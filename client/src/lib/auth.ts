import { useAuthStore } from './store';
import { decodeJwtPayload } from './jwt';
import { emitSessionEvent } from './sessionCoordinator';

let refreshTimeout: NodeJS.Timeout | null = null;
let refreshInterval: NodeJS.Timeout | null = null;

const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // резервная проверка каждые 10 минут

/**
 * Настраивает автоматическое обновление токена доступа перед его истечением.
 * @param expiresInMs Длительность жизни токена в миллисекундах (НЕ абсолютный timestamp)
 */
export const setupTokenRefresh = (expiresInMs: number) => {
  if (typeof window === 'undefined') return;

  if (refreshTimeout) {
    clearTimeout(refreshTimeout);
    refreshTimeout = null;
  }

  // Минимум 60 секунд, обновляем на 80% жизни токена
  const refreshIn = Math.max(Math.floor(expiresInMs * 0.8), 60_000);

  refreshTimeout = setTimeout(() => {
    refreshAccessToken().catch(err => {
      console.error('[auth] Ошибка планового обновления токена:', err);
    });
  }, refreshIn);
};

/** Schedules refresh from the JWT's actual expiry instead of a guessed lifetime. */
export const setupTokenRefreshFromToken = (token: string) => {
  try {
    const payload = decodeJwtPayload(token);
    if (!payload?.exp) throw new Error('JWT has no expiry');
    const expiresInMs = payload.exp * 1000 - Date.now();
    setupTokenRefresh(Math.max(expiresInMs, 0));
  } catch {
    setupTokenRefresh(15 * 60 * 1000);
  }
};

/**
 * Запускает резервный интервал — обновляет токен каждые 10 минут.
 * Защита на случай сбоя цепочки setTimeout.
 */
export const startRefreshInterval = () => {
  if (typeof window === 'undefined') return;
  if (refreshInterval) return; // уже запущен

  refreshInterval = setInterval(() => {
    const token = localStorage.getItem('auth_token');
    const refreshToken = localStorage.getItem('refresh_token');
    if (token && refreshToken) {
      refreshAccessToken().catch(err => {
        console.error('[auth] Ошибка резервного обновления токена:', err);
      });
    }
  }, REFRESH_INTERVAL_MS);
};

export const stopRefreshInterval = () => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  if (refreshTimeout) {
    clearTimeout(refreshTimeout);
    refreshTimeout = null;
  }
};

/**
 * Обновляет токен доступа с использованием refresh_token.
 */
export const refreshAccessToken = async (): Promise<string> => {
  const { refreshAuthSession } = await import('./refreshAuth');
  const result = await refreshAuthSession();

  if (result === 'invalid') {
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_id');
    useAuthStore.getState().clearAuth();
    emitSessionEvent('invalid');
    throw new Error('AUTH_SESSION_INVALID');
  }
  if (result === 'unavailable') {
    emitSessionEvent('unavailable');
    throw new Error('AUTH_REFRESH_UNAVAILABLE');
  }
  if (result === 'superseded') {
    const currentToken = localStorage.getItem('auth_token');
    if (!currentToken) throw new Error('AUTH_SESSION_SUPERSEDED');
    return currentToken;
  }
  if (result === 'session_changed') throw new Error('AUTH_SESSION_SUPERSEDED');

  const token = localStorage.getItem('auth_token');
  if (!token) throw new Error('AUTH_REFRESH_INVALID_RESPONSE');
  setupTokenRefreshFromToken(token);
  return token;
};

/**
 * Выполняет вход через локальный API.
 */
export const loginWithDirectus = async (email: string, password: string) => {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ошибка входа: ${response.statusText}`);
  }

  const authData = await response.json();

  if (!authData.token || !authData.refresh_token || !authData.user?.id) {
    throw new Error('Неверный формат ответа от сервера');
  }

  const access_token = authData.token;
  const refresh_token = authData.refresh_token;
  const userId = authData.user.id;

  localStorage.setItem('auth_token', access_token);
  localStorage.setItem('refresh_token', refresh_token);
  localStorage.setItem('user_id', userId);

  useAuthStore.getState().setAuth(access_token, userId);

  // expires от логина — секунды (86400 = 24h)
  const expiresInMs = (authData.expires || 900) * 1000;
  setupTokenRefresh(expiresInMs);
  startRefreshInterval();

  return { access_token, user: authData.user };
};

/**
 * Выполняет выход из системы.
 */
export const logout = async () => {
  stopRefreshInterval();

  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
      },
    });
  } catch (e) {
    console.warn('[auth] Ошибка при выходе через API:', e);
  }

  const AUTH_KEYS = ['auth_token', 'refresh_token', 'user_id', 'is_admin', 'selected_campaign_id', 'selected_campaign_name'];
  AUTH_KEYS.forEach(key => localStorage.removeItem(key));
  try { sessionStorage.clear(); } catch {}

  useAuthStore.getState().clearAuth();
  const { queryClient } = await import('./queryClient');
  queryClient.clear();
};

/**
 * Получает текущий токен аутентификации из localStorage.
 */
export const getToken = async (): Promise<string> => {
  const token = localStorage.getItem('auth_token');
  if (!token) {
    return refreshAccessToken();
  }
  return token;
};

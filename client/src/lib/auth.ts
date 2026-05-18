import { useAuthStore } from './store';

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
  const refreshToken = localStorage.getItem('refresh_token');
  const userId = localStorage.getItem('user_id');

  if (!refreshToken) {
    throw new Error('No refresh token available');
  }

  let apiResponse: Response;
  try {
    apiResponse = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      body: JSON.stringify({ refresh_token: refreshToken, user_id: userId }),
    });
  } catch (networkError) {
    // Сетевая ошибка — НЕ выходим из системы, просто ждём следующей попытки
    console.warn('[auth] Сетевая ошибка при обновлении токена, попробуем позже');
    throw networkError;
  }

  if (!apiResponse.ok) {
    if (apiResponse.status === 401) {
      // Refresh token истёк — тихо чистим только refresh_token
      localStorage.removeItem('refresh_token');
      console.warn('[auth] Refresh token истёк');
      return localStorage.getItem('auth_token') || '';
    }
    const errorText = await apiResponse.text().catch(() => '');
    console.error(`[auth] Ошибка обновления токена: ${apiResponse.status}`, errorText);
    // НЕ выходим из системы — временная ошибка сервера
    throw new Error(`Token refresh failed: ${apiResponse.status}`);
  }

  const data = await apiResponse.json();

  if (!data.success || !data.token) {
    console.error('[auth] Неверный формат ответа при обновлении токена:', data);
    throw new Error('Invalid token refresh response');
  }

  // Обновляем токены
  localStorage.setItem('auth_token', data.token);
  if (data.refresh_token) {
    localStorage.setItem('refresh_token', data.refresh_token);
  }

  // Обновляем store
  useAuthStore.getState().setAuth(data.token, userId);

  // expires_at — абсолютный Unix timestamp в мс от Directus
  // Конвертируем в длительность
  let expiresInMs: number;
  if (data.expires_at && data.expires_at > Date.now()) {
    expiresInMs = data.expires_at - Date.now();
  } else if (data.expires && data.expires > 0) {
    // expires может быть секундами или мс
    expiresInMs = data.expires < 10_000 ? data.expires * 1000 : data.expires;
  } else {
    expiresInMs = 15 * 60 * 1000; // 15 минут по умолчанию
  }

  setupTokenRefresh(expiresInMs);

  return data.token;
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

  if (!authData.token) {
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

/**
 * Утилита для обновления токена авторизации
 * Используется для предотвращения проблем с истекшими токенами при планировании публикаций
 */

import { useAuthStore } from "./store";
import { decodeJwtPayload } from './jwt';
import { emitSessionEvent, getSessionSnapshot, isSameSession } from './sessionCoordinator';

export type RefreshAuthResult = 'refreshed' | 'superseded' | 'session_changed' | 'invalid' | 'unavailable';

let refreshInFlight: Promise<RefreshAuthResult> | null = null;

async function performRefresh(refreshToken: string, session = getSessionSnapshot()): Promise<RefreshAuthResult> {
  if (!isSameSession(session)) return 'session_changed';
  if (localStorage.getItem('refresh_token') !== refreshToken) {
    const currentToken = localStorage.getItem('auth_token');
    const userId = currentToken ? decodeJwtPayload(currentToken)?.id : null;
    if (!currentToken || !userId || userId !== session.userId) return 'session_changed';
    useAuthStore.getState().syncAuth(currentToken, userId);
    return 'superseded';
  }
  if (!refreshToken) return 'invalid';

  let response: Response;
  try {
    response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    return 'unavailable';
  }

  if (response.status === 400 || response.status === 401) return 'invalid';
  if (!response.ok) return 'unavailable';

  const data = await response.json().catch(() => null);
  if (!data?.token) return 'unavailable';

  // A logout or another login happened while this request was in flight.
  // Never let the stale response overwrite the newer account/session.
  if (!isSameSession(session)) return 'session_changed';
  if (localStorage.getItem('refresh_token') !== refreshToken) return 'superseded';

  const userId = decodeJwtPayload(data.token)?.id;
  if (!userId) return 'unavailable';

  localStorage.setItem('auth_token', data.token);
  if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
  useAuthStore.getState().setAuth(data.token, userId);
  emitSessionEvent('refreshed');
  return 'refreshed';
}

export async function refreshAuthSession(): Promise<RefreshAuthResult> {
  if (!refreshInFlight) {
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) {
      emitSessionEvent('invalid');
      return 'invalid';
    }
    const session = getSessionSnapshot();
    const coordinatedRefresh = async () => performRefresh(refreshToken, session);
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    refreshInFlight = (locks
      ? locks.request('smm-auth-refresh', { mode: 'exclusive' }, coordinatedRefresh)
      : coordinatedRefresh()
    ).then((result) => {
      if (result === 'invalid' || result === 'unavailable') emitSessionEvent(result);
      return result;
    }).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Backwards-compatible boolean API for existing callers. */
export async function refreshAuthToken(): Promise<boolean> {
  const result = await refreshAuthSession();
  return result === 'refreshed' || result === 'superseded';
}

/**
 * Проверяет валидность текущего токена через запрос к API
 * @returns Promise с результатом проверки (true - токен валидный, false - токен невалидный)
 */
export async function validateCurrentToken(): Promise<boolean> {
  const token = localStorage.getItem('auth_token');
  
  if (!token) {
    console.log('Нет токена для проверки');
    return false;
  }
  
  try {
    const response = await fetch('/api/auth/check', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    return response.ok;
  } catch (error) {
    console.error('Ошибка при проверке токена:', error);
    return false;
  }
}

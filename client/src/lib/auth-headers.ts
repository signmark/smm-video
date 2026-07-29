/**
 * Заголовок авторизации для «сырых» вызовов fetch.
 *
 * Большинство запросов идёт через apiRequest/queryClient, которые подставляют
 * токен сами. Но часть кода зовёт fetch напрямую и заголовок не ставила вовсе —
 * такие ручки работали лишь потому, что глобального гейта на /api не было.
 * После появления гейта (server/middleware/api-auth-gate.ts) они обязаны
 * представляться, как и все остальные.
 *
 * Токен читаем из тех же ключей, что и остальной клиент.
 */
export function getStoredAuthToken(): string | null {
  return localStorage.getItem('auth_token')
    || localStorage.getItem('authToken')
    || localStorage.getItem('token');
}

/**
 * Заголовки для fetch. Пустой объект, если токена нет — вызывающий сам решает,
 * что делать с 401, а мы не подставляем строку «Bearer null».
 */
export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getStoredAuthToken();
  return token ? { Authorization: `Bearer ${token}`, ...extra } : { ...extra };
}

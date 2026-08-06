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

// refreshAuthSession is imported dynamically inside fetchWithAuth
// to avoid the static import chain refreshAuth → store → campaignStore
// which breaks vitest in node environment (no localStorage).

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
  const userId = localStorage.getItem('user_id');
  const headers: Record<string, string> = { ...extra };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (userId) {
    headers['x-user-id'] = userId;
  }
  return headers;
}

/**
 * fetch с автоматической подстановкой auth-заголовков и ретраем при 401.
 *
 * Используй вместо сырого fetch() для любых вызовов к /api/*, которые ещё
 * не переведены на apiClient / apiRequest.
 *
 * При 401 делает одну попытку обновить токен через refreshAuthSession и
 * повторяет исходный запрос. Если refresh не удался — пробрасывает 401.
 *
 * Импорт refreshAuthSession — динамический, чтобы статическая цепочка
 * refreshAuth → store → campaignStore не ломала vitest node-окружение.
 */
export async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = authHeaders(
    options.headers
      ? Object.fromEntries(
          options.headers instanceof Headers
            ? [...options.headers.entries()]
            : Array.isArray(options.headers)
              ? options.headers
              : Object.entries(options.headers)
        )
      : {},
  );

  let response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    // Dynamic import — see module-level comment
    const { refreshAuthSession } = await import('./refreshAuth');
    const refreshResult = await refreshAuthSession();
    if (refreshResult === 'refreshed' || refreshResult === 'superseded') {
      const newHeaders = authHeaders(
        options.headers
          ? Object.fromEntries(
              options.headers instanceof Headers
                ? [...options.headers.entries()]
                : Array.isArray(options.headers)
                  ? options.headers
                  : Object.entries(options.headers)
            )
          : {},
      );
      response = await fetch(url, { ...options, headers: newHeaders });
    }
  }

  return response;
}

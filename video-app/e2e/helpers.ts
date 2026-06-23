import { BASE_URL, TIMEOUTS } from './config.js';

export type ApiResponse<T = unknown> = {
  status: number;
  ok: boolean;
  body: T;
};

export async function api<T = unknown>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<ApiResponse<T>> {
  const { token, headers: extraHeaders, ...rest } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((extraHeaders as Record<string, string>) ?? {}),
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers,
    signal: AbortSignal.timeout(TIMEOUTS.request),
  });

  let body: T;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    body = (await res.json()) as T;
  } else {
    body = (await res.text()) as unknown as T;
  }

  return { status: res.status, ok: res.ok, body };
}

export const get  = <T = unknown>(path: string, token?: string)               => api<T>(path, { method: 'GET', token });
export const del  = <T = unknown>(path: string, token?: string)               => api<T>(path, { method: 'DELETE', token });
export const post = <T = unknown>(path: string, body: unknown, token?: string) => api<T>(path, { method: 'POST',  body: JSON.stringify(body), token });
export const patch= <T = unknown>(path: string, body: unknown, token?: string) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body), token });

/**
 * Поллинг: запрашивает GET path каждые intervalMs пока predicate не вернёт true.
 * Бросает ошибку если таймаут истёк.
 */
export async function pollUntil<T = unknown>(
  path: string,
  predicate: (body: T) => boolean,
  opts: { timeoutMs: number; intervalMs?: number; token?: string },
): Promise<T> {
  const { timeoutMs, intervalMs = 3000, token } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await get<T>(path, token);
    if (predicate(body)) return body;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  const { body } = await get<T>(path, token);
  throw new Error(
    `pollUntil timeout after ${timeoutMs}ms. Last: ${JSON.stringify(body).slice(0, 300)}`,
  );
}

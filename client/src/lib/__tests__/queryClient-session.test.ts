import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('apiRequest session binding', () => {
  beforeEach(() => {
    vi.resetModules();
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });

  it('never replays an account A mutation with account B credentials after a late 401', async () => {
    const { useAuthStore } = await import('../store');
    const { apiRequest } = await import('../queryClient');
    useAuthStore.getState().setAuth('token-a', 'user-a');
    localStorage.setItem('refresh_token', 'refresh-a');

    let resolveRequest!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveRequest = resolve; }));
    vi.stubGlobal('fetch', fetchMock);

    const mutation = apiRequest('/api/resource', { method: 'PATCH', data: { value: 1 } });
    useAuthStore.getState().setAuth('token-b', 'user-b');
    localStorage.setItem('refresh_token', 'refresh-b');
    resolveRequest(new Response('{}', { status: 401 }));

    await expect(mutation).rejects.toThrow('AUTH_SESSION_CHANGED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer token-a' });
  });

  it('never exposes a late successful account A response after switching to account B', async () => {
    const { useAuthStore } = await import('../store');
    const { apiRequest } = await import('../queryClient');
    useAuthStore.getState().setAuth('token-a', 'user-a');

    let resolveRequest!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveRequest = resolve; })));

    const request = apiRequest('/api/private-data');
    useAuthStore.getState().setAuth('token-b', 'user-b');
    resolveRequest(new Response(JSON.stringify({ owner: 'user-a' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(request).rejects.toThrow('AUTH_SESSION_CHANGED');
  });
});

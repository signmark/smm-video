import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authHeaders, getStoredAuthToken } from '../auth-headers';

// Mock refreshAuthSession to avoid pulling in zustand/campaignStore chain
vi.mock('../refreshAuth', () => ({
  refreshAuthSession: vi.fn(),
}));

// Minimal localStorage stub for node environment
function fakeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal('localStorage', storage);
});

describe('authHeaders', () => {
  it('returns Authorization + x-user-id when token and user_id present', () => {
    storage.setItem('auth_token', 'token-abc');
    storage.setItem('user_id', 'user-1');

    const headers = authHeaders();
    expect(headers['Authorization']).toBe('Bearer token-abc');
    expect(headers['x-user-id']).toBe('user-1');
  });

  it('returns empty object when no token stored', () => {
    const headers = authHeaders();
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['x-user-id']).toBeUndefined();
  });

  it('preserves extra headers', () => {
    storage.setItem('auth_token', 'token-abc');
    const headers = authHeaders({ 'Content-Type': 'application/json' });
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBe('Bearer token-abc');
  });

  it('reads from authToken fallback', () => {
    storage.setItem('authToken', 'fallback-token');
    storage.setItem('user_id', 'user-2');

    const headers = authHeaders();
    expect(headers['Authorization']).toBe('Bearer fallback-token');
    expect(headers['x-user-id']).toBe('user-2');
  });

  it('reads from token fallback (last resort)', () => {
    storage.setItem('token', 'last-token');
    storage.setItem('user_id', 'user-3');

    const headers = authHeaders();
    expect(headers['Authorization']).toBe('Bearer last-token');
    expect(headers['x-user-id']).toBe('user-3');
  });
});

describe('getStoredAuthToken', () => {
  it('prefers auth_token over authToken', () => {
    storage.setItem('auth_token', 'primary');
    storage.setItem('authToken', 'secondary');
    expect(getStoredAuthToken()).toBe('primary');
  });

  it('falls back to token', () => {
    storage.setItem('token', 'tertiary');
    expect(getStoredAuthToken()).toBe('tertiary');
  });

  it('returns null when empty', () => {
    expect(getStoredAuthToken()).toBeNull();
  });
});

describe('fetchWithAuth', () => {
  it('adds Authorization and x-user-id headers', async () => {
    storage.setItem('auth_token', 'token-abc');
    storage.setItem('user_id', 'user-1');

    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const { fetchWithAuth } = await import('../auth-headers');
    await fetchWithAuth('/api/test');

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers).toHaveProperty('Authorization', 'Bearer token-abc');
    expect(init.headers).toHaveProperty('x-user-id', 'user-1');
  });

  it('retries with refreshed token on 401', async () => {
    storage.setItem('auth_token', 'expired-token');
    storage.setItem('refresh_token', 'refresh-xyz');
    storage.setItem('user_id', 'user-1');

    const { refreshAuthSession } = await import('../refreshAuth');
    const mockRefresh = vi.mocked(refreshAuthSession);

    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      callCount++;
      const auth = (init?.headers as Record<string, string>)?.Authorization || '';

      if (callCount === 1) {
        expect(auth).toBe('Bearer expired-token');
        return new Response('', { status: 401 });
      }

      // Retry after refresh
      expect(auth).toBe('Bearer fresh-token');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', mockFetch);

    // Simulate: refresh succeeded, token updated INSIDE the refresh mock
    // so fetchWithAuth re-reads it after refresh, not before
    mockRefresh.mockImplementation(async () => {
      storage.setItem('auth_token', 'fresh-token');
      return 'refreshed';
    });

    const { fetchWithAuth } = await import('../auth-headers');
    const response = await fetchWithAuth('/api/protected');

    expect(response.status).toBe(200);
    expect(callCount).toBe(2); // initial 401 + retry (refresh is mocked)
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not retry on non-401 errors', async () => {
    storage.setItem('auth_token', 'token-abc');
    storage.setItem('user_id', 'user-1');

    const mockFetch = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    vi.stubGlobal('fetch', mockFetch);

    const { fetchWithAuth } = await import('../auth-headers');
    const response = await fetchWithAuth('/api/error');
    expect(response.status).toBe(500);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('passes through method, body, and custom headers', async () => {
    storage.setItem('auth_token', 'token-abc');
    storage.setItem('user_id', 'user-1');

    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const { fetchWithAuth } = await import('../auth-headers');
    await fetchWithAuth('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'value' }),
    });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers).toHaveProperty('Content-Type', 'application/json');
    expect(init.body).toBe(JSON.stringify({ key: 'value' }));
  });

  it('does not add Authorization when no token stored', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const { fetchWithAuth } = await import('../auth-headers');
    await fetchWithAuth('/api/public');

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('does not retry when refresh fails', async () => {
    storage.setItem('auth_token', 'expired-token');
    storage.setItem('refresh_token', 'refresh-xyz');
    storage.setItem('user_id', 'user-1');

    const { refreshAuthSession } = await import('../refreshAuth');
    const mockRefresh = vi.mocked(refreshAuthSession);
    mockRefresh.mockResolvedValue('invalid');

    const mockFetch = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', mockFetch);

    const { fetchWithAuth } = await import('../auth-headers');
    const response = await fetchWithAuth('/api/protected');

    expect(response.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

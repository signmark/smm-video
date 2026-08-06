import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithAuth } from '../auth-headers';

// Mock localStorage
const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => storage.get(String(key)) ?? null);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => storage.set(String(key), String(value)));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setTokens(auth_token: string, refresh_token?: string) {
  storage.set('auth_token', auth_token);
  if (refresh_token) storage.set('refresh_token', refresh_token);
  storage.set('user_id', 'user-1');
}

describe('fetchWithAuth', () => {
  it('adds Authorization and x-user-id headers', async () => {
    setTokens('token-abc');
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    await fetchWithAuth('/api/test');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/test');
    expect(init.headers).toHaveProperty('Authorization', 'Bearer token-abc');
    expect(init.headers).toHaveProperty('x-user-id', 'user-1');
  });

  it('retries with refreshed token on 401', async () => {
    setTokens('expired-token', 'refresh-xyz');
    storage.set('user_id', 'user-1');

    // First call: 401
    // Then refresh call: 200 with new token
    // Then retry: 200
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      callCount++;
      const auth = (init?.headers as Record<string, string>)?.Authorization || '';

      if (callCount === 1) {
        // Initial request — 401
        expect(auth).toBe('Bearer expired-token');
        return new Response('', { status: 401 });
      }

      if (callCount === 2) {
        // Refresh call (from refreshAuthSession internals)
        return new Response(JSON.stringify({ token: 'fresh-token', refresh_token: 'fresh-refresh' }), { status: 200 });
      }

      // Retry with fresh token
      expect(auth).toBe('Bearer fresh-token');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', mockFetch);
    // Mock navigator.locks for refreshAuthSession
    vi.stubGlobal('navigator', { locks: undefined });

    const response = await fetchWithAuth('/api/protected');
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual({ ok: true });
    expect(callCount).toBe(3); // initial + refresh + retry
  });

  it('does not retry on non-401 errors', async () => {
    setTokens('token-abc');
    const mockFetch = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    vi.stubGlobal('fetch', mockFetch);

    const response = await fetchWithAuth('/api/error');
    expect(response.status).toBe(500);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('passes through non-auth headers', async () => {
    setTokens('token-abc');
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    await fetchWithAuth('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'value' }),
    });

    const [_, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers).toHaveProperty('Content-Type', 'application/json');
    expect(init.body).toBe(JSON.stringify({ key: 'value' }));
  });

  it('does not add Authorization when no token stored', async () => {
    storage.clear(); // no token
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    await fetchWithAuth('/api/public');
    const [_, init] = mockFetch.mock.calls[0];
    expect(init.headers).not.toHaveProperty('Authorization');
  });
});

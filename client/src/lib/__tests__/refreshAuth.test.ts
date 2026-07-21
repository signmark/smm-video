import { beforeEach, describe, expect, it, vi } from 'vitest';

const setAuth = vi.fn();
const syncAuth = vi.fn();

vi.mock('../store', () => ({
  useAuthStore: {
    getState: () => ({ setAuth, syncAuth }),
  },
}));

import { refreshAuthSession } from '../refreshAuth';

describe('refreshAuthSession', () => {
  const values = new Map<string, string>();
  const tokenFor = (userId: string) => {
    const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${encode({ alg: 'none' })}.${encode({ id: userId })}.signature`;
  };

  beforeEach(() => {
    values.clear();
    values.set('refresh_token', 'refresh-token');
    values.set('user_id', 'user-1');
    values.set('auth_session_id', 'session-1');
    setAuth.mockClear();
    syncAuth.mockClear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });

  it('stores a refreshed access token and rotated refresh token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      token: tokenFor('verified-user'),
      refresh_token: 'new-refresh-token',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(refreshAuthSession()).resolves.toBe('refreshed');
    expect(values.get('auth_token')).toBe(tokenFor('verified-user'));
    expect(values.get('refresh_token')).toBe('new-refresh-token');
    expect(setAuth).toHaveBeenCalledWith(tokenFor('verified-user'), 'verified-user');
    expect(JSON.parse((fetch as any).mock.calls[0][1].body)).toEqual({ refresh_token: 'refresh-token' });
  });

  it('distinguishes an invalid refresh token from a temporary outage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    await expect(refreshAuthSession()).resolves.toBe('invalid');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    await expect(refreshAuthSession()).resolves.toBe('unavailable');
  });

  it('deduplicates concurrent refresh attempts so a rotating token is used once', async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);

    const first = refreshAuthSession();
    const second = refreshAuthSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(new Response(JSON.stringify({ token: tokenFor('user-1') }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(Promise.all([first, second])).resolves.toEqual(['refreshed', 'refreshed']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite a newer login with a late refresh response', async () => {
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })));

    const refresh = refreshAuthSession();
    values.set('refresh_token', 'new-login-refresh');
    values.set('auth_token', tokenFor('new-user'));
    values.set('user_id', 'new-user');
    values.set('auth_session_id', 'session-2');
    resolveFetch(new Response(JSON.stringify({
      token: tokenFor('old-user'), refresh_token: 'rotated-old-refresh',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(refresh).resolves.toBe('session_changed');
    expect(values.get('auth_token')).toBe(tokenFor('new-user'));
    expect(setAuth).not.toHaveBeenCalled();
  });

  it('syncs the current access token after another tab rotates the same session', async () => {
    values.set('auth_token', tokenFor('user-1'));
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn(async (_name, _options, callback) => {
          values.set('refresh_token', 'rotated-by-first-tab');
          values.set('auth_token', tokenFor('user-1'));
          return callback();
        }),
      },
    });
    vi.stubGlobal('fetch', vi.fn());

    await expect(refreshAuthSession()).resolves.toBe('superseded');
    expect(syncAuth).toHaveBeenCalledWith(tokenFor('user-1'), 'user-1');
    expect(fetch).not.toHaveBeenCalled();
  });
});

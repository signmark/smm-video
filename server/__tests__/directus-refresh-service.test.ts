import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  refreshDirectusSession,
  resetDirectusRefreshCoordinatorForTests,
} from '../services/directus-refresh-service';

describe('refreshDirectusSession', () => {
  beforeEach(() => resetDirectusRefreshCoordinatorForTests());

  it('derives the session owner from Directus instead of client input', async () => {
    const dependencies = {
      refresh: vi.fn().mockResolvedValue({ data: { data: {
        access_token: 'access-victim', refresh_token: 'refresh-next', expires_at: 123,
      } } }),
      getCurrentUser: vi.fn().mockResolvedValue({ data: { data: { id: 'verified-victim' } } }),
    };

    await expect(refreshDirectusSession('refresh-original', dependencies)).resolves.toEqual(
      expect.objectContaining({ status: 'success', userId: 'verified-victim' }),
    );
    expect(dependencies.getCurrentUser).toHaveBeenCalledWith('access-victim');
  });

  it('coalesces only requests that present the same refresh token', async () => {
    let resolveRefresh!: (value: any) => void;
    const pending = new Promise((resolve) => { resolveRefresh = resolve; });
    const dependencies = {
      refresh: vi.fn().mockReturnValue(pending),
      getCurrentUser: vi.fn().mockResolvedValue({ data: { data: { id: 'user-1' } } }),
    };

    const first = refreshDirectusSession('same-refresh', dependencies);
    const second = refreshDirectusSession('same-refresh', dependencies);
    resolveRefresh({ data: { data: { access_token: 'a', refresh_token: 'r2' } } });

    await Promise.all([first, second]);
    expect(dependencies.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not coalesce different refresh tokens even if a caller spoofs the same user id', async () => {
    const dependencies = {
      refresh: vi.fn((token: string) => Promise.resolve({ data: { data: {
        access_token: `access-${token}`, refresh_token: `next-${token}`,
      } } })),
      getCurrentUser: vi.fn().mockResolvedValue({ data: { data: { id: 'same-user' } } }),
    };

    await Promise.all([
      refreshDirectusSession('refresh-a', dependencies),
      refreshDirectusSession('refresh-b', dependencies),
    ]);
    expect(dependencies.refresh).toHaveBeenCalledTimes(2);
  });

  it.each([
    [400, 'invalid'], [401, 'invalid'], [429, 'rate_limited'], [500, 'unavailable'],
  ])('maps Directus HTTP %s to %s', async (httpStatus, expected) => {
    const dependencies = {
      refresh: vi.fn().mockRejectedValue({ response: { status: httpStatus } }),
      getCurrentUser: vi.fn(),
    };
    await expect(refreshDirectusSession(`refresh-${httpStatus}`, dependencies))
      .resolves.toEqual({ status: expected });
  });
});

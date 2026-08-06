import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicationLockManager } from '../services/publication-lock-manager';

// Mock directusApi
vi.mock('../directus', () => ({
  directusApi: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { directusApi } from '../directus';

function mockAvailable() {
  const m = directusApi as any;
  m.get.mockResolvedValue({ data: { data: [] } });
  m.post.mockResolvedValue({ data: { data: { id: 'new-lock-id', lock_key: 'content-1:tg' } } });
  m.delete.mockResolvedValue({ data: {} });
}

function mockDown() {
  const m = directusApi as any;
  m.get.mockRejectedValue(new Error('ECONNREFUSED'));
  m.post.mockRejectedValue(new Error('ECONNREFUSED'));
  m.delete.mockRejectedValue(new Error('ECONNREFUSED'));
}

function mockUniqueViolation() {
  const err = new Error('Unique violation');
  (err as any).response = {
    data: { errors: [{ extensions: { code: 'RECORD_NOT_UNIQUE' } }] },
  };
  (directusApi as any).post.mockRejectedValue(err);
}

function mockExistingLock(id: string, lockKey: string, expiresOffset: number = 600000) {
  (directusApi as any).get.mockResolvedValue({
    data: {
      data: [{
        id,
        lock_key: lockKey,
        content_id: lockKey.split(':')[0],
        platform: lockKey.split(':')[1],
        acquired_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + expiresOffset).toISOString(),
      }],
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAvailable();
});

describe('PublicationLockManager (Directus-based)', () => {
  it('acquireLock succeeds and remembers held id', async () => {
    const mgr = new PublicationLockManager();
    const result = await mgr.acquireLock('content-1', 'telegram');
    expect(result).toBe(true);
    expect(directusApi.post).toHaveBeenCalledWith('/items/publication_locks', expect.objectContaining({
      lock_key: 'content-1:telegram',
      content_id: 'content-1',
      platform: 'telegram',
    }));
  });

  it('acquireLock returns false when lock already exists (not expired)', async () => {
    mockExistingLock('existing-id', 'content-1:telegram', 600000);

    const mgr = new PublicationLockManager();
    const result = await mgr.acquireLock('content-1', 'telegram');
    expect(result).toBe(false);
    expect(directusApi.post).not.toHaveBeenCalled();
  });

  it('acquireLock cleans up expired lock and acquires', async () => {
    mockExistingLock('stale-id', 'content-1:telegram', -1000); // expired 1s ago

    const mgr = new PublicationLockManager();
    const result = await mgr.acquireLock('content-1', 'telegram');
    expect(result).toBe(true);
    expect(directusApi.delete).toHaveBeenCalledWith('/items/publication_locks/stale-id');
    expect(directusApi.post).toHaveBeenCalled();
  });

  it('acquireLock returns false on RECORD_NOT_UNIQUE (concurrent acquire)', async () => {
    // First get returns empty (no existing lock visible), then post fails with unique violation
    (directusApi as any).get.mockResolvedValue({ data: { data: [] } });
    mockUniqueViolation();

    const mgr = new PublicationLockManager();
    const result = await mgr.acquireLock('content-1', 'telegram');
    expect(result).toBe(false);
  });

  it('acquireLock returns false (fail-closed) when Directus is down', async () => {
    mockDown();

    const mgr = new PublicationLockManager();
    const result = await mgr.acquireLock('content-1', 'telegram');
    // FAIL-CLOSED: duplicate post is worse than delayed post
    expect(result).toBe(false);
  });

  it('releaseLock deletes by held id, never by content/platform alone', async () => {
    // Acquire
    (directusApi as any).post.mockResolvedValue({
      data: { data: { id: 'my-lock-id', lock_key: 'content-1:tg' } },
    });
    const mgr = new PublicationLockManager();
    await mgr.acquireLock('content-1', 'telegram');

    // Reset mocks for release
    vi.clearAllMocks();
    mockAvailable();

    await mgr.releaseLock('content-1', 'telegram');
    expect(directusApi.delete).toHaveBeenCalledWith('/items/publication_locks/my-lock-id');
    // Should NOT do a get to find the lock — it uses the held id
    expect(directusApi.get).not.toHaveBeenCalled();
  });

  it('releaseLock does not delete when no held id (was from another process)', async () => {
    const mgr = new PublicationLockManager();
    // No acquire — no held id
    await mgr.releaseLock('content-1', 'telegram');
    // Should check if expired and clean up, but not blindly delete
    expect(directusApi.delete).not.toHaveBeenCalled();
  });

  it('isLocked returns false when Directus is down (fail-safe)', async () => {
    mockDown();

    const mgr = new PublicationLockManager();
    const result = await mgr.isLocked('content-1', 'telegram');
    expect(result).toBe(false);
  });

  it('isLocked returns false for expired lock (and cleans it up)', async () => {
    mockExistingLock('stale-id', 'content-1:telegram', -1000);

    const mgr = new PublicationLockManager();
    const result = await mgr.isLocked('content-1', 'telegram');
    expect(result).toBe(false);
    expect(directusApi.delete).toHaveBeenCalledWith('/items/publication_locks/stale-id');
  });

  it('releaseAllLocks deletes all matching records by id', async () => {
    (directusApi as any).get.mockResolvedValue({
      data: {
        data: [
          { id: 'lock-1', lock_key: 'content-1:tg', content_id: 'content-1' },
          { id: 'lock-2', lock_key: 'content-1:vk', content_id: 'content-1' },
        ],
      },
    });

    const mgr = new PublicationLockManager();
    await mgr.releaseAllLocks('content-1');
    expect(directusApi.delete).toHaveBeenCalledTimes(2);
    expect(directusApi.delete).toHaveBeenCalledWith('/items/publication_locks/lock-1');
    expect(directusApi.delete).toHaveBeenCalledWith('/items/publication_locks/lock-2');
  });

  it('shutdown cleans up intervals and held ids', () => {
    const mgr = new PublicationLockManager();
    mgr.initCleanupSchedule();
    mgr.shutdown();
    // No error = pass
  });

  it('probeCollectionHealth logs error when collection missing, does not throw', async () => {
    (directusApi as any).get.mockRejectedValue({ response: { status: 403 } });

    const mgr = new PublicationLockManager();
    // Should not throw — probe is advisory
    await expect(mgr.probeCollectionHealth()).resolves.toBeUndefined();
  });

  it('acquireLock returns false on 403 (missing collection) — fail-closed', async () => {
    const err = new Error('Forbidden');
    (err as any).response = { status: 403, data: { errors: [{ extensions: { code: 'FORBIDDEN' } }] } };
    (directusApi as any).get.mockResolvedValue({ data: { data: [] } });
    (directusApi as any).post.mockRejectedValue(err);

    const mgr = new PublicationLockManager();
    const result = await mgr.acquireLock('content-1', 'telegram');
    // 403 is not RECORD_NOT_UNIQUE → should go to fail-closed branch
    expect(result).toBe(false);
  });
});

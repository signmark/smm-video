import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PublicationLockManager } from '../services/publication-lock-manager';
import axios from 'axios';

// Mock directusApi — it's a named export from ../directus
vi.mock('../directus', () => ({
  directusApi: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { directusApi } from '../directus';

function mockDirectusAvailable() {
  const m = directusApi as any;
  m.get.mockResolvedValue({ data: { data: [] } });
  m.post.mockResolvedValue({ data: {} });
  m.delete.mockResolvedValue({ data: {} });
}

function mockDirectusDown() {
  const m = directusApi as any;
  m.get.mockRejectedValue(new Error('ECONNREFUSED'));
  m.post.mockRejectedValue(new Error('ECONNREFUSED'));
  m.delete.mockRejectedValue(new Error('ECONNREFUSED'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDirectusAvailable();
});

describe('PublicationLockManager (Directus-based)', () => {
  it('acquireLock returns true on first attempt', async () => {
    const mgr = new PublicationLockManager();
    const result = await mgr.acquireLock('content-1', 'telegram');
    expect(result).toBe(true);
    expect(directusApi.post).toHaveBeenCalledWith('/items/publication_locks', expect.objectContaining({
      content_id: 'content-1',
      platform: 'telegram',
    }));
  });

  it('acquireLock returns false when lock already exists', async () => {
    (directusApi.get as any).mockResolvedValue({
      data: {
        data: [{
          id: 'lock-1',
          content_id: 'content-1',
          platform: 'telegram',
          acquired_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 600000).toISOString(),
        }],
      },
    });

    const mgr = new PublicationLockManager();
    const result = await mgr.acquireLock('content-1', 'telegram');
    expect(result).toBe(false);
    expect(directusApi.post).not.toHaveBeenCalled();
  });

  it('acquireLock cleans up expired lock and acquires', async () => {
    // Return an expired lock
    (directusApi.get as any).mockResolvedValue({
      data: {
        data: [{
          id: 'stale-lock',
          content_id: 'content-1',
          platform: 'telegram',
          acquired_at: new Date(Date.now() - 3600000).toISOString(),
          expires_at: new Date(Date.now() - 1000).toISOString(), // expired
        }],
      },
    });

    const mgr = new PublicationLockManager();
    const result = await mgr.acquireLock('content-1', 'telegram');
    expect(result).toBe(true);
    expect(directusApi.delete).toHaveBeenCalledWith('/items/publication_locks/stale-lock');
    expect(directusApi.post).toHaveBeenCalled();
  });

  it('acquireLock returns false (fail-closed) when Directus is down', async () => {
    mockDirectusDown();

    const mgr = new PublicationLockManager();
    const result = await mgr.acquireLock('content-1', 'telegram');
    // FAIL-CLOSED: duplicate post is worse than delayed post
    expect(result).toBe(false);
  });

  it('isLocked returns false when Directus is down (fail-safe)', async () => {
    mockDirectusDown();

    const mgr = new PublicationLockManager();
    const result = await mgr.isLocked('content-1', 'telegram');
    // On error, assume not locked — let the acquireLock handle the check
    expect(result).toBe(false);
  });

  it('releaseLock is no-op when Directus is down', async () => {
    mockDirectusDown();

    const mgr = new PublicationLockManager();
    // Should not throw
    await expect(mgr.releaseLock('content-1', 'telegram')).resolves.toBeUndefined();
  });

  it('releaseAllLocks deletes all matching records', async () => {
    (directusApi.get as any).mockResolvedValue({
      data: {
        data: [
          { id: 'lock-1', content_id: 'content-1', platform: 'tg' },
          { id: 'lock-2', content_id: 'content-1', platform: 'vk' },
        ],
      },
    });

    const mgr = new PublicationLockManager();
    await mgr.releaseAllLocks('content-1');
    expect(directusApi.delete).toHaveBeenCalledTimes(2);
  });

  it('shutdown cleans up interval', () => {
    const mgr = new PublicationLockManager();
    mgr.initCleanupSchedule();
    mgr.shutdown();
    // No error = pass
  });
});

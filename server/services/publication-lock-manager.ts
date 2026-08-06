import { log } from '../utils/logger';
import { directusApi } from '../directus';

/**
 * Distributed publication lock manager using Directus as the lock store.
 *
 * Replaces the previous in-memory Map-based implementation which could not
 * prevent duplicate publications across multiple replicas. Uses a Directus
 * collection `publication_locks` with a unique constraint on (content_id, platform)
 * to guarantee atomicity.
 *
 * API is identical to the previous PublicationLockManager — all callers in
 * publish-scheduler.ts are unchanged.
 */

const LOCK_COLLECTION = 'publication_locks';
const LOCK_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

interface LockRecord {
  id: string;
  content_id: string;
  platform: string;
  acquired_at: string;
  expires_at: string;
}

function expiresAt(): string {
  return new Date(Date.now() + LOCK_TIMEOUT_MS).toISOString();
}

function isExpired(record: LockRecord): boolean {
  return new Date(record.expires_at).getTime() < Date.now();
}

export class PublicationLockManager {
  private cleanupIntervalId: NodeJS.Timeout | null = null;

  /**
   * Try to acquire a publication lock.
   * Returns true if the lock was acquired, false if already held by another process.
   */
  async acquireLock(contentId: string, platform: string): Promise<boolean> {
    const lockKey = `${contentId}:${platform}`;

    try {
      // Check if a non-expired lock already exists
      const existing = await this.findLock(contentId, platform);
      if (existing) {
        if (isExpired(existing)) {
          // Stale lock — clean it up and retry
          await this.deleteLock(existing.id);
          log(`🔓 PublicationLock: Expired lock released for ${lockKey}`, 'publication-lock');
        } else {
          log(`🔒 PublicationLock: Content ${contentId} already publishing on ${platform}`, 'publication-lock');
          return false;
        }
      }

      // Attempt to insert — unique constraint ensures atomicity
      await directusApi.post(`/items/${LOCK_COLLECTION}`, {
        content_id: contentId,
        platform,
        acquired_at: new Date().toISOString(),
        expires_at: expiresAt(),
      });

      log(`🔒 PublicationLock: Lock acquired for ${lockKey}`, 'publication-lock');
      return true;
    } catch (err: any) {
      // Unique constraint violation — another process grabbed it first
      if (err?.response?.status === 400 || err?.message?.includes('unique')) {
        log(`🔒 PublicationLock: Lock already held for ${lockKey} (concurrent acquire)`, 'publication-lock');
        return false;
      }
      // Network error, Directus down, etc. — fail open to avoid blocking publishing
      log(`⚠️ PublicationLock: Error acquiring lock for ${lockKey}, failing open: ${err?.message}`, 'publication-lock');
      return true;
    }
  }

  /**
   * Release a publication lock.
   */
  async releaseLock(contentId: string, platform: string): Promise<void> {
    const lockKey = `${contentId}:${platform}`;

    try {
      const existing = await this.findLock(contentId, platform);
      if (existing) {
        await this.deleteLock(existing.id);
        log(`🔓 PublicationLock: Lock released for ${lockKey}`, 'publication-lock');
      }
    } catch (err: any) {
      log(`⚠️ PublicationLock: Error releasing lock for ${lockKey}: ${err?.message}`, 'publication-lock');
    }
  }

  /**
   * Check if a lock is currently held (and not expired).
   */
  async isLocked(contentId: string, platform: string): Promise<boolean> {
    try {
      const existing = await this.findLock(contentId, platform);
      if (!existing) return false;
      if (isExpired(existing)) {
        // Clean up stale lock on read
        await this.deleteLock(existing.id).catch(() => {});
        return false;
      }
      return true;
    } catch {
      // On error, assume not locked (fail open)
      return false;
    }
  }

  /**
   * Release all locks for a given content ID.
   */
  async releaseAllLocks(contentId: string): Promise<void> {
    try {
      const response = await directusApi.get(`/items/${LOCK_COLLECTION}`, {
        params: {
          filter: { content_id: { _eq: contentId } },
          limit: -1,
        },
      });
      const records: LockRecord[] = response.data?.data || [];
      for (const record of records) {
        await this.deleteLock(record.id);
      }
      if (records.length > 0) {
        log(`🔓 PublicationLock: All locks released for content ${contentId} (${records.length})`, 'publication-lock');
      }
    } catch (err: any) {
      log(`⚠️ PublicationLock: Error releasing all locks for ${contentId}: ${err?.message}`, 'publication-lock');
    }
  }

  /**
   * Remove expired locks. Called periodically.
   */
  async cleanupExpiredLocks(): Promise<void> {
    try {
      const response = await directusApi.get(`/items/${LOCK_COLLECTION}`, {
        params: {
          filter: {
            expires_at: { _lt: new Date().toISOString() },
          },
          limit: 200,
        },
      });
      const records: LockRecord[] = response.data?.data || [];
      for (const record of records) {
        await this.deleteLock(record.id);
      }
      if (records.length > 0) {
        log(`🧹 PublicationLock: Cleaned up ${records.length} expired locks`, 'publication-lock');
      }
    } catch (err: any) {
      // Non-critical — expired locks will be cleaned on next acquire attempt
      log(`⚠️ PublicationLock: Cleanup error: ${err?.message}`, 'publication-lock');
    }
  }

  /**
   * Get statistics (best-effort, may be slow with many locks).
   */
  async getStats(): Promise<{ totalLocks: number }> {
    try {
      const response = await directusApi.get(`/items/${LOCK_COLLECTION}`, {
        params: { aggregate: { count: '*' } },
      });
      return { totalLocks: response.data?.data?.[0]?.count ?? 0 };
    } catch {
      return { totalLocks: 0 };
    }
  }

  /**
   * Initialize periodic cleanup.
   */
  initCleanupSchedule(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
    }
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupExpiredLocks();
    }, 5 * 60 * 1000); // every 5 minutes
  }

  /**
   * Shutdown — clear interval, nothing to flush (state is in Directus).
   */
  shutdown(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
    log('🔴 PublicationLockManager: Shutdown complete', 'publication-lock');
  }

  // ---- Private helpers ----

  private async findLock(contentId: string, platform: string): Promise<LockRecord | null> {
    const response = await directusApi.get(`/items/${LOCK_COLLECTION}`, {
      params: {
        filter: {
          content_id: { _eq: contentId },
          platform: { _eq: platform },
        },
        limit: 1,
      },
    });
    const data = response.data?.data;
    return data?.length ? data[0] : null;
  }

  private async deleteLock(id: string): Promise<void> {
    await directusApi.delete(`/items/${LOCK_COLLECTION}/${id}`);
  }
}

// Singleton
export const publicationLockManager = new PublicationLockManager();

// Start cleanup schedule
publicationLockManager.initCleanupSchedule();

// Graceful shutdown
process.on('SIGTERM', () => publicationLockManager.shutdown());
process.on('SIGINT', () => publicationLockManager.shutdown());

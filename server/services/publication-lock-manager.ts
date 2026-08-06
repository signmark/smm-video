import { log } from '../utils/logger';
import { directusApi } from '../directus';

/**
 * Distributed publication lock manager using Directus as the lock store.
 *
 * Replaces the previous in-memory Map-based implementation which could not
 * prevent duplicate publications across multiple replicas.
 *
 * Design:
 * - Directus collection `publication_locks` with a SINGLE-FIELD unique constraint
 *   on `lock_key` (format: `${contentId}:${platform}`). Single-field unique is
 *   configurable through the Directus UI (field settings → "Unique" checkbox).
 * - Atomicity: concurrent INSERTs on the same lock_key → exactly one succeeds
 *   (unique constraint violation → RECORD_NOT_UNIQUE).
 * - To avoid releasing another process's lock: each acquire remembers the
 *   Directus record id, and releases only by that id.
 * - Fail-CLOSED on Directus errors: a duplicate post is worse than a delayed one.
 *   The scheduler retries every minute.
 *
 * API is identical to the previous PublicationLockManager — all callers in
 * publish-scheduler.ts are unchanged.
 */

const LOCK_COLLECTION = 'publication_locks';
const LOCK_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

interface LockRecord {
  id: string;
  lock_key: string;
  content_id: string;
  platform: string;
  acquired_at: string;
  expires_at: string;
}

function lockKey(contentId: string, platform: string): string {
  return `${contentId}:${platform}`;
}

function expiresAt(): string {
  return new Date(Date.now() + LOCK_TIMEOUT_MS).toISOString();
}

function isExpired(record: LockRecord): boolean {
  return new Date(record.expires_at).getTime() < Date.now();
}

/**
 * Check if an error is a Directus unique constraint violation.
 */
function isUniqueViolation(err: any): boolean {
  try {
    return err?.response?.data?.errors?.[0]?.extensions?.code === 'RECORD_NOT_UNIQUE';
  } catch {
    return false;
  }
}

export class PublicationLockManager {
  private cleanupIntervalId: NodeJS.Timeout | null = null;
  // In-process map: lockKey → Directus record id (for safe release)
  private heldLockIds = new Map<string, string>();

  /**
   * Try to acquire a publication lock.
   * Returns true if the lock was acquired, false if already held or store unavailable.
   */
  async acquireLock(contentId: string, platform: string): Promise<boolean> {
    const key = lockKey(contentId, platform);

    try {
      // Check if a non-expired lock already exists
      const existing = await this.findLock(key);
      if (existing) {
        if (isExpired(existing)) {
          await this.deleteById(existing.id);
          log(`🔓 PublicationLock: Expired lock released for ${key}`, 'publication-lock');
        } else {
          log(`🔒 PublicationLock: Content ${contentId} already publishing on ${platform}`, 'publication-lock');
          return false;
        }
      }

      // Attempt INSERT — unique constraint guarantees atomicity
      const response = await directusApi.post(`/items/${LOCK_COLLECTION}`, {
        lock_key: key,
        content_id: contentId,
        platform,
        acquired_at: new Date().toISOString(),
        expires_at: expiresAt(),
      });

      const record: LockRecord = response.data?.data;
      if (record?.id) {
        this.heldLockIds.set(key, record.id);
      }

      log(`🔒 PublicationLock: Lock acquired for ${key}`, 'publication-lock');
      return true;
    } catch (err: any) {
      if (isUniqueViolation(err)) {
        // Another process grabbed it first
        log(`🔒 PublicationLock: Lock already held for ${key} (concurrent acquire)`, 'publication-lock');
        return false;
      }

      // Network error, Directus down, missing collection, etc.
      // FAIL-CLOSED: duplicate post is worse than delayed post.
      // Scheduler retries every minute.
      log(`⛔ PublicationLock: Lock store unavailable for ${key}, denying publish: ${err?.message}`, 'publication-lock');
      return false;
    }
  }

  /**
   * Release a publication lock. Only releases the lock that THIS process acquired.
   */
  async releaseLock(contentId: string, platform: string): Promise<void> {
    const key = lockKey(contentId, platform);
    const heldId = this.heldLockIds.get(key);

    try {
      if (heldId) {
        await this.deleteById(heldId);
        this.heldLockIds.delete(key);
        log(`🔓 PublicationLock: Lock released for ${key}`, 'publication-lock');
      } else {
        // We don't hold this lock — might be from another process or expired.
        // Check if it still exists and is expired, clean up.
        const existing = await this.findLock(key);
        if (existing && isExpired(existing)) {
          await this.deleteById(existing.id);
          log(`🔓 PublicationLock: Expired lock cleaned up for ${key}`, 'publication-lock');
        }
      }
    } catch (err: any) {
      log(`⚠️ PublicationLock: Error releasing lock for ${key}: ${err?.message}`, 'publication-lock');
      // Release from in-process map even if Directus delete failed
      if (heldId) this.heldLockIds.delete(key);
    }
  }

  /**
   * Check if a lock is currently held (and not expired).
   */
  async isLocked(contentId: string, platform: string): Promise<boolean> {
    try {
      const key = lockKey(contentId, platform);
      const existing = await this.findLock(key);
      if (!existing) return false;
      if (isExpired(existing)) {
        await this.deleteById(existing.id).catch(() => {});
        return false;
      }
      return true;
    } catch {
      // On error, assume not locked (fail-safe for the check; acquireLock is the gate)
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
        await this.deleteById(record.id);
        // Also clean up in-process map
        for (const [k, id] of this.heldLockIds) {
          if (id === record.id) this.heldLockIds.delete(k);
        }
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
        await this.deleteById(record.id);
      }
      if (records.length > 0) {
        log(`🧹 PublicationLock: Cleaned up ${records.length} expired locks`, 'publication-lock');
      }
    } catch (err: any) {
      log(`⚠️ PublicationLock: Cleanup error: ${err?.message}`, 'publication-lock');
    }
  }

  /**
   * Get statistics.
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

  initCleanupSchedule(): void {
    if (this.cleanupIntervalId) clearInterval(this.cleanupIntervalId);
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupExpiredLocks();
    }, 5 * 60 * 1000);
  }

  shutdown(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
    this.heldLockIds.clear();
    log('🔴 PublicationLockManager: Shutdown complete', 'publication-lock');
  }

  // ---- Private helpers ----

  private async findLock(key: string): Promise<LockRecord | null> {
    const response = await directusApi.get(`/items/${LOCK_COLLECTION}`, {
      params: {
        filter: { lock_key: { _eq: key } },
        limit: 1,
      },
    });
    const data = response.data?.data;
    return data?.length ? data[0] : null;
  }

  private async deleteById(id: string): Promise<void> {
    await directusApi.delete(`/items/${LOCK_COLLECTION}/${id}`);
  }
}

// Singleton
export const publicationLockManager = new PublicationLockManager();

publicationLockManager.initCleanupSchedule();

process.on('SIGTERM', () => publicationLockManager.shutdown());
process.on('SIGINT', () => publicationLockManager.shutdown());

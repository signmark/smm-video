/**
 * Pure functions for video file retention and expiry labels.
 *
 * Single source of truth for retention period calculation.
 * Used by Home.tsx and VideoDetail.tsx.
 */

/** Server-side retention period (must match cleanup.ts). */
export const RETENTION_DAYS = 30;

export interface FileStatus {
  /** Whether the video file exists on disk. */
  hasFile: boolean;
  /** Whether the project is in 'done' status. */
  isDone: boolean;
  /** Human-readable expiry label, or null if not applicable. */
  expiryLabel: string | null;
  /** Whether the expiry is urgent (≤1 day remaining). */
  expiryUrgent: boolean;
  /** Whether the file is missing but was expected (done project without file). */
  fileMissing: boolean;
}

/**
 * Calculate file status for a project.
 * @param status - Project status string
 * @param hasFile - Whether the video file exists on disk (from server)
 * @param createdAt - ISO date string of project creation
 * @param now - Current timestamp (injectable for testing)
 */
export function getFileStatus(
  status: string,
  hasFile: boolean,
  createdAt: string,
  now: number = Date.now(),
): FileStatus {
  const isDone = status === 'done';
  const fileMissing = isDone && !hasFile;

  let expiryLabel: string | null = null;
  let expiryUrgent = false;

  if (isDone && hasFile) {
    const age = now - new Date(createdAt).getTime();
    const msRemaining = RETENTION_DAYS * 24 * 60 * 60 * 1000 - age;
    if (msRemaining > 0) {
      const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
      if (daysRemaining <= 1) {
        expiryLabel = 'удалится завтра';
        expiryUrgent = true;
      } else {
        expiryLabel = `${daysRemaining} дн.`;
      }
    }
  }

  return { hasFile, isDone, expiryLabel, expiryUrgent, fileMissing };
}

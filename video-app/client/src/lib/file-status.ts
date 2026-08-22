/**
 * Pure functions for video file retention and expiry labels.
 *
 * Single source of truth for retention period calculation.
 * Used by Home.tsx and VideoDetail.tsx.
 */

/** Default retention period (fallback before server response arrives). */
export const DEFAULT_RETENTION_DAYS = 30;

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
  /**
   * Why the file is gone, in words the user can act on — null when nothing is
   * missing. Two different causes must not share one sentence: retention only
   * explains projects older than the retention period. Everything younger is
   * gone for another reason (22.08: the data volume was mounted at the wrong
   * path, so finished videos never survived a rebuild), and blaming retention
   * there tells the user a fact that is not true.
   */
  missingLabel: string | null;
}

/**
 * Calculate file status for a project.
 * @param status - Project status string
 * @param hasFile - Whether the video file exists on disk (from server)
 * @param createdAt - ISO date string of project creation
 * @param retentionDays - Retention period from server (or default)
 * @param now - Current timestamp (injectable for testing)
 */
export function getFileStatus(
  status: string,
  hasFile: boolean,
  createdAt: string,
  retentionDays: number = DEFAULT_RETENTION_DAYS,
  now: number = Date.now(),
): FileStatus {
  const isDone = status === 'done';
  const fileMissing = isDone && !hasFile;
  const ageDays = (now - new Date(createdAt).getTime()) / (24 * 60 * 60 * 1000);

  const missingLabel = !fileMissing
    ? null
    : ageDays >= retentionDays
      ? 'файл удалён по сроку хранения'
      : 'файла нет — скачать нельзя';

  let expiryLabel: string | null = null;
  let expiryUrgent = false;

  if (isDone && hasFile) {
    const age = now - new Date(createdAt).getTime();
    const msRemaining = retentionDays * 24 * 60 * 60 * 1000 - age;
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

  return { hasFile, isDone, expiryLabel, expiryUrgent, fileMissing, missingLabel };
}

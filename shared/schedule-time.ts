export interface ScheduledPlatformTime {
  status?: string | null;
  scheduledAt?: string | Date | null;
  scheduled_at?: string | Date | null;
}

function validTimestamp(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function setLocalScheduleTime(
  date: Date,
  time: { hour: string; minute: string },
): Date {
  const hour = Number.parseInt(time.hour, 10);
  const minute = Number.parseInt(time.minute, 10);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error('Некорректный час публикации');
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error('Некорректная минута публикации');
  }

  const result = new Date(date);
  result.setHours(hour, minute, 0, 0);
  return result;
}

/**
 * Content-level scheduled_at is the earliest active platform publication.
 * This keeps list sorting/date blocks consistent with per-platform schedules.
 */
export function getCanonicalScheduledAt(
  platforms: Record<string, ScheduledPlatformTime> | null | undefined,
  fallback?: string | Date | null,
): string | null {
  const platformTimestamps = Object.values(platforms || {})
    .filter((platform) => platform?.status !== 'cancelled')
    .map((platform) => validTimestamp(platform?.scheduledAt ?? platform?.scheduled_at))
    .filter((timestamp): timestamp is number => timestamp !== null);

  if (platformTimestamps.length > 0) {
    return new Date(Math.min(...platformTimestamps)).toISOString();
  }

  const fallbackTimestamp = validTimestamp(fallback);
  return fallbackTimestamp === null ? null : new Date(fallbackTimestamp).toISOString();
}

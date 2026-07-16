export interface ScheduledPlatformTime {
  status?: string | null;
  scheduledAt?: string | Date | null;
  scheduled_at?: string | Date | null;
  publishedAt?: string | Date | null;
  published_at?: string | Date | null;
}

const UPCOMING_PLATFORM_STATUSES = new Set(['pending', 'scheduled', 'publishing']);

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
    .filter((platform) => !platform?.status || UPCOMING_PLATFORM_STATUSES.has(platform.status))
    .map((platform) => validTimestamp(platform?.scheduledAt ?? platform?.scheduled_at))
    .filter((timestamp): timestamp is number => timestamp !== null);

  if (platformTimestamps.length > 0) {
    return new Date(Math.min(...platformTimestamps)).toISOString();
  }

  const fallbackTimestamp = validTimestamp(fallback);
  return fallbackTimestamp === null ? null : new Date(fallbackTimestamp).toISOString();
}

export function getPublishedPlatformTimeSummary(
  platforms: Record<string, ScheduledPlatformTime> | null | undefined,
  fallback?: { scheduledAt?: string | Date | null; publishedAt?: string | Date | null },
): { scheduledAt: string | null; publishedAt: string | null } {
  const publishedPlatforms = Object.values(platforms || {})
    .filter((platform) => platform?.status === 'published');

  const scheduledTimestamps = publishedPlatforms
    .map((platform) => validTimestamp(platform.scheduledAt ?? platform.scheduled_at))
    .filter((timestamp): timestamp is number => timestamp !== null);
  const publishedTimestamps = publishedPlatforms
    .map((platform) => validTimestamp(platform.publishedAt ?? platform.published_at))
    .filter((timestamp): timestamp is number => timestamp !== null);

  const fallbackScheduled = validTimestamp(fallback?.scheduledAt);
  const fallbackPublished = validTimestamp(fallback?.publishedAt);

  return {
    scheduledAt: scheduledTimestamps.length > 0
      ? new Date(Math.min(...scheduledTimestamps)).toISOString()
      : fallbackScheduled === null ? null : new Date(fallbackScheduled).toISOString(),
    publishedAt: publishedTimestamps.length > 0
      ? new Date(Math.max(...publishedTimestamps)).toISOString()
      : fallbackPublished === null ? null : new Date(fallbackPublished).toISOString(),
  };
}

export function getContentAggregateTimes(
  platforms: Record<string, ScheduledPlatformTime> | null | undefined,
  contentStatus: string | null | undefined,
  fallback?: { scheduledAt?: string | Date | null; publishedAt?: string | Date | null },
): { scheduledAt: string | null; publishedAt: string | null } {
  const historical = getPublishedPlatformTimeSummary(platforms);
  const upcomingScheduledAt = getCanonicalScheduledAt(platforms);
  const fallbackScheduled = validTimestamp(fallback?.scheduledAt);
  const fallbackPublished = validTimestamp(fallback?.publishedAt);
  const isFullyPublished = contentStatus === 'published';

  return {
    scheduledAt: isFullyPublished
      ? historical.scheduledAt || (fallbackScheduled === null ? null : new Date(fallbackScheduled).toISOString())
      : upcomingScheduledAt
        || historical.scheduledAt
        || (fallbackScheduled === null ? null : new Date(fallbackScheduled).toISOString()),
    // Keep the content-level contract: non-null means the whole content item is published.
    publishedAt: isFullyPublished
      ? historical.publishedAt || (fallbackPublished === null ? null : new Date(fallbackPublished).toISOString())
      : null,
  };
}

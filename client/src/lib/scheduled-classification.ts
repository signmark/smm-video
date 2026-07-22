/**
 * Scheduled publication classification.
 *
 * The /publish/scheduled page used to merge everything tagged
 * `status='scheduled'` into a single "upcoming" bucket, which meant six
 * stale `scheduled` records from two months ago produced
 * "Все платформы — 6, Предстоящие публикации — 0, список пустой".
 *
 * This module splits scheduled content into three buckets that share
 * one classification rule, so the badge "Все платформы — N" can match
 * the union of "Предстоящие" + "Просроченные" + "Без даты" and the
 * page can show overdue posts in their own warning section.
 *
 * "Today" is computed from the supplied `now` so tests can pin a fixed
 * date and so the boundary is explicit to the caller.
 */
import type { CampaignContent, SocialPlatform } from '@/types';

export type ScheduledBucket = 'upcoming' | 'overdue' | 'unscheduledDate';

export interface ScheduledClassification {
  bucket: ScheduledBucket;
  /** Best-effort local date used for sorting and display. */
  scheduledAt: Date | null;
  /** True if any platform has a parseable `scheduledAt`/`scheduledAt` field. */
  hasParseableDate: boolean;
}

function validDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isPlatformStatusScheduled(value: unknown): boolean {
  return value === 'pending' || value === 'scheduled';
}

function pickScheduledDate(content: CampaignContent): {
  date: Date | null;
  parseable: boolean;
} {
  // 1) Aggregate field wins when valid.
  const aggregate = validDate((content as any).scheduledAt);
  if (aggregate) return { date: aggregate, parseable: true };

  // 2) Fall back to the earliest parseable per-platform scheduledAt.
  const platforms = (content.socialPlatforms ?? {}) as Record<string, any>;
  for (const platform of Object.keys(platforms)) {
    const info = platforms[platform];
    if (!isPlatformStatusScheduled(info?.status)) continue;
    const platformDate = validDate(info?.scheduledAt);
    if (platformDate) return { date: platformDate, parseable: true };
  }

  return { date: null, parseable: false };
}

/**
 * Classify a single `scheduled`-status post. Posts whose `scheduledAt` is
 * strictly before `now` (after a midnight boundary) are "overdue".
 * Posts that are "today or later" are "upcoming". Posts that have no
 * parseable date at all are "unscheduledDate" — these are the records
 * that previously disappeared from the page without a trace.
 */
export function classifyScheduled(
  content: CampaignContent,
  now: Date = new Date(),
): ScheduledClassification {
  const { date, parseable } = pickScheduledDate(content);
  if (!parseable || !date) {
    return { bucket: 'unscheduledDate', scheduledAt: null, hasParseableDate: false };
  }

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  return {
    bucket: date >= startOfToday ? 'upcoming' : 'overdue',
    scheduledAt: date,
    hasParseableDate: true,
  };
}

export interface ScheduledBuckets {
  upcoming: CampaignContent[];
  overdue: CampaignContent[];
  unscheduledDate: CampaignContent[];
}

export function splitScheduled(
  content: CampaignContent[],
  now: Date = new Date(),
): ScheduledBuckets {
  const result: ScheduledBuckets = { upcoming: [], overdue: [], unscheduledDate: [] };
  for (const item of content) {
    const cls = classifyScheduled(item, now);
    result[cls.bucket].push(item);
  }
  return result;
}

export function countByBucket(buckets: ScheduledBuckets): {
  upcoming: number;
  overdue: number;
  unscheduledDate: number;
  total: number;
} {
  const upcoming = buckets.upcoming.length;
  const overdue = buckets.overdue.length;
  const unscheduledDate = buckets.unscheduledDate.length;
  return { upcoming, overdue, unscheduledDate, total: upcoming + overdue + unscheduledDate };
}

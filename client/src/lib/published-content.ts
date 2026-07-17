import type { CampaignContent, PlatformPublishInfo, SocialPlatform } from '@/types';
import { isConfirmedPublishedPlatform } from '@shared/schedule-time';

const PUBLISHED_CONTENT_STATUSES = new Set([
  'published',
  'partial',
  'partially_published',
]);

export interface ConfirmedPublicationEvent {
  key: string;
  contentId: string;
  platform: SocialPlatform | null;
  date: Date;
  contentType: CampaignContent['contentType'];
}

function validDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isConfirmedPlatformPublication(
  info: PlatformPublishInfo | Record<string, any> | null | undefined,
): boolean {
  return isConfirmedPublishedPlatform(info);
}

export function hasConfirmedPublication(content: CampaignContent): boolean {
  if (PUBLISHED_CONTENT_STATUSES.has(content.status)) return true;
  return Object.values(content.socialPlatforms || {}).some(isConfirmedPlatformPublication);
}

export function hasFailedPublicationAttempt(content: CampaignContent): boolean {
  return Object.values(content.socialPlatforms || {}).some((info) => (
    info?.status === 'failed' || Boolean(info?.error || info?.lastError)
  ));
}

/**
 * Fully failed posts have no publication timestamp, but must remain reachable
 * from their intended day so the user can inspect the error and retry.
 */
export function getFailedPublicationAttemptDate(content: CampaignContent): Date | null {
  if (hasConfirmedPublication(content) || !hasFailedPublicationAttempt(content)) return null;

  const platforms = Object.values(content.socialPlatforms || {});
  return validDate(content.scheduledAt)
    || platforms.map((info) => validDate(info?.scheduledAt)).find(Boolean)
    || platforms.map((info) => validDate(info?.failedAt)).find(Boolean)
    || validDate(content.createdAt);
}

export function getPublicationCardDates(content: CampaignContent): Date[] {
  const publishedDates = getConfirmedPublicationDates(content);
  if (publishedDates.length > 0) return publishedDates;

  const failedDate = getFailedPublicationAttemptDate(content);
  return failedDate ? [failedDate] : [];
}

export function getConfirmedPublicationEvents(content: CampaignContent): ConfirmedPublicationEvent[] {
  if (!hasConfirmedPublication(content)) return [];

  const contentDate = validDate(content.publishedAt);
  const legacyDate = contentDate || validDate(content.scheduledAt) || validDate(content.createdAt);
  const events: ConfirmedPublicationEvent[] = [];

  Object.entries(content.socialPlatforms || {}).forEach(([platform, info]) => {
    if (!isConfirmedPlatformPublication(info)) return;
    const date = validDate(info.publishedAt) || legacyDate;
    if (!date) return;
    events.push({
      key: `${content.id}:${platform}`,
      contentId: content.id,
      platform: platform as SocialPlatform,
      date,
      contentType: content.contentType,
    });
  });

  // Legacy published records may have no per-platform publication state.
  if (events.length === 0 && legacyDate) {
    events.push({
      key: `${content.id}:legacy`,
      contentId: content.id,
      platform: null,
      date: legacyDate,
      contentType: content.contentType,
    });
  }

  return events;
}

/**
 * Returns actual publication dates. Content-level dates are retained as a
 * compatibility fallback, while schedule/creation dates are used only for
 * legacy published records that have no actual publication timestamp.
 */
export function getConfirmedPublicationDates(content: CampaignContent): Date[] {
  const timestamps = new Set<number>();
  getConfirmedPublicationEvents(content).forEach(({ date }) => timestamps.add(date.getTime()));

  return Array.from(timestamps, (timestamp) => new Date(timestamp));
}

/**
 * Returns the timestamp displayed as the actual publication time on a card.
 * Per-platform timestamps provide a compatibility fallback for records whose
 * aggregate published_at value was not populated by an older publishing path.
 */
export function getPublishedDisplayDate(content: CampaignContent): Date | null {
  const aggregateDate = validDate(content.publishedAt);
  if (aggregateDate) return aggregateDate;

  const platformDates = Object.values(content.socialPlatforms || {})
    .filter(isConfirmedPlatformPublication)
    .map((info) => validDate(info?.publishedAt || (info as any)?.published_at))
    .filter((date): date is Date => Boolean(date));

  if (platformDates.length === 0) return null;
  return platformDates.reduce((latest, date) => date > latest ? date : latest);
}

export function countConfirmedPlatformPublications(
  content: CampaignContent[],
  platforms: readonly SocialPlatform[],
  range?: { from: Date; to: Date },
): Partial<Record<SocialPlatform, number>> {
  const counts: Partial<Record<SocialPlatform, number>> = {};
  platforms.forEach((platform) => { counts[platform] = 0; });

  content.forEach((item) => {
    getConfirmedPublicationEvents(item).forEach(({ platform, date }) => {
      if (range && (date < range.from || date > range.to)) return;
      if (platform && platforms.includes(platform)) {
        const key = platform;
        counts[key] = (counts[key] || 0) + 1;
      }
    });
  });

  return counts;
}

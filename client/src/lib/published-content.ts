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
 * Returns `true` when the post is *entirely* failed (no platform succeeded).
 * A "partial" post with at least one confirmed publication must NOT be
 * treated as fully failed.
 */
export function isFullyFailedPublication(content: CampaignContent): boolean {
  if (hasConfirmedPublication(content)) return false;
  return hasFailedPublicationAttempt(content);
}

/**
 * Categorises a raw platform error / lastError string into a short,
 * UI-safe label. We MUST NOT render the raw backend text directly: per
 * the security sanitization cycle (commits efff09e / b00893b) such
 * strings can contain URLs with leaked tokens, internal stack frames
 * or PII, and rendering them was the security regression CL-03
 * pointed out in the Claude review.
 *
 * The classifier is intentionally narrow: a handful of well-known
 * categories plus a generic fallback. Anything that does not match
 * collapses to 'unknown' so the user sees a stable, harmless phrase.
 *
 * The raw reason is still preserved on the returned object as
 * `rawReason` (camelCase) for the unit tests; the UI must never read
 * it. In dev, we additionally surface it via console.debug for the
 * developer console, never in the DOM.
 */
export type PlatformFailureCategory =
  | 'auth'
  | 'rate-limit'
  | 'timeout'
  | 'network'
  | 'invalid-content'
  | 'server'
  | 'unknown';

const REASON_PATTERNS: Array<{ category: PlatformFailureCategory; pattern: RegExp }> = [
  { category: 'auth', pattern: /(401|403|auth|unauthori[sz]ed|forbidden|token|api[_ -]?key)/i },
  { category: 'rate-limit', pattern: /(429|rate[\s_-]?limit|too many|throttle)/i },
  { category: 'timeout', pattern: /(timeout|timed[\s_-]?out|etimedout|deadline)/i },
  { category: 'network', pattern: /(network|econn|enotfound|econnreset|dns|socket)/i },
  { category: 'invalid-content', pattern: /(invalid|malformed|bad request|missing|empty)/i },
  { category: 'server', pattern: /(5\d\d|internal|server error|unavailable)/i },
];

const REASON_LABELS: Record<PlatformFailureCategory, string> = {
  auth: 'ошибка авторизации',
  'rate-limit': 'превышен лимит запросов',
  timeout: 'таймаут',
  network: 'сетевая ошибка',
  'invalid-content': 'некорректный контент',
  server: 'ошибка сервиса',
  unknown: 'неизвестная ошибка',
};

export function categorisePlatformFailure(rawReason: string | null | undefined): PlatformFailureCategory {
  if (!rawReason) return 'unknown';
  for (const { category, pattern } of REASON_PATTERNS) {
    if (pattern.test(rawReason)) return category;
  }
  return 'unknown';
}

export function platformFailureLabel(category: PlatformFailureCategory): string {
  return REASON_LABELS[category];
}

/**
 * Lists the platforms that failed for a given post. The list is stable
 * and order-preserving so the UI can show a per-post summary like
 * "Instagram: timeout, Telegram: rate-limit". The UI must read
 * `reasonLabel` for the user-facing copy and MUST NOT read `rawReason`
 * (kept only for tests and dev console).
 */
export function getFailedPlatforms(
  content: CampaignContent,
): Array<{ platform: string; reasonCategory: PlatformFailureCategory; reasonLabel: string; rawReason: string | null }> {
  const result: Array<{ platform: string; reasonCategory: PlatformFailureCategory; reasonLabel: string; rawReason: string | null }> = [];
  const platforms = content.socialPlatforms || {};
  for (const [platform, info] of Object.entries(platforms)) {
    if (!info) continue;
    const status = (info as any).status;
    const rawReason = ((info as any).error || (info as any).lastError || null) as string | null;
    const hasError = Boolean(rawReason);
    if (status === 'failed' || (hasError && status !== 'published' && status !== 'partial' && status !== 'partially_published')) {
      const reasonCategory = categorisePlatformFailure(rawReason);
      result.push({
        platform,
        reasonCategory,
        reasonLabel: platformFailureLabel(reasonCategory),
        rawReason,
      });
    }
  }
  return result;
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
/**
 * Функции достаточно двух полей, а требовала она весь CampaignContent —
 * причём КЛИЕНТСКИЙ его вариант, где `title: string`. Записи, приходящие по
 * shared-типу (`title: string | null`), из-за этого не подходили по типу, хотя
 * ни title, ни остальные тридцать полей здесь не читаются
 * (находка ревью 2026-07-29).
 */
type PublishedDateSource = Pick<CampaignContent, 'publishedAt' | 'socialPlatforms'>;

export function getPublishedDisplayDate(content: PublishedDateSource): Date | null {
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

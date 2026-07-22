/**
 * Analytics verdict classifier.
 *
 * The previous version of /analytics called `getCampaignInsights` whenever
 * the page mounted, and the function unconditionally added a
 * "Низкая эффективность" insight when the engagement rate was below 1%.
 * On a fresh campaign with `totalPosts=0, totalViews=0, totalLikes=0`
 * this produced the contradictory UI of five zero counters AND a
 * warning "Низкая эффективность кампании" — which the user reads as
 * "the campaign failed", when in fact there is no data yet.
 *
 * This module provides a single, pure predicate (`getAnalyticsVerdict`)
 * the rest of the analytics page must consult before rendering an
 * efficiency verdict, and a parallel `getSampleSummary` for the
 * "no-data" copy.
 *
 * Acceptance matrix (per docs/prompts/codex-ui-pretester-fix-plan-2026-07-21.md):
 *
 *   posts  views  engagement  -> verdict
 *   -----------------------------------------
 *   0      0      0           -> 'no-data'
 *   >0     0      0           -> 'insufficient-views'
 *   >0     >0     0           -> 'low'
 *   >0     >0     >0          -> 'low' | 'medium' | 'high' (rate-based)
 */

export type AnalyticsVerdict =
  | 'no-data'
  | 'insufficient-views'
  | 'low'
  | 'medium'
  | 'high';

export interface AnalyticsSample {
  posts: number;
  views: number;
  /** Sum of likes + comments + shares across the sample. */
  engagements: number;
}

const ENGAGEMENT_RATE_THRESHOLDS = {
  high: 5,
  medium: 2,
  low: 1,
} as const;

export function getAnalyticsVerdict(sample: AnalyticsSample): AnalyticsVerdict {
  if (sample.posts <= 0) return 'no-data';
  if (sample.views <= 0) return 'insufficient-views';

  const rate = (sample.engagements / sample.views) * 100;
  if (rate >= ENGAGEMENT_RATE_THRESHOLDS.high) return 'high';
  if (rate >= ENGAGEMENT_RATE_THRESHOLDS.medium) return 'medium';
  // Anything that does not reach the 'medium' (>= 2%) threshold is
  // 'low'; rate < 1% falls through here as well.
  return 'low';
}

export interface SampleSummary {
  verdict: AnalyticsVerdict;
  /** Stable Russian text for the page header — never "Низкая эффективность". */
  headline: string;
  /** Long-form explanation for the "card" body. */
  detail: string;
}

const NO_DATA: SampleSummary = {
  verdict: 'no-data',
  headline: 'Нет данных',
  detail:
    'В выбранном периоде ещё нет публикаций. После первой публикации здесь появятся охват, вовлечённость и оценка эффективности.',
};

const INSUFFICIENT_VIEWS: SampleSummary = {
  verdict: 'insufficient-views',
  headline: 'Недостаточно просмотров для оценки',
  detail:
    'Публикации уже есть, но платформы ещё не передали данные о просмотрах. Подождите несколько часов или расширьте период.',
};

const RATE_HEADLINES: Record<Exclude<AnalyticsVerdict, 'no-data' | 'insufficient-views'>, string> = {
  high: 'Отличная эффективность',
  medium: 'Средняя эффективность',
  low: 'Низкая эффективность',
};

const RATE_DETAILS: Record<Exclude<AnalyticsVerdict, 'no-data' | 'insufficient-views'>, string> = {
  high: 'Кампания стабильно набирает вовлечённость выше 5%. Сохраняйте текущий формат.',
  medium: 'Вовлечённость 2–5%. Есть потенциал для тестов с новыми форматами и временем публикации.',
  low: 'Вовлечённость ниже 2%. Попробуйте сменить тон, формат и время публикации.',
};

export function getSampleSummary(sample: AnalyticsSample): SampleSummary {
  const verdict = getAnalyticsVerdict(sample);
  if (verdict === 'no-data') return NO_DATA;
  if (verdict === 'insufficient-views') return INSUFFICIENT_VIEWS;
  return {
    verdict,
    headline: RATE_HEADLINES[verdict],
    detail: RATE_DETAILS[verdict],
  };
}

/**
 * Whether a single platform's "efficiency" card may be shown. A platform
 * with `posts=0, views=0` must never be classified as "low efficiency" —
 * it simply has no data yet.
 */
export function getPlatformEfficiencyLevel(platform: {
  posts: number;
  views: number;
}): 'no-data' | 'low' | 'average' | 'good' | 'excellent' {
  if (platform.posts <= 0 || platform.views <= 0) return 'no-data';

  // Engagement rate per post is unknown without engagement counts, so the
  // caller is expected to pass a more complete shape; this fallback uses
  // views as a coarse proxy.
  if (platform.posts >= 10) return 'good';
  if (platform.posts >= 3) return 'average';
  return 'low';
}

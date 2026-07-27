export interface PlatformAnalyticsStats {
  name: string;
  posts: number;
  views: number;
  likes: number;
  shares: number;
  comments: number;
}

export interface AggregatedPublicationAnalytics {
  totalPosts: number;
  totalViews: number;
  totalLikes: number;
  totalShares: number;
  totalComments: number;
  platformStatsMap: Map<string, PlatformAnalyticsStats>;
}

function metric(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function publicationTime(post: any, platformData: any): number | null {
  const value = platformData.publishedAt ??
    platformData.published_at ??
    post.published_at ??
    post.publishedAt ??
    post.scheduled_at ??
    post.scheduledAt;

  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function postIdCandidates(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const raw = String(value).trim().toLowerCase();
  if (!raw) return [];

  const candidates = new Set([raw]);
  const withoutQuery = raw.split(/[?#]/, 1)[0].replace(/\/$/, '');
  const lastPathPart = withoutQuery.split('/').filter(Boolean).pop();
  if (lastPathPart) candidates.add(lastPathPart);

  const wallId = raw.match(/wall(-?\d+_\d+)/)?.[1];
  if (wallId) candidates.add(wallId);

  for (const candidate of Array.from(candidates)) {
    if (/^-?\d+_\d+$/.test(candidate)) {
      candidates.add(candidate.split('_').pop()!);
    }
  }

  return Array.from(candidates);
}

export function getPublishedPlatformPostIds(
  posts: any[],
  platform: string,
  dateFrom: Date,
  dateTo: Date,
): Set<string> {
  const ids = new Set<string>();
  const fromTime = dateFrom.getTime();
  const toTime = dateTo.getTime();

  for (const post of posts) {
    let platforms = post?.social_platforms ?? post?.socialPlatforms;
    if (typeof platforms === 'string') {
      try { platforms = JSON.parse(platforms); } catch { continue; }
    }
    if (!platforms || typeof platforms !== 'object' || Array.isArray(platforms)) continue;

    const platformEntry = Object.entries(platforms).find(([key, data]: [string, any]) => (
      String(data?.platform || key).toLowerCase() === platform.toLowerCase()
    ));
    const platformData = platformEntry?.[1] as any;
    if (!platformData || platformData.status !== 'published') continue;

    const publishedTime = publicationTime(post, platformData);
    if (publishedTime === null || publishedTime < fromTime || publishedTime > toTime) continue;

    for (const value of [platformData.postId, platformData.post_id, platformData.postUrl, platformData.post_url]) {
      postIdCandidates(value).forEach((candidate) => ids.add(candidate));
    }
  }

  return ids;
}

export function matchesPublishedPlatformPostId(expectedIds: Set<string>, value: unknown): boolean {
  return postIdCandidates(value).some((candidate) => expectedIds.has(candidate));
}

export interface PublishedPlatformRow {
  title: string;
  content: string;
  platform: string;
  published_at: string;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
}

/**
 * Flattens content items into one row per confirmed platform publication in the
 * selected period, reading the timestamp and metrics from the same
 * `social_platforms` JSON the analytics page uses. Report generation must consume
 * this instead of the top-level `published_at`/`reach`/`likes` columns (which are
 * usually empty), otherwise the exported PDF/Excel comes out blank while the page
 * shows data.
 */
export function flattenPublishedPlatformRows(
  posts: any[],
  dateFrom: Date,
  dateTo: Date,
): PublishedPlatformRow[] {
  const rows: PublishedPlatformRow[] = [];
  const fromTime = dateFrom.getTime();
  const toTime = dateTo.getTime();

  for (const post of posts) {
    let platforms = post?.social_platforms ?? post?.socialPlatforms;
    if (typeof platforms === 'string') {
      try { platforms = JSON.parse(platforms); } catch { continue; }
    }
    if (!platforms || typeof platforms !== 'object' || Array.isArray(platforms)) continue;

    for (const [platformKey, platformData] of Object.entries(platforms) as [string, any][]) {
      if (!platformData || platformData.status !== 'published') continue;

      const publishedTime = publicationTime(post, platformData);
      if (publishedTime === null || publishedTime < fromTime || publishedTime > toTime) continue;

      const analytics = platformData.analytics || {};
      rows.push({
        title: post.title || post.name || '',
        content: post.content || post.text || post.body || '',
        platform: String(platformData.platform || platformKey).toLowerCase(),
        published_at: new Date(publishedTime).toISOString(),
        reach: metric(analytics.views),
        likes: metric(analytics.likes),
        comments: metric(analytics.comments),
        shares: metric(analytics.shares),
      });
    }
  }

  return rows;
}

/**
 * Counts one post per confirmed platform publication in the selected period.
 * Content-level status and scheduled_at are deliberately not used as filters:
 * a single content item can be published to different platforms at different times.
 */
export function aggregatePublishedPlatformAnalytics(
  posts: any[],
  dateFrom: Date,
  dateTo: Date,
): AggregatedPublicationAnalytics {
  let totalPosts = 0;
  let totalViews = 0;
  let totalLikes = 0;
  let totalShares = 0;
  let totalComments = 0;
  const platformStatsMap = new Map<string, PlatformAnalyticsStats>();
  const fromTime = dateFrom.getTime();
  const toTime = dateTo.getTime();

  for (const post of posts) {
    let platforms = post?.social_platforms ?? post?.socialPlatforms;
    if (!platforms) continue;

    if (typeof platforms === 'string') {
      try {
        platforms = JSON.parse(platforms);
      } catch {
        continue;
      }
    }

    if (!platforms || typeof platforms !== 'object' || Array.isArray(platforms)) continue;

    for (const [platformKey, platformData] of Object.entries(platforms) as [string, any][]) {
      if (!platformData || platformData.status !== 'published') continue;

      // Period analytics cannot safely attribute a publication with no timestamp
      // to any selected range. Counting it would inflate every period total.
      const publishedTime = publicationTime(post, platformData);
      if (publishedTime === null || publishedTime < fromTime || publishedTime > toTime) continue;

      const analytics = platformData.analytics || {};
      const views = metric(analytics.views);
      const likes = metric(analytics.likes);
      const shares = metric(analytics.shares);
      const comments = metric(analytics.comments);
      const platformName = String(platformData.platform || platformKey).toLowerCase();

      totalPosts++;
      totalViews += views;
      totalLikes += likes;
      totalShares += shares;
      totalComments += comments;

      if (!platformStatsMap.has(platformName)) {
        platformStatsMap.set(platformName, {
          name: platformName,
          posts: 0,
          views: 0,
          likes: 0,
          shares: 0,
          comments: 0,
        });
      }

      const stats = platformStatsMap.get(platformName)!;
      stats.posts++;
      stats.views += views;
      stats.likes += likes;
      stats.shares += shares;
      stats.comments += comments;
    }
  }

  return {
    totalPosts,
    totalViews,
    totalLikes,
    totalShares,
    totalComments,
    platformStatsMap,
  };
}

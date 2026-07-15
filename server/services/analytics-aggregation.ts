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

export interface PlatformAnalyticsStats {
  name: string;
  posts: number;
  views: number;
  likes: number;
  shares: number;
  comments: number;
  /**
   * SM-15: те же метрики, но по всему каналу за период. Показываются рядом с
   * кампанийными, чтобы человек видел, сколько отклика мы не досчитали.
   *
   * Источников расхождения три, и «ручные публикации» среди них не главный:
   * один канал могут вести несколько кампаний, а часть наших же публикаций не
   * сохранила идентификатор поста и потому не сопоставляется с каналом.
   * Отсутствует, если по платформе нет пост-уровневой атрибуции (тогда
   * сравнивать не с чем и врать цифрой нельзя).
   */
  channelTotals?: {
    posts: number;
    views: number;
    likes: number;
    shares: number;
    comments: number;
  };
  /**
   * SM-15 (решение владельца 19.08): чем именно отличается цифра по каналу от
   * цифры кампании. Отсутствует, если канал ведёт одна кампания — тогда
   * раскладывать нечего.
   */
  channelAttribution?: {
    /** Имя текущей кампании: подсказке нужно назвать, чьи посты учтены. */
    campaignName: string;
    own: ChannelWideStats;
    others: AttributedCampaignStats[];
    unattributed: ChannelWideStats;
  };
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

export interface ChannelPostRow {
  platform_post_id?: string | number | null;
  published_date?: string | null;
  captured_at?: string | null;
  views?: unknown;
  likes?: unknown;
  comments?: unknown;
  shares?: unknown;
}

// Telegram albums arrive as several messages: the media carries no caption and
// the sibling holds the text. Reactions attach to the sibling, but publication
// stores only the first message id, so per-id matching lost every like (SM-15).
// Sibling ids are consecutive and published within a couple of seconds.
export const ALBUM_GROUP_WINDOW_MS = 5000;

function latestSnapshotPerPost(posts: ChannelPostRow[]): ChannelPostRow[] {
  const latestByPostId = new Map<string, ChannelPostRow>();

  for (const post of posts) {
    const postId = String(post?.platform_post_id ?? '').trim();
    if (!postId) continue;

    const current = latestByPostId.get(postId);
    const capturedAt = Date.parse(post?.captured_at || '') || 0;
    const currentCapturedAt = Date.parse(current?.captured_at || '') || 0;
    if (!current || capturedAt > currentCapturedAt) {
      latestByPostId.set(postId, post);
    }
  }

  return Array.from(latestByPostId.values());
}

function numericPostId(post: ChannelPostRow): number | null {
  const raw = String(post?.platform_post_id ?? '').trim();
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

/**
 * Groups channel rows into publications: one album (several Telegram messages)
 * counts as a single post. Only non-numeric-id platforms (VK) stay ungrouped.
 */
export function groupChannelPostsIntoPublications(
  posts: ChannelPostRow[],
  claimedIds: Set<string> = new Set(),
): ChannelPostRow[][] {
  const latest = latestSnapshotPerPost(posts);
  const numbered = latest
    .filter(post => numericPostId(post) !== null)
    .sort((a, b) => numericPostId(a)! - numericPostId(b)!);
  const groups: ChannelPostRow[][] = latest
    .filter(post => numericPostId(post) === null)
    .map(post => [post]);

  let currentGroup: ChannelPostRow[] = [];
  for (const post of numbered) {
    const previous = currentGroup[currentGroup.length - 1];
    const consecutive = previous
      && numericPostId(post)! === numericPostId(previous)! + 1;
    const previousTime = Date.parse(previous?.published_date || '');
    const postTime = Date.parse(post?.published_date || '');
    const withinWindow = Number.isFinite(previousTime)
      && Number.isFinite(postTime)
      && Math.abs(postTime - previousTime) <= ALBUM_GROUP_WINDOW_MS;

    // Every publication stores its own first message id. A row that is itself a
    // stored id therefore anchors a separate publication and must never be
    // absorbed as an album sibling - prod posts /7 and /8 are two different
    // content rows published 44ms apart, and merging them lost their reach.
    const anchorsOwnPublication = matchesPublishedPlatformPostId(
      claimedIds,
      post.platform_post_id,
    );

    if (consecutive && withinWindow && !anchorsOwnPublication) {
      currentGroup.push(post);
      continue;
    }
    if (currentGroup.length) groups.push(currentGroup);
    currentGroup = [post];
  }
  if (currentGroup.length) groups.push(currentGroup);

  return groups;
}

/**
 * Aggregates scraper rows for publications of this campaign.
 * Metrics are taken as the maximum across an album's messages, never the sum:
 * Telegram repeats the same view count on every message of the album, so summing
 * would double reach, while the reaction lives on exactly one of them.
 */
/**
 * Метрики канала целиком: и наши публикации, и чужие/ручные.
 *
 * SM-15: тестировщик считал лайки по каналу (их было 4), система показывала по
 * кампании (3) -- четвёртый стоял на посте, опубликованном руками мимо системы.
 * Оба числа верны, но снаружи неразличимы. Владелец решил (07.08) показывать
 * ОБА, а не подписывать одно: тогда видно не только «наша цифра честная», но и
 * сколько отклика уходит на ручные публикации.
 */
export interface ChannelWideStats {
  posts: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

export interface CampaignChannelStats extends ChannelWideStats {
  /** То же самое, но по всем публикациям канала за период, включая не наши. */
  channelTotals: ChannelWideStats;
  /**
   * Решение владельца 19.08: «Хорошо бы написать, посты из какой кампании
   * учтены». До него разница «канал минус кампания» была одним безымянным
   * числом, и человек не мог понять, чья это активность: соседней кампании в
   * том же канале, ручной публикации или нашей же публикации с потерянным
   * идентификатором поста.
   *
   * Отсутствует, если соседних кампаний в этом канале не нашлось — тогда
   * раскладывать нечего, а пустой блок в интерфейсе читался бы как «данные
   * пропали».
   */
  attribution?: ChannelAttribution;
}

/** Кампания, которая ведёт ТОТ ЖЕ канал, и её опубликованные посты за период. */
export interface SiblingCampaign {
  campaignId: string;
  name: string;
  expectedIds: Set<string>;
}

export interface AttributedCampaignStats extends ChannelWideStats {
  campaignId: string;
  name: string;
}

export interface ChannelAttribution {
  /** Соседние кампании, чьи публикации нашлись в канале за период. */
  others: AttributedCampaignStats[];
  /**
   * Всё остальное: ручные публикации, чужие и наши же, у которых не сохранён
   * идентификатор поста. Разделить их по данным канала нельзя — и выдавать
   * догадку за факт мы не будем.
   */
  unattributed: ChannelWideStats;
}

function emptyStats(): ChannelWideStats {
  return { posts: 0, views: 0, likes: 0, comments: 0, shares: 0 };
}

function addTo(target: ChannelWideStats, group: {
  views: number; likes: number; comments: number; shares: number;
}): void {
  target.posts++;
  target.views += group.views;
  target.likes += group.likes;
  target.comments += group.comments;
  target.shares += group.shares;
}

export function aggregateCampaignChannelPosts(
  channelPosts: ChannelPostRow[],
  expectedIds: Set<string>,
  siblings: SiblingCampaign[] = [],
): CampaignChannelStats {
  let posts = 0;
  let views = 0;
  let likes = 0;
  let comments = 0;
  let shares = 0;

  const channelTotals: ChannelWideStats = emptyStats();
  const perSibling = new Map<string, AttributedCampaignStats>();
  const unattributed: ChannelWideStats = emptyStats();

  for (const group of groupChannelPostsIntoPublications(channelPosts, expectedIds)) {
    // Метрики берутся максимумом по группе, а не суммой: Telegram повторяет
    // счётчик просмотров на каждом сообщении альбома (SM-15).
    const groupViews = Math.max(...group.map(post => metric(post.views)));
    const groupLikes = Math.max(...group.map(post => metric(post.likes)));
    const groupComments = Math.max(...group.map(post => metric(post.comments)));
    const groupShares = Math.max(...group.map(post => metric(post.shares)));

    channelTotals.posts++;
    channelTotals.views += groupViews;
    channelTotals.likes += groupLikes;
    channelTotals.comments += groupComments;
    channelTotals.shares += groupShares;

    const belongsToCampaign = group.some(post => (
      matchesPublishedPlatformPostId(expectedIds, post.platform_post_id)
    ));
    if (!belongsToCampaign) {
      // Чья это публикация: соседней кампании в том же канале или ничья.
      // Первое совпадение выигрывает: одна публикация не может принадлежать
      // двум кампаниям сразу, а порядок соседей задаёт вызывающий.
      const owner = siblings.find(sibling => group.some(post => (
        matchesPublishedPlatformPostId(sibling.expectedIds, post.platform_post_id)
      )));

      if (owner) {
        let bucket = perSibling.get(owner.campaignId);
        if (!bucket) {
          bucket = { campaignId: owner.campaignId, name: owner.name, ...emptyStats() };
          perSibling.set(owner.campaignId, bucket);
        }
        addTo(bucket, { views: groupViews, likes: groupLikes, comments: groupComments, shares: groupShares });
      } else {
        addTo(unattributed, { views: groupViews, likes: groupLikes, comments: groupComments, shares: groupShares });
      }
      continue;
    }

    posts++;
    views += groupViews;
    likes += groupLikes;
    comments += groupComments;
    shares += groupShares;
  }

  const result: CampaignChannelStats = { posts, views, likes, comments, shares, channelTotals };

  // Разложение отдаём только когда было с кем сравнивать: без списка соседних
  // кампаний «остальное» означало бы просто «не наше», и число выглядело бы
  // осмысленнее, чем оно есть.
  if (siblings.length > 0) {
    result.attribution = {
      others: [...perSibling.values()].sort((a, b) => b.posts - a.posts),
      unattributed,
    };
  }

  return result;
}

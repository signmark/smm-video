import axios from 'axios';
import { directusCrud } from './directus-crud';
import { log } from '../utils/logger';
import { globalApiKeysService } from './global-api-keys';
import { ApiServiceName } from './api-keys';

// Новый скрейпер-сервер (Telegram + VK): /find-groups и /trending-posts
const SCRAPER_NEW_BASE = 'http://31.129.109.216:3030';
// Фоллбэк-токен (виден в N8N-воркфлоу, храним для надёжности)
const SCRAPER_NEW_BEARER_FALLBACK = '68b5bed1-ae3e-4eb5-be9e-eddf00ac3600';

// Старый скрейпер-сервер (YouTube + Instagram)
const SCRAPER_OLD_BASE = 'http://217.26.25.95:3030';

export interface CollectTrendsParams {
  campaignId: string;
  userId: string;
  authToken: string;
  postsPerPlatform?: number;
  daysSince?: number;
  platforms?: string[];
  collectSources?: boolean;
  keywords?: string[];
  maxSourcesPerPlatform?: number;
  minFollowers?: Record<string, number>;
  sourcesList?: string[];
}

// ─── Вспомогательные типы ────────────────────────────────────────────────────

interface TgGroup {
  id: string;
  title: string;
  link: string;
  members_count: number;
}

interface VkGroup {
  id: number | string;
  name: string;
  members: number;
  is_closed: number;
}

// ─── Получение Bearer-токена ─────────────────────────────────────────────────

async function getScraperBearerToken(): Promise<string> {
  try {
    const token = await globalApiKeysService.getGlobalApiKey(ApiServiceName.TRENDS_SCRAPER);
    if (token) return token;
  } catch {
    // ignore
  }
  log('[TrendCollector] Используем fallback Bearer-токен для скрейпера', 'warn');
  return SCRAPER_NEW_BEARER_FALLBACK;
}

async function getOldScraperApiKey(): Promise<string | null> {
  try {
    return await globalApiKeysService.getGlobalApiKey(ApiServiceName.TELEGRAM_COLLECT_COMMENTS) || null;
  } catch {
    return null;
  }
}

// ─── Вспомогательные функции ─────────────────────────────────────────────────

function calcEngagementScore(reactions: number, comments: number, views: number, reposts: number): number {
  const base = reactions * 3 + comments * 2 + reposts * 2;
  if (views > 0) return Math.round((base / views) * 1000);
  return base;
}

function extractChannelId(url: string): string {
  if (!url) return '';
  return url
    .replace(/https?:\/\/(t\.me|vk\.com|youtube\.com\/(@|c\/|channel\/)?|instagram\.com\/)/, '')
    .replace(/\/$/, '')
    .split('/')[0];
}

// ─── Запросы к новому скрейперу (31.129.109.216:3030) ────────────────────────

async function callNewScraper(endpoint: string, body: any, token: string): Promise<any | null> {
  try {
    const url = `${SCRAPER_NEW_BASE}${endpoint}`;
    log(`[TrendCollector] POST ${url} body=${JSON.stringify(body).substring(0, 200)}`, 'info');
    const response = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      timeout: 45000
    });
    return response.data;
  } catch (err: any) {
    log(`[TrendCollector] Ошибка ${endpoint}: ${err.response?.status} ${err.message}`, 'error');
    if (err.response?.data) {
      log(`[TrendCollector] Response body: ${JSON.stringify(err.response.data).substring(0, 300)}`, 'error');
    }
    return null;
  }
}

// ─── Запросы к старому скрейперу (217.26.25.95:3030) ─────────────────────────

async function callOldScraper(endpoint: string, body: any, apiKey: string): Promise<any[] | null> {
  try {
    const response = await axios.post(`${SCRAPER_OLD_BASE}${endpoint}`, body, {
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      timeout: 30000
    });
    const data = response.data;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.posts)) return data.posts;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.results)) return data.results;
    if (Array.isArray(data?.data)) return data.data;
    log(`[TrendCollector] ${endpoint} вернул неожиданный формат: ${JSON.stringify(data).substring(0, 200)}`, 'warn');
    return [];
  } catch (err: any) {
    log(`[TrendCollector] Ошибка ${endpoint}: ${err.response?.status} ${err.message}`, 'error');
    return null;
  }
}

// ─── Поиск групп/каналов ──────────────────────────────────────────────────────

async function findGroups(
  platform: 'telegram' | 'vk',
  keywords: string[],
  minMembers: number,
  maxGroups: number,
  token: string
): Promise<TgGroup[] | VkGroup[]> {
  const data = await callNewScraper('/find-groups', {
    platform,
    keywords,
    min_members: minMembers,
    max_groups: maxGroups
  }, token);

  if (!data) return [];

  if (platform === 'telegram') {
    // Ответ: массив {id, title, link, members_count}
    if (Array.isArray(data)) return data as TgGroup[];
    if (Array.isArray(data?.channels)) return data.channels as TgGroup[];
    if (Array.isArray(data?.groups)) return data.groups as TgGroup[];
    return [];
  } else {
    // Ответ VK: {groups: [{id, name, members, is_closed}]}
    const groups: VkGroup[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.groups)
        ? data.groups
        : [];
    // Фильтруем только открытые группы
    return groups.filter((g: VkGroup) => g.is_closed === 0 || g.is_closed === undefined);
  }
}

// ─── Сохранение источников в БД ──────────────────────────────────────────────

async function saveSourcesToDB(
  platform: 'telegram' | 'vk',
  groups: TgGroup[] | VkGroup[],
  campaignId: string
): Promise<{ savedIds: string[]; tgIds: string[]; vkIds: (number | string)[] }> {
  const savedIds: string[] = [];
  const tgIds: string[] = [];
  const vkIds: (number | string)[] = [];

  for (const g of groups as any[]) {
    try {
      if (platform === 'telegram') {
        const tg = g as TgGroup;
        const tgId = (tg.id || '').trim();
        if (!tgId) continue;

        const existing = await directusCrud.list('campaign_content_sources', {
          filter: { TgId: { _eq: tgId }, campaign_id: { _eq: campaignId } },
          limit: 1,
          fields: ['id'],
          useAdminToken: true
        }) as any[];

        let recordId: string;
        if (existing?.length > 0) {
          recordId = existing[0].id;
          await directusCrud.update('campaign_content_sources', recordId, {
            name: tg.title,
            url: tg.link || `https://t.me/${tgId}`,
            followersCount: tg.members_count,
            is_active: false
          }, { useAdminToken: true });
        } else {
          const created = await directusCrud.create('campaign_content_sources', {
            name: tg.title,
            url: tg.link || `https://t.me/${tgId}`,
            type: 'telegram',
            TgId: tgId,
            followersCount: tg.members_count,
            is_active: false,
            campaign_id: campaignId,
            created_at: new Date().toISOString()
          }, { useAdminToken: true }) as any;
          recordId = created?.id;
        }

        if (recordId) savedIds.push(recordId);
        tgIds.push(tgId);

      } else {
        const vk = g as VkGroup;
        const vkId = vk.id;
        if (!vkId) continue;

        const vkIdStr = String(vkId).replace('-', '');
        const url = `https://vk.com/club${vkIdStr}`;

        const existing = await directusCrud.list('campaign_content_sources', {
          filter: { vkId: { _eq: vkId }, campaign_id: { _eq: campaignId } },
          limit: 1,
          fields: ['id'],
          useAdminToken: true
        }) as any[];

        let recordId: string;
        if (existing?.length > 0) {
          recordId = existing[0].id;
          await directusCrud.update('campaign_content_sources', recordId, {
            name: vk.name,
            followersCount: vk.members
          }, { useAdminToken: true });
        } else {
          const created = await directusCrud.create('campaign_content_sources', {
            name: vk.name,
            url,
            type: 'vk',
            vkId: vkId,
            followersCount: vk.members,
            is_active: false,
            campaign_id: campaignId,
            created_at: new Date().toISOString()
          }, { useAdminToken: true }) as any;
          recordId = created?.id;
        }

        if (recordId) savedIds.push(recordId);
        vkIds.push(vkId);
      }
    } catch (err: any) {
      log(`[TrendCollector] Ошибка сохранения источника (${platform}): ${err.message}`, 'error');
    }
  }

  log(`[TrendCollector] Сохранено источников (${platform}): ${savedIds.length}`, 'info');
  return { savedIds, tgIds, vkIds };
}

// ─── Получение существующих источников из БД ─────────────────────────────────

async function getCampaignSources(
  campaignId: string,
  authToken: string,
  sourcesList?: string[]
): Promise<{
  telegram: { id: string; tgId: string }[];
  vk: { id: string; vkId: number | string }[];
  youtube: { id: string; channelId: string }[];
  instagram: { id: string; username: string }[];
}> {
  const result: any = { telegram: [], vk: [], youtube: [], instagram: [] };
  try {
    // Если переданы конкретные ID источников — фильтруем по ним, иначе по кампании
    const filter: Record<string, any> = sourcesList && sourcesList.length > 0
      ? { id: { _in: sourcesList } }
      : { campaign_id: { _eq: campaignId } };

    // Используем токен юзера (не admin) — так как в dev admin-токен не имеет прав на эту коллекцию
    const sources = await directusCrud.list('campaign_content_sources', {
      filter,
      fields: ['id', 'url', 'type', 'name', 'username', 'TgId', 'vkId'],
      limit: -1,
      authToken
    }) as any[];

    for (const s of sources) {
      const url: string = s.url || '';
      const type: string = (s.type || '').toLowerCase();

      if (type === 'telegram' || url.includes('t.me')) {
        const tgId = s.TgId || extractChannelId(url);
        if (tgId) result.telegram.push({ id: s.id, tgId });
      } else if (type === 'vk' || url.includes('vk.com')) {
        const vkId = s.vkId || extractChannelId(url).replace('club', '');
        if (vkId) result.vk.push({ id: s.id, vkId });
      } else if (type === 'youtube' || url.includes('youtube.com') || url.includes('youtu.be')) {
        const channelId = extractChannelId(url);
        if (channelId) result.youtube.push({ id: s.id, channelId });
      } else if (type === 'instagram' || url.includes('instagram.com')) {
        const username = s.username || extractChannelId(url);
        if (username) result.instagram.push({ id: s.id, username });
      }
    }

    log(`[TrendCollector] Источники из БД: TG=${result.telegram.length}, VK=${result.vk.length}, YT=${result.youtube.length}, IG=${result.instagram.length}`, 'info');
  } catch (err: any) {
    log(`[TrendCollector] Ошибка получения источников из БД: ${err.message}`, 'error');
  }
  return result;
}

// ─── Получение трендовых постов ───────────────────────────────────────────────

async function fetchTrendingPosts(
  platform: 'telegram' | 'vk',
  groupIds: (string | number)[],
  daysBack: number,
  postsPerGroup: number,
  minViews: number,
  token: string
): Promise<any[]> {
  if (groupIds.length === 0) return [];

  const data = await callNewScraper('/trending-posts', {
    platform,
    group_ids: groupIds,
    days_back: daysBack,
    posts_per_group: postsPerGroup,
    min_views: minViews
  }, token);

  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.posts)) return data.posts;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.results)) return data.results;

  log(`[TrendCollector] /trending-posts (${platform}) вернул неожиданный формат: ${JSON.stringify(data).substring(0, 200)}`, 'warn');
  return [];
}

// ─── Нормализация поста ───────────────────────────────────────────────────────

function normalizeTgPost(raw: any): {
  title: string; description: string; urlPost: string;
  reactions: number; comments: number; views: number; reposts: number;
  trendScore: number; mediaLinks: any; date: string | null; sourceId: string | null;
} {
  const text = raw.text || raw.message || '';
  const views = Number(raw.views || raw.views_count || 0);
  const reactions = Number(raw.reactions || raw.reactions_count || 0);
  const comments = Number(raw.comments || raw.comments_count || 0);
  const reposts = Number(raw.forwards || raw.reposts || raw.shares || 0);

  return {
    title: text.substring(0, 100) || 'Telegram пост',
    description: text,
    urlPost: raw.url || raw.link || '',
    reactions,
    comments,
    views,
    reposts,
    trendScore: Number(raw.trend_score || calcEngagementScore(reactions, comments, views, reposts)),
    mediaLinks: raw.media_links || null,
    date: raw.date || null,
    sourceId: raw.sourceId || raw.source_id || null
  };
}

function normalizeVkPost(raw: any): {
  title: string; description: string; urlPost: string;
  reactions: number; comments: number; views: number; reposts: number;
  trendScore: number; mediaLinks: any; date: string | null; sourceId: string | null;
  postType: string; accountUrl: string;
} {
  const text = raw.caption || raw.text || raw.description || '';
  return {
    title: text.substring(0, 100) || 'VK пост',
    description: text,
    urlPost: raw.url || raw.link || '',
    reactions: Number(raw.likesCount || raw.reactions || raw.likes || 0),
    comments: Number(raw.commentsCount || raw.comments || 0),
    views: Number(raw.viewsCount || raw.views || 0),
    reposts: Number(raw.repostsCount || raw.reposts || raw.shares || 0),
    trendScore: Number(raw.trendScore || raw.trend_score || 0),
    mediaLinks: raw.media_links || null,
    date: raw.timestamp || raw.date || null,
    sourceId: raw.source_id || raw.sourceId || null,
    postType: raw.type || 'post',
    accountUrl: raw.accountUrl || ''
  };
}

// ─── Сохранение постов ────────────────────────────────────────────────────────

async function saveTrendPosts(
  posts: any[],
  platform: 'telegram' | 'vk' | 'youtube' | 'instagram',
  campaignId: string,
  sourceIdMap?: Map<string, string>
): Promise<number> {
  let saved = 0;
  for (const raw of posts) {
    try {
      let topicData: Record<string, any>;

      if (platform === 'telegram') {
        const p = normalizeTgPost(raw);
        const dbSourceId = p.sourceId && sourceIdMap
          ? (sourceIdMap.get((p.sourceId as string).trim().toLowerCase()) || null)
          : null;
        topicData = {
          title: p.title,
          description: p.description || null,
          urlPost: p.urlPost || null,
          sourceType: 'telegram',
          reactions: p.reactions,
          comments: p.comments,
          views: p.views,
          reposts: p.reposts,
          trendScore: p.trendScore,
          media_links: p.mediaLinks,
          created_at: p.date || new Date().toISOString(),
          campaign_id: campaignId,
          source_id: dbSourceId,
          is_bookmarked: false,
          raw_source_data: raw
        };
      } else if (platform === 'vk') {
        const p = normalizeVkPost(raw);
        const dbSourceId = p.sourceId && sourceIdMap
          ? (sourceIdMap.get(String(p.sourceId)) || null)
          : null;
        topicData = {
          title: p.title,
          description: p.description || null,
          urlPost: p.urlPost || null,
          sourceType: 'vk',
          type: p.postType,
          accountUrl: p.accountUrl,
          reactions: p.reactions,
          comments: p.comments,
          views: p.views,
          reposts: p.reposts,
          trendScore: p.trendScore,
          media_links: p.mediaLinks,
          created_at: p.date || new Date().toISOString(),
          campaign_id: campaignId,
          source_id: dbSourceId,
          is_bookmarked: false,
          raw_source_data: raw
        };
      } else {
        // YouTube / Instagram — нормализация как раньше
        const text = raw.text || raw.message || raw.description || raw.title || raw.caption || '';
        const views = Number(raw.views || raw.views_count || raw.view_count || 0);
        const reactions = Number(raw.reactions || raw.reactions_count || raw.likes || raw.likes_count || 0);
        const comments = Number(raw.comments || raw.comments_count || 0);
        const reposts = Number(raw.reposts || raw.shares || 0);
        topicData = {
          title: text.substring(0, 200) || `${platform} пост`,
          description: text || null,
          urlPost: raw.url || raw.link || null,
          sourceType: platform,
          reactions,
          comments,
          views,
          reposts,
          trendScore: raw.trend_score
            ? Number(raw.trend_score)
            : raw.engagement_rate
              ? Math.round(Number(raw.engagement_rate) * 1000)
              : calcEngagementScore(reactions, comments, views, reposts),
          campaign_id: campaignId,
          is_bookmarked: false,
          raw_source_data: raw
        };
      }

      await directusCrud.create('campaign_trend_topics', topicData, { useAdminToken: true });
      saved++;
    } catch (err: any) {
      log(`[TrendCollector] Ошибка сохранения поста (${platform}): ${err.message}`, 'error');
    }
  }
  return saved;
}

// ─── Основная функция сбора трендов ──────────────────────────────────────────

export async function collectTrendsForCampaign(params: CollectTrendsParams): Promise<{
  telegram: number;
  vk: number;
  youtube: number;
  instagram: number;
  total: number;
  sourcesFound?: { telegram: number; vk: number };
}> {
  const { campaignId, authToken } = params;
  const limit = params.postsPerPlatform || 10;
  const daysBack = params.daysSince || 7;
  const collectSources = params.collectSources ?? false;
  const keywords = params.keywords || [];
  const maxSourcesPerPlatform = params.maxSourcesPerPlatform || 10;
  const minFollowers = params.minFollowers || { telegram: 2000, vk: 3000, youtube: 10000, instagram: 5000 };
  const platforms = params.platforms || ['telegram', 'vk', 'youtube', 'instagram'];
  const sourcesList = params.sourcesList;

  log(`[TrendCollector] 🚀 Сбор трендов для кампании ${campaignId} | platforms=${platforms.join(',')} | collectSources=${collectSources} | keywords=${keywords.length} | sourcesList=${sourcesList?.length ?? 'не передан'}`, 'info');

  const newScraperToken = await getScraperBearerToken();
  const oldScraperKey = await getOldScraperApiKey();

  const results = { telegram: 0, vk: 0, youtube: 0, instagram: 0, total: 0, sourcesFound: { telegram: 0, vk: 0 } };
  const tasks: Promise<void>[] = [];

  // ── Telegram ──────────────────────────────────────────────────────────────
  if (platforms.includes('telegram')) {
    tasks.push((async () => {
      let tgIds: string[] = [];
      const sourceIdMap = new Map<string, string>(); // tgId.lower → DB record id

      if (collectSources && keywords.length > 0) {
        log(`[TrendCollector][TG] Поиск каналов по ${keywords.length} ключевым словам`, 'info');
        const groups = await findGroups('telegram', keywords, minFollowers.telegram || 2000, maxSourcesPerPlatform, newScraperToken) as TgGroup[];
        log(`[TrendCollector][TG] Найдено каналов: ${groups.length}`, 'info');
        results.sourcesFound!.telegram = groups.length;

        if (groups.length > 0) {
          const { savedIds, tgIds: foundTgIds } = await saveSourcesToDB('telegram', groups, campaignId);
          tgIds = foundTgIds;
          groups.forEach((g, i) => {
            if (g.id && savedIds[i]) sourceIdMap.set(g.id.trim().toLowerCase(), savedIds[i]);
          });
        }
      } else {
        const dbSources = await getCampaignSources(campaignId, authToken, sourcesList);
        for (const s of dbSources.telegram) {
          tgIds.push(s.tgId);
          sourceIdMap.set(s.tgId.trim().toLowerCase(), s.id);
        }
      }

      if (tgIds.length === 0) {
        log(`[TrendCollector][TG] Нет каналов для сбора трендов`, 'warn');
        return;
      }

      log(`[TrendCollector][TG] Сбор трендов из ${tgIds.length} каналов: ${tgIds.slice(0, 5).join(', ')}`, 'info');
      const postsPerGroup = Math.max(Math.ceil(limit / tgIds.length), 3);
      const posts = await fetchTrendingPosts('telegram', tgIds, daysBack, postsPerGroup, 300, newScraperToken);
      log(`[TrendCollector][TG] Получено постов: ${posts.length}`, 'info');

      if (posts.length > 0) {
        results.telegram = await saveTrendPosts(posts, 'telegram', campaignId, sourceIdMap);
        log(`[TrendCollector][TG] ✅ Сохранено: ${results.telegram}`, 'info');
      }
    })());
  }

  // ── VK ────────────────────────────────────────────────────────────────────
  if (platforms.includes('vk')) {
    tasks.push((async () => {
      let vkIds: (number | string)[] = [];
      const sourceIdMap = new Map<string, string>(); // vkId → DB record id

      if (collectSources && keywords.length > 0) {
        log(`[TrendCollector][VK] Поиск групп по ${keywords.length} ключевым словам`, 'info');
        const groups = await findGroups('vk', keywords, minFollowers.vk || 3000, maxSourcesPerPlatform, newScraperToken) as VkGroup[];
        log(`[TrendCollector][VK] Найдено открытых групп: ${groups.length}`, 'info');
        results.sourcesFound!.vk = groups.length;

        if (groups.length > 0) {
          const { savedIds, vkIds: foundVkIds } = await saveSourcesToDB('vk', groups, campaignId);
          vkIds = foundVkIds;
          groups.forEach((g, i) => {
            if (g.id != null && savedIds[i]) sourceIdMap.set(String(g.id), savedIds[i]);
          });
        }
      } else {
        const dbSources = await getCampaignSources(campaignId, authToken, sourcesList);
        for (const s of dbSources.vk) {
          vkIds.push(s.vkId);
          sourceIdMap.set(String(s.vkId), s.id);
        }
      }

      if (vkIds.length === 0) {
        log(`[TrendCollector][VK] Нет групп для сбора трендов`, 'warn');
        return;
      }

      log(`[TrendCollector][VK] Сбор трендов из ${vkIds.length} групп`, 'info');
      const postsPerGroup = Math.max(Math.ceil(limit / vkIds.length), 3);
      const posts = await fetchTrendingPosts('vk', vkIds, daysBack, postsPerGroup, 300, newScraperToken);
      log(`[TrendCollector][VK] Получено постов: ${posts.length}`, 'info');

      if (posts.length > 0) {
        results.vk = await saveTrendPosts(posts, 'vk', campaignId, sourceIdMap);
        log(`[TrendCollector][VK] ✅ Сохранено: ${results.vk}`, 'info');
      }
    })());
  }

  // ── YouTube ───────────────────────────────────────────────────────────────
  if (platforms.includes('youtube') && oldScraperKey) {
    tasks.push((async () => {
      const dbSources = await getCampaignSources(campaignId, authToken, sourcesList);
      if (dbSources.youtube.length === 0) {
        log(`[TrendCollector][YT] Нет каналов YouTube в источниках`, 'warn');
        return;
      }
      const channelIds = dbSources.youtube.map(s => s.channelId);
      log(`[TrendCollector][YT] Сбор из ${channelIds.length} каналов`, 'info');
      const posts = await callOldScraper('/api/youtube/trending-videos', {
        channel_ids: channelIds,
        limit,
        days_back: daysBack,
        min_views: 500
      }, oldScraperKey);
      if (posts && posts.length > 0) {
        results.youtube = await saveTrendPosts(posts, 'youtube', campaignId);
        log(`[TrendCollector][YT] ✅ Сохранено: ${results.youtube}`, 'info');
      }
    })());
  }

  // ── Instagram ─────────────────────────────────────────────────────────────
  if (platforms.includes('instagram') && oldScraperKey) {
    tasks.push((async () => {
      const dbSources = await getCampaignSources(campaignId, authToken, sourcesList);
      if (dbSources.instagram.length === 0) {
        log(`[TrendCollector][IG] Нет аккаунтов Instagram в источниках`, 'warn');
        return;
      }
      const usernames = dbSources.instagram.map(s => s.username);
      log(`[TrendCollector][IG] Сбор из ${usernames.length} аккаунтов`, 'info');
      const posts = await callOldScraper('/api/instagram/instagram/collect-and-get-trending', {
        usernames,
        days_back: daysBack,
        content_per_user: Math.ceil(limit / usernames.length),
        trending_limit: limit,
        sort_by: 'engagement_rate'
      }, oldScraperKey);
      if (posts && posts.length > 0) {
        results.instagram = await saveTrendPosts(posts, 'instagram', campaignId);
        log(`[TrendCollector][IG] ✅ Сохранено: ${results.instagram}`, 'info');
      }
    })());
  }

  await Promise.all(tasks);

  results.total = results.telegram + results.vk + results.youtube + results.instagram;
  log(`[TrendCollector] ✅ Итого: ${results.total} (TG=${results.telegram}, VK=${results.vk}, YT=${results.youtube}, IG=${results.instagram}) | sourcesFound: TG=${results.sourcesFound?.telegram}, VK=${results.sourcesFound?.vk}`, 'info');

  return results;
}

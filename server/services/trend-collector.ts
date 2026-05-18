import axios from 'axios';
import { directusCrud } from './directus-crud';
import { directusApi } from '../directus';
import { log } from '../utils/logger';
import { globalApiKeysService } from './global-api-keys';
import { ApiServiceName } from './api-keys';

const SCRAPER_BASE = 'http://217.26.25.95:3030';

export interface CollectTrendsParams {
  campaignId: string;
  userId: string;
  authToken: string;
  postsPerPlatform?: number;
  daysSince?: number;
}

interface ScraperPost {
  platform: 'telegram' | 'vk' | 'youtube' | 'instagram';
  id?: string | number;
  text?: string;
  message?: string;
  description?: string;
  title?: string;
  url?: string;
  link?: string;
  views?: number;
  views_count?: number;
  reactions?: number;
  reactions_count?: number;
  likes?: number;
  likes_count?: number;
  comments?: number;
  comments_count?: number;
  reposts?: number;
  shares?: number;
  trend_score?: number;
  engagement_rate?: number;
  [key: string]: any;
}

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

async function getScraperApiKey(): Promise<string | null> {
  try {
    const key = await globalApiKeysService.getGlobalApiKey(ApiServiceName.TELEGRAM_COLLECT_COMMENTS);
    return key || null;
  } catch {
    return null;
  }
}

async function getCampaignSources(campaignId: string, authToken?: string): Promise<{
  telegram: string[];
  vk: string[];
  youtube: string[];
  instagram: string[];
}> {
  const result = { telegram: [], vk: [], youtube: [], instagram: [] } as any;
  try {
    const authOptions = authToken
      ? { token: authToken }
      : { useAdminToken: true };

    const sources = await directusCrud.list('campaign_content_sources', {
      filter: { campaign_id: { _eq: campaignId } },
      fields: ['id', 'url', 'type', 'name', 'username'],
      limit: -1,
      ...authOptions
    }) as any[];

    for (const s of sources) {
      const url: string = s.url || '';
      const type: string = (s.type || '').toLowerCase();

      if (type === 'telegram' || url.includes('t.me')) {
        result.telegram.push(extractChannelId(url));
      } else if (type === 'vk' || url.includes('vk.com')) {
        result.vk.push(extractChannelId(url));
      } else if (type === 'youtube' || url.includes('youtube.com') || url.includes('youtu.be')) {
        result.youtube.push(extractChannelId(url));
      } else if (type === 'instagram' || url.includes('instagram.com')) {
        result.instagram.push(extractChannelId(url));
      }
    }
    log(`[TrendCollector] Источники: TG=${result.telegram.length}, VK=${result.vk.length}, YT=${result.youtube.length}, IG=${result.instagram.length}`, 'info');
  } catch (err: any) {
    log(`[TrendCollector] Ошибка получения источников: ${err.message}`, 'error');
  }
  return result;
}

function normalizePost(raw: any, platform: string): {
  title: string;
  description: string;
  urlPost: string;
  sourceType: string;
  reactions: number;
  comments: number;
  views: number;
  reposts: number;
  engagementScore: number;
} {
  const text = raw.text || raw.message || raw.description || raw.title || raw.caption || '';
  const views = Number(raw.views || raw.views_count || raw.view_count || 0);
  const reactions = Number(raw.reactions || raw.reactions_count || raw.likes || raw.likes_count || raw.like_count || 0);
  const comments = Number(raw.comments || raw.comments_count || raw.comment_count || 0);
  const reposts = Number(raw.reposts || raw.shares || raw.share_count || 0);
  const url = raw.url || raw.link || raw.post_url || raw.permalink || '';

  const sourceLabels: Record<string, string> = {
    telegram: 'Telegram',
    vk: 'VK',
    youtube: 'YouTube',
    instagram: 'Instagram'
  };

  return {
    title: text.substring(0, 200) || `${sourceLabels[platform] || platform} пост`,
    description: text,
    urlPost: url,
    sourceType: sourceLabels[platform] || platform,
    reactions,
    comments,
    views,
    reposts,
    engagementScore: raw.trend_score
      ? Number(raw.trend_score)
      : raw.engagement_rate
        ? Math.round(Number(raw.engagement_rate) * 1000)
        : calcEngagementScore(reactions, comments, views, reposts)
  };
}

async function callScraper(endpoint: string, body: any, apiKey: string): Promise<any[] | null> {
  try {
    const response = await axios.post(`${SCRAPER_BASE}${endpoint}`, body, {
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

async function savePosts(posts: any[], platform: string, campaignId: string): Promise<number> {
  let saved = 0;
  for (const raw of posts) {
    try {
      const normalized = normalizePost(raw, platform);
      await directusCrud.create('campaign_trend_topics', {
        title: normalized.title,
        description: normalized.description || null,
        urlPost: normalized.urlPost || null,
        sourceType: normalized.sourceType,
        reactions: normalized.reactions,
        comments: normalized.comments,
        views: normalized.views,
        campaign_id: campaignId,
        is_bookmarked: false,
        raw_source_data: {
          ...raw,
          platform,
          reposts: normalized.reposts,
          engagementScore: normalized.engagementScore
        }
      }, { useAdminToken: true });
      saved++;
    } catch (err: any) {
      log(`[TrendCollector] Ошибка сохранения поста: ${err.message}`, 'error');
    }
  }
  return saved;
}

export async function collectTrendsForCampaign(params: CollectTrendsParams): Promise<{
  telegram: number;
  vk: number;
  youtube: number;
  instagram: number;
  total: number;
}> {
  const { campaignId, authToken } = params;
  const limit = params.postsPerPlatform || 20;
  const daysBack = params.daysSince || 7;

  log(`[TrendCollector] 🚀 Сбор трендов для кампании ${campaignId}`, 'info');

  const apiKey = await getScraperApiKey();
  if (!apiKey) {
    log('[TrendCollector] ❌ API ключ скрейпера не найден', 'error');
    return { telegram: 0, vk: 0, youtube: 0, instagram: 0, total: 0 };
  }

  const sources = await getCampaignSources(campaignId, authToken || undefined);
  const results = { telegram: 0, vk: 0, youtube: 0, instagram: 0, total: 0 };

  const tasks: Promise<void>[] = [];

  // Telegram
  if (sources.telegram.length > 0) {
    tasks.push((async () => {
      log(`[TrendCollector][TG] Сбор из ${sources.telegram.length} каналов`, 'info');
      const posts = await callScraper('/api/telegram/trending-posts', {
        channel_ids: sources.telegram,
        limit,
        days_back: daysBack,
        min_views: 100,
        download_media: false,
        async_mode: false
      }, apiKey);
      if (posts) {
        results.telegram = await savePosts(posts, 'telegram', campaignId);
        log(`[TrendCollector][TG] Сохранено: ${results.telegram}`, 'info');
      }
    })());
  }

  // VK
  if (sources.vk.length > 0) {
    tasks.push((async () => {
      log(`[TrendCollector][VK] Сбор из ${sources.vk.length} групп`, 'info');
      const posts = await callScraper('/api/vk/trending-posts', {
        group_ids: sources.vk,
        limit,
        days_back: daysBack,
        min_views: 100,
        download_media: false,
        async_mode: false
      }, apiKey);
      if (posts) {
        results.vk = await savePosts(posts, 'vk', campaignId);
        log(`[TrendCollector][VK] Сохранено: ${results.vk}`, 'info');
      }
    })());
  }

  // YouTube
  if (sources.youtube.length > 0) {
    tasks.push((async () => {
      log(`[TrendCollector][YT] Сбор из ${sources.youtube.length} каналов`, 'info');
      const posts = await callScraper('/api/youtube/trending-videos', {
        channel_ids: sources.youtube,
        limit,
        days_back: daysBack,
        min_views: 500
      }, apiKey);
      if (posts) {
        results.youtube = await savePosts(posts, 'youtube', campaignId);
        log(`[TrendCollector][YT] Сохранено: ${results.youtube}`, 'info');
      }
    })());
  }

  // Instagram
  if (sources.instagram.length > 0) {
    tasks.push((async () => {
      log(`[TrendCollector][IG] Сбор из ${sources.instagram.length} аккаунтов`, 'info');
      const posts = await callScraper('/api/instagram/instagram/collect-and-get-trending', {
        usernames: sources.instagram,
        days_back: daysBack,
        content_per_user: Math.ceil(limit / sources.instagram.length),
        trending_limit: limit,
        sort_by: 'engagement_rate'
      }, apiKey);
      if (posts) {
        results.instagram = await savePosts(posts, 'instagram', campaignId);
        log(`[TrendCollector][IG] Сохранено: ${results.instagram}`, 'info');
      }
    })());
  }

  await Promise.all(tasks);

  results.total = results.telegram + results.vk + results.youtube + results.instagram;
  log(`[TrendCollector] ✅ Итого сохранено: ${results.total} (TG=${results.telegram}, VK=${results.vk}, YT=${results.youtube}, IG=${results.instagram})`, 'info');

  return results;
}

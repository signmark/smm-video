import axios from 'axios';
import { SCRAPER_BASE, getScraperApiKey } from './trend-collector';
import { log } from '../utils/logger';

// ─── Типы ─────────────────────────────────────────────────────────────────────

export interface ChannelResponse {
  id: string;
  platform: string;
  platform_channel_id: string;
  name: string;
  is_active: boolean;
  metadata: Record<string, any>;
  created_at: string;
  last_parsed_at: string | null;
}

export interface AnalyticsOverview {
  channel_id: string;
  total_posts: number;
  total_views: number;
  total_likes: number;
  total_comments: number;
  total_shares: number;
  avg_engagement_rate: number;
  period_days: number;
}

export interface AnalyticsDataPoint {
  date: string;
  posts: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagement_rate: number;
}

export interface TrendPost {
  id: number;
  channel_id: number;
  text: string;
  date: string;
  views: number;
  reactions: number;
  comments: number;
  forwards: number;
  url?: string;
  platform?: string;
}

export interface TrendHashtag {
  hashtag: string;
  count: number;
  total_views?: number;
}

export interface EngagementData {
  channel_id: string;
  platform_channel_id: string;
  name: string;
  avg_engagement_rate: number;
  total_posts: number;
  total_views: number;
}

// ─── Вспомогательная функция запроса ─────────────────────────────────────────

async function scraperGet<T = any>(path: string, params?: Record<string, any>): Promise<T | null> {
  const apiKey = await getScraperApiKey();
  try {
    const url = `${SCRAPER_BASE}${path}`;
    const response = await axios.get(url, {
      headers: { 'api-key': apiKey },
      params,
      timeout: 20000
    });
    return response.data as T;
  } catch (err: any) {
    log(`[ScraperAnalytics] GET ${path} error: ${err.response?.status} ${err.message}`, 'error');
    return null;
  }
}

async function scraperPost<T = any>(path: string, body: Record<string, any>): Promise<T | null> {
  const apiKey = await getScraperApiKey();
  try {
    const url = `${SCRAPER_BASE}${path}`;
    const response = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      timeout: 20000
    });
    return response.data as T;
  } catch (err: any) {
    log(`[ScraperAnalytics] POST ${path} error: ${err.response?.status} ${err.message}`, 'error');
    if (err.response?.data) {
      log(`[ScraperAnalytics] Response: ${JSON.stringify(err.response.data).substring(0, 300)}`, 'error');
    }
    return null;
  }
}

// ─── Мониторинг каналов ───────────────────────────────────────────────────────

export async function getMonitoredChannels(): Promise<ChannelResponse[]> {
  const data = await scraperGet<ChannelResponse[] | { channels: ChannelResponse[] }>('/api/v1/monitoring/channels');
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray((data as any).channels)) return (data as any).channels;
  return [];
}

export async function createMonitoringChannel(payload: {
  platform: string;
  platform_channel_id: string;
  name?: string;
  metadata?: Record<string, any>;
}): Promise<ChannelResponse | null> {
  return scraperPost<ChannelResponse>('/api/v1/monitoring/channels', payload);
}

export async function getChannelById(channelId: string): Promise<ChannelResponse | null> {
  return scraperGet<ChannelResponse>(`/api/v1/monitoring/channels/${channelId}`);
}

// ─── Аналитика каналов ────────────────────────────────────────────────────────

export async function getChannelAnalytics(
  channelId: string,
  params?: { from_date?: string; to_date?: string; granularity?: 'day' | 'week' | 'month' }
): Promise<AnalyticsDataPoint[] | null> {
  return scraperGet<AnalyticsDataPoint[]>(`/api/v1/channels/${channelId}/analytics`, params);
}

export async function getChannelOverview(channelId: string): Promise<AnalyticsOverview | null> {
  return scraperGet<AnalyticsOverview>(`/api/v1/channels/${channelId}/overview`);
}

// ─── Трендовые посты и хэштеги ────────────────────────────────────────────────

export async function getTrendingPosts(params?: {
  platform?: string;
  channel_ids?: string[];
  from_date?: string;
  to_date?: string;
  limit?: number;
}): Promise<TrendPost[]> {
  const queryParams: Record<string, any> = {};
  if (params?.platform) queryParams.platform = params.platform;
  if (params?.from_date) queryParams.from_date = params.from_date;
  if (params?.to_date) queryParams.to_date = params.to_date;
  if (params?.limit) queryParams.limit = params.limit;
  if (params?.channel_ids?.length) queryParams.channel_ids = params.channel_ids.join(',');

  const data = await scraperGet<TrendPost[] | { posts: TrendPost[] }>('/api/v1/trends/posts', queryParams);
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray((data as any).posts)) return (data as any).posts;
  return [];
}

export async function getTrendingHashtags(params?: {
  platform?: string;
  from_date?: string;
  to_date?: string;
  limit?: number;
}): Promise<TrendHashtag[]> {
  const data = await scraperGet<TrendHashtag[] | { hashtags: TrendHashtag[] }>('/api/v1/trends/hashtags', params);
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray((data as any).hashtags)) return (data as any).hashtags;
  return [];
}

// ─── Сравнительный engagement ─────────────────────────────────────────────────

export async function getEngagementComparison(params?: {
  platform?: string;
  channel_ids?: string[];
  from_date?: string;
  to_date?: string;
}): Promise<EngagementData[]> {
  const queryParams: Record<string, any> = {};
  if (params?.platform) queryParams.platform = params.platform;
  if (params?.from_date) queryParams.from_date = params.from_date;
  if (params?.to_date) queryParams.to_date = params.to_date;
  if (params?.channel_ids?.length) queryParams.channel_ids = params.channel_ids.join(',');

  const data = await scraperGet<EngagementData[] | { channels: EngagementData[] }>('/api/v1/analytics/engagement', queryParams);
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray((data as any).channels)) return (data as any).channels;
  return [];
}

// ─── Авторегистрация каналов из кампании ─────────────────────────────────────

export async function ensureChannelsRegistered(
  channels: Array<{ platform: string; id: string; name?: string }>
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>(); // platform:channelId → scraperUUID

  const existingChannels = await getMonitoredChannels();
  const existingMap = new Map(existingChannels.map(c => [`${c.platform}:${c.platform_channel_id}`, c.id]));

  await Promise.all(channels.map(async ch => {
    const key = `${ch.platform}:${ch.id}`;
    if (existingMap.has(key)) {
      idMap.set(key, existingMap.get(key)!);
      return;
    }
    try {
      const created = await createMonitoringChannel({
        platform: ch.platform,
        platform_channel_id: ch.id,
        name: ch.name
      });
      if (created?.id) {
        idMap.set(key, created.id);
        log(`[ScraperAnalytics] Registered channel ${ch.platform}:${ch.id} → ${created.id}`, 'info');
      }
    } catch (err: any) {
      log(`[ScraperAnalytics] Failed to register channel ${key}: ${err.message}`, 'warn');
    }
  }));

  return idMap;
}

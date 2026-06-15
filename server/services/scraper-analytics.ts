import axios from 'axios';
import { SCRAPER_BASE } from './trend-collector';
import { log } from '../utils/logger';

const ANALYTICS_BASE = SCRAPER_BASE;

function getAnalyticsApiKey(): string {
  return process.env.SCRAPER_ANALYTICS_API_KEY || '';
}

// ─── Типы ─────────────────────────────────────────────────────────────────────

export interface ChannelResponse {
  id: string;
  platform: string;
  platform_channel_id: string;
  name: string;
  is_active: boolean;
  metadata: { subscribers_count?: number; parse_slot?: number; [key: string]: any };
  created_at: string;
  last_parsed_at: string | null;
}

export interface ChannelListResponse {
  items: ChannelResponse[];
  total: number;
  page: number;
  page_size: number;
}

export interface ParseStatus {
  channel_id: string;
  status: 'idle' | 'parsing' | 'error';
  last_parsed_at: string | null;
  posts_count: number;
  last_error: string | null;
  next_parse_at: string | null;
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

export interface ChannelAnalytics {
  channel_id: string;
  platform: string;
  platform_channel_id: string;
  name: string;
  subscribers_count: number;
  last_parsed_at: string | null;
  from_date: string;
  to_date: string;
  total_posts: number;
  total_views: number;
  total_likes: number;
  total_comments: number;
  total_shares: number;
  avg_engagement_rate: number;
  avg_views: number;
  avg_likes: number;
  avg_comments: number;
  avg_shares: number;
  posts_per_day: number;
  views_per_subscriber: number;
  granularity: string;
  data: AnalyticsDataPoint[];
  trend_direction: 'growing' | 'declining' | 'stable';
  trend_percent: number;
  trend_data: {
    direction: string;
    percent: number;
    views_growth: number;
    engagement_growth: number;
    posts_growth: number;
  };
  dynamics: ChannelDynamicsPoint[];
}

export interface ChannelDynamicsPoint {
  date: string;
  subscribers_count: number;
  posts_in_period: number;
  avg_views_per_post: number;
  total_views: number;
  total_likes: number;
  total_comments: number;
  total_shares: number;
  subscribers_growth: number;
  subscribers_growth_percent: number;
}

export interface TrendPost {
  id: string;
  platform: string;
  platform_post_id: string;
  published_date: string;
  captured_at: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagement_rate: number;
  text: string;
  url: string;
  channel_id?: string;
  channel_name?: string;
  hashtags?: string[];
}

export interface ChannelPost extends TrendPost {
  highlight?: string | null;
}

export interface ChannelPostsResponse {
  items: ChannelPost[];
  total: number;
  page: number;
  page_size: number;
  has_next_page: boolean;
}

export interface TrendHashtag {
  hashtag: string;
  posts_count: number;
  total_reach: number;
  trend_score: number;
  related_hashtags: string[];
}

export interface EngagementData {
  channel_id: string;
  channel_name: string;
  platform: string;
  avg_engagement: number;
  posts_count: number;
  url: string;
}

export interface EngagementResponse {
  from_date: string;
  to_date: string;
  channels: EngagementData[];
  best_performer: EngagementData | null;
}

export interface BestTimesResponse {
  channel_id: string;
  best_days: string[];
  best_hours: number[];
  data: {
    by_day: Array<{ day: number; day_name: string; avg_engagement: number; posts_count: number }>;
    by_hour: Array<{ hour: number; avg_engagement: number; posts_count: number }>;
  };
}

export interface PostDynamics {
  platform_post_id: string;
  published_date: string;
  data_points: Array<{
    date: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    engagement_rate: number;
  }>;
  first_views: number;
  current_views: number;
  views_growth: number;
  views_growth_percent: number;
  trend: 'rising' | 'falling' | 'stable';
}

export interface PostsDynamicsResponse {
  channel_id: string;
  from_date: string;
  to_date: string;
  posts_count: number;
  posts: PostDynamics[];
  rising_posts: PostDynamics[];
  best_performer: PostDynamics | null;
}

export interface MetricsRefreshResponse {
  status: string;
  processed: number;
  failed: number;
  skipped: number;
  duration_seconds: number;
  errors: string[];
}

// ─── Вспомогательные функции запроса ──────────────────────────────────────────

async function analyticsGet<T = any>(path: string, params?: Record<string, any>): Promise<T | null> {
  const apiKey = getAnalyticsApiKey();
  try {
    const url = `${ANALYTICS_BASE}${path}`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      params,
      timeout: 20000
    });
    return response.data as T;
  } catch (err: any) {
    log(`[ScraperAnalytics] GET ${path} error: ${err.response?.status} ${err.message}`, 'error');
    if (err.response?.data?.detail) log(`[ScraperAnalytics] detail: ${err.response.data.detail}`, 'error');
    return null;
  }
}

async function analyticsPost<T = any>(path: string, body: Record<string, any> = {}, params?: Record<string, any>): Promise<T | null> {
  const apiKey = getAnalyticsApiKey();
  try {
    const url = `${ANALYTICS_BASE}${path}`;
    const response = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      params,
      timeout: 60000
    });
    return response.data as T;
  } catch (err: any) {
    log(`[ScraperAnalytics] POST ${path} error: ${err.response?.status} ${err.message}`, 'error');
    if (err.response?.data?.detail) log(`[ScraperAnalytics] detail: ${err.response.data.detail}`, 'error');
    return null;
  }
}

async function analyticsDelete(path: string): Promise<boolean> {
  const apiKey = getAnalyticsApiKey();
  try {
    const url = `${ANALYTICS_BASE}${path}`;
    await axios.delete(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 20000
    });
    return true;
  } catch (err: any) {
    log(`[ScraperAnalytics] DELETE ${path} error: ${err.response?.status} ${err.message}`, 'error');
    return false;
  }
}

// ─── Мониторинг каналов ───────────────────────────────────────────────────────

export async function getMonitoredChannels(params?: { platform?: string; is_active?: boolean; page?: number; page_size?: number }): Promise<ChannelListResponse> {
  const data = await analyticsGet<ChannelListResponse>('/api/v1/monitoring/channels', params);
  if (!data) return { items: [], total: 0, page: 1, page_size: 20 };
  return data;
}

export async function createMonitoringChannel(payload: {
  platform: string;
  platform_channel_id: string;
  name?: string;
  metadata?: Record<string, any>;
  id?: string;
}): Promise<ChannelResponse | null> {
  return analyticsPost<ChannelResponse>('/api/v1/monitoring/channels', payload);
}

export async function deleteMonitoringChannel(channelId: string): Promise<boolean> {
  return analyticsDelete(`/api/v1/monitoring/channels/${channelId}`);
}

export async function getChannelParseStatus(channelId: string): Promise<ParseStatus | null> {
  return analyticsGet<ParseStatus>(`/api/v1/monitoring/channels/${channelId}/parse-status`);
}

export async function forceParseChannel(channelId: string): Promise<{ message: string; task_id: string; status: string } | null> {
  return analyticsPost(`/api/v1/monitoring/channels/${channelId}/force-parse`);
}

// ─── Посты каналов ────────────────────────────────────────────────────────────

export async function getChannelPosts(
  channelId: string,
  params?: { page?: number; page_size?: number; from_date?: string; to_date?: string }
): Promise<ChannelPostsResponse | null> {
  return analyticsGet<ChannelPostsResponse>(`/api/v1/channels/${channelId}/posts`, params);
}

// ─── Аналитика каналов ────────────────────────────────────────────────────────

export async function getChannelAnalytics(
  channelId: string,
  params?: { from_date?: string; to_date?: string; granularity?: 'day' | 'week' | 'month' }
): Promise<ChannelAnalytics | null> {
  return analyticsGet<ChannelAnalytics>(`/api/v1/channels/${channelId}/analytics`, params);
}

export async function getChannelOverview(channelId: string): Promise<AnalyticsOverview | null> {
  return analyticsGet<AnalyticsOverview>(`/api/v1/channels/${channelId}/overview`);
}

export async function getChannelBestTimes(channelId: string): Promise<BestTimesResponse | null> {
  return analyticsGet<BestTimesResponse>(`/api/v1/channels/${channelId}/best-times`);
}

export async function getChannelPostsDynamics(
  channelId: string,
  params?: { days?: number; min_views?: number; limit?: number }
): Promise<PostsDynamicsResponse | null> {
  return analyticsGet<PostsDynamicsResponse>(`/api/v1/channels/${channelId}/posts/dynamics`, params);
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

  const data = await analyticsGet<{ posts: TrendPost[] } | TrendPost[]>('/api/v1/trends/posts', queryParams);
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return (data as any).posts ?? [];
}

export async function getTrendingHashtags(params?: {
  platform?: string;
  from_date?: string;
  to_date?: string;
  limit?: number;
}): Promise<TrendHashtag[]> {
  const data = await analyticsGet<{ hashtags: TrendHashtag[] } | TrendHashtag[]>('/api/v1/trends/hashtags', params);
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return (data as any).hashtags ?? [];
}

// ─── Сравнительный engagement ─────────────────────────────────────────────────

export async function getEngagementComparison(params?: {
  platform?: string;
  channel_ids?: string[];
  from_date?: string;
  to_date?: string;
  limit?: number;
}): Promise<EngagementResponse> {
  const queryParams: Record<string, any> = {};
  if (params?.platform) queryParams.platform = params.platform;
  if (params?.from_date) queryParams.from_date = params.from_date;
  if (params?.to_date) queryParams.to_date = params.to_date;
  if (params?.limit) queryParams.limit = params.limit;
  if (params?.channel_ids?.length) queryParams.channel_ids = params.channel_ids.join(',');

  const data = await analyticsGet<EngagementResponse>('/api/v1/analytics/engagement', queryParams);
  if (!data) return { from_date: '', to_date: '', channels: [], best_performer: null };
  return data;
}

// ─── Шедулер ─────────────────────────────────────────────────────────────────

export async function refreshChannelMetrics(params: {
  channel_ids: string[];
  days?: number;
  force?: boolean;
}): Promise<MetricsRefreshResponse | null> {
  return analyticsPost<MetricsRefreshResponse>(
    '/api/v1/monitoring/scheduler/metrics-refresh',
    {},
    {
      channel_ids: params.channel_ids.join(','),
      days: params.days ?? 7,
      force: params.force ?? false
    }
  );
}

// ─── Авторегистрация каналов из кампании ─────────────────────────────────────

export async function ensureChannelsRegistered(
  channels: Array<{ platform: string; id: string; name?: string }>
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();

  const existing = await getMonitoredChannels({ page_size: 100 });
  const existingMap = new Map(existing.items.map(c => [`${c.platform}:${c.platform_channel_id}`, c.id]));

  for (const ch of channels) {
    const key = `${ch.platform}:${ch.id}`;
    if (existingMap.has(key)) {
      idMap.set(key, existingMap.get(key)!);
      continue;
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
  }

  return idMap;
}

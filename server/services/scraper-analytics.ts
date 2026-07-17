import axios from 'axios';
import { SCRAPER_BASE, getScraperApiKey } from './trend-collector';
import { log } from '../utils/logger';

const ANALYTICS_BASE = SCRAPER_BASE;

async function getAnalyticsApiKey(): Promise<string> {
  // Приоритет: SCRAPER_ANALYTICS_API_KEY → SCRAPER_API_KEY → Directus (trends_scraper / telegram_collect_comments) → захардкоженный fallback
  if (process.env.SCRAPER_ANALYTICS_API_KEY) return process.env.SCRAPER_ANALYTICS_API_KEY;
  if (process.env.SCRAPER_API_KEY) return process.env.SCRAPER_API_KEY;
  return getScraperApiKey();
}

function getAnalyticsErrorMessage(method: string, path: string, err: any): string {
  const status = err.response?.status;
  const responseData = err.response?.data;
  const detail = typeof responseData === 'string'
    ? responseData
    : responseData?.detail || responseData?.error || responseData?.message;
  const suffix = detail ? `: ${String(detail).slice(0, 500)}` : '';

  if (status === 401 || status === 403) {
    return `Analytics API отклонил ключ доступа (HTTP ${status})${suffix}`;
  }

  if (status) {
    return `Analytics API вернул HTTP ${status} для ${method} ${path}${suffix}`;
  }

  const networkDetails = [err.code, err.message]
    .filter(Boolean)
    .join(': ') || 'network error';
  return `Analytics API недоступен для ${method} ${path}: ${networkDetails}`;
}

function logAnalyticsRequest(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params?: Record<string, any>,
  body?: Record<string, any>,
): void {
  const request = {
    method,
    url: `${ANALYTICS_BASE}${path}`,
    headers: {
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      Authorization: 'Bearer [REDACTED]',
    },
    query: params || {},
    ...(method === 'POST' ? { body: body || {} } : {}),
  };
  log.warn(`scraper request=${JSON.stringify(request)}`, 'analytics');
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

export interface ScraperCampaignChannel {
  platform: 'telegram' | 'vk';
  id: string;
  name?: string;
}

function normalizeTelegramPublicUsername(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const username = raw.replace(/^@+/, '');
  return /^[A-Za-z0-9_]{5,32}$/.test(username) ? `@${username}` : null;
}

export function getScraperCampaignChannels(
  socialSettings: any,
  campaignName?: string,
): ScraperCampaignChannel[] {
  const channels: ScraperCampaignChannel[] = [];
  const telegram = socialSettings?.telegram;
  const telegramChatId = String(telegram?.chatId ?? '').trim();
  const telegramPublicId = telegramChatId.startsWith('@')
    ? normalizeTelegramPublicUsername(telegramChatId)
    : normalizeTelegramPublicUsername(telegram?.username);

  if (telegramPublicId) {
    channels.push({
      platform: 'telegram',
      id: telegramPublicId,
      name: campaignName,
    });
  }

  const vkGroupId = String(socialSettings?.vk?.groupId ?? '').trim();
  if (vkGroupId) {
    channels.push({
      platform: 'vk',
      id: vkGroupId,
      name: campaignName,
    });
  }

  return channels;
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

function logMetricsRefreshFailure(
  channels: Array<{ id: string; platform: string; platform_channel_id: string }>,
  days: number,
  force: boolean,
  error: Error,
): void {
  const channelIds = channels.map(channel => channel.id);
  const request = {
    method: 'POST',
    url: `${ANALYTICS_BASE}/api/v1/monitoring/scheduler/metrics-refresh`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer [REDACTED]',
    },
    query: {
      channel_ids: channelIds,
      days,
      force,
    },
    body: {},
  };
  const scraperChannels = channels.map(channel => ({
    scraper_channel_id: channel.id,
    platform: channel.platform,
    platform_channel_id: channel.platform_channel_id,
  }));
  log.warn(
    `metrics-refresh failed request=${JSON.stringify(request)} scraper_channels=${JSON.stringify(scraperChannels)} error=${error.message}`,
    'analytics',
  );
}

// ─── Вспомогательные функции запроса ──────────────────────────────────────────

async function analyticsGet<T = any>(
  path: string,
  params?: Record<string, any>,
  throwOnError = false,
): Promise<T | null> {
  const apiKey = await getAnalyticsApiKey();
  try {
    const url = `${ANALYTICS_BASE}${path}`;
    logAnalyticsRequest('GET', path, params);
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      params,
      timeout: 20000
    });
    return response.data as T;
  } catch (err: any) {
    const message = getAnalyticsErrorMessage('GET', path, err);
    log.warn(message, 'analytics');
    if (throwOnError) throw new Error(message);
    return null;
  }
}

async function analyticsPost<T = any>(
  path: string,
  body: Record<string, any> = {},
  params?: Record<string, any>,
  throwOnError = false,
): Promise<T | null> {
  const apiKey = await getAnalyticsApiKey();
  const startedAt = Date.now();
  try {
    const url = `${ANALYTICS_BASE}${path}`;
    logAnalyticsRequest('POST', path, params, body);
    log(`[ScraperAnalytics] → POST ${url} body=${JSON.stringify(body)}`, 'info');
    const response = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      params,
      paramsSerializer: { indexes: null },
      timeout: 60000
    });
    log(`[ScraperAnalytics] ← POST ${path} status=${response.status} response=${JSON.stringify(response.data)}`, 'info');
    return response.data as T;
  } catch (err: any) {
    const message = getAnalyticsErrorMessage('POST', path, err);
    log.warn(
      `${message} elapsed_ms=${Date.now() - startedAt} timeout_ms=60000`,
      'analytics',
    );
    if (throwOnError) throw new Error(message);
    return null;
  }
}

async function analyticsDelete(path: string): Promise<boolean> {
  const apiKey = await getAnalyticsApiKey();
  try {
    const url = `${ANALYTICS_BASE}${path}`;
    logAnalyticsRequest('DELETE', path);
    await axios.delete(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 20000
    });
    return true;
  } catch (err: any) {
    log.warn(getAnalyticsErrorMessage('DELETE', path, err), 'analytics');
    return false;
  }
}

// ─── Мониторинг каналов ───────────────────────────────────────────────────────

export async function getMonitoredChannels(
  params?: { platform?: string; is_active?: boolean; page?: number; page_size?: number },
  throwOnError = false,
): Promise<ChannelListResponse> {
  const data = await analyticsGet<ChannelListResponse>('/api/v1/monitoring/channels', params, throwOnError);
  if (!data) return { items: [], total: 0, page: 1, page_size: 20 };
  return data;
}

export async function getAllMonitoredChannels(
  params?: { platform?: string; is_active?: boolean },
  throwOnError = false,
): Promise<ChannelListResponse> {
  const items: ChannelResponse[] = [];
  let page = 1;
  let total = 0;

  do {
    const response = await getMonitoredChannels(
      { ...params, page, page_size: 100 },
      throwOnError,
    );
    items.push(...response.items);
    total = response.total;
    if (response.items.length === 0) break;
    page += 1;
  } while (items.length < total);

  return { items, total, page: 1, page_size: items.length };
}

export async function createMonitoringChannel(payload: {
  platform: string;
  platform_channel_id: string;
  name?: string;
  metadata?: Record<string, any>;
  id?: string;
}, throwOnError = false): Promise<ChannelResponse | null> {
  return analyticsPost<ChannelResponse>('/api/v1/monitoring/channels', payload, undefined, throwOnError);
}

export async function deleteMonitoringChannel(channelId: string): Promise<boolean> {
  return analyticsDelete(`/api/v1/monitoring/channels/${channelId}`);
}

export async function getChannelParseStatus(channelId: string, throwOnError = false): Promise<ParseStatus | null> {
  return analyticsGet<ParseStatus>(
    `/api/v1/monitoring/channels/${channelId}/parse-status`,
    undefined,
    throwOnError,
  );
}

export async function forceParseChannel(
  channelId: string,
  throwOnError = false,
): Promise<{ message: string; task_id: string; status: string } | null> {
  const result = await analyticsPost<{ message: string; task_id: string; status: string }>(
    `/api/v1/monitoring/channels/${channelId}/force-parse`,
    {},
    undefined,
    throwOnError,
  );
  if (!result) return null;

  if (result.status === 'failed') {
    const message = result.message || `force-parse завершился ошибкой для канала ${channelId}`;
    log.warn(message, 'analytics');
    if (throwOnError) throw new Error(message);
    return null;
  }

  if (result.status !== 'started' && result.status !== 'completed') {
    const message = `Analytics API вернул неизвестный статус force-parse: ${String(result.status)}`;
    log.warn(message, 'analytics');
    if (throwOnError) throw new Error(message);
    return null;
  }

  return result;
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
  channels: Array<{ id: string; platform: string; platform_channel_id: string }>;
  days?: number;
  force?: boolean;
}): Promise<MetricsRefreshResponse | null> {
  const days = params.days ?? 7;
  const force = params.force ?? true;
  // Live OpenAPI declares channel_ids as a query array. Axios indexes:null
  // serializes it as channel_ids=uuid1&channel_ids=uuid2 for FastAPI.
  const refresh = (channelIds: string[]) => analyticsPost<MetricsRefreshResponse>(
      '/api/v1/monitoring/scheduler/metrics-refresh',
      {},
      { channel_ids: channelIds, days, force },
      true,
    );
  const channelIds = params.channels.map(c => c.id);

  log(`[ScraperAnalytics] metrics-refresh query: channel_ids=${channelIds.join(',')}&days=${days}&force=${force}`, 'info');

  try {
    return await refresh(channelIds);
  } catch (batchError: any) {
    logMetricsRefreshFailure(params.channels, days, force, batchError);
    if (params.channels.length <= 1) {
      const channel = params.channels[0];
      throw new Error(
        `Не удалось обновить ${channel.platform}:${channel.platform_channel_id}: ${batchError.message}`,
      );
    }
    const isRetryableBatchFailure = /HTTP 500|ECONNABORTED|ECONNRESET|timeout|aborted/i
      .test(String(batchError.message));
    if (!isRetryableBatchFailure) throw batchError;

    // Scraper может вернуть непрозрачный HTTP 500 для всего пакета. Повтор по одному
    // сохраняет метрики исправных каналов и показывает, какой именно канал падает.
    log.warn(
      `Пакетное обновление ${params.channels.length} каналов не удалось; повторяем каналы по одному`,
      'analytics',
    );

    const aggregate: MetricsRefreshResponse = {
      status: 'completed',
      processed: 0,
      failed: 0,
      skipped: 0,
      duration_seconds: 0,
      errors: [],
    };
    let successfulChannels = 0;

    for (const channel of params.channels) {
      try {
        const result = await refresh([channel.id]);
        if (!result) throw new Error('Analytics API вернул пустой ответ');
        aggregate.processed += result.processed || 0;
        aggregate.failed += result.failed || 0;
        aggregate.skipped += result.skipped || 0;
        aggregate.duration_seconds += result.duration_seconds || 0;
        successfulChannels += 1;
        aggregate.errors.push(...(result.errors || []).map(
          error => `${channel.platform}:${channel.platform_channel_id}: ${error}`,
        ));
      } catch (channelError: any) {
        logMetricsRefreshFailure([channel], days, force, channelError);
        aggregate.failed += 1;
        aggregate.errors.push(
          `${channel.platform}:${channel.platform_channel_id}: ${channelError.message}`,
        );
      }
    }

    if (aggregate.failed > 0) {
      aggregate.status = successfulChannels > 0 ? 'partial' : 'failed';
    }

    return aggregate;
  }
}

// ─── Авторегистрация каналов из кампании ─────────────────────────────────────

export async function ensureChannelsRegistered(
  channels: Array<{ platform: string; id: string; name?: string }>
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();

  const existing = await getAllMonitoredChannels(undefined, true);
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
      }, true);
      if (created?.id) {
        idMap.set(key, created.id);
        log(`[ScraperAnalytics] Registered channel ${ch.platform}:${ch.id} → ${created.id}`, 'info');
      }
    } catch (err: any) {
      log.warn(`Не удалось зарегистрировать канал ${key}: ${err.message}`, 'analytics');
      throw err;
    }
  }

  return idMap;
}

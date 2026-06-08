import axios from 'axios';
import { directusCrud } from './directus-crud';
import { log } from '../utils/logger';
import { globalApiKeysService } from './global-api-keys';
import { ApiServiceName } from './api-keys';

// Скрейпер-сервер (Telegram, VK, YouTube, Instagram + аналитика)
export const SCRAPER_BASE = 'http://217.26.25.95:3030';
// Фоллбэк api-key для скрейпера (обновлён 2026-06-08)
const SCRAPER_API_KEY_FALLBACK = 'c1f2e8ad-61c5-450a-b301-12690e9e1112';

// Алиас для обратной совместимости
const SCRAPER_OLD_BASE = SCRAPER_BASE;

// ─── Webhook-реестр TG-задач ──────────────────────────────────────────────────
// task_id → метаданные задачи, нужные при получении колбэка от скрейпера
export interface PendingTgTask {
  campaignId: string;
  sourceIdMap: Map<string, string>; // tgUsername.lower → Directus record id
  createdAt: number;
}
export const pendingTgTasks = new Map<string, PendingTgTask>();

// Автоочистка устаревших задач (>2ч) чтобы не копить память
setInterval(() => {
  const cutoff = Date.now() - 2 * 3600_000;
  for (const [id, task] of pendingTgTasks) {
    if (task.createdAt < cutoff) pendingTgTasks.delete(id);
  }
}, 600_000).unref();

// Публичный базовый URL сервера (для callback_url)
export function getPublicBaseUrl(): string {
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return (process.env.API_BASE_URL || process.env.PUBLIC_URL || process.env.APP_URL || 'https://smm.omemo.tech').replace(/\/$/, '');
}

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

// ─── Получение API-ключа скрейпера ───────────────────────────────────────────

export async function getScraperApiKey(): Promise<string> {
  // Пробуем ключ из Directus (service: telegram_collect_comments или trends_scraper)
  for (const svc of [ApiServiceName.TELEGRAM_COLLECT_COMMENTS, ApiServiceName.TRENDS_SCRAPER]) {
    try {
      const key = await globalApiKeysService.getGlobalApiKey(svc);
      if (key) return key;
    } catch {
      // игнорируем
    }
  }
  log('[TrendCollector] Используем fallback api-key для скрейпера', 'warn');
  return SCRAPER_API_KEY_FALLBACK;
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

// ─── Запросы к скрейперу (217.26.25.95:3030) ─────────────────────────────────

async function callScraper(endpoint: string, body: any, apiKey: string): Promise<any | null> {
  try {
    const url = `${SCRAPER_BASE}${endpoint}`;
    log(`[TrendCollector] POST ${url} body=${JSON.stringify(body).substring(0, 200)}`, 'info');
    const response = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      timeout: 45000
    });
    log(`[TrendCollector] RESPONSE ${endpoint} status=${response.status} data=${JSON.stringify(response.data).substring(0, 400)}`, 'info');
    return response.data;
  } catch (err: any) {
    console.error(`[TrendCollector] ❌ Ошибка ${endpoint}: status=${err.response?.status} code=${err.code} msg=${err.message}`);
    if (err.response?.data) {
      console.error(`[TrendCollector] Response body: ${JSON.stringify(err.response.data).substring(0, 400)}`);
    }
    return null;
  }
}

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
  apiKey: string
): Promise<TgGroup[] | VkGroup[]> {
  const endpoint = platform === 'telegram' ? '/api/telegram/find-groups' : '/api/vk/find-groups';
  const data = await callScraper(endpoint, {
    keywords,
    min_members: minMembers,
    max_groups: maxGroups
  }, apiKey);

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
    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    const adminToken = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_TOKEN;

    // Строим URL для прямого запроса к Directus
    // Поле username отсутствует в dev Directus — не запрашиваем его
    const params = new URLSearchParams();
    params.set('fields', 'id,url,type,name,TgId,vkId');
    params.set('limit', '-1');

    if (sourcesList && sourcesList.length > 0) {
      // Фильтр по конкретным ID источников
      sourcesList.forEach(id => params.append('filter[id][_in][]', id));
    } else {
      params.set('filter[campaign_id][_eq]', campaignId);
    }

    const fetchUrl = `${directusUrl}/items/campaign_content_sources?${params.toString()}`;
    log(`[TrendCollector] Запрос источников из Directus: ${fetchUrl.substring(0, 200)}...`, 'info');
    log(`[TrendCollector] Используем токен (первые 20 символов): ${(authToken || adminToken || '').substring(0, 20)}... adminToken present: ${!!adminToken}`, 'info');

    // Пробуем сначала user-токен, потом admin-токен
    let sourcesRaw: any[] = [];
    for (const tok of [authToken, adminToken].filter(Boolean)) {
      try {
        const resp = await axios.get(fetchUrl, {
          headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
          timeout: 10000
        });
        sourcesRaw = resp.data?.data || [];
        log(`[TrendCollector] ✅ Получено источников: ${sourcesRaw.length} (токен: ${tok?.substring(0, 15)}...)`, 'info');
        break;
      } catch (axErr: any) {
        const status = axErr.response?.status;
        const body = JSON.stringify(axErr.response?.data);
        log(`[TrendCollector] ❌ Ошибка с токеном ${tok?.substring(0, 15)}... | status=${status} | body=${body}`, 'error');
      }
    }

    for (const s of sourcesRaw) {
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
        const username = extractChannelId(url);
        if (username) result.instagram.push({ id: s.id, username });
      }
    }

    log(`[TrendCollector] Источники из БД: TG=${result.telegram.length}, VK=${result.vk.length}, YT=${result.youtube.length}, IG=${result.instagram.length}`, 'info');
  } catch (err: any) {
    log(`[TrendCollector] Ошибка получения источников из БД: ${err.message}`, 'error');
  }
  return result;
}

// ─── Поллинг задачи скрейпера ─────────────────────────────────────────────────

async function pollScraperTask(
  taskId: string,
  apiKey: string,
  platform: 'telegram' | 'vk',
  maxWaitMs = platform === 'telegram' ? 360000 : 120000
): Promise<any[]> {
  // TG воркер медленнее VK — ждём до 6 минут; опрашиваем каждые 10с
  const pollInterval = platform === 'telegram' ? 10000 : 5000;
  const maxAttempts = Math.ceil(maxWaitMs / pollInterval);
  const statusPath = platform === 'telegram'
    ? `/api/telegram/tasks/status/${taskId}`
    : `/api/vk/tasks/status/${taskId}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, pollInterval));

    try {
      const url = `${SCRAPER_BASE}${statusPath}`;
      const resp = await axios.get(url, {
        headers: { 'api-key': apiKey },
        timeout: 15000
      });
      const d = resp.data;
      log(`[TrendCollector] Poll ${statusPath} attempt=${attempt} status=${d?.status}`, 'info');

      const status = (d?.status || '').toLowerCase();

      if (status === 'done' || status === 'completed' || status === 'finished' || status === 'success') {
        // Результат хранится в d.result (TelegramTaskStatus/VKTaskStatus)
        const result = d?.result;
        log(`[TrendCollector] Task ${taskId} done. result keys=${result ? Object.keys(result).join(',') : 'null'} raw=${JSON.stringify(d).substring(0, 400)}`, 'info');
        if (result) {
          if (Array.isArray(result?.posts)) return result.posts;
          if (Array.isArray(result)) return result;
          if (Array.isArray(result?.results)) return result.results;
          if (Array.isArray(result?.items)) return result.items;
        }
        if (Array.isArray(d?.posts)) return d.posts;
        log(`[TrendCollector] Task ${taskId} done but unknown result format: ${JSON.stringify(d).substring(0, 300)}`, 'warn');
        return [];
      }

      if (status === 'failed' || status === 'error') {
        log(`[TrendCollector] Task ${taskId} error: ${d?.error || JSON.stringify(d).substring(0, 200)}`, 'error');
        return [];
      }

      // status: pending/processing — продолжаем ждать
    } catch (err: any) {
      log(`[TrendCollector] Poll ${statusPath} error: ${err.response?.status} ${err.message}`, 'error');
      // Не прерываем досрочно — транзиентные ошибки сети не должны останавливать поллинг
    }
  }

  log(`[TrendCollector] Task ${taskId} timed out after ${maxWaitMs / 1000}s`, 'warn');
  return [];
}

// ─── Фоновый поллинг TG-задачи (fire-and-forget) ─────────────────────────────
// Запускается через setTimeout().unref() — не блокирует ни вызывающую функцию,
// ни завершение процесса. Результат сохраняется когда задача завершится.
function pollTgTaskInBackground(
  taskId: string,
  apiKey: string,
  campaignId: string,
  sourceIdMap: Map<string, string>
): void {
  const statusPath = `/api/telegram/tasks/status/${taskId}`;
  const pollInterval = 15000; // 15с между попытками
  const maxAttempts = 40;     // 40 × 15с = 10 минут максимум

  async function poll(attempt: number): Promise<void> {
    try {
      const resp = await axios.get(`${SCRAPER_BASE}${statusPath}`, {
        headers: { 'api-key': apiKey },
        timeout: 12000
      });
      const d = resp.data;
      const status = (d?.status || '').toLowerCase();
      log(`[TG BG Poll] task=${taskId} attempt=${attempt}/${maxAttempts} status=${status}`, 'info');

      if (status === 'done' || status === 'completed' || status === 'finished' || status === 'success') {
        const posts: any[] = d?.result?.posts || d?.result?.items || d?.posts || [];
        if (posts.length > 0) {
          const saved = await saveTrendPosts(posts, 'telegram', campaignId, sourceIdMap);
          log(`[TG BG Poll] ✅ task=${taskId} saved=${saved} для кампании ${campaignId}`, 'info');
        } else {
          log(`[TG BG Poll] ℹ️ task=${taskId} завершён, постов нет`, 'info');
        }
        return;
      }

      if (status === 'failed' || status === 'error') {
        log(`[TG BG Poll] ❌ task=${taskId} error: ${d?.error}`, 'error');
        return;
      }

      // pending / processing — продолжаем
      if (attempt < maxAttempts) {
        setTimeout(() => poll(attempt + 1), pollInterval).unref();
      } else {
        log(`[TG BG Poll] ⏱️ task=${taskId} timeout после ${maxAttempts} попыток`, 'warn');
      }
    } catch (err: any) {
      log(`[TG BG Poll] ⚠️ task=${taskId} попытка ${attempt} ошибка: ${err.message}`, 'warn');
      if (attempt < maxAttempts) {
        setTimeout(() => poll(attempt + 1), pollInterval).unref();
      }
    }
  }

  // Первая попытка через 15с
  setTimeout(() => poll(1), pollInterval).unref();
  log(`[TG BG Poll] 🚀 Запущен фоновый поллинг task=${taskId} (макс ${maxAttempts} попыток × ${pollInterval / 1000}с)`, 'info');
}

function extractPostsFromResponse(data: any): any[] | null {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.posts)) return data.posts;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.data)) return data.data;
  return null;
}

// ─── Получение трендовых постов ───────────────────────────────────────────────

async function fetchTrendingPosts(
  platform: 'telegram' | 'vk',
  groupIds: (string | number)[],
  daysBack: number,
  postsPerGroup: number,
  minViews: number,
  apiKey: string
): Promise<any[]> {
  if (groupIds.length === 0) return [];

  let endpoint: string;
  let body: Record<string, any>;

  if (platform === 'telegram') {
    endpoint = '/api/telegram/trending-posts';
    // Docs: предпочтительно передавать @username для публичных каналов
    body = {
      channel_ids: groupIds.map(id => {
        const s = String(id).trim();
        return s.startsWith('@') ? s : `@${s}`;
      }),
      limit: postsPerGroup * groupIds.length,
      fetch_limit: 100,
      merge_results: true,
      days_back: daysBack,
      min_views: minViews,
      async_mode: true
    };
  } else {
    endpoint = '/api/vk/trending-posts';
    body = {
      group_ids: groupIds.map(String),
      limit: postsPerGroup * groupIds.length,
      days_back: daysBack,
      min_views: minViews,
      async_mode: true
    };
  }

  const data = await callScraper(endpoint, body, apiKey);

  if (!data) return [];

  // Синхронный ответ — прямо массив постов
  const directPosts = extractPostsFromResponse(data);
  if (directPosts !== null && directPosts.length > 0) return directPosts;

  // Async паттерн: скрейпер вернул task_id → поллим статус
  const taskId = data?.task_id || data?.job_id || data?.id || data?.taskId;
  if (taskId) {
    const status = (data?.status || '').toLowerCase();
    log(`[TrendCollector] ${endpoint} (${platform}) вернул task_id=${taskId} status=${status} — поллинг`, 'info');
    return pollScraperTask(String(taskId), apiKey, platform);
  }

  log(`[TrendCollector] ${endpoint} (${platform}) неожиданный формат: ${JSON.stringify(data).substring(0, 300)}`, 'warn');
  return [];
}

// ─── Нормализация поста ───────────────────────────────────────────────────────

const PG_INT_MAX = 2147483647;
const clampInt = (v: number): number => Math.min(Math.max(Math.floor(v || 0), 0), PG_INT_MAX);

function normalizeTgPost(raw: any): {
  title: string; description: string; urlPost: string;
  reactions: number; comments: number; views: number; reposts: number;
  trendScore: number; mediaLinks: any; date: string | null; sourceId: string | null;
} {
  const text = raw.text || raw.message || '';
  const views = clampInt(Number(raw.views || raw.views_count || 0));
  const reactions = clampInt(Number(raw.reactions || raw.reactions_count || 0));
  const comments = clampInt(Number(raw.comments || raw.comments_count || 0));
  const reposts = clampInt(Number(raw.forwards || raw.reposts || raw.shares || 0));

  return {
    title: text.substring(0, 100) || 'Telegram пост',
    description: text,
    // Docs: public_url — стабильная публичная ссылка; url — приватная (t.me/c/...), менее предпочтительна
    urlPost: raw.public_url || raw.url || raw.link || '',
    reactions,
    comments,
    views,
    reposts,
    trendScore: clampInt(Number(raw.trend_score || calcEngagementScore(reactions, comments, views, reposts))),
    mediaLinks: raw.media_links || raw.photos || null,
    date: raw.date || null,
    // Docs: channel_username — имя канала (совпадает с tgId в источниках)
    sourceId: raw.channel_username || raw.sourceId || raw.source_id || null
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
    urlPost: raw.url || raw.link || (raw.id && raw.owner_id ? `https://vk.com/wall${raw.owner_id}_${raw.id}` : '') || '',
    reactions: clampInt(Number(raw.likesCount || raw.reactions || raw.likes || 0)),
    comments: clampInt(Number(raw.commentsCount || raw.comments || 0)),
    views: clampInt(Number(raw.viewsCount || raw.views || 0)),
    reposts: clampInt(Number(raw.repostsCount || raw.reposts || raw.shares || 0)),
    trendScore: clampInt(Number(raw.trendScore || raw.trend_score || 0)),
    mediaLinks: raw.media_links || null,
    date: raw.timestamp || raw.date || null,
    // Docs: group_id — ID группы в формате "-174948538", совпадает с vkId в источниках
    sourceId: raw.group_id || raw.source_id || raw.sourceId || null,
    postType: raw.type || 'post',
    accountUrl: raw.group_id
      ? `https://vk.com/club${String(raw.group_id).replace('-', '')}`
      : (raw.owner_id ? `https://vk.com/club${String(raw.owner_id).replace('-', '')}` : '')
  };
}

// ─── Сохранение постов ────────────────────────────────────────────────────────

export async function saveTrendPosts(
  posts: any[],
  platform: 'telegram' | 'vk' | 'youtube' | 'instagram',
  campaignId: string,
  sourceIdMap?: Map<string, string>
): Promise<number> {
  // Pre-dedup: collect urlPost values and query existing records to avoid RECORD_NOT_UNIQUE 400s
  // TG: prefer public_url (stable); VK: url already contains the post URL from API
  const candidateUrls = posts
    .map(raw => raw.public_url || raw.url || raw.link || (raw.id && raw.owner_id ? `https://vk.com/wall${raw.owner_id}_${raw.id}` : null))
    .filter((u): u is string => !!u);

  const existingUrls = new Set<string>();
  if (candidateUrls.length > 0) {
    try {
      const existing = await directusCrud.list<{ urlPost: string }>('campaign_trend_topics', {
        useAdminToken: true,
        filter: { urlPost: { _in: candidateUrls } },
        fields: ['urlPost'],
        limit: candidateUrls.length
      });
      for (const r of existing) {
        if (r.urlPost) existingUrls.add(r.urlPost);
      }
    } catch { /* not critical — proceed with insert attempts */ }
  }

  let saved = 0;
  for (const raw of posts) {
    // Совпадает с логикой candidateUrls выше: TG — public_url, VK — url
    const rawUrl = raw.public_url || raw.url || raw.link || null;
    if (rawUrl && existingUrls.has(rawUrl)) continue;

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
          campaign_id: campaignId,
          source_id: dbSourceId,
          is_bookmarked: false,
          raw_source_data: raw
        };
      } else {
        // YouTube / Instagram — нормализация как раньше
        const text = raw.text || raw.message || raw.description || raw.title || raw.caption || '';
        const views = clampInt(Number(raw.views || raw.views_count || raw.view_count || 0));
        const reactions = clampInt(Number(raw.reactions || raw.reactions_count || raw.likes || raw.likes_count || 0));
        const comments = clampInt(Number(raw.comments || raw.comments_count || 0));
        const reposts = clampInt(Number(raw.reposts || raw.shares || 0));
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
            ? clampInt(Number(raw.trend_score))
            : raw.engagement_rate
              ? clampInt(Math.round(Number(raw.engagement_rate) * 1000))
              : clampInt(calcEngagementScore(reactions, comments, views, reposts)),
          campaign_id: campaignId,
          is_bookmarked: false,
          raw_source_data: raw
        };
      }

      await directusCrud.create('campaign_trend_topics', topicData, { useAdminToken: true });
      saved++;
    } catch (err: any) {
      const isdup = err?.response?.data?.errors?.[0]?.extensions?.code === 'RECORD_NOT_UNIQUE';
      if (!isdup) {
        log(`[TrendCollector] Ошибка сохранения поста (${platform}): ${err.message}`, 'error');
      }
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

  const apiKey = await getScraperApiKey();
  const oldScraperKey = apiKey; // используем тот же ключ для YT/IG (тот же сервер)

  const results = { telegram: 0, vk: 0, youtube: 0, instagram: 0, total: 0, sourcesFound: { telegram: 0, vk: 0 } };
  const tasks: Promise<void>[] = [];

  // ── Telegram ──────────────────────────────────────────────────────────────
  if (platforms.includes('telegram')) {
    tasks.push((async () => {
      let tgIds: string[] = [];
      const sourceIdMap = new Map<string, string>(); // tgId.lower → DB record id

      if (collectSources && keywords.length > 0) {
        log(`[TrendCollector][TG] Поиск каналов по ${keywords.length} ключевым словам`, 'info');
        const groups = await findGroups('telegram', keywords, minFollowers.telegram || 2000, maxSourcesPerPlatform, apiKey) as TgGroup[];
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

      // ВАЖНО: callback_url нельзя передавать — скрейпер при его наличии
      // возвращает posts:[] немедленно вместо реального сбора. Используем
      // фоновый поллинг (pollTgTaskInBackground) — он не блокирует вызывающий код.
      const postsPerGroup = Math.max(Math.ceil(limit / tgIds.length), 3);

      const channelIds = tgIds.map(id => {
        const s = String(id).trim();
        return s.startsWith('@') ? s : `@${s}`;
      });

      const body = {
        channel_ids: channelIds,
        limit: postsPerGroup * tgIds.length,
        fetch_limit: 100,
        merge_results: true,
        days_back: daysBack,
        min_views: 100,
        async_mode: true,
        max_concurrent: parseInt(process.env.SCRAPER_MAX_CONCURRENT || '3', 10)
        // callback_url — НЕ передавать! Ломает TG-запрос (возвращает posts:[] мгновенно)
      };

      log(`[TrendCollector][TG] POST /api/telegram/trending-posts | channels=${channelIds.slice(0, 5).join(',')} | count=${channelIds.length}`, 'info');
      const data = await callScraper('/api/telegram/trending-posts', body, apiKey);

      if (!data) {
        log(`[TrendCollector][TG] Скрейпер вернул пустой ответ`, 'warn');
        return;
      }

      // Редкий случай: скрейпер ответил синхронно
      const directPosts = extractPostsFromResponse(data);
      if (directPosts && directPosts.length > 0) {
        log(`[TrendCollector][TG] Синхронный ответ: ${directPosts.length} постов — сохраняем сразу`, 'info');
        results.telegram = await saveTrendPosts(directPosts, 'telegram', campaignId, sourceIdMap);
        log(`[TrendCollector][TG] ✅ Сохранено: ${results.telegram}`, 'info');
        return;
      }

      // Async: скрейпер принял задачу → запускаем фоновый поллинг (не блокируем)
      const taskId = data?.task_id || data?.job_id || data?.id || data?.taskId;
      if (taskId) {
        pollTgTaskInBackground(String(taskId), apiKey, campaignId, sourceIdMap);
        log(`[TrendCollector][TG] 🔄 Фоновый поллинг запущен task=${taskId}, возвращаемся немедленно`, 'info');
      } else {
        log(`[TrendCollector][TG] ⚠️ Не удалось получить task_id: ${JSON.stringify(data).substring(0, 200)}`, 'warn');
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
        const groups = await findGroups('vk', keywords, minFollowers.vk || 3000, maxSourcesPerPlatform, apiKey) as VkGroup[];
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
      const posts = await fetchTrendingPosts('vk', vkIds, daysBack, postsPerGroup, 300, apiKey);
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

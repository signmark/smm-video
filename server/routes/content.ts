import { Express, Request, Response } from 'express';
import { authenticateUser } from '../middleware/user-auth';
import { directusApi } from '../directus';
import { socialPublishingService } from '../services/social-publishing';
import { getPublishScheduler } from '../services/publish-scheduler';
import { cleanupText } from '../utils/text';
import { directusCrud } from '../services/directus-crud';
import { storage } from '../storage';
import { log } from '../utils/logger';
import { aiService } from '../services/ai-service';
import { toSafeErrorDetails } from '../utils/safe-error';
import axios from 'axios';

import { buildCacheKey, getFromCache, setToCache, invalidateContentCache } from '../utils/content-cache';
export { invalidateContentCache };

// Creation timestamps are owned by Directus. SMM panel requests must never
// provide or overwrite them, including through generic POST/PATCH/PUT routes.
const IMMUTABLE_CONTENT_FIELDS = new Set([
  'createdAt',
  'created_at',
  'date_created',
]);

/**
 * Гарантирует, что в ответе клиенту строка содержит явный TZ-маркер (Z или ±HH:MM).
 * Directus иногда отдаёт naive-UTC (например, '2026-07-26T10:00:00' без 'Z');
 * в браузере такая строка читается как локальное время и даёт сдвиг в карточке
 * «Недавний контент» (SM-14). Пустое/null остаются как есть.
 */
function ensureIsoWithTimezone(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  if (value === '') return value;
  if (value.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(value)) return value;
  return value + 'Z';
}

/**
 * Проверяет владение записью campaign_content перед мутацией.
 *
 * Находка ревью 2026-07-28: PATCH/PUT/DELETE правили запись по чужому `id`, хотя
 * у соседнего GET проверка владения есть — значит права Directus эту коллекцию
 * не закрывают, и полагаться на них нельзя.
 *
 * При отказе САМ пишет ответ (404 — не подтверждаем существование чужой записи)
 * и возвращает false.
 */
async function assertOwnsContentItem(id: string, req: Request, res: Response): Promise<boolean> {
  const user = (req as any).user;
  const token = user?.token;
  const userId = user?.id;
  if (!userId || !token) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  const notFound = () => {
    res.status(404).json({ error: "Content item not found" });
    return false;
  };

  let item: any;
  try {
    const response = await directusApi.get(`/items/campaign_content/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { fields: 'id,user_id' },
    });
    item = response.data?.data;
  } catch (error: any) {
    const status = error.response?.status;
    if (status === 404 || status === 403) return notFound();
    if (status === 401) {
      res.status(401).json({ error: "Сессия истекла. Пожалуйста, войдите заново.", sessionExpired: true });
      return false;
    }
    // Сбой Directus — fail-closed: доступ не выдаём, но и не врём про «не найдено».
    res.status(503).json({ error: "Проверка доступа временно недоступна" });
    return false;
  }

  if (!item) return notFound();

  const isAdmin = user?.is_smm_admin === true;
  if (!isAdmin && item.user_id && item.user_id !== userId) return notFound();

  return true;
}

/**
 * Маппинг camelCase полей от фронтенда в snake_case для Directus campaign_content
 */
function mapContentFieldsToDirectus(body: Record<string, any>): Record<string, any> {
  const fieldMap: Record<string, string> = {
    campaignId: 'campaign_id',
    contentType: 'content_type',
    scheduledAt: 'scheduled_at',
    imageUrl: 'image_url',
    videoUrl: 'video_url',
    userId: 'user_id',
    socialPlatforms: 'social_platforms',
    additionalImages: 'additional_images',
  };

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || IMMUTABLE_CONTENT_FIELDS.has(key)) continue;
    const mappedKey = fieldMap[key] || key;
    result[mappedKey] = value;
  }
  return result;
}

/**
 * Обработка полей, которые могут быть как массивом, так и JSON строкой
 */
function parseArrayField(value: any, itemId?: string): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
      if (value.includes(',')) {
        return value.split(',').map(s => s.trim()).filter(Boolean);
      }
      return [value];
    }
  }
  
  return [value];
}

// Окно графика активности на дашборде — 7 дней, но «сегодня»/«на этой неделе»
// считаются на клиенте по тем же строкам, поэтому окно берём с запасом.
const STATS_WINDOW_DEFAULT_DAYS = 31;
const STATS_WINDOW_MAX_DAYS = 92;
const STATS_WINDOW_ROW_LIMIT = 1000;
// Карточка «Недавний контент» на дашборде показывает три последние записи.
const STATS_LATEST_LIMIT = 5;

// «Опубликовано» на дашборде исторически включает частичную публикацию.
const PUBLISHED_LIKE_STATUSES = ['published', 'partial', 'partially_published'];

/**
 * Количество записей по статусам. Основной путь — агрегат на стороне Directus:
 * наружу едет по строке на статус независимо от размера таблицы.
 *
 * Запасной путь — выборка двух колонок (id, status). Он существует потому, что
 * `aggregate`+`groupBy` зависят от прав роли в Directus: если агрегат когда-нибудь
 * отвалится, счётчики на дашборде и красный кружок в сайдбаре не должны исчезать.
 * Это всё равно на порядок дешевле прежнего `?summary=1` (два поля вместо семи и
 * без мета-обвязки), но это аварийный режим, а не штатный.
 */
async function fetchStatusCounts(
  baseFilter: Record<string, any>,
  headers: Record<string, string>,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  try {
    const response = await directusApi.get('/items/campaign_content', {
      headers,
      params: {
        filter: JSON.stringify(baseFilter),
        aggregate: JSON.stringify({ count: ['id'] }),
        groupBy: ['status'],
        limit: -1,
      },
    });
    const rows = Array.isArray(response.data?.data) ? response.data.data : [];
    for (const row of rows) {
      const status = row?.status ?? 'unknown';
      // Directus отдаёт count строкой; в зависимости от версии — вложенным в id.
      const raw = row?.count?.id ?? row?.count ?? 0;
      const value = Number(raw);
      counts[status] = (counts[status] || 0) + (Number.isFinite(value) ? value : 0);
    }
    return counts;
  } catch (aggregateError: any) {
    if (aggregateError.response?.status === 404) throw aggregateError;
    log(`[content-stats] aggregate недоступен (${aggregateError.message}), считаем по id+status`, 'content');
  }

  const fallback = await directusApi.get('/items/campaign_content', {
    headers,
    params: {
      filter: JSON.stringify(baseFilter),
      fields: ['id', 'status'],
      limit: -1,
    },
  });
  const rows = Array.isArray(fallback.data?.data) ? fallback.data.data : [];
  for (const row of rows) {
    const status = row?.status ?? 'unknown';
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

/**
 * Directus-строка → форма, в которой контент отдаётся наружу.
 *
 * ОДНА функция на список и на `/:id`. Раньше маппинг жил только внутри
 * обработчика списка, а `/:id` отдавал сырую строку Directus: `published_at`
 * вместо `publishedAt`, `campaign_id` вместо `campaignId`, а `keywords`/
 * `hashtags`/`links` — строкой вместо разобранного массива. Любой потребитель,
 * переключившийся со списка на `/:id` (например, диалог редактирования, если он
 * начнёт дотягивать полное тело поста), получил бы поля не под теми именами.
 * Держим один источник правды, чтобы формы не разъехались снова.
 */
export function mapContentItemFromDirectus(item: any) {
  const additionalImages = Array.isArray(item.additional_images) ? item.additional_images : [];
  const isVideoType = item.content_type === 'video' || item.content_type === 'video-text';

  return {
    id: item.id,
    campaignId: item.campaign_id,
    userId: item.user_id,
    title: item.title,
    content: item.content,
    contentType: item.content_type,
    imageUrl: item.image_url,
    additionalImages,
    additionalMedia: item.additional_media || [],
    videoThumbnail: additionalImages.length > 0 && isVideoType ? additionalImages[0] : '',
    videoUrl: item.video_url,
    prompt: item.prompt,
    keywords: parseArrayField(item.keywords, item.id),
    hashtags: parseArrayField(item.hashtags, item.id),
    links: parseArrayField(item.links, item.id),
    createdAt: item.created_at,
    scheduledAt: item.scheduled_at,
    publishedAt: item.published_at,
    status: item.status,
    socialPlatforms: item.social_platforms || {},
    metadata: item.metadata || {},
  };
}

const TITLE_MAX_LENGTH = 255;

/**
 * `title` приходит из внешнего мира и до этой проверки уходил прямо в
 * `data.title.charAt(0)`. На `{"title": 999}` или `{"title": [1,2]}` это давало
 * `charAt is not a function` и HTTP 500 на POST/PATCH/PUT — то есть ошибка
 * валидации выглядела как падение сервера. Возвращаем 400 с внятным текстом.
 */
function validateTitle(raw: unknown): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'Поле title должно быть строкой' };
  }
  const trimmed = raw.trim();
  if (trimmed.length > TITLE_MAX_LENGTH) {
    return { ok: false, message: `Поле title не может быть длиннее ${TITLE_MAX_LENGTH} символов` };
  }
  // Первая буква заголовка — заглавная.
  return { ok: true, value: trimmed.charAt(0).toUpperCase() + trimmed.slice(1) };
}

export function registerContentRoutes(app: Express) {
  // GET /api/campaign-content
  app.get("/api/campaign-content", authenticateUser, async (req, res) => {
    try {
      const campaignId = (req.query.campaignId as string) || '';
      const page = parseInt(req.query.page as string) || 1;
      const parsedLimit = parseInt(req.query.limit as string);
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : -1;
      const offset = limit === -1 ? 0 : (page - 1) * limit;
      const noCache = req.query.nocache === '1';
      // Режим сводки: только поля, нужные для счётчиков и графиков.
      // Полная выдача по этой коллекции — около 5 МБ JSON на пользователя, потому
      // что тянет тексты, картинки и social_platforms. Дашборду из этого нужны
      // ровно три скалярных поля. Не generic ?fields=: он ломает маппинг ниже и
      // открывает выбор произвольных колонок, а нужен один фиксированный набор.
      const summary = req.query.summary === '1';

      const userId = req.user?.id;
      const token = req.user?.token;

      if (!userId || !token) return res.status(401).json({ error: "Unauthorized" });

      // ── Кеш ──────────────────────────────────────────────────
      const key = buildCacheKey(userId, campaignId, page, limit, summary ? 'summary' : 'full');
      if (!noCache) {
        const cached = getFromCache(key);
        if (cached) {
          res.setHeader('X-Cache', 'HIT');
          return res.json(cached);
        }
      }
      res.setHeader('X-Cache', 'MISS');
      // ─────────────────────────────────────────────────────────

      const params: any = {
        filter: JSON.stringify({
          user_id: { _eq: userId },
          ...(campaignId ? { campaign_id: { _eq: campaignId } } : {})
        }),
        sort: ['-created_at', '-id'],
        meta: 'total_count,filter_count',
        limit: limit,
        offset: offset,
        ...(summary ? { fields: ['id', 'title', 'status', 'scheduled_at', 'published_at', 'created_at', 'campaign_id'] } : {})
      };

      try {
        log(`[content-cache] MISS → Directus userId=${userId} campaign=${campaignId}`, 'content');
        const response = await directusApi.get('/items/campaign_content', {
          params,
          headers: { Authorization: `Bearer ${token}` }
        });
        
        const responseData = response.data.data || [];
        const meta = response.data.meta || {};
        
        console.log(`✅ [API] GET /api/campaign-content success: ${responseData.length} items found`);
        
        // БЕЗОПАСНЫЙ МАППИНГ: Проверяем существование responseData перед map
        if (!Array.isArray(responseData)) {
          console.error('❌ [API] responseData is not an array:', responseData);
          return res.json({ data: [], meta: { total: 0, page, limit, totalPages: 0 } });
        }

        console.log(`[API] Mapping ${responseData.length} items...`);
        const contentItems = summary
          ? responseData.map((item: any) => ({
              id: item.id,
              campaignId: item.campaign_id,
              title: item.title,
              status: item.status,
              createdAt: item.created_at,
              scheduledAt: item.scheduled_at,
              publishedAt: item.published_at,
            }))
          : responseData.map((item: any) => {
          try {
            // Общий маппер со списком и /:id — см. mapContentItemFromDirectus.
            return mapContentItemFromDirectus(item);
          } catch (mapError: any) {
            console.error(`❌ [API] Error mapping item ${item.id}:`, mapError.message);
            return null;
          }
        }).filter(Boolean);
        
        const responseBody = {
          data: contentItems,
          meta: {
            // Только filter_count: total_count считает всю коллекцию целиком,
            // игнорируя фильтр по кампании и пользователю (на проде 1781 против
            // 487 реальных). Если filter_count не пришёл — падаем на длину выборки,
            // но НИКОГДА на total_count, иначе UI покажет 1781 и «Загрузить все»
            // запросит столько же чужих строк.
            total: meta.filter_count ?? contentItems.length,
            page,
            limit,
            // totalPages — по тому же числу, что и total.
            totalPages: limit > 0 ? Math.ceil((meta.filter_count ?? contentItems.length) / limit) : 1
          }
        };

        // Сохраняем в кеш
        setToCache(key, responseBody);
        log(`[content-cache] SET items=${contentItems.length} ttl=60s`, 'content');

        res.json(responseBody);
      } catch (directusError: any) {
        if (directusError.response?.status === 404) {
          console.warn(`⚠️ [API] Collection campaign_content not found in Directus. Returning empty array.`);
          return res.json({ data: [], meta: { total: 0, page, limit, totalPages: 0 } });
        }
        throw directusError;
      }
    } catch (error: any) {
      console.error('❌ Error in GET /api/campaign-content:', error.message);
      res.status(500).json({ error: "Failed to fetch content" });
    }
  });

  // GET /api/campaign-content/stats
  //
  // Счётчики и график активности дашборда/сайдбара. Раньше и то и другое
  // считалось на клиенте из `?summary=1` без campaignId и без limit — то есть из
  // ВСЕЙ таблицы пользователя (на проде 1422 объекта, 354 КБ на каждое открытие
  // дашборда и на каждую страницу с сайдбаром). Объём рос линейно с числом постов,
  // хотя на экран попадают три числа и гистограмма по дням.
  //
  // Здесь наружу едут агрегаты: количества по статусам считает Directus
  // (`aggregate[count]` + `groupBy=status`, наружу — по строке на статус), а
  // сырыми отдаются только даты за окно графика и только два datetime-поля.
  // ВАЖНО: маршрут обязан регистрироваться до `/api/campaign-content/:id`,
  // иначе "stats" уедет в него как id.
  app.get("/api/campaign-content/stats", authenticateUser, async (req, res) => {
    try {
      const userId = req.user?.id;
      const token = req.user?.token;
      if (!userId || !token) return res.status(401).json({ error: "Unauthorized" });

      const campaignId = (req.query.campaignId as string) || '';
      const parsedDays = parseInt(req.query.days as string, 10);
      const days = Number.isFinite(parsedDays) && parsedDays > 0
        ? Math.min(parsedDays, STATS_WINDOW_MAX_DAYS)
        : STATS_WINDOW_DEFAULT_DAYS;

      const key = buildCacheKey(userId, campaignId, 1, days, 'stats');
      if (req.query.nocache !== '1') {
        const cached = getFromCache(key);
        if (cached) {
          res.setHeader('X-Cache', 'HIT');
          return res.json(cached);
        }
      }
      res.setHeader('X-Cache', 'MISS');

      const baseFilter: Record<string, any> = {
        user_id: { _eq: userId },
        ...(campaignId ? { campaign_id: { _eq: campaignId } } : {}),
      };
      const authHeaders = { Authorization: `Bearer ${token}` };

      // Начало окна — полночь UTC дня (days-1) назад, чтобы сегодняшний день
      // попадал в выборку целиком.
      const windowStart = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
      windowStart.setUTCHours(0, 0, 0, 0);
      const windowStartIso = windowStart.toISOString();

      const [byStatus, windowRows, latestRows] = await Promise.all([
        fetchStatusCounts(baseFilter, authHeaders),
        // Окно графика: и опубликованные за период, и запланированные (в т.ч.
        // на будущее — они тоже рисуются на гистограмме).
        directusApi.get('/items/campaign_content', {
          headers: authHeaders,
          params: {
            filter: JSON.stringify({
              ...baseFilter,
              _or: [
                { published_at: { _gte: windowStartIso } },
                { _and: [{ status: { _eq: 'scheduled' } }, { scheduled_at: { _gte: windowStartIso } }] },
              ],
            }),
            fields: ['id', 'status', 'published_at', 'scheduled_at'],
            sort: ['-created_at'],
            limit: STATS_WINDOW_ROW_LIMIT,
          },
        }).then(r => (Array.isArray(r.data?.data) ? r.data.data : [])),
        // Карточка «Недавний контент»: заголовок и дата у последних записей.
        // Окно графика её не закрывает — оно отфильтровано по датам публикации.
        directusApi.get('/items/campaign_content', {
          headers: authHeaders,
          params: {
            filter: JSON.stringify(baseFilter),
            fields: ['id', 'title', 'status', 'created_at'],
            sort: ['-created_at', '-id'],
            limit: STATS_LATEST_LIMIT,
          },
        }).then(r => (Array.isArray(r.data?.data) ? r.data.data : [])),
      ]);

      const sumStatuses = (statuses: string[]) =>
        statuses.reduce((acc, s) => acc + (byStatus[s] || 0), 0);

      const responseBody = {
        success: true,
        data: {
          total: Object.values(byStatus).reduce((acc, n) => acc + n, 0),
          byStatus,
          // Клиент исторически считает «опубликовано» вместе с частичной
          // публикацией — сохраняем ту же арифметику, чтобы плитки не изменились.
          published: sumStatuses(PUBLISHED_LIKE_STATUSES),
          scheduled: byStatus.scheduled || 0,
          failed: byStatus.failed || 0,
          draft: byStatus.draft || 0,
          windowDays: days,
          windowStart: windowStartIso,
          latest: latestRows.map((item: any) => ({
            id: item.id,
            title: item.title,
            status: item.status,
            createdAt: ensureIsoWithTimezone(item.created_at),
          })),
          recent: windowRows.map((item: any) => ({
            id: item.id,
            status: item.status,
            publishedAt: ensureIsoWithTimezone(item.published_at),
            scheduledAt: ensureIsoWithTimezone(item.scheduled_at),
          })),
        },
      };

      setToCache(key, responseBody);
      log(`[content-stats] SET total=${responseBody.data.total} window=${days}d rows=${responseBody.data.recent.length}`, 'content');
      res.json(responseBody);
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.warn('⚠️ [API] Collection campaign_content not found in Directus. Returning empty stats.');
        return res.json({
          success: true,
          data: {
            total: 0, byStatus: {}, published: 0, scheduled: 0, failed: 0, draft: 0,
            windowDays: STATS_WINDOW_DEFAULT_DAYS, windowStart: new Date().toISOString(),
            latest: [], recent: [],
          },
        });
      }
      console.error('❌ Error in GET /api/campaign-content/stats:', error.message);
      res.status(500).json({ error: "Failed to fetch content stats" });
    }
  });

  // POST /api/campaign-content
  app.post("/api/campaign-content", authenticateUser, async (req, res) => {
    console.log('🚀 [API] POST /api/campaign-content REQUEST RECEIVED');
    console.log('📦 [API] Request Body:', JSON.stringify(req.body, null, 2));
    try {
      const token = req.user?.token;
      const userId = req.user?.id;
      
      if (!userId || !token) {
        console.error('❌ [API] AUTH ERROR: No userId or token in request object despite middleware');
        return res.status(401).json({ error: "Unauthorized - Missing user data" });
      }

      console.log(`👤 [API] User ID: ${userId}`);
      const data = mapContentFieldsToDirectus(req.body);
      data.user_id = userId;
      if (!data.title) data.title = 'Без названия';
      const titleCheck = validateTitle(data.title);
      if (!titleCheck.ok) {
        return res.status(400).json({ error: "Invalid title", details: titleCheck.message });
      }
      data.title = titleCheck.value;
      if (!data.content && req.body.text) data.content = req.body.text;
      if (!data.content_type) data.content_type = 'text';
      if (!data.status) data.status = 'draft';
      
      console.log('📡 [API] Calling Directus POST /items/campaign_content...');
      console.log('📦 [API] Payload for Directus:', JSON.stringify(data, null, 2));
      const response = await directusApi.post('/items/campaign_content', data, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      console.log('✅ [API] Directus POST Success! Status:', response.status);
      console.log('🆔 [API] Created Item ID:', response.data.data.id);
      // Сбрасываем кеш для этой кампании
      invalidateContentCache(userId, data.campaign_id);
      res.status(201).json({ success: true, data: response.data.data });
    } catch (error: any) {
      console.error('❌ [API] POST /api/campaign-content CRITICAL ERROR');
      console.error('❌ [API] Message:', error.message);
      if (error.response) {
        console.error('❌ [API] Directus Response Status:', error.response.status);
        console.error('❌ [API] Directus Response Data:', JSON.stringify(error.response.data, null, 2));
      }
      // details — только сообщение валидации от Directus, оно осмысленно для UI.
      // error.message наружу больше не уходит: это сырой текст JS-исключения
      // (именно так «data.title.charAt is not a function» уезжало клиенту).
      const directusMessage = error.response?.data?.errors?.[0]?.message;
      res.status(error.response?.status || 500).json({
        error: "Failed to create content",
        ...(directusMessage ? { details: directusMessage } : {}),
      });
    }
  });

  // GET /api/campaign-content/:id
  app.get("/api/campaign-content/:id", authenticateUser, async (req, res) => {
    try {
      const { id } = req.params;
      const token = req.user?.token;
      const userId = req.user?.id;
      if (!userId || !token) return res.status(401).json({ error: "Unauthorized" });

      const response = await directusApi.get(`/items/campaign_content/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const item = response.data?.data;
      if (!item) return res.status(404).json({ error: "Content item not found" });

      // Проверка владения — как во всех остальных чтениях этой коллекции
      // (список фильтрует по user_id явно). 404, а не 403: чужой id не должен
      // отличаться по ответу от несуществующего.
      const isAdmin = req.user?.is_smm_admin === true;
      if (!isAdmin && item.user_id && item.user_id !== userId) {
        return res.status(404).json({ error: "Content item not found" });
      }

      // Та же форма, что и у списка — иначе потребитель, перешедший со списка
      // на /:id, получит published_at вместо publishedAt и строки вместо массивов.
      res.json({ data: mapContentItemFromDirectus(item) });
    } catch (error: any) {
      const status = error.response?.status;
      // 403 от Directus = записи нет или к ней нет доступа. Раньше общий catch
      // превращал и 404, и 403 в 500 — мониторинг шумел, настоящие сбои терялись.
      if (status === 404 || status === 403) {
        return res.status(404).json({ error: "Content item not found" });
      }
      if (status === 401) {
        return res.status(401).json({ error: "Сессия истекла. Пожалуйста, войдите заново.", sessionExpired: true });
      }
      console.error(`❌ [API] GET /api/campaign-content/${req.params.id} error:`, toSafeErrorDetails(error));
      res.status(500).json({ error: "Failed to fetch content item" });
    }
  });

  // PATCH /api/campaign-content/:id
  app.patch("/api/campaign-content/:id", authenticateUser, async (req, res) => {
    try {
      const { id } = req.params;
      const token = req.user?.token;
      const userId = req.user?.id || '';
      const data = mapContentFieldsToDirectus(req.body);
      // Форма запроса проверяется до похода в Directus: 400 за нестроковый title
      // не зависит от того, чья это запись, и ничего о ней не раскрывает.
      if (data.title !== undefined && data.title !== null) {
        const titleCheck = validateTitle(data.title);
        if (!titleCheck.ok) {
          return res.status(400).json({ error: "Invalid title", details: titleCheck.message });
        }
        data.title = titleCheck.value;
      }
      if (!(await assertOwnsContentItem(id, req, res))) return;
      const response = await directusApi.patch(`/items/campaign_content/${id}`, data, {
        headers: { Authorization: `Bearer ${token}` }
      });
      // Сбрасываем кеш (знаем campaignId из тела или сбрасываем весь кеш пользователя)
      invalidateContentCache(userId, data.campaign_id);
      res.json({ data: response.data.data });
    } catch (error) {
      res.status(500).json({ error: "Failed to update content" });
    }
  });

  // PUT /api/campaign-content/:id
  app.put("/api/campaign-content/:id", authenticateUser, async (req, res) => {
    try {
      const { id } = req.params;
      const token = req.user?.token;
      const userId = req.user?.id || '';
      const data = mapContentFieldsToDirectus(req.body);
      // Форма запроса проверяется до похода в Directus: 400 за нестроковый title
      // не зависит от того, чья это запись, и ничего о ней не раскрывает.
      if (data.title !== undefined && data.title !== null) {
        const titleCheck = validateTitle(data.title);
        if (!titleCheck.ok) {
          return res.status(400).json({ error: "Invalid title", details: titleCheck.message });
        }
        data.title = titleCheck.value;
      }
      if (!(await assertOwnsContentItem(id, req, res))) return;
      const response = await directusApi.patch(`/items/campaign_content/${id}`, data, {
        headers: { Authorization: `Bearer ${token}` }
      });
      invalidateContentCache(userId, data.campaign_id);
      res.json({ data: response.data.data });
    } catch (error) {
      res.status(500).json({ error: "Failed to update content (PUT)" });
    }
  });

  // DELETE /api/campaign-content/:id
  app.delete("/api/campaign-content/:id", authenticateUser, async (req, res) => {
    try {
      const { id } = req.params;
      const token = req.user?.token;
      const userId = req.user?.id || '';
      if (!(await assertOwnsContentItem(id, req, res))) return;
      await directusApi.delete(`/items/campaign_content/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      // Сбрасываем весь кеш пользователя (не знаем campaignId удалённой записи)
      invalidateContentCache(userId);
      res.status(204).end();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete content" });
    }
  });

  // POST /api/campaign-content/remove-duplicates
  app.post("/api/campaign-content/remove-duplicates", authenticateUser, async (req, res) => {
    try {
      const { campaignId } = req.body;
      const token = req.user?.token;
      const userId = req.user?.id;
      
      const response = await directusApi.get('/items/campaign_content', {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          filter: JSON.stringify({ campaign_id: { _eq: campaignId }, user_id: { _eq: userId } }),
          limit: -1
        }
      });
      
      const allPosts = response.data.data || [];
      const postsMap = new Map<string, any[]>();
      
      allPosts.forEach((post: any) => {
        const key = `${(post.title || '').trim()}|||${(post.content || '').trim()}`;
        if (!postsMap.has(key)) postsMap.set(key, []);
        postsMap.get(key)!.push(post);
      });
      
      const duplicateGroups = Array.from(postsMap.values()).filter(group => group.length > 1);
      const deletedIds = [];
      
      for (const group of duplicateGroups) {
        group.sort((a, b) => new Date(a.date_created || 0).getTime() - new Date(b.date_created || 0).getTime());
        const [keep, ...toDelete] = group;
        for (const post of toDelete) {
          await directusApi.delete(`/items/campaign_content/${post.id}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          deletedIds.push(post.id);
        }
      }
      
      res.json({ success: true, deletedCount: deletedIds.length });
    } catch (error) {
      res.status(500).json({ error: "Failed to remove duplicates" });
    }
  });

  // POST /api/content/hashtags
  app.post("/api/content/hashtags", authenticateUser, async (req, res) => {
    try {
      const { topic, count = 10, language = 'russian' } = req.body;
      console.log(`[HASHTAGS] Request received: topic="${topic}", count=${count}, lang=${language}`);
      
      if (!topic) return res.status(400).json({ error: "Тема не указана" });

      const prompt = `Сгенерируй ${count} популярных и релевантных хештегов для контента на тему: "${topic}". 
      Язык: ${language}. 
      Верни ТОЛЬКО хештеги через пробел, без лишнего текста.`;

      console.log(`[HASHTAGS] Calling aiService.generateContent...`);
      const response = await aiService.generateContent({
        prompt,
        model: 'gemini-3-flash-preview',
        service: 'gemini',
        userId: req.user?.id,
        token: req.user?.token
      });

      if (!response || !response.content) {
        console.error('[HASHTAGS] Empty response from aiService');
        throw new Error('AI service returned empty response');
      }

      console.log(`[HASHTAGS] AI Response: ${response.content.substring(0, 100)}...`);

      const hashtags = response.content.trim().split(/\s+/).filter((h: string) => h.startsWith('#'));
      
      const result = hashtags.length > 0 
        ? hashtags 
        : response.content.trim().split(/\s+/).map((h: string) => h.startsWith('#') ? h : `#${h}`);

      console.log(`[HASHTAGS] Generated ${result.length} hashtags`);
      
      return res.json({ 
        success: true, 
        hashtags: result
      });
    } catch (error: any) {
      console.error('❌ Error in POST /api/content/hashtags:', error);
      res.status(500).json({ 
        error: "Failed to generate hashtags", 
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  // POST /api/content/:id/editor-pass — AI редактура одного поста
  app.post("/api/content/:id/editor-pass", authenticateUser, async (req, res) => {
    try {
      const { id } = req.params;
      const token = req.user?.token;
      const userId = req.user?.id;
      if (!userId || !token) return res.status(401).json({ error: "Не авторизован" });

      const contentResponse = await directusApi.get(`/items/campaign_content/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const contentItem = contentResponse.data.data;
      if (!contentItem) return res.status(404).json({ error: "Content not found" });

      const originalText = contentItem.content || '';
      if (!originalText.trim()) return res.json({ success: true, changed: false });

      // Загружаем autonomous_settings кампании для персонализированной редактуры
      let autoSettings: { globalPrompt?: string; alwaysInclude?: string; signature?: string; humanize?: boolean; adaptForPlatforms?: boolean } = {};
      let connectedPlatforms: string[] = [];
      try {
        const campaignId = contentItem.campaign_id;
        if (campaignId) {
          const campaign = await directusCrud.getById('user_campaigns', campaignId, { authToken: token });
          if (campaign?.autonomous_settings) {
            const raw = campaign.autonomous_settings;
            autoSettings = typeof raw === 'string' ? JSON.parse(raw) : raw;
          }
          // SM-18 follow-up: подтягиваем подключённые соцсети для [socialNetworks].
          const s = campaign?.social_media_settings;
          if (s && typeof s === 'object') {
            const KNOWN = ['telegram', 'vk', 'instagram', 'facebook', 'youtube', 'tiktok', 'threads'];
            connectedPlatforms = KNOWN.filter((p) => {
              const cfg = s[p];
              if (!cfg || typeof cfg !== 'object') return false;
              const enabled = cfg.enabled === true;
              const hasToken = !!(cfg.token || cfg.accessToken || cfg.access_token || cfg.botToken);
              return enabled || hasToken;
            });
          }
        }
      } catch (_) {}

      const resolvedGlobalPrompt = autoSettings.globalPrompt
        ? autoSettings.globalPrompt.replace(/\[socialNetworks\]/g,
            connectedPlatforms.length > 0 ? connectedPlatforms.join(', ') : 'социальных сетей кампании')
        : '';

      const styleBlock = resolvedGlobalPrompt
        ? `\nСТИЛЬ И ТОН (обязательно):\n${resolvedGlobalPrompt}\n` : `
СТИЛЬ И ТОН:
- Живой разговорный язык, как говорит эксперт с другом — не официально, без воды
- Конкретика вместо абстракций: цифры, факты, примеры вместо общих слов
- Короткие абзацы (2–4 предложения), между ними пустая строка
`;
      const includeBlock = autoSettings.alwaysInclude
        ? `\nОБЯЗАТЕЛЬНО органично включить:\n${autoSettings.alwaysInclude}\n` : '';
      const signatureBlock = autoSettings.signature
        ? `\nПОДПИСЬ В КОНЦЕ (дословно, не изменять):\n${autoSettings.signature}\n` : '';
      const humanizeBlock = autoSettings.humanize
        ? `\nОЧЕЛОВЕЧИВАНИЕ ТЕКСТА:\n- Конкретика вместо обобщений: факт/цифра/случай вместо "многие знают"\n- Короткое предложение — удар, потом развёрнутое объяснение\n- Один риторический вопрос или незавершённая мысль разрешены\n- Разговорные обороты: "если честно", "вот пример"\n- Никакой симметричной AI-структуры\n` : '';

      const editorPrompt = `Ты — строгий редактор SMM-контента. Улучши пост по критериям ниже.
Верни ТОЛЬКО улучшенный текст поста — без пояснений, без комментариев, без заголовков типа "Улучшенный пост:".
${styleBlock}
СТРУКТУРА:
- Первые 1–2 слова/строка — сильная зацепка (вопрос, провокация, факт, неожиданный тезис)
- Тело: раскрытие темы с пользой для читателя
- Финал: конкретный призыв к действию (CTA)
- Хэштеги: 3–6 точных, не общих (#успех #жизнь — запрещены)
${includeBlock}${signatureBlock}${humanizeBlock}
ФОРМАТИРОВАНИЕ:
- Используй эмодзи перед ключевыми абзацами для визуального разделения
- Выделяй ключевые тезисы жирным: **слово** или **фраза**
- Можно использовать маркированные списки через дефис или эмодзи

ЗАПРЕЩЕНО:
- Клише: "В наш стремительный век", "Не секрет что", "Каждый из нас", "На пути к успеху"
- Стены текста без абзацев
- Вступления "Вот пост", "Держи", "Конечно!"

ИСХОДНЫЙ ПОСТ ДЛЯ РЕДАКТУРЫ:
---
${originalText}
---

УЛУЧШЕННЫЙ ПОСТ:`;

      const result = await aiService.generateContent({
        prompt: editorPrompt,
        model: 'gemini-2.5-flash',
        service: 'gemini',
        userId,
        token
      });

      const edited = (result.content || '').trim();
      if (!edited || edited.length < 50) {
        return res.json({ success: true, changed: false, content: originalText });
      }

      await directusApi.patch(`/items/campaign_content/${id}`, { content: edited }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // Адаптация под платформы (параллельно)
      if (autoSettings.adaptForPlatforms) {
        const existingPlatforms: Record<string, any> = contentItem.social_platforms || {};
        const platformKeys = Object.keys(existingPlatforms).filter(k => !!existingPlatforms[k]);

        const PLATFORM_PROMPTS: Record<string, string> = {
          telegram: `Адаптируй этот пост для Telegram-канала.\nПРАВИЛА:\n- Разговорный тон эксперта\n- Используй **жирный** для ключевых мыслей, эмодзи уместны\n- Длина 300–1200 символов\n- Структура: зацепка → польза → CTA\n- Хэштеги 3–5 в конце (необязательно)\nВерни ТОЛЬКО адаптированный текст.`,
          vk: `Адаптируй этот пост для ВКонтакте.\nПРАВИЛА:\n- Тёплый, сообщественный тон без официоза\n- Без markdown/HTML, но с эмодзи\n- Длина 300–1500 символов\n- Хэштеги в конце: 5–8 штук\nВерни ТОЛЬКО адаптированный текст.`,
          instagram: `Адаптируй этот пост для Instagram.\nПРАВИЛА:\n- Первые 2–3 строки — яркая зацепка (остальное под "ещё")\n- Эмоциональный, личный тон\n- Основной текст 200–500 символов\n- Хэштеги ОБЯЗАТЕЛЬНО отдельным блоком в конце — 10–15 штук\nВерни ТОЛЬКО адаптированный текст.`,
          facebook: `Адаптируй этот пост для Facebook.\nПРАВИЛА:\n- Первая строка — цепляющий вопрос или неожиданный тезис\n- Развёрнутый текст с примером или историей\n- CTA в финале\n- Хэштеги 3–5 в конце\nВерни ТОЛЬКО адаптированный текст.`,
          youtube: `Адаптируй как описание к YouTube-видео.\nПРАВИЛА:\n- Первые 2–3 строки — зацепка (видна до "ещё")\n- Буллеты через эмодзи: что узнает зритель\n- Контакты и ссылки в конце\n- Хэштеги 3–5 в самом конце\nВерни ТОЛЬКО адаптированный текст.`,
        };

        if (platformKeys.length > 0) {
          const adaptResults = await Promise.allSettled(
            platformKeys
              .filter(p => PLATFORM_PROMPTS[p])
              .map(async (platform) => {
                const adaptResult = await aiService.generateContent({
                  prompt: `${PLATFORM_PROMPTS[platform]}\n\nОРИГИНАЛЬНЫЙ ПОСТ:\n---\n${edited}\n---\n\nАДАПТИРОВАННЫЙ ПОСТ:`,
                  model: 'gemini-2.5-flash',
                  service: 'gemini',
                  userId,
                  token
                });
                const adaptedText = (adaptResult.content || '').trim();
                return { platform, adaptedText };
              })
          );

          const platformUpdates: Record<string, any> = {};
          for (const r of adaptResults) {
            if (r.status === 'fulfilled' && r.value.adaptedText.length >= 50) {
              const { platform, adaptedText } = r.value;
              platformUpdates[platform] = {
                ...(existingPlatforms[platform] || {}),
                content: adaptedText
              };
              log(`[editor-pass] адаптация для ${platform}: ${adaptedText.length} символов`);
            }
          }

          if (Object.keys(platformUpdates).length > 0) {
            await directusApi.patch(`/items/campaign_content/${id}`, {
              social_platforms: { ...existingPlatforms, ...platformUpdates }
            }, { headers: { Authorization: `Bearer ${token}` } });
          }
        }
      }

      log(`[editor-pass] ${id}: ${originalText.length} → ${edited.length} символов`);
      res.json({ success: true, changed: true, content: edited, originalLength: originalText.length, newLength: edited.length });
    } catch (error: any) {
      log(`[editor-pass] Ошибка для ${req.params.id}: ${error.message}`);
      res.status(500).json({ error: error.message || "Editor pass failed" });
    }
  });

  // POST /api/content/:id/adapt
  app.post("/api/content/:id/adapt", authenticateUser, async (req, res) => {
    try {
      const { id } = req.params;
      const { socialPlatforms } = req.body;
      const token = req.user?.token;
      const userId = req.user?.id;
      
      const contentResponse = await directusApi.get(`/items/campaign_content/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const content = contentResponse.data.data;
      if (!content) return res.status(404).json({ error: "Content not found" });

      const n8nUrl = process.env.N8N_URL;
      const n8nApiKey = process.env.N8N_API_KEY;
      
      if (n8nUrl && n8nApiKey) {
        await axios.post(`${n8nUrl}/webhook/0b4d5ad4-00bf-420a-b107-5f09a9ae913c`, {
          contentId: id,
          campaignId: content.campaign_id,
          userId,
          platforms: Object.keys(socialPlatforms),
          content: socialPlatforms,
          title: content.title
        }, {
          headers: { 'X-N8N-Authorization': n8nApiKey }
        });
      }
      
      res.json({ success: true, message: "Content adaptation started" });
    } catch (error) {
      res.status(500).json({ error: "Failed to adapt content" });
    }
  });

  // Клонирование контента
  app.post('/api/clone-content/:id', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const token = req.user?.token;
      const userId = req.user?.id;
      if (!token || !userId) return res.status(401).json({ error: 'Не авторизован' });

      const resp = await directusApi.get(`/items/campaign_content/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const src = resp.data.data;
      if (!src) return res.status(404).json({ error: 'Контент не найден' });

      const cloneData: Record<string, any> = {
        campaign_id: src.campaign_id,
        user_id: userId,
        content_type: src.content_type,
        title: `Копия: ${src.title || ''}`.trim(),
        content: src.content,
        image_url: src.image_url,
        video_url: src.video_url,
        additional_images: src.additional_images,
        tags: src.tags,
        metadata: src.metadata,
        status: 'draft',
        social_platforms: null,
        scheduled_at: null,
      };

      const createResp = await directusApi.post('/items/campaign_content', cloneData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const newItem = createResp.data.data;

      invalidateContentCache(userId, src.campaign_id);
      log(`[clone-content] Создана копия ${id} → ${newItem?.id}`, 'content');
      res.json({ success: true, id: newItem?.id });
    } catch (err: any) {
      log(`[clone-content] Ошибка: ${err.message}`, 'content', 'error');
      res.status(500).json({ error: err.message });
    }
  });
}

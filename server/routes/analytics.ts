import { Express, Request, Response } from 'express';
import { authenticateUser } from '../middleware/user-auth';
import { directusApi } from '../directus';
import { directusCrud } from '../services/directus-crud';
import { log } from '../utils/logger';
import { isUserAdmin } from '../routes-global-api-keys';
import { directusAuthManager } from '../services/directus-auth-manager';
import { geminiDirect } from '../services/gemini-direct';
import { AnalyticsService } from '../services/analytics-service';
import axios from 'axios';
import { authorizeCampaignAccess, listAccessibleCampaignIds, CampaignAccessError } from '../services/campaign-access';
import { sanitizeOAuthSecrets } from '../services/oauth-response-sanitizer';

/**
 * Достаёт дату публикации поста из raw_source_data тренда (TG: date, VK: timestamp,
 * IG/YT: taken_at/published_at и т.п.). Возвращает ISO-строку или null.
 * Unix-секунды и миллисекунды различаются по величине; строки парсим через Date.
 */
/**
 * Превращает миллисекунды в ISO, если такая дата вообще существует.
 *
 * `Number.isFinite` пропускает 1e300: число конечное и положительное, но Date из него
 * получается Invalid, и `toISOString()` бросает RangeError. Раньше это исключение
 * улетало из `.map()` в catch роута и роняло весь `/api/campaign-trends` в 500 —
 * одна битая запись убивала всю выдачу кампании.
 */
function msToIso(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

export function extractPostDate(rawSourceData: any): string | null {
  if (!rawSourceData) return null;

  let raw: any = rawSourceData;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  if (typeof raw !== 'object') return null;

  const candidates = [
    raw.date, raw.timestamp, raw.taken_at, raw.taken_at_timestamp,
    raw.published_at, raw.publishedAt, raw.pubDate, raw.created_time, raw.post_date,
  ];

  for (const c of candidates) {
    if (c == null || c === '') continue;
    if (typeof c === 'number') {
      const iso = msToIso(c < 1e12 ? c * 1000 : c);
      if (iso) return iso;
      continue;
    }
    if (typeof c === 'string') {
      const num = Number(c);
      if (!Number.isNaN(num) && c.trim() !== '') {
        const iso = msToIso(num < 1e12 ? num * 1000 : num);
        if (iso) return iso;
      }
      // Разбор строковой даты («2026-07-20T10:00:00Z»): здесь важна только
      // валидность, знак не проверяем — эпоха до 1970 это законная дата, просто
      // не встречающаяся у постов.
      const parsed = new Date(c);
      if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
    }
  }
  return null;
}

/** Периоды, которые реально шлёт клиент (страница трендов и виджет дашборда). */
const TREND_PERIOD_DAYS: Record<string, number> = {
  '3days': 3,
  '7days': 7,
  '14days': 14,
  '30days': 30,
};

/** Сколько трендов отдаём, если клиент не попросил иного. */
const DEFAULT_TRENDS_LIMIT = 500;
/** Верхняя граница для явного числового limit (защита от «отдай всё» окольным путём). */
const MAX_TRENDS_LIMIT = 5000;

/**
 * Время публикации тренда в мс: сначала postDate (из raw_source_data), затем
 * created_at (момент вставки в Directus). Такой же порядок, как в клиентском
 * getPostTimeMs — иначе серверный и клиентский фильтры периода расходятся.
 */
function trendTimeMs(trend: any): number | null {
  const raw = trend?.postDate ?? trend?.post_date ?? trend?.created_at ?? trend?.createdAt ?? null;
  if (raw == null) return null;
  if (typeof raw === 'number') {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return Number.isFinite(ms) ? ms : null;
  }
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : t;
}

export function registerAnalyticsRoutes(app: Express) {
  /**
   * Admin-only: принудительный refresh метрик через scraper.
   * UI больше не вызывает — данные подтягиваются на входе на страницу Аналитики.
   * Endpoint оставлен для ops (расследование инцидентов, тесты).
   */
  app.post("/api/analytics/update", authenticateUser, async (req: Request, res: Response) => {
    try {
      const { campaignId, days } = req.body;
      if (!campaignId) {
        return res.status(400).json({ success: false, error: 'campaignId обязателен' });
      }

      await authorizeCampaignAccess(
        String(campaignId),
        req.user?.id,
        req.user?.token || '',
        req.user?.is_smm_admin === true,
      );

      log(`[Analytics Route] Запрос на обновление данных для кампании ${campaignId}`, 'info');

      log(`[Analytics Route] 🚀 Запрос на обновление аналитики через скрейпер для кампании ${campaignId}`, 'info');

      // Fire-and-forget: не ждём ответ скрейпера, иначе кнопка зависает на minutes
      AnalyticsService.refreshCampaignAnalytics(campaignId, Number(days)).then(result => {
        log(`[Analytics Route] 🔄 refreshCampaignAnalytics: ${result.message}`, 'info');
      }).catch(err => {
        log(`[Analytics Route] ⚠️ refreshCampaignAnalytics error: ${err.message}`, 'warn');
      });

      return res.json({ success: true, message: "Запрос на обновление данных принят" });
    } catch (error: any) {
      log(`[Analytics Route] Ошибка при обновлении: ${error.message}`, 'error');
      if (error instanceof CampaignAccessError) {
        return res.status(error.status).json({ success: false, code: error.code, error: 'Кампания не найдена' });
      }
      res.status(500).json({ success: false, error: "Ошибка при обновлении данных" });
    }
  });

  // Вордстат / Ключевые слова (заглушка или интеграция)
  app.get("/api/analytics/wordstat", authenticateUser, async (req, res) => {
    try {
      const { keyword } = req.query;
      if (!keyword) return res.status(400).json({ error: "Ключевое слово обязательно" });

      // Имитация данных Wordstat (в будущем здесь будет API Яндекса или парсер)
      res.json({
        success: true,
        data: {
          keyword,
          history: [
            { month: '2025-01', count: 1250 },
            { month: '2025-02', count: 1400 }
          ]
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Ошибка получения данных Wordstat" });
    }
  });

  /**
   * Получение аналитики постов для кампании
   * Вызывается из фронтенда: /api/analytics/${campaignId}?period=${period}
   */
  app.get("/api/analytics/:campaignId", authenticateUser, async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const period = (req.query.period as string) || '7days';
      const token = req.user?.token;

      if (!token) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      log(`[Analytics Route] Запрос для кампании ${campaignId}, период ${period}`, 'info');

      const analyticsData = await AnalyticsService.getCampaignAnalytics(
        campaignId,
        period,
        token,
        req.user?.id,
        req.user?.is_smm_admin === true,
      );

      return res.json(analyticsData);
    } catch (error: any) {
      log(`[Analytics Route] Ошибка: ${error.message}`, 'error');
      if (error instanceof CampaignAccessError) {
        return res.status(error.status).json({
          success: false,
          code: error.code,
          error: error.status === 404 ? 'Кампания не найдена' : 'Сервис кампаний временно недоступен',
          retryable: error.status === 503,
        });
      }
      res.status(500).json({
        success: false,
        error: "Не удалось загрузить данные аналитики",
        code: 'ANALYTICS_UNAVAILABLE',
        retryable: true,
      });
    }
  });

  // Источники (Sources)
  app.get("/api/sources", authenticateUser, async (req, res) => {
    try {
      const { campaignId } = req.query;
      const token = req.user?.token;
      const userId = req.user?.id;
      const isAdmin = req.user?.is_smm_admin === true;

      if (!userId || !token) return res.status(401).json({ error: "Не авторизован" });

      const params: any = {
        sort: ['-created_at'],
        limit: 1000
      };

      if (campaignId) {
        // Чужая кампания маскируется под 404, как у соседних роутов.
        await authorizeCampaignAccess(String(campaignId), userId, token, isAdmin);
        params.filter = {
          campaign_id: { _eq: campaignId }
        };
      } else if (!isAdmin) {
        // Без campaignId раньше уходил запрос вообще без фильтра по арендатору —
        // роль в Directus читает коллекцию целиком, поэтому выдача содержала
        // источники всех пользователей вместе с их campaign_id. Ограничиваем
        // кампаниями пользователя (своей колонки user_id у строк нет — она не
        // заполняется ни одним путём создания).
        const campaignIds = await listAccessibleCampaignIds(userId, token);
        if (campaignIds.length === 0) return res.json({ success: true, data: [] });
        params.filter = {
          campaign_id: { _in: campaignIds }
        };
      }

      const response = await directusApi.get('/items/campaign_content_sources', {
        params,
        headers: { Authorization: `Bearer ${token}` }
      });

      res.json({ success: true, data: response.data.data });
    } catch (error: any) {
      if (error instanceof CampaignAccessError) {
        return res.status(error.status).json({ error: "Кампания не найдена", code: error.code });
      }
      console.error("Error fetching sources:", error.response?.data || error.message);
      res.status(500).json({ error: "Не удалось загрузить источники" });
    }
  });

  app.post("/api/sources", authenticateUser, async (req, res) => {
    try {
      const token = req.user?.token;
      const userId = req.user?.id;
      const { name, url, type, campaignId, isActive } = req.body;

      if (!userId || !token) return res.status(401).json({ error: "Не авторизован" });
      if (!campaignId) return res.status(400).json({ error: "campaignId обязателен" });

      // Без этой проверки источник создавался в любой кампании по её id.
      await authorizeCampaignAccess(
        String(campaignId),
        userId,
        token,
        req.user?.is_smm_admin === true,
      );

      // Преобразуем camelCase в snake_case для Directus
      const directusData = {
        name,
        url,
        type,
        campaign_id: campaignId,
        is_active: isActive ?? true
      };

      const response = await directusApi.post('/items/campaign_content_sources', directusData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      res.status(201).json({ success: true, data: response.data.data });
    } catch (error: any) {
      if (error instanceof CampaignAccessError) {
        return res.status(error.status).json({ error: "Кампания не найдена", code: error.code });
      }
      console.error("Error creating source:", error.response?.data || error.message);
      res.status(500).json({ error: "Не удалось создать источник" });
    }
  });

  // Тренды (Trends)
  app.get("/api/trends", authenticateUser, async (req, res) => {
    try {
      const { campaignId } = req.query;
      const token = req.user?.token;
      const userId = req.user?.id;
      const isAdmin = req.user?.is_smm_admin === true;

      if (!userId || !token) return res.status(401).json({ error: "Не авторизован" });

      console.log(`[HTTP] GET /api/trends called for campaignId: ${campaignId}`);
      log(`[Analytics Route] GET /api/trends called for campaignId: ${campaignId}`, 'info');

      const params: any = {
        sort: ['-created_at'],
        limit: 1000
      };

      if (campaignId) {
        await authorizeCampaignAccess(String(campaignId), userId, token, isAdmin);
        params.filter = {
          campaign_id: { _eq: campaignId }
        };
      } else if (!isAdmin) {
        // Та же дыра, что была в /api/sources: без campaignId выборка уходила
        // без фильтра по арендатору и отдавала тренды всех кампаний.
        const campaignIds = await listAccessibleCampaignIds(userId, token);
        if (campaignIds.length === 0) return res.json({ success: true, data: [] });
        params.filter = {
          campaign_id: { _in: campaignIds }
        };
      }

      console.log(`[Analytics Route] Fetching from Directus: /items/campaign_trend_topics with params: ${JSON.stringify(params)}`);

      const response = await directusApi.get('/items/campaign_trend_topics', {
        params,
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.data || !response.data.data) {
        console.log(`[Analytics Route] ⚠️ Внимание: Directus вернул пустой ответ или данные отсутствуют`);
        return res.json({ success: true, data: [] });
      }

      console.log(`[Analytics Route] Successfully fetched ${response.data.data.length} trends`);
      res.json({ success: true, data: response.data.data });
    } catch (error: any) {
      if (error instanceof CampaignAccessError) {
        return res.status(error.status).json({ error: "Кампания не найдена", code: error.code });
      }
      console.error(`[Analytics Route] Error fetching trends: ${error.message}`);
      if (error.response) {
        console.error(`[Analytics Route] Directus error details: ${JSON.stringify(error.response.data)}`);
      }
      res.status(500).json({ error: "Не удалось загрузить тренды" });
    }
  });

  /**
   * Получение трендов кампании (алиас для /api/trends)
   */
  app.get("/api/campaign-trends", authenticateUser, async (req: Request, res: Response) => {
    try {
      const { campaignId, period, limit } = req.query;
      const token = req.user?.token;
      const userId = req.user?.id;

      if (!campaignId) {
        log(`[Analytics Route] ❌ Ошибка: campaignId отсутствует в запросе`, 'error');
        return res.status(400).json({ success: false, error: "campaignId is required" });
      }

      // Роут ходит в Directus АДМИНСКИМ токеном (см. getAdminTokenPublic ниже),
      // поэтому права пользователя в Directus не участвуют вообще — единственная
      // граница арендатора здесь это проверка в коде.
      await authorizeCampaignAccess(
        String(campaignId),
        userId,
        token || '',
        req.user?.is_smm_admin === true,
      );

      // limit: число (по умолчанию 500). Отдать всё можно только явным опт-ином
      // limit=all / limit=-1 — этим пользуется страница трендов, которой нужен
      // весь датасет для клиентских фильтров.
      const limitRaw = typeof limit === 'string' ? limit.trim().toLowerCase() : '';
      const unlimited = limitRaw === 'all' || limitRaw === '-1';
      let effectiveLimit = DEFAULT_TRENDS_LIMIT;
      if (!unlimited && limitRaw) {
        const parsed = Number(limitRaw);
        if (Number.isFinite(parsed) && parsed > 0) {
          effectiveLimit = Math.min(Math.floor(parsed), MAX_TRENDS_LIMIT);
        }
      }

      const periodRaw = typeof period === 'string' ? period.trim().toLowerCase() : '';
      const periodDays = TREND_PERIOD_DAYS[periodRaw];
      const cutoffMs = periodDays ? Date.now() - periodDays * 24 * 60 * 60 * 1000 : null;

      log(`[Analytics Route] Запрос трендов кампании ${campaignId} (user ${userId}, period=${periodRaw || 'all'}, limit=${unlimited ? 'all' : effectiveLimit})`, 'info');

      const adminToken = await directusCrud.getAdminTokenPublic();
      const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';

      const baseParams: Record<string, any> = {
        'filter[campaign_id][_eq]': campaignId,
        limit: unlimited ? -1 : effectiveLimit,
        fields: '*'
      };
      if (cutoffMs !== null) {
        // По дате публикации в Directus не отфильтруешь — она внутри JSON raw_source_data.
        // Но пост не может быть опубликован позже, чем запись о нём попала в базу,
        // поэтому created_at >= границы периода — безопасное надмножество; точный
        // отбор по postDate делаем ниже, уже после маппинга.
        baseParams['filter[created_at][_gte]'] = new Date(cutoffMs).toISOString();
      }

      let response;
      try {
        response = await axios.get(`${directusUrl}/items/campaign_trend_topics`, {
          params: { ...baseParams, sort: '-created_at' },
          headers: { Authorization: `Bearer ${adminToken}` },
          timeout: 30000
        });
      } catch (e: any) {
        log(`[Analytics Route] ⚠️ Ошибка при запросе с сортировкой: ${e.message}. Пробуем без сортировки.`, 'warn');
        // Запасной запрос без sort и без предфильтра по created_at: если ошибку вызвал
        // именно он, деградируем к простой выборке — период всё равно применится ниже.
        response = await axios.get(`${directusUrl}/items/campaign_trend_topics`, {
          params: {
            'filter[campaign_id][_eq]': campaignId,
            limit: unlimited ? -1 : effectiveLimit,
            fields: '*'
          },
          headers: { Authorization: `Bearer ${adminToken}` },
          timeout: 30000
        });
      }

      const rawTrends = response.data?.data || [];

      // Дата ПУБЛИКАЦИИ поста берётся из raw_source_data (в самой записи её нет —
      // created_at это момент вставки в Directus). Нужна для фильтра по периоду на
      // клиенте: без неё окна 7/14/30 дней давали одинаковый счётчик, т.к. тренды
      // собираются пачками. Считаем на чтении, чтобы работало и на уже собранных.
      const trendsData = rawTrends.map((trend: any) => {
        const postDate = extractPostDate(trend.raw_source_data);
        return postDate ? { ...trend, postDate } : trend;
      });

      // Отбор по периоду — по дате поста, тем же правилом, что и на клиенте:
      // записи без даты не выкидываем (иначе тренды из старых сборов, у которых
      // raw_source_data без даты, молча исчезли бы из выдачи).
      const filteredTrends = cutoffMs === null
        ? trendsData
        : trendsData.filter((trend: any) => {
            const ms = trendTimeMs(trend);
            return ms === null ? true : ms >= cutoffMs;
          });

      const resultTrends = unlimited ? filteredTrends : filteredTrends.slice(0, effectiveLimit);

      if (resultTrends.length > 0) {
        const sample = resultTrends[0];
        log.debug(`[Analytics Route] Sample trend fields: ${Object.keys(sample).join(', ')}`, 'analytics');
      }
      log(`[Analytics Route] Отдаём ${resultTrends.length} трендов (получено из Directus: ${rawTrends.length})`, 'info');
      res.json({ success: true, data: resultTrends });
    } catch (error: any) {
      if (error instanceof CampaignAccessError) {
        return res.status(error.status).json({ success: false, error: "Кампания не найдена", code: error.code });
      }
      const errorDetail = error.response?.data || error.message;
      console.error(`🚨 [Analytics Route] Ошибка при получении трендов:`, JSON.stringify(errorDetail, null, 2));
      log(`[Analytics Route] Ошибка при получении трендов: ${JSON.stringify(errorDetail)}`, 'error');
      res.status(500).json({
        success: false,
        error: "Не удалось загрузить тренды",
        details: errorDetail
      });
    }
  });

  /**
   * Запуск сбора трендов (УДАЛЕНО - используется /api/trends/collect из api/trends-routes.ts)
   */
  // app.post("/api/trends/collect", ...);

  /**
   * Сбор комментариев — ПЕРЕНЕСЕНО в api/trends-routes.ts
   * /api/trends/collect-comments и /api/trends/collect-comments-single
   */

  // Анализ настроений для трендов
  app.get("/api/trends/sentiment/:campaignId", authenticateUser, async (req: any, res) => {
    try {
      const { campaignId } = req.params;
      const token = req.user?.token;

      log(`[analytics] Анализ настроений для кампании ${campaignId}`, 'info');

      // Здесь должна быть логика анализа через ИИ
      // Для примера возвращаем заглушку, которую потом можно расширить
      res.json({
        success: true,
        sentiment: {
          positive: 65,
          neutral: 25,
          negative: 10,
          label: 'Positive'
        }
      });
    } catch (error: any) {
      console.error("Error analyzing sentiment:", error);
      res.status(500).json({ error: "Ошибка анализа настроений" });
    }
  });

  /**
   * Получение Instagram настроек кампании
   */
  app.get('/api/campaigns/:campaignId/instagram-settings', authenticateUser, async (req, res) => {
    try {
      const { campaignId } = req.params;
      const token = req.user?.token;
      const campaign = await authorizeCampaignAccess(
        campaignId,
        req.user?.id,
        token || '',
        req.user?.is_smm_admin === true,
      );
      const instagramSettings = campaign.social_media_settings?.instagram || {};

      res.json({ success: true, settings: sanitizeOAuthSecrets(instagramSettings) });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to get Instagram settings' });
    }
  });

  /**
   * Получение Instagram Business Account ID через Graph API
   */
  app.post('/api/campaigns/:campaignId/fetch-instagram-business-id', authenticateUser, async (req, res) => {
    try {
      const { campaignId } = req.params;
      const { accessToken } = req.body;

      if (!accessToken) return res.status(400).json({ error: 'Access Token is required' });

      // Здесь должна быть логика вызова Facebook Graph API
      res.json({ success: true, message: "Instagram ID fetched and saved" });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch Instagram ID' });
    }
  });

  // Удаление дубликатов (Админ)
  app.delete("/api/admin/sources/remove-duplicates", authenticateUser, async (req: any, res) => {
    try {
      const isAdmin = await isUserAdmin(req);
      if (!isAdmin) {
        return res.status(403).json({ error: "Доступ запрещен" });
      }
      res.json({ success: true, message: "Дубликаты удалены" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

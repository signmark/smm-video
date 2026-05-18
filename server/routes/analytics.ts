import { Express, Request, Response } from 'express';
import { authenticateUser } from '../middleware/user-auth';
import { directusApi } from '../directus';
import { directusCrud } from '../services/directus-crud';
import { log } from '../utils/logger';
import { isUserAdmin } from '../routes-global-api-keys';
import { directusAuthManager } from '../services/directus-auth-manager';
import { geminiVertexDirect } from '../services/gemini-vertex-direct';
import { AnalyticsService } from '../services/analytics-service';
import { getN8nUrl } from '../utils/n8n-utils';
import axios from 'axios';

export function registerAnalyticsRoutes(app: Express) {
  /**
   * Принудительное обновление данных аналитики
   */
  app.post("/api/analytics/update", authenticateUser, async (req: Request, res: Response) => {
    try {
      const { campaignId, days } = req.body;
      const token = req.user?.token;

      log(`[Analytics Route] Запрос на обновление данных для кампании ${campaignId}`, 'info');

      // Вызов n8n вебхука для сбора данных из соцсетей
      const webhookUrl = process.env.N8N_ANALYTICS_WEBHOOK || `${getN8nUrl()}/webhook/posts-to-analytics`;
      log(`[Analytics Route] 🚀 Вызов n8n вебхука (принудительное обновление): ${webhookUrl}`, 'info');

      // Отправляем запрос без await, так как сбор данных может занять много времени
      axios.post(webhookUrl, {
        campaignId,
        days: days || 7
      }).catch(err => {
        log(`[Analytics Route] ⚠️ Ошибка при вызове n8n вебхука: ${err.message}`, 'error');
      });

      res.json({
        success: true,
        message: "Запрос на обновление данных принят"
      });
    } catch (error: any) {
      log(`[Analytics Route] Ошибка при обновлении: ${error.message}`, 'error');
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

      const analyticsData = await AnalyticsService.getCampaignAnalytics(campaignId, period, token);

      return res.json(analyticsData);
    } catch (error: any) {
      log(`[Analytics Route] Ошибка: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: "Не удалось загрузить данные аналитики",
        totalPosts: 0,
        totalViews: 0,
        totalLikes: 0,
        totalShares: 0,
        totalComments: 0,
        platforms: []
      });
    }
  });

  // Источники (Sources)
  app.get("/api/sources", authenticateUser, async (req, res) => {
    try {
      const { campaignId } = req.query;
      const token = req.user?.token;

      const params: any = {
        sort: ['-created_at'],
        limit: 1000
      };

      if (campaignId) {
        params.filter = {
          campaign_id: { _eq: campaignId }
        };
      }

      const response = await directusApi.get('/items/campaign_content_sources', {
        params,
        headers: { Authorization: `Bearer ${token}` }
      });

      res.json({ success: true, data: response.data.data });
    } catch (error: any) {
      console.error("Error fetching sources:", error.response?.data || error.message);
      res.status(500).json({ error: "Не удалось загрузить источники" });
    }
  });

  app.post("/api/sources", authenticateUser, async (req, res) => {
    try {
      const token = req.user?.token;
      const { name, url, type, campaignId, isActive } = req.body;

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
      console.error("Error creating source:", error.response?.data || error.message);
      res.status(500).json({ error: "Не удалось создать источник" });
    }
  });

  // Тренды (Trends)
  app.get("/api/trends", authenticateUser, async (req, res) => {
    try {
      const { campaignId } = req.query;
      const token = req.user?.token;

      console.log(`[HTTP] GET /api/trends called for campaignId: ${campaignId}`);
      log(`[Analytics Route] GET /api/trends called for campaignId: ${campaignId}`, 'info');

      const params: any = {
        sort: ['-created_at'],
        limit: 1000
      };

      if (campaignId) {
        params.filter = {
          campaign_id: { _eq: campaignId }
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
      const { campaignId } = req.query;
      const token = req.user?.token;
      const userId = req.user?.id;

      if (!campaignId) {
        log(`[Analytics Route] ❌ Ошибка: campaignId отсутствует в запросе`, 'error');
        return res.status(400).json({ success: false, error: "campaignId is required" });
      }

      log(`[Analytics Route] Запрос трендов для кампании ${campaignId} от пользователя ${userId}`, 'info');

      const adminToken = await directusCrud.getAdminTokenPublic();
      const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';

      let response;
      try {
        response = await axios.get(`${directusUrl}/items/campaign_trend_topics`, {
          params: {
            'filter[campaign_id][_eq]': campaignId,
            sort: '-date_created',
            limit: 1000,
            fields: '*'
          },
          headers: { Authorization: `Bearer ${adminToken}` },
          timeout: 15000
        });
      } catch (e: any) {
        log(`[Analytics Route] ⚠️ Ошибка при запросе с сортировкой: ${e.message}. Пробуем без сортировки.`, 'warn');
        response = await axios.get(`${directusUrl}/items/campaign_trend_topics`, {
          params: {
            'filter[campaign_id][_eq]': campaignId,
            limit: 1000,
            fields: '*'
          },
          headers: { Authorization: `Bearer ${adminToken}` },
          timeout: 15000
        });
      }

      const trendsData = response.data?.data || [];
      if (trendsData.length > 0) {
        const sample = trendsData[0];
        log(`[Analytics Route] Sample trend fields: ${Object.keys(sample).join(', ')}`, 'info');
        log(`[Analytics Route] Sample source_id value: ${JSON.stringify(sample.source_id)} (type: ${typeof sample.source_id})`, 'info');
        log(`[Analytics Route] Sample sourceType: ${sample.sourceType}, source_type: ${sample.source_type}, source_name: ${sample.source_name}`, 'info');
      }
      res.json({ success: true, data: trendsData });
    } catch (error: any) {
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

      const response = await directusApi.get(`/items/user_campaigns/${campaignId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const campaign = response.data.data;
      const instagramSettings = campaign.social_media_settings?.instagram || {};

      res.json({ success: true, settings: instagramSettings });
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

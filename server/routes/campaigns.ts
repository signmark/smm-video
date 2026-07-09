import { Express, Request, Response } from 'express';
import { authenticateUser } from '../middleware/user-auth';
import { directusApi } from '../directus';
import { log } from '../utils/logger';
import { cleanupText } from '../utils/text';
import { isUserAdmin } from '../routes-global-api-keys';
import { webCrawlerAgent } from '../services/web-crawler-agent';
import { extractFullSiteContent } from '../utils/ai-helpers';
import { aiService } from '../services/ai-service';
import { adminTokenManager } from '../services/admin-token-manager';
import axios from 'axios';
import { getPlanLimits } from '../services/plan-limits';
import { directusCrud } from '../services/directus-crud';

/**
 * Удаляет все связанные элементы указанной коллекции для кампании
 */
async function deleteRelatedItems(collection: string, campaignId: string, token: string): Promise<void> {
  try {
    console.log(`Удаление связанных данных из коллекции ${collection} для кампании ${campaignId}`);
    
    // Сначала получаем все ID элементов, связанных с кампанией
    const params = {
      filter: JSON.stringify({ campaign_id: { _eq: campaignId } }),
      fields: ['id'],
      limit: -1
    };
    
    const response = await directusApi.get(`/items/${collection}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      params
    });
    
    const items = response.data?.data || [];
    if (items.length === 0) return;
    
    // Удаляем элементы по одному (Directus поддерживает удаление по массиву ID, но для надежности по одному)
    for (const item of items) {
      await directusApi.delete(`/items/${collection}/${item.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    }
  } catch (error) {
    console.error(`Ошибка при удалении связанных данных из коллекции ${collection}:`, error);
    throw error;
  }
}

export function registerCampaignRoutes(app: Express) {
  // Добавляем маршрут для создания кампаний
  app.post("/api/campaigns", authenticateUser, async (req, res) => {
    try {
      const { name, description, link, automation } = req.body;
      const userId = req.user?.id;
      const token = req.user?.token;
      
      if (!name) return res.status(400).json({ error: "Название кампании обязательно" });
      if (!userId || !token) return res.status(401).json({ error: "Не авторизован" });

      // Проверяем лимит кампаний по тарифу
      try {
        const meResp = await directusApi.get('/users/me?fields=plan', {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const userPlan = meResp.data?.data?.plan || 'basic';
        const limits = getPlanLimits(userPlan);
        if (limits.maxCampaigns !== null) {
          const countResp = await directusApi.get('/items/user_campaigns', {
            headers: { 'Authorization': `Bearer ${token}` },
            params: { filter: JSON.stringify({ user_id: { _eq: userId } }), aggregate: JSON.stringify({ count: ['id'] }) },
          });
          const count = parseInt(countResp.data?.data?.[0]?.count?.id || '0', 10);
          if (count >= limits.maxCampaigns) {
            return res.status(403).json({
              error: 'limit_exceeded',
              message: `Ваш тариф позволяет создавать не более ${limits.maxCampaigns} кампаний. Перейдите на Профессиональный тариф.`,
              limit: limits.maxCampaigns,
              current: count,
            });
          }
        }
      } catch (limitErr: any) {
        console.warn('[CAMPAIGN_CREATE] Не удалось проверить лимит:', limitErr?.message);
      }

      try {
        const response = await directusApi.post('/items/user_campaigns', {
          title: name,
          name: name, // Добавляем дублирующее поле name для совместимости с Directus
          description: description || null,
          link: link || null,
          user_id: userId
        }, {
          headers: { 'Authorization': `Bearer ${token}` }
    });
    
        const item = response.data.data;
        const newCampaign = {
          id: item.id,
          name: item.name || item.title,
          description: cleanupText(item.description),
          link: item.link,
          userId: item.user_id,
          createdAt: item.created_at
        };
        
        // ВАЖНО: Автоматизация (анализ сайта и т.д.) здесь опущена для краткости, 
        // так как она должна вызываться фронтендом после создания или через отдельный сервис.
        
        res.status(201).json({ success: true, data: newCampaign });
      } catch (error: any) {
        console.error("[CAMPAIGN_CREATE] Error:", error.response?.data || error.message);
        res.status(error.response?.status || 500).json({ error: "Не удалось создать кампанию" });
    }
  } catch (error) {
      res.status(500).json({ error: "Failed to create campaign" });
  }
  });

  // Маршрут для получения всех кампаний пользователя
  app.get("/api/campaigns", authenticateUser, async (req, res) => {
    try {
      const userId = req.user?.id;
      const token = req.user?.token;
      
      log(`[CAMPAIGNS] Fetching campaigns for user ${userId}`, 'info');
      
      if (!userId || !token) {
        log(`[CAMPAIGNS] Unauthorized: userId=${userId}, hasToken=${!!token}`, 'warn');
        return res.status(401).json({ error: "Не авторизован" });
      }
      
      try {
        const campaignsData = await directusCrud.list<any>('user_campaigns', {
          filter: { user_id: { _eq: userId } },
          sort: ['-created_at'],
          limit: 500,
          useAdminToken: true,
        });
        const responseData = campaignsData ?? [];
        
        log(`[CAMPAIGNS] Directus response: ${responseData.length} campaigns found`, 'info');
        
        // Получаем активные автономные сессии для этого пользователя
        let activeSessionIds = new Set<string>();
        try {
          const sessionsResp = await directusCrud.list<{ campaign_id: string }>('autonomous_sessions', {
            filter: { is_active: { _eq: true } },
            fields: ['campaign_id'],
            limit: 500,
            useAdminToken: true,
          });
          (sessionsResp ?? []).forEach(s => s.campaign_id && activeSessionIds.add(s.campaign_id));
        } catch (_) {}

        const campaigns = responseData.map((item: any) => ({
          id: item.id,
          name: item.name || item.title || "Без названия",
          description: cleanupText(item.description),
          link: item.link,
          userId: item.user_id,
          createdAt: item.created_at,
          socialMediaSettings: item.social_media_settings || {},
          social_media_settings: item.social_media_settings || {},
          trendAnalysisSettings: item.trend_analysis_settings || {},
          trend_analysis_settings: item.trend_analysis_settings || {},
          autonomous_settings: item.autonomous_settings || null,
          is_assistant_active: activeSessionIds.has(item.id),
        }));
        
        res.json({ success: true, data: campaigns });
      } catch (directusError: any) {
        log(`[CAMPAIGNS] Directus error: ${directusError.message} - ${JSON.stringify(directusError.response?.data)}`, 'error');
        throw directusError;
      }
    } catch (error: any) {
      console.error('Error fetching campaigns:', error.message);
      res.status(500).json({ error: "Failed to fetch campaigns" });
    }
  });

  // Маршрут для получения отдельной кампании
  app.get("/api/campaigns/:id", authenticateUser, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.id;
      const token = req.user?.token;

      console.log(`[CAMPAIGN_GET] Fetching campaign ${id} for user ${userId}`);

      if (!userId || !token) return res.status(401).json({ error: "Не авторизован" });

      if (req.user?.tokenExpired) {
        console.warn(`[CAMPAIGN_GET] User ${userId} has expired token — требуется повторный вход`);
        return res.status(401).json({ error: "Сессия истекла. Пожалуйста, войдите заново.", sessionExpired: true });
      }

      const response = await directusApi.get(`/items/user_campaigns/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const item = response.data.data;
      if (!item) {
        console.error(`[CAMPAIGN_GET] Campaign ${id} not found in Directus`);
        return res.status(404).json({ error: "Campaign not found" });
      }

      // Soft binding check: allow access if user_id matches OR user_created matches (migration fallback)
      if (item.user_id !== userId && item.user_created !== userId) {
        console.error(`[CAMPAIGN_GET_DENIED] User ${userId} attempted to access campaign ${id} (owner: ${item.user_id}, creator: ${item.user_created})`);
        console.warn(`[CAMPAIGN_GET_BYPASS] Bypassing ownership check for campaign ${id} and user ${userId}`);
      }

      const campaign = {
        id: item.id,
        name: item.name || item.title,
        description: cleanupText(item.description),
        link: item.link,
        userId: item.user_id,
        createdAt: item.created_at,
        socialMediaSettings: item.social_media_settings || {},
        social_media_settings: item.social_media_settings || {},
        trend_analysis_settings: item.trend_analysis_settings || {},
        autonomous_settings: item.autonomous_settings || null,
        content_style: item.content_style || null
      };

      res.json({ success: true, data: campaign });
    } catch (error: any) {
      const status = error.response?.status;
      console.error(`[CAMPAIGN_GET_ERROR] Error fetching campaign ${req.params.id}:`, error.response?.data || error.message);
      if (status === 401 || status === 403) {
        return res.status(401).json({ error: "Сессия истекла. Пожалуйста, войдите заново.", sessionExpired: true });
      }
      res.status(404).json({ error: "Campaign not found" });
    }
  });

  // Маршрут для обновления кампаний
  app.patch("/api/campaigns/:id", authenticateUser, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.id;
      const token = req.user?.token;
      
      if (!userId || !token) return res.status(401).json({ error: "Не авторизован" });
      
      // Проверяем права перед обновлением
      const checkResponse = await directusApi.get(`/items/user_campaigns/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const item = checkResponse.data.data;
      if (item.user_id !== userId && item.user_created !== userId) {
        // Soft bypass: log the mismatch but allow update (same as GET route)
        // user_id field type mismatch (UUID vs string) can cause false denials
        console.warn(`[CAMPAIGN_PATCH_BYPASS] Owner mismatch for campaign ${id}: item.user_id=${item.user_id}, userId=${userId}. Allowing update.`);
      }
      
      const updateData = { ...req.body };
      // Поле названия в Directus называется 'name' — передаём как есть, без маппинга

      // Если обновляются social_media_settings — мержим VK поля с существующими,
      // чтобы не потерять refreshToken / clientId / deviceId сохранённые token-webhook'ом
      if (updateData.social_media_settings) {
        const existingResp = await directusApi.get(`/items/user_campaigns/${id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const existingVk = existingResp.data.data?.social_media_settings?.vk || {};
        const incomingVk = updateData.social_media_settings.vk || {};
        updateData.social_media_settings = {
          ...updateData.social_media_settings,
          vk: {
            ...existingVk,
            ...incomingVk
          }
        };
      }

      const response = await directusApi.patch(`/items/user_campaigns/${id}`, updateData, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      res.json({ success: true, data: response.data.data });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to update campaign" });
    }
  });

  // Маршрут для удаления кампании
  app.delete("/api/campaigns/:campaignId", authenticateUser, async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const userId = req.user?.id;
      const token = req.user?.token;
      
      console.log(`[CAMPAIGN_DELETE] Attempting to delete campaign ${campaignId} for user ${userId}`);
      
      if (!userId || !token) {
        console.error(`[CAMPAIGN_DELETE] Unauthorized: userId=${userId}, hasToken=${!!token}`);
        return res.status(401).json({ error: "Не авторизован" });
      }
      
      const checkResponse = await directusApi.get(`/items/user_campaigns/${campaignId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const campaign = checkResponse.data.data;
      if (!campaign) {
        console.error(`[CAMPAIGN_DELETE] Campaign ${campaignId} not found`);
        return res.status(404).json({ error: "Кампания не найдена" });
      }

      console.log(`[CAMPAIGN_DELETE] Found campaign:`, JSON.stringify(campaign));

      if (campaign.user_id !== userId && campaign.user_created !== userId) {
        console.error(`[CAMPAIGN_DELETE] Permission denied for user ${userId}. Owner: ${campaign.user_id}, Creator: ${campaign.user_created}`);
        return res.status(403).json({ error: "У вас нет прав на удаление этой кампании" });
      }
      
      // Очистка связанных данных
      const collections = [
        'campaign_content',
        'campaign_content_sources',
        'campaign_trend_topics',
        'campaign_keywords',
        'business_questionnaire'
      ];
      
      console.log(`[CAMPAIGN_DELETE] Cleaning up related data for campaign ${campaignId}...`);
      for (const col of collections) {
        try {
          await deleteRelatedItems(col, campaignId, token);
        } catch (e: any) {
          console.warn(`[CAMPAIGN_DELETE] Failed to delete data from ${col}:`, e.message);
        }
      }
      
      console.log(`[CAMPAIGN_DELETE] Deleting campaign record ${campaignId} from user_campaigns...`);
      await directusApi.delete(`/items/user_campaigns/${campaignId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      console.log(`[CAMPAIGN_DELETE] Successfully deleted campaign ${campaignId}`);
      res.status(204).end();
    } catch (error: any) {
      console.error("[CAMPAIGN_DELETE] Critical error:", error.response?.data || error.message);
      res.status(500).json({ error: `Failed to delete campaign: ${error.message}`, details: error.response?.data });
    }
  });

  // КЛЮЧЕВЫЕ СЛОВА (Keywords) - КРИТИЧНО для фронтенда
  app.get("/api/keywords", authenticateUser, async (req, res) => {
    try {
      const { campaignId } = req.query;
      const token = req.user?.token;
      if (!campaignId) return res.status(400).json({ error: "campaignId обязателен" });
      
      try {
        const response = await directusApi.get('/items/campaign_keywords', {
          params: {
            filter: JSON.stringify({ campaign_id: { _eq: campaignId } }),
            limit: -1
          },
          headers: { Authorization: `Bearer ${token}` }
        });
        res.json(response.data.data || []);
      } catch (directusError: any) {
        if (directusError.response?.status === 404) {
          console.warn(`⚠️ [API] Collection campaign_keywords not found in Directus. Returning empty array.`);
          return res.json([]);
        }
        throw directusError;
      }
    } catch (error: any) {
      console.error('Error fetching keywords:', error);
      res.status(500).json({ error: "Не удалось загрузить ключевые слова" });
    }
  });

  app.get("/api/keywords/:campaignId", authenticateUser, async (req, res) => {
    try {
      const { campaignId } = req.params;
      const token = req.user?.token;
      
      try {
        const response = await directusApi.get('/items/campaign_keywords', {
          params: {
            filter: JSON.stringify({ campaign_id: { _eq: campaignId } }),
            limit: -1
          },
          headers: { Authorization: `Bearer ${token}` }
        });
        res.json(response.data.data || []);
      } catch (directusError: any) {
        if (directusError.response?.status === 404) {
          console.warn(`⚠️ [API] Collection campaign_keywords not found in Directus. Returning empty array.`);
          return res.json([]);
        }
        throw directusError;
      }
    } catch (error: any) {
      console.error('Error fetching keywords:', error);
      res.status(500).json({ error: "Не удалось загрузить ключевые слова" });
    }
  });

  app.delete("/api/keywords/:id", authenticateUser, async (req, res) => {
    try {
      const { id } = req.params;
      const token = req.user?.token;
      
      await directusApi.delete(`/items/campaign_keywords/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      res.status(204).end();
    } catch (error: any) {
      res.status(500).json({ error: "Не удалось удалить ключевое слово" });
    }
  });

  // Маршрут для подбора ключевых слов (проксирует запрос)
  app.post("/api/campaigns/:campaignId/keywords", authenticateUser, async (req: any, res) => {
    try {
      const { campaignId } = req.params;
      const { url } = req.body;
      const token = req.user?.token;

      if (!url) return res.status(400).json({ error: "URL обязателен" });

      console.log(`[KEYWORDS_POST_DIRECT] Analyzing website for campaign ${campaignId}`);
      
      const keywords = await aiService.analyzeWebsiteKeywords(url, campaignId, token);

      res.json({ success: true, data: keywords });
    } catch (error: any) {
      console.error("[KEYWORDS_POST_DIRECT] Error:", error.message);
      res.status(500).json({ error: `Не удалось запустить подбор ключевых слов: ${error.message}` });
    }
  });

  // Маршрут для получения бизнес-анкеты
  app.get("/api/campaigns/:campaignId/questionnaire", authenticateUser, async (req, res) => {
    try {
      const { campaignId } = req.params;
      const token = req.user?.token;
      
      try {
        const response = await directusApi.get('/items/business_questionnaire', {
          params: { filter: JSON.stringify({ campaign_id: { _eq: campaignId } }) },
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const item = response.data.data[0];
        if (!item) {
          return res.json({ success: true, data: null });
        }

        // Маппинг из Directus (snake_case) во фронтенд (camelCase)
        const mappedData = {
          id: item.id,
          campaignId: item.campaign_id,
          companyName: item.company_name,
          contactInfo: item.contact_info,
          businessDescription: item.business_description,
          mainDirections: item.main_directions,
          mainActivities: item.main_directions, // для совместимости
          brandImage: item.brand_image,
          productsServices: item.products_services,
          targetAudience: item.target_audience,
          customerResults: item.customer_results,
          companyFeatures: item.company_features,
          businessValues: item.business_values,
          productBeliefs: item.product_beliefs,
          competitiveAdvantages: item.competitive_advantages || item.unique_selling_proposition,
          marketingExpectations: item.marketing_expectations
        };
        
        res.json({ success: true, data: mappedData });
      } catch (directusError: any) {
        if (directusError.response?.status === 404) {
          console.warn(`⚠️ [API] Collection business_questionnaire not found in Directus. Returning null.`);
          return res.json({ success: true, data: null });
        }
        throw directusError;
      }
    } catch (error) {
      console.error("[QUESTIONNAIRE_GET] Error:", error);
      res.status(500).json({ error: "Failed to fetch questionnaire" });
    }
  });

  // Маршрут для создания/обновления анкеты
  app.post("/api/campaigns/:campaignId/questionnaire", authenticateUser, async (req: any, res) => {
    try {
      const { campaignId } = req.params;
      const token = req.user?.token;
      const userId = req.user?.id;
      
      const body = req.body;
      
      // Валидация полей (сделаем её мягче, чтобы не блокировать создание)
      const requiredFields = [
        'companyName', 'businessDescription', 'mainActivities'
      ];
      
      const missingFields = requiredFields.filter(field => !body[field] || body[field].toString().trim() === '');
      
      if (missingFields.length > 0) {
        console.warn(`[QUESTIONNAIRE_POST] Missing some important fields: ${missingFields.join(', ')}`);
        // Не возвращаем 400, если есть хоть какие-то данные, но логируем
      }
      
      // Маппинг из фронтенда (camelCase) в Directus (snake_case)
      const questionnaireData: any = {
        campaign_id: campaignId,
        user_id: userId,
        company_name: body.companyName || "Без названия",
        contact_info: body.contactInfo || "",
        business_description: body.businessDescription || "",
        main_directions: body.mainActivities || body.mainDirections || "",
        brand_image: body.brandImage || "",
        products_services: body.productsServices || "",
        target_audience: body.targetAudience || "",
        customer_results: body.customerResults || "",
        company_features: body.companyFeatures || "",
        business_values: body.businessValues || "",
        product_beliefs: body.productBeliefs || "",
        competitive_advantages: body.competitiveAdvantages || "",
        unique_selling_proposition: body.competitiveAdvantages || "",
        marketing_expectations: body.marketingExpectations || ""
      };

      // Проверяем, существует ли уже анкета для этой кампании
      const checkResponse = await directusApi.get('/items/business_questionnaire', {
        params: { filter: JSON.stringify({ campaign_id: { _eq: campaignId } }) },
        headers: { 'Authorization': `Bearer ${token}` }
      });

      let response;
      if (checkResponse.data.data && checkResponse.data.data.length > 0) {
        // Обновляем существующую
        const existingId = checkResponse.data.data[0].id;
        response = await directusApi.patch(`/items/business_questionnaire/${existingId}`, questionnaireData, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } else {
        // Создаем новую
        response = await directusApi.post('/items/business_questionnaire', questionnaireData, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
      }
      
      res.status(201).json({ success: true, data: response.data.data });
    } catch (error: any) {
      console.error("[QUESTIONNAIRE_POST] Error:", error.response?.data || error.message);
      res.status(500).json({ error: "Failed to save questionnaire" });
    }
  });

  // Маршрут для анализа сайта и заполнения анкеты
  app.post(["/api/analyze-site", "/api/website-analysis"], authenticateUser, async (req: Request, res: Response) => {
    try {
      console.log("[AnalyzeSite] Request body:", JSON.stringify(req.body));
      const { url, campaignId } = req.body;
      const token = req.user?.token;
      const userId = req.user?.id;

      if (!url) return res.status(400).json({ error: "URL обязателен" });
      if (!campaignId) {
        console.error("[AnalyzeSite] Missing campaignId in request body");
        return res.status(400).json({ error: "campaignId обязателен" });
      }

      log(`[AnalyzeSite] Starting analysis for ${url} (Campaign: ${campaignId})`, 'info');

      // 1. Парсинг сайта (сначала пробуем Puppeteer, если не выйдет - Axios)
      let websiteContent = "";
      let crawlFailed = false;
      try {
        const crawlResult = await webCrawlerAgent.crawlSite({ url });
        if (crawlResult.success && crawlResult.text) {
          websiteContent = crawlResult.text;
        } else {
          console.warn(`[AnalyzeSite] Puppeteer failed, falling back to Axios: ${crawlResult.error}`);
          websiteContent = await extractFullSiteContent(url);
        }
      } catch (e: any) {
        console.warn(`[AnalyzeSite] Error during crawling, falling back to Axios: ${e.message}`);
        try {
          websiteContent = await extractFullSiteContent(url);
        } catch (axiosErr: any) {
          console.warn(`[AnalyzeSite] Axios fallback also failed: ${axiosErr.message}`);
        }
      }

      if (!websiteContent || websiteContent.includes("Ошибка загрузки сайта")) {
        console.warn(`[AnalyzeSite] Could not load site content for ${url}, using URL as context`);
        websiteContent = `Сайт: ${url}. Контент недоступен — используйте URL для извлечения базовой информации о компании.`;
        crawlFailed = true;
      }

      // 2. AI анализ с четким промптом для получения нужных полей
      const analysisPrompt = `Проанализируй содержимое веб-страницы и извлеки следующую информацию.
      Ты ОБЯЗАН выдать JSON строго с этими 13 полями:
      1. companyName - Название компании
      2. contactInfo - Контактная информация (email, телефон, адрес)
      3. businessDescription - Описание бизнеса (подробно)
      4. mainActivities - Основные направления деятельности (список услуг или направлений, не оставлять пустым!)
      5. brandImage - Имидж бренда (стиль, ценности)
      6. productsServices - Перечень товаров и услуг
      7. targetAudience - Описание целевой аудитории
      8. customerResults - Результаты и выгоды для клиентов
      9. companyFeatures - Уникальные особенности компании
      10. businessValues - Основные ценности бизнеса
      11. productBeliefs - Убеждения о продукте/услуге
      12. competitiveAdvantages - Конкурентные преимущества (USP)
      13. marketingExpectations - Цели и ожидания от маркетинга

      ВАЖНО: Постарайся найти максимум информации. Если информации на сайте абсолютно точно нет, напиши "Не найдено" для этого поля. Не оставляй поля пустыми и не пропускай их.
      Верни результат СТРОГО в формате JSON без лишнего текста.`;

      let analysis: any = {};
      try {
        const analysisResultRaw = await aiService.generateContent({
          prompt: analysisPrompt + `\n\nТекст страницы для анализа:\n${websiteContent.substring(0, 15000)}`,
          model: 'deepseek-chat',
          service: 'deepseek',
          userId,
          token
        });
        try {
          const cleanResult = analysisResultRaw.content.replace(/```json/g, '').replace(/```/g, '').trim();
          const jsonMatch = cleanResult.match(/\{[\s\S]*\}/);
          analysis = JSON.parse(jsonMatch ? jsonMatch[0] : cleanResult);
        } catch (e) {
          console.warn("[AnalyzeSite] Failed to parse AI JSON, using raw content");
          analysis = { businessDescription: analysisResultRaw.content };
        }
        console.log("[AnalyzeSite] AI Analysis Result:", JSON.stringify(analysis).substring(0, 500) + "...");
      } catch (aiError: any) {
        console.warn(`[AnalyzeSite] AI call failed: ${aiError.message}. Proceeding with empty analysis.`);
        analysis = {};
      }

      // Helper to ensure value is string
      const ensureString = (val: any): string => {
        if (Array.isArray(val)) return val.join(', ');
        if (typeof val === 'object' && val !== null) return JSON.stringify(val);
        return String(val || "Не найдено");
      };

      // 3. Подготовка данных для анкеты (snake_case для Directus)
      const questionnaireData: any = {
        campaign_id: campaignId,
        user_id: userId,
        company_name: ensureString(analysis.companyName),
        contact_info: ensureString(analysis.contactInfo),
        business_description: ensureString(analysis.businessDescription),
        main_directions: ensureString(analysis.mainActivities),
        brand_image: ensureString(analysis.brandImage),
        products_services: ensureString(analysis.productsServices),
        target_audience: ensureString(analysis.targetAudience),
        customer_results: ensureString(analysis.customerResults),
        company_features: ensureString(analysis.companyFeatures),
        business_values: ensureString(analysis.businessValues),
        product_beliefs: ensureString(analysis.productBeliefs),
        competitive_advantages: ensureString(analysis.competitiveAdvantages),
        marketing_expectations: ensureString(analysis.marketingExpectations)
      };

      // 4. Сохранение/Обновление в БД
      // Используем adminTokenManager вместо пользовательского токена —
      // user token может истечь за время долгого AI-вызова (30-60с)
      console.log(`[AnalyzeSite] Step 4: Saving to DB (Campaign: ${campaignId})...`);
      let savedData: any = null;
      try {
        const dbToken = await adminTokenManager.getAdminToken() || token;

        const checkResponse = await directusApi.get('/items/business_questionnaire', {
          params: { filter: JSON.stringify({ campaign_id: { _eq: campaignId } }) },
          headers: { 'Authorization': `Bearer ${dbToken}` }
        });

        if (checkResponse.data.data && checkResponse.data.data.length > 0) {
          const existingId = checkResponse.data.data[0].id;
          console.log(`[AnalyzeSite] Updating existing questionnaire ${existingId}...`);
          const updateResponse = await directusApi.patch(`/items/business_questionnaire/${existingId}`, questionnaireData, {
            headers: { 'Authorization': `Bearer ${dbToken}` }
          });
          savedData = updateResponse.data.data;
        } else {
          console.log(`[AnalyzeSite] Creating new questionnaire...`);
          const createResponse = await directusApi.post('/items/business_questionnaire', questionnaireData, {
            headers: { 'Authorization': `Bearer ${dbToken}` }
          });
          savedData = createResponse.data.data;
        }
      } catch (dbError: any) {
        console.warn(`[AnalyzeSite] DB save failed: ${dbError.response?.status} ${dbError.message}. Returning AI data without DB persistence.`);
        savedData = { ...questionnaireData, id: null };
      }

      console.log(`[AnalyzeSite] Step 5: Mapping result...`);
      // 5. Возвращаем данные в формате camelCase для фронтенда
      const mappedResult = {
        companyName: savedData.company_name,
        contactInfo: savedData.contact_info,
        businessDescription: savedData.business_description,
        mainDirections: savedData.main_directions,
        mainActivities: savedData.main_directions,
        brandImage: savedData.brand_image,
        productsServices: savedData.products_services,
        targetAudience: savedData.target_audience,
        customerResults: savedData.customer_results,
        companyFeatures: savedData.company_features,
        businessValues: savedData.business_values,
        productBeliefs: savedData.product_beliefs,
        competitiveAdvantages: savedData.competitive_advantages || savedData.unique_selling_proposition,
        marketingExpectations: savedData.marketing_expectations,
        id: savedData.id,
        campaignId: savedData.campaign_id,
        ...(crawlFailed && { warning: 'Сайт недоступен, анализ выполнен по URL' })
      };

      console.log(`[AnalyzeSite] Analysis completed for ${campaignId} (crawlFailed=${crawlFailed})`);
      res.json({
        success: true,
        data: mappedResult
      });

    } catch (error: any) {
      console.error("[ANALYZE_SITE] Critical Error:", error.response?.data || error.message);
      res.status(500).json({ error: `Ошибка анализа сайта: ${error.message}` });
    }
  });

  // Маршрут для обновления анкеты
  app.patch("/api/campaigns/:campaignId/questionnaire/:id", authenticateUser, async (req: any, res) => {
    try {
      const { id } = req.params;
      const token = req.user?.token;
      
      const body = req.body;
      
      // Маппинг из фронтенда (camelCase) в Directus (snake_case)
      const updates: any = {};
      if (body.companyName !== undefined) updates.company_name = body.companyName;
      if (body.contactInfo !== undefined) updates.contact_info = body.contactInfo;
      if (body.businessDescription !== undefined) updates.business_description = body.businessDescription;
      if (body.mainActivities !== undefined) {
        updates.main_directions = body.mainActivities;
      }
      if (body.brandImage !== undefined) updates.brand_image = body.brandImage;
      if (body.productsServices !== undefined) updates.products_services = body.productsServices;
      if (body.targetAudience !== undefined) updates.target_audience = body.targetAudience;
      if (body.customerResults !== undefined) updates.customer_results = body.customerResults;
      if (body.companyFeatures !== undefined) updates.company_features = body.companyFeatures;
      if (body.businessValues !== undefined) updates.business_values = body.businessValues;
      if (body.productBeliefs !== undefined) updates.product_beliefs = body.productBeliefs;
      if (body.competitiveAdvantages !== undefined) {
        updates.competitive_advantages = body.competitiveAdvantages;
        updates.unique_selling_proposition = body.competitiveAdvantages;
      }
      if (body.marketingExpectations !== undefined) updates.marketing_expectations = body.marketingExpectations;
      
      const response = await directusApi.patch(`/items/business_questionnaire/${id}`, updates, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      res.json({ success: true, data: response.data.data });
    } catch (error: any) {
      console.error("[QUESTIONNAIRE_PATCH] Error:", error.response?.data || error.message);
      res.status(500).json({ error: "Failed to update questionnaire" });
    }
  });

  // Админский роут для удаления дубликатов
  app.delete("/api/admin/sources/remove-duplicates", authenticateUser, async (req: any, res) => {
    try {
      const isAdmin = await isUserAdmin(req);
      if (!isAdmin) return res.status(403).json({ error: "Доступ запрещен" });
      
      res.json({ success: true, message: "Duplicates removed" });
    } catch (error) {
      res.status(500).json({ error: "Failed to remove duplicates" });
    }
  });

  // Генерация промта ассистента на основе конфигуратора
  app.post('/api/campaigns/:campaignId/generate-assistant-prompt', authenticateUser, async (req, res) => {
    try {
      const { campaignId } = req.params;
      const token = req.user?.token;
      const userId = req.user?.id;
      const {
        role, experience, knowledge = [], skills = [],
        tone, postLength, contentMix
      } = req.body;

      if (!role) return res.status(400).json({ error: 'role is required' });

      // Берём ЦА и описание бизнеса из уже заполненной анкеты кампании
      let campaignAudience = 'широкая аудитория';
      let campaignBusinessContext = '';
      try {
        const { directusCrud } = await import('../services/directus-crud');
        const camp = await directusCrud.getById('user_campaigns', campaignId);
        if (camp?.target_audience) campaignAudience = camp.target_audience;
        if (camp?.business_description) campaignBusinessContext = camp.business_description;
      } catch { /* не критично — используем дефолты */ }

      const knowledgeStr = knowledge.length ? knowledge.join(', ') : 'не указано';
      const skillsStr = skills.length ? skills.join(', ') : 'не указано';
      const mixStr = contentMix
        ? `${contentMix.educational}% обучающий, ${contentMix.entertaining}% развлекательный, ${contentMix.selling}% продающий`
        : '33% обучающий, 33% развлекательный, 33% продающий';

      const builderPrompt = `Ты — эксперт по созданию AI-промтов для контент-менеджеров. Сгенерируй детальный системный промт для AI-ассистента, который создаёт посты для социальных сетей.

ПАРАМЕТРЫ АССИСТЕНТА:
- Роль: ${role}
- Опыт: ${experience || 'не указан'}
- Специализация/знания: ${knowledgeStr}
- Навыки: ${skillsStr}

ПАРАМЕТРЫ КОНТЕНТА:
- Тон: ${tone || 'не задан'}
- Целевая аудитория: ${campaignAudience}
- Длина постов: ${postLength || 'смешанная'}
- Микс контента: ${mixStr}

${campaignBusinessContext ? `КОНТЕКСТ БИЗНЕСА:\n${campaignBusinessContext}\n` : ''}

ТРЕБОВАНИЯ К ПРОМТУ (соблюдать строго):
1. Начни с "Ты — ${role}" и укажи опыт
2. Опиши целевую аудиторию: кто эти люди, их боли и желания
3. Укажи тон и стиль: как именно писать, что допустимо, что нет
4. Опиши структуру идеального поста (зацепка → развитие → CTA)
5. Дай 5–7 тем для ротации с учётом миксa контента
6. Блок ЗАПРЕЩЕНО: клише, шаблонные фразы, стилистические ошибки

Верни ТОЛЬКО текст промта — без заголовков, без объяснений, без markdown.`;

      const result = await aiService.generateContent({
        prompt: builderPrompt,
        model: 'gemini-2.5-flash',
        service: 'gemini',
        userId: userId || '',
        token: token || ''
      });

      const generatedPrompt = (result.content || '').trim();
      if (!generatedPrompt || generatedPrompt.length < 100) {
        return res.status(500).json({ error: 'Не удалось сгенерировать промт, попробуйте ещё раз' });
      }

      res.json({ success: true, prompt: generatedPrompt });
    } catch (error: any) {
      console.error('[generate-assistant-prompt] error:', error.message);
      res.status(500).json({ error: error.message || 'Ошибка генерации промта' });
    }
  });

  // GET /api/campaigns/:campaignId/instagram-settings регистрируется в routes/analytics.ts —
  // идентичная копия, которая была здесь, никогда не достигалась (Express берёт первый совпавший).

  // === Content Style Analysis ===

  app.post('/api/campaigns/:campaignId/analyze-style', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const { posts } = req.body;
      const userId = req.user?.id;
      const token = req.user?.token;

      if (!userId || !token) return res.status(401).json({ error: 'Не авторизован' });

      if (!posts || typeof posts !== 'string' || posts.length < 50) {
        return res.status(400).json({ error: 'Минимум 50 символов текста для анализа' });
      }

      // Smart sampling: if content exceeds limit, take representative sample
      const MAX_CHARS = 50000;
      let sampledPosts = posts;
      if (posts.length > MAX_CHARS) {
        const third = Math.floor(MAX_CHARS / 3);
        const mid = Math.floor(posts.length / 2);
        const start = posts.slice(0, third);
        const middle = posts.slice(mid - Math.floor(third / 2), mid + Math.floor(third / 2));
        const end = posts.slice(-third);
        sampledPosts = [start, middle, end].join('\n\n---\n\n');
        console.log(`[ContentStyle] Контент обрезан: ${posts.length} → ${sampledPosts.length} символов`);
      }

      console.log(`[ContentStyle] Анализ стиля для кампании ${campaignId}, длина текста: ${sampledPosts.length}`);

      const analysisPrompt = `Проанализируй стиль написания постов для социальных сетей.
Опиши максимально конкретно, чтобы другой автор мог писать в таком же стиле.

ПОСТЫ ДЛЯ АНАЛИЗА:
${sampledPosts}

Верни ТОЛЬКО JSON без markdown-обертки (без \`\`\`json):
{
  "tone": "тон и настроение постов",
  "vocabulary": "уровень лексики, типичные слова",
  "sentenceStructure": "длина предложений, структура абзацев",
  "emojiUsage": "как используются эмодзи, какие именно",
  "formattingPatterns": "как оформлен текст, переносы, списки",
  "hashtagStyle": "хештеги: количество, язык, расположение",
  "callToAction": "призывы к действию, вовлечение",
  "averagePostLength": "средняя длина поста",
  "distinctiveFeatures": "уникальные особенности, фирменный стиль"
}

Описывай на том же языке что и посты. Приводи конкретные примеры из текста.`;

      const result = await aiService.generateContent({
        prompt: analysisPrompt,
        model: 'gemini-2.5-flash',
        service: 'gemini',
        userId,
        token,
      });

      const rawContent = (result.content || '').trim();
      let styleData: Record<string, string>;

      // Try multiple extraction strategies for JSON from AI response
      const extractJson = (text: string): Record<string, string> | null => {
        // Strategy 1: direct parse
        try { return JSON.parse(text); } catch {}

        // Strategy 2: strip markdown code blocks
        const noMarkdown = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        try { return JSON.parse(noMarkdown); } catch {}

        // Strategy 3: find first { to last }
        const firstBrace = noMarkdown.indexOf('{');
        const lastBrace = noMarkdown.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          try { return JSON.parse(noMarkdown.slice(firstBrace, lastBrace + 1)); } catch {}
        }

        return null;
      };

      styleData = extractJson(rawContent);
      if (!styleData) {
        console.error(`[ContentStyle] AI returned non-JSON (first 500 chars): ${rawContent.substring(0, 500)}`);
        return res.status(500).json({ error: 'AI вернул некорректный результат, попробуйте ещё раз' });
      }

      const contentStyle = {
        analyzedAt: new Date().toISOString(),
        rawPostCount: (sampledPosts.split(/\n\s*\n/).filter((p: string) => p.trim()).length),
        style: styleData,
        samplePosts: sampledPosts.substring(0, 500),
      };

      try {
        await directusApi.patch(`/items/user_campaigns/${campaignId}`, { content_style: contentStyle }, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        log(`[ContentStyle] Стиль сохранён для кампании ${campaignId}`, 'info');
      } catch (saveErr: any) {
        log(`[ContentStyle] Ошибка сохранения для кампании ${campaignId}: ${saveErr.message}`, 'error');
        // Fallback: try with admin token
        try {
          const adminToken = await adminTokenManager.getAdminToken();
          await directusApi.patch(`/items/user_campaigns/${campaignId}`, { content_style: contentStyle }, {
            headers: { 'Authorization': `Bearer ${adminToken}` },
          });
          log(`[ContentStyle] Стиль сохранён через admin token для кампании ${campaignId}`, 'info');
        } catch (adminErr: any) {
          log(`[ContentStyle] Admin save also failed: ${adminErr.message}`, 'error');
          return res.status(500).json({ error: 'Не удалось сохранить стиль' });
        }
      }

      res.json({ success: true, style: contentStyle });
    } catch (error: any) {
      console.error('[analyze-style] error:', error.message);
      res.status(500).json({ error: error.message || 'Ошибка анализа стиля' });
    }
  });

  app.delete('/api/campaigns/:campaignId/content-style', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const userId = req.user?.id;
      const token = req.user?.token;

      if (!userId || !token) return res.status(401).json({ error: 'Не авторизован' });

      await directusApi.patch(`/items/user_campaigns/${campaignId}`, { content_style: null }, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error('[delete-content-style] error:', error.message);
      res.status(500).json({ error: error.message || 'Ошибка удаления стиля' });
    }
  });
}

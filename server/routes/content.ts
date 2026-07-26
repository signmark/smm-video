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
        ...(summary ? { fields: ['id', 'status', 'scheduled_at', 'published_at', 'created_at', 'campaign_id'] } : {})
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
              status: item.status,
              createdAt: item.created_at,
              scheduledAt: item.scheduled_at,
              publishedAt: item.published_at,
            }))
          : responseData.map((item: any) => {
          try {
            return {
              id: item.id,
              campaignId: item.campaign_id,
              userId: item.user_id,
              title: item.title,
              content: item.content,
              contentType: item.content_type,
              imageUrl: item.image_url,
              additionalImages: Array.isArray(item.additional_images) ? item.additional_images : [],
              additionalMedia: item.additional_media || [],
              videoThumbnail: Array.isArray(item.additional_images) && item.additional_images.length > 0 && 
                              (item.content_type === 'video' || item.content_type === 'video-text') 
                              ? item.additional_images[0] : '',
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
              metadata: item.metadata || {}
            };
          } catch (mapError: any) {
            console.error(`❌ [API] Error mapping item ${item.id}:`, mapError.message);
            return null;
          }
        }).filter(Boolean);
        
        const responseBody = {
          data: contentItems,
          meta: {
            // filter_count, а не total_count: второй считает всю коллекцию целиком,
            // игнорируя фильтр по кампании и пользователю. На проде это 1781 против
            // 487 реальных — клиенту нельзя показывать такое число.
            total: meta.filter_count ?? meta.total_count ?? contentItems.length,
            page,
            limit,
            // totalPages тоже считаем от filter_count: total_count — размер всей
            // коллекции без учёта фильтра (1781 против 487), иначе страниц выйдет
            // втрое больше реальных.
            totalPages: limit > 0 ? Math.ceil((meta.filter_count ?? meta.total_count ?? contentItems.length) / limit) : 1
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
      // Первая буква заголовка — заглавная
      if (data.title) data.title = data.title.charAt(0).toUpperCase() + data.title.slice(1);
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
      res.status(error.response?.status || 500).json({ 
        error: "Failed to create content",
        details: error.response?.data?.errors?.[0]?.message || error.message
      });
    }
  });

  // GET /api/campaign-content/:id
  app.get("/api/campaign-content/:id", authenticateUser, async (req, res) => {
    try {
      const { id } = req.params;
      const token = req.user?.token;
      const response = await directusApi.get(`/items/campaign_content/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      res.json({ data: response.data.data });
    } catch (error) {
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
      if (data.title) data.title = data.title.charAt(0).toUpperCase() + data.title.slice(1);
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
      if (data.title) data.title = data.title.charAt(0).toUpperCase() + data.title.slice(1);
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
      try {
        const campaignId = contentItem.campaign_id;
        if (campaignId) {
          const campaign = await directusCrud.getById('campaigns', campaignId);
          if (campaign?.autonomous_settings) {
            const raw = campaign.autonomous_settings;
            autoSettings = typeof raw === 'string' ? JSON.parse(raw) : raw;
          }
        }
      } catch (_) {}

      const styleBlock = autoSettings.globalPrompt
        ? `\nСТИЛЬ И ТОН (обязательно):\n${autoSettings.globalPrompt}\n` : `
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

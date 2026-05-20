import { Express, Request, Response } from 'express';
import { authenticateUser } from '../middleware/user-auth';
import { directusApi } from '../directus';
import { directusCrud } from '../services/directus-crud';
import { log } from '../utils/logger';
import axios from 'axios';
import { geminiVertexDirect } from '../services/gemini-vertex-direct';
import { DeepSeekService } from '../services/deepseek';
import { apiKeyService, ApiServiceName } from '../services/api-keys';
import { globalApiKeysService } from '../services/global-api-keys';

async function analyzeSentimentWithAI(comments: any[]): Promise<Record<string, any>> {
  if (comments.length === 0) {
    return {
      sentiment: 'neutral',
      confidence: 0,
      details: { positive: 0, negative: 0, neutral: 100 },
      summary: 'Комментарии отсутствуют',
      themes: [],
      analyzed_at: new Date().toISOString(),
      analysisMethod: 'ai',
    };
  }

  const commentTexts = comments
    .map((c: any) => (c.text || c.content || '').trim())
    .filter((t: string) => t.length > 0)
    .slice(0, 200);

  if (commentTexts.length === 0) {
    return {
      sentiment: 'neutral',
      confidence: 0,
      details: { positive: 0, negative: 0, neutral: 100 },
      summary: 'Комментарии не содержат текста',
      themes: [],
      analyzed_at: new Date().toISOString(),
      analysisMethod: 'ai',
    };
  }

  const prompt = `Ты — эксперт по анализу тональности комментариев в социальных сетях. Проанализируй следующие ${commentTexts.length} комментариев и верни JSON.

Комментарии:
${commentTexts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n')}

Верни ТОЛЬКО валидный JSON без markdown-обёрток, без \`\`\`json, строго в формате:
{
  "sentiment": "positive" | "negative" | "neutral",
  "score": число от 0 до 10 (0 = максимально негативный, 10 = максимально позитивный),
  "confidence": число от 0 до 100 (уверенность в анализе),
  "positive_percentage": число от 0 до 100,
  "negative_percentage": число от 0 до 100,
  "neutral_percentage": число от 0 до 100,
  "themes": ["тема1", "тема2", "тема3"],
  "summary": "Краткое описание общего настроения аудитории на русском языке, 2-3 предложения"
}

Важно:
- positive_percentage + negative_percentage + neutral_percentage = 100
- themes — основные темы обсуждения (3-5 штук)
- summary должен быть информативным и содержательным
- Учитывай сарказм, эмодзи, сленг`;

  try {
    const aiResponse = await geminiVertexDirect.generateContent({
      prompt,
      model: 'gemini-3-pro-preview'
    });

    const cleanJson = aiResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleanJson);

    return {
      sentiment: parsed.sentiment || 'neutral',
      confidence: parsed.confidence || 50,
      score: parsed.score ?? 5,
      average_score: parsed.score ?? 5,
      details: {
        positive: parsed.positive_percentage || 0,
        negative: parsed.negative_percentage || 0,
        neutral: parsed.neutral_percentage || 0,
      },
      positive_percentage: parsed.positive_percentage || 0,
      negative_percentage: parsed.negative_percentage || 0,
      neutral_percentage: parsed.neutral_percentage || 0,
      themes: parsed.themes || [],
      summary: parsed.summary || `Проанализировано ${commentTexts.length} комментариев с помощью ИИ.`,
      analyzed_at: new Date().toISOString(),
      analysisMethod: 'ai',
      commentsAnalyzed: commentTexts.length,
    };
  } catch (err: any) {
    log(`[Sentiment AI] ⚠️ Ошибка AI анализа: ${err.message}. Fallback на базовый анализ.`, 'warn');
    return analyzeSentimentFallback(comments);
  }
}

function analyzeSentimentFallback(comments: any[]): Record<string, any> {
  const positiveKeywords = [
    'отличн', 'великолепн', 'замечательн', 'прекрасн', 'хорош', 'позитивн',
    'нравится', 'доволен', 'молодц', 'спасибо', 'класс', 'супер', 'интересн', 'полезн'
  ];
  const negativeKeywords = [
    'плох', 'ужасн', 'негативн', 'проблем', 'опасн', 'разочарован',
    'неприятн', 'ошибк', 'сломан', 'не работает', 'против', 'недоволен'
  ];

  let positive = 0, negative = 0, neutral = 0;
  for (const comment of comments) {
    const text = (comment.text || comment.content || '').toLowerCase();
    const isPositive = positiveKeywords.some(kw => text.includes(kw));
    const isNegative = negativeKeywords.some(kw => text.includes(kw));
    if (isPositive && !isNegative) positive++;
    else if (isNegative && !isPositive) negative++;
    else neutral++;
  }

  const total = comments.length || 1;
  const posPercent = Math.round((positive / total) * 100);
  const negPercent = Math.round((negative / total) * 100);
  const neuPercent = 100 - posPercent - negPercent;
  const overallSentiment = posPercent > negPercent && posPercent > neuPercent ? 'positive' : negPercent > posPercent ? 'negative' : 'neutral';

  return {
    sentiment: overallSentiment,
    confidence: Math.max(posPercent, negPercent, neuPercent),
    details: { positive: posPercent, negative: negPercent, neutral: neuPercent },
    positive_percentage: posPercent,
    negative_percentage: negPercent,
    neutral_percentage: neuPercent,
    summary: `Проанализировано ${comments.length} комментариев (резервный метод).`,
    analyzed_at: new Date().toISOString(),
    analysisMethod: 'ai',
  };
}

/**
 * Получает внутренний URL n8n для Docker-сети
 * В production используем внутренний адрес контейнера, в dev - внешний
 */
function getN8nWebhookUrl(webhookPath: string): string {
  const isDocker = process.env.DOCKER_ENV === 'true';
  const isProduction = process.env.NODE_ENV === 'production';

  // В Docker production используем внутренний URL
  if (isDocker && isProduction) {
    const internalUrl = process.env.N8N_INTERNAL_URL || 'http://n8n:5678';
    return `${internalUrl}/webhook/${webhookPath}`;
  }

  // В dev или без Docker - используем env переменную или внешний URL
  const { getN8nUrl } = require('../utils/n8n-utils');
  const externalUrl = getN8nUrl();
  return `${externalUrl}/webhook/${webhookPath}`;
}

export function registerTrendsRoutes(app: Express) {
  log('[Trends Routes] 🚀 Регистрация маршрутов сбора трендов', 'info');

  /**
   * Запуск сбора трендов
   */
  app.post("/api/trends/collect", authenticateUser, async (req: Request, res: Response) => {
    try {
      const { campaignId, platforms, collectSources, collectComments, sourcesList, keywords } = req.body;
      const userId = req.user?.id;

      log(`[Trends Route] Запуск сбора трендов для кампании ${campaignId} от пользователя ${userId}`, 'info');
      console.log(`[Trends Route] Request body:`, JSON.stringify(req.body, null, 2));

      if (!campaignId) {
        return res.status(400).json({ success: false, error: 'campaignId обязателен' });
      }

      const authToken = req.user?.token || process.env.DIRECTUS_ADMIN_TOKEN || '';

      // Читаем настройки анализа трендов из кампании
      let campaignTrendSettings: Record<string, any> = {};
      try {
        const campaign = await directusCrud.getById<any>('user_campaigns', campaignId, { useAdminToken: true });
        const ts = campaign?.trend_analysis_settings;
        if (ts && typeof ts === 'object') {
          campaignTrendSettings = ts;
        }
      } catch (e: any) {
        log(`[Trends Route] Не удалось получить trend_analysis_settings для ${campaignId}: ${e.message}`, 'warn');
      }

      // Параметры: настройки кампании → перекрываются явными значениями из req.body
      const collectionDays = req.body.collectionDays ?? req.body.day_past ?? campaignTrendSettings.collectionDays ?? 7;
      const minViews = req.body.minViews ?? campaignTrendSettings.minViews ?? 500;
      const maxTrendsPerSource = req.body.maxTrendsPerSource ?? campaignTrendSettings.maxTrendsPerSource ?? 5;
      const maxSourcesPerPlatform = req.body.maxSourcesPerPlatform ?? campaignTrendSettings.maxSourcesPerPlatform ?? 10;
      const minFollowers = req.body.minFollowers ?? campaignTrendSettings.minFollowers ?? {
        instagram: 5000,
        telegram: 2000,
        vk: 3000,
        facebook: 5000,
        youtube: 10000
      };
      const postsPerPlatform = maxTrendsPerSource;

      // Вызываем N8N webhook (основной механизм сбора трендов)
      const n8nWebhookUrl = process.env.N8N_TRENDS_COLLECT_WEBHOOK || getN8nWebhookUrl('collect-trends');
      const n8nPayload = {
        ...req.body,
        campaignId,
        userID: userId,
        collectionDays,
        day_past: collectionDays,
        minViews,
        maxTrendsPerSource,
        maxSourcesPerPlatform,
        minFollowers
      };
      log(`[Trends Route] 📤 Отправка запроса на N8N вебхук: ${n8nWebhookUrl}`, 'info');
      axios.post(n8nWebhookUrl, n8nPayload, {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' }
      }).then(() => {
        log(`[Trends Route] ✅ N8N вебхук collect-trends вызван успешно`, 'info');
      }).catch((err: any) => {
        log(`[Trends Route] ⚠️ Ошибка N8N вебхука collect-trends: ${err.message}. Запускаем прямой сбор.`, 'error');
        // Fallback: прямой сбор через scraper если n8n недоступен
        (async () => {
          try {
            const { collectTrendsForCampaign } = await import('../services/trend-collector');
            const result = await collectTrendsForCampaign({
              campaignId,
              userId: userId!,
              authToken,
              postsPerPlatform,
              daysSince: collectionDays
            });
            log(`[Trends Route] ✅ Fallback сбор завершён: TG=${result.telegram}, VK=${result.vk}, YT=${result.youtube}, IG=${result.instagram}, total=${result.total}`, 'info');
          } catch (err2: any) {
            log(`[Trends Route] ❌ Ошибка fallback сбора: ${err2.message}`, 'error');
          }
        })();
      });

      res.json({
        success: true,
        message: 'Сбор трендов запущен',
        campaignId
      });
    } catch (error: any) {
      log(`[Trends Route] Ошибка при запуске сбора трендов: ${error.message}`, 'error');
      res.status(500).json({ success: false, error: "Ошибка при запуске сбора трендов" });
    }
  });

  /**
   * Вызов нашего API сбора постов (трендов) Telegram (217.26.25.95)
   */
  async function callTelegramTrendsCollectDirect(keywords: string[], channels: string[], campaignId: string): Promise<boolean> {
    const apiKey = await globalApiKeysService.getGlobalApiKey(ApiServiceName.TELEGRAM_COLLECT_COMMENTS);
    if (!apiKey) {
      log(`[Telegram Trends] API key for telegram_collect_comments not found`, 'error');
      return false;
    }

    const getBaseUrl = () => {
      if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
      let url = process.env.API_BASE_URL || process.env.PUBLIC_URL || process.env.APP_URL || 'https://smm.omemo.tech';
      url = url.replace(/\/$/, '');
      if (process.env.NODE_ENV === 'production' && !url.startsWith('http')) {
        url = `https://${url}`;
      }
      return url;
    };

    const baseUrl = getBaseUrl();
    const callback_url = `${baseUrl}/api/trends/collect-trends-callback`;
    const externalApiUrl = 'http://217.26.25.95:3030/api/telegram/trending-posts';

    const requestPayload = {
      channel_ids: channels || [],
      limit: 50,
      days_back: 7,
      min_views: 100,
      download_media: false,
      async_mode: true,
      callback_url,
      metadata: {
        campaignId: String(campaignId)
      }
    };

    log.warn(`[Telegram Trends] 📤 Sending direct trends request to ${externalApiUrl}\nPayload: ${JSON.stringify(requestPayload, null, 2)}`, 'telegram-collect');

    try {
      const response = await axios.post(externalApiUrl, requestPayload, {
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        timeout: 15000
      });
      log.warn(`[Telegram Trends] 📥 Direct API response: ${response.status}\nData: ${JSON.stringify(response.data, null, 2)}`, 'telegram-collect');
      return true;
    } catch (err: any) {
      log(`[Telegram Trends] Error for campaign ${campaignId}: ${err.message}`, 'error');
      if (err.response) {
        log(`[Telegram Trends] API Error Response: ${JSON.stringify(err.response.data)}`, 'error');
      }
      return false;
    }
  }

  /**
   * Callback для сбора постов (трендов) Telegram
   */
  app.post("/api/trends/collect-trends-callback", async (req: Request, res: Response) => {
    try {
      const { posts, metadata } = req.body;
      const campaignId = metadata?.campaignId;

      log.warn(`[Telegram Trends Callback] 📥 Received callback for campaign ${campaignId}\nBody: ${JSON.stringify(req.body, null, 2)}`, 'telegram-collect');

      if (!campaignId || !posts || !Array.isArray(posts)) {
        log(`[Telegram Trends Callback] ❌ Missing campaignId or posts array`, 'error');
        return res.status(400).json({ success: false, error: "Invalid callback payload" });
      }

      log(`[Telegram Trends Callback] Processing ${posts.length} posts for campaign ${campaignId}`, 'info');

      for (const post of posts) {
        try {
          // Строим URL отдельного поста Telegram (не канала)
          const buildTelegramPostUrl = (p: any): string => {
            const base = p.url || p.link || '';
            // Если уже содержит ID поста (https://t.me/channel/12345), используем как есть
            if (/t\.me\/.+\/\d+/.test(base)) return base;
            // Иначе пробуем добавить ID сообщения
            const msgId = p.id || p.message_id || p.post_id;
            if (msgId && base.includes('t.me/')) {
              return `${base.replace(/\/$/, '')}/${msgId}`;
            }
            return base;
          };

          // Сохраняем пост как тренд в Directus
          const topicData = {
            title: post.text?.substring(0, 100) || 'Telegram Post',
            sourceType: 'Telegram Direct',
            urlPost: buildTelegramPostUrl(post),
            reactions: post.reactions_count || post.reactions?.total_count || 0,
            comments: post.comments_count || 0,
            views: post.views_count || 0,
            is_bookmarked: false,
            campaign_id: String(campaignId),
            description: post.text || null,
            raw_source_data: post
          };

          await directusCrud.create('campaign_trend_topics', topicData, { useAdminToken: true });
        } catch (saveErr: any) {
          log(`[Telegram Trends Callback] Error saving post ${post.url || post.link}: ${saveErr.message}`, 'error');
        }
      }

      res.json({ success: true, processed: posts.length });
    } catch (error: any) {
      log(`[Telegram Trends Callback] Critical error: ${error.message}`, 'error');
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * Вызов нашего API сбора комментариев Telegram (217.26.25.95)
   */
  async function callTelegramCollectDirect(postUrl: string): Promise<boolean> {
    const apiKey = await globalApiKeysService.getGlobalApiKey(ApiServiceName.TELEGRAM_COLLECT_COMMENTS);
    if (!apiKey) {
      log(`[Telegram Collect] API key for telegram_collect_comments not found`, 'error');
      return false;
    }
    // Определяем базовый URL для callback (аналогично логике в telegram-bot/index.ts)
    const getBaseUrl = () => {
      if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
      let url = process.env.API_BASE_URL || process.env.PUBLIC_URL || process.env.APP_URL || 'https://smm.omemo.tech';
      url = url.replace(/\/$/, '');
      if (process.env.NODE_ENV === 'production' && !url.startsWith('http')) {
        url = `https://${url}`;
      }
      return url;
    };

    const baseUrl = getBaseUrl();
    const callback_url = `${baseUrl}/api/trends/collect-comments-callback`;
    const externalApiUrl = 'http://217.26.25.95:3030/api/telegram/collect-comments';

    const requestPayload = {
      post_url: postUrl,
      limit: 1000,
      download_media: false,
      async_mode: true,
      callback_url
    };

    log.warn(`[Telegram Collect] 📤 Sending direct request to ${externalApiUrl}\nPayload: ${JSON.stringify(requestPayload, null, 2)}`, 'telegram-collect');

    try {
      const response = await axios.post(externalApiUrl, requestPayload, {
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        timeout: 10000
      });
      log.warn(`[Telegram Collect] 📥 Direct API response: ${response.status}\nData: ${JSON.stringify(response.data, null, 2)}`, 'telegram-collect');
      return true;
    } catch (err: any) {
      log(`[Telegram Collect] Error for ${postUrl}: ${err.message}`, 'error');
      return false;
    }
  }

  /**
   * Запуск сбора комментариев для трендов.
   * Telegram всегда собирается на нашей стороне (217.26.25.95), остальные источники — через N8N.
   */
  app.post("/api/trends/collect-comments", authenticateUser, async (req: Request, res: Response) => {
    try {
      const { trendIds, campaignId } = req.body;

      if (!trendIds?.length) {
        return res.status(400).json({ success: false, error: "trendIds обязателен" });
      }

      log(`[Trends Route] Запуск сбора комментариев для ${trendIds.length} трендов`, 'info');

      // Получаем полные данные трендов из Directus
      const trends = await directusCrud.list('campaign_trend_topics', {
        filter: { id: { _in: trendIds } },
        limit: -1,
        useAdminToken: true
      }) as any[];

      log(`[Trends Route] Получено ${(trends || []).length} трендов из Directus`, 'info');

      const telegramTrends: any[] = [];
      const allTrends: any[] = trends || [];

      for (const trend of allTrends) {
        const url = trend?.urlPost || trend?.url_post || '';
        if (url && url.includes('t.me/')) {
          telegramTrends.push(trend);
        }
      }

      // Telegram — наш API напрямую
      if (telegramTrends.length > 0) {
        log(`[Trends Route] Сбор Telegram на нашей стороне для ${telegramTrends.length} трендов`, 'info');
        for (const t of telegramTrends) {
          const postUrl = t?.urlPost || t?.url_post;
          if (postUrl) {
            await callTelegramCollectDirect(postUrl);
          }
        }
      }

      // Отправляем ВСЕ тренды в N8N (включая Telegram — N8N обрабатывает VK/Instagram комменты)
      const webhookUrl = process.env.N8N_COLLECT_COMMENTS_WEBHOOK || getN8nWebhookUrl('collect-comments');
      log(`[Trends Route] Отправка ${allTrends.length} трендов на N8N: ${webhookUrl}`, 'info');

      const userId = req.user?.id;
      const n8nPayload = {
        trendIds,
        campaignId,
        userID: userId
      };

      log(`[Trends Route] N8N payload: trendIds=${trendIds.length}, campaignId=${campaignId}`, 'info');

      axios.post(webhookUrl, n8nPayload, {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' }
      }).catch(err => {
        log(`[Trends Route] ⚠️ Ошибка n8n вебхука collect-comments: ${err.message}`, 'error');
      });

      res.json({
        success: true,
        message: "Запрос на сбор комментариев принят",
        data: { totalTrends: allTrends.length, telegramDirect: telegramTrends.length }
      });
    } catch (error: any) {
      log(`[Trends Route] Ошибка сбора комментариев: ${error.message}`, 'error');
      res.status(500).json({ success: false, error: "Ошибка при запуске сбора комментариев" });
    }
  });

  /**
   * Запуск сбора комментариев для одного тренда
   * post_url (urlPost) — обязателен для сбора, берётся из поля "URL Post" тренда
   */
  app.post("/api/trends/collect-comments-single", authenticateUser, async (req: Request, res: Response) => {
    try {
      const { trendId, campaignId } = req.body;
      const userId = req.user?.id;

      if (!trendId) {
        return res.status(400).json({ success: false, error: "trendId обязателен" });
      }

      log(`[Trends Route] Запуск сбора комментариев для одного тренда ${trendId}`, 'info');

      // Получаем полные данные тренда из Directus
      const trends = await directusCrud.list('campaign_trend_topics', {
        filter: { id: { _eq: trendId } },
        limit: 1,
        useAdminToken: true
      }) as any[];

      const trend = trends?.[0];
      const postUrl = trend?.urlPost || trend?.url_post || '';

      // Telegram — наш API напрямую
      if (postUrl && postUrl.includes('t.me/')) {
        log(`[Trends Route] Telegram тренд — сбор через наш API: ${postUrl}`, 'info');
        await callTelegramCollectDirect(postUrl);
      }

      // Отправляем на N8N collect-comments (тот же эндпоинт, один тренд в списке)
      const webhookUrl = process.env.N8N_COLLECT_COMMENTS_WEBHOOK || getN8nWebhookUrl('collect-comments');

      const n8nPayload = {
        trendIds: [trendId],
        campaignId,
        userID: userId
      };

      log(`[Trends Route] Отправка 1 тренда на N8N collect-comments: ${webhookUrl}`, 'info');

      axios.post(webhookUrl, n8nPayload, {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' }
      }).catch(err => {
        log(`[Trends Route] ⚠️ Ошибка n8n вебхука collect-comments (single): ${err.message}`, 'error');
      });

      res.json({
        success: true,
        message: "Запрос на сбор комментариев принят"
      });
    } catch (error: any) {
      log(`[Trends Route] Ошибка сбора комментариев (single): ${error.message}`, 'error');
      res.status(500).json({ success: false, error: "Ошибка при запуске сбора комментариев" });
    }
  });

  /**
   * Прямой вызов API сбора комментариев Telegram
   */
  app.post("/api/telegram/collect-comments-direct", authenticateUser, async (req: Request, res: Response) => {
    try {
      const { post_url, limit = 1000, download_media = false } = req.body;
      const userId = req.user?.id;

      if (!post_url) {
        return res.status(400).json({ success: false, error: "post_url is required" });
      }

      log(`[Telegram Collect] Direct request for ${post_url} from user ${userId}`, 'info');

      // Получаем API ключ из глобальных настроек
      const apiKey = await globalApiKeysService.getGlobalApiKey(ApiServiceName.TELEGRAM_COLLECT_COMMENTS);

      if (!apiKey) {
        log(`[Telegram Collect] API key for telegram_collect_comments not found in global_api_keys`, 'error');
        return res.status(500).json({ success: false, error: "API service not configured" });
      }

      // Формируем callback_url
      const baseUrl = process.env.APP_URL || process.env.PUBLIC_URL || 'https://smm.omemo.tech';
      const callback_url = `${baseUrl}/api/trends/collect-comments-callback`;

      const externalApiUrl = 'http://217.26.25.95:3030/api/telegram/collect-comments';

      log(`[Telegram Collect] Sending request to ${externalApiUrl} with callback ${callback_url}`, 'info');

      const response = await axios.post(externalApiUrl, {
        post_url,
        limit,
        download_media,
        callback_url
      }, {
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey
        },
        timeout: 10000
      });

      res.json({
        success: true,
        message: "Запрос на сбор комментариев отправлен",
        externalStatus: response.status,
        data: response.data
      });

    } catch (error: any) {
      log(`[Telegram Collect] Error: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: "Ошибка при вызове API сбора комментариев",
        details: error.response?.data || error.message
      });
    }
  });

  /**
   * Callback для получения результатов сбора комментариев
   */
  app.post("/api/trends/collect-comments-callback", async (req: Request, res: Response) => {
    try {
      const { status, error, result } = req.body;
      const post_url = req.body.post_url ?? result?.post_url;
      const comments = req.body.comments ?? result?.comments;

      log.warn(`[Trends Callback] 📥 Received callback from Telegram API\nBody: ${JSON.stringify(req.body, null, 2)}`, 'telegram-collect');

      log(`[Trends Callback] Processing for ${post_url}, status: ${status}, comments: ${comments?.length}`, 'info');

      if (status === 'error') {
        log(`[Trends Callback] Error in external collection: ${error}`, 'error');
        return res.json({ success: true });
      }

      if (!comments || !Array.isArray(comments)) {
        log(`[Trends Callback] No comments in payload`, 'warn');
        return res.json({ success: true });
      }

      // Находим тренд по post_url
      const trends = await directusCrud.list('campaign_trend_topics', {
        filter: { urlPost: { _eq: post_url } },
        limit: 1,
        useAdminToken: true
      });

      if (trends && trends.length > 0) {
        const trend = trends[0];
        log(`[Trends Callback] Found trend ${trend.id} for URL ${post_url}`, 'info');

        // Сохраняем комментарии
        for (const comment of comments) {
          try {
            await directusCrud.create('post_comment', {
              trent_post_id: trend.id,
              author: comment.author_name || comment.author || (comment.from_id ? String(comment.from_id) : 'Аноним'),
              text: comment.text || '',
              date: comment.date || new Date().toISOString(),
              platform: comment.platform || 'telegram',
              comment_id: comment.comment_id || comment.id || ''
            }, { useAdminToken: true });
          } catch (saveErr: any) {
            // Дубликаты пропускаем, остальные — логируем
            if (!saveErr.message?.includes('duplicate') && !saveErr.message?.includes('unique')) {
              log(`[Trends Callback] Error saving comment: ${saveErr.message}`, 'warn');
            }
          }
        }

        // Обновляем количество комментариев в тренде
        await directusCrud.update('campaign_trend_topics', trend.id, {
          comments: (trend.comments || 0) + comments.length
        }, { useAdminToken: true });

        log(`[Trends Callback] Saved ${comments.length} comments for trend ${trend.id}`, 'info');
      } else {
        log(`[Trends Callback] Trend not found for URL ${post_url}`, 'warn');
      }

      res.json({ success: true });
    } catch (error: any) {
      log(`[Trends Callback] Fatal error: ${error.message}`, 'error');
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * Получение комментариев к тренду по его ID
   */
  app.get("/api/trend-comments/:trendId", authenticateUser, async (req: Request, res: Response) => {
    try {
      const { trendId } = req.params;

      if (!trendId) {
        return res.status(400).json({ success: false, error: "Отсутствует trendId" });
      }

      let comments: any[] = [];
      try {
        comments = await directusCrud.list('post_comment', {
          filter: { trent_post_id: { _eq: trendId } },
          sort: ['-date'],
          limit: 200,
          useAdminToken: true
        });
      } catch (sortErr: any) {
        log(`[Trend Comments] Sort by 'date' failed, trying without sort: ${sortErr.message}`, 'warn');
        try {
          comments = await directusCrud.list('post_comment', {
            filter: { trent_post_id: { _eq: trendId } },
            limit: 200,
            useAdminToken: true
          });
        } catch (noSortErr: any) {
          log(`[Trend Comments] Both queries failed: ${noSortErr.message}`, 'error');
          return res.status(500).json({ success: false, error: noSortErr.message });
        }
      }

      res.json({ success: true, data: comments || [] });
    } catch (error: any) {
      log(`[Trend Comments] Error fetching comments: ${error.message}`, 'error');
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * Сбор глобальных трендов через SerpAPI (Google Trends) + AI обогащение
   */
  app.post("/api/trends/global", authenticateUser, async (req: Request, res: Response) => {
    try {
      const { campaignId, language } = req.body;
      const userId = req.user?.id;
      const token = req.user?.token;

      if (!campaignId || !userId) {
        return res.status(400).json({ success: false, error: "Отсутствуют обязательные параметры" });
      }

      const serpApiKey = await globalApiKeysService.getGlobalApiKey('SERPAPI_KEY');
      if (!serpApiKey) {
        return res.status(500).json({ success: false, error: "SERPAPI_KEY не настроен" });
      }

      log(`[Trends Route] Запуск сбора глобальных трендов (SerpAPI + AI) для кампании ${campaignId}`, 'info');

      // Удаляем старые AI-тренды для этой кампании перед сбором новых (используем admin-токен)
      try {
        const oldAiTrends = await directusCrud.list('campaign_trend_topics', {
          filter: {
            _and: [
              { campaign_id: { _eq: campaignId } },
              { sourceType: { _starts_with: 'AI:' } }
            ]
          },
          fields: ['id'],
          limit: -1,
          useAdminToken: true
        });
        const oldIds = (oldAiTrends || []).map((t: any) => t.id);
        if (oldIds.length > 0) {
          for (const oldId of oldIds) {
            await directusCrud.delete('campaign_trend_topics', oldId, { useAdminToken: true });
          }
          log(`[Trends Route] Удалено ${oldIds.length} старых AI-трендов`, 'info');
        }
      } catch (delErr: any) {
        log(`[Trends Route] Не удалось удалить старые AI-тренды: ${delErr.message}`, 'warn');
      }

      let campaignName = '';
      let keywordsList: string[] = [];

      try {
        const campaignData = await directusCrud.getById('campaigns', campaignId, { useAdminToken: true });
        campaignName = (campaignData as any)?.name || '';
      } catch (err) {
        log(`[Trends Route] Не удалось загрузить кампанию ${campaignId}`, 'warn');
      }

      try {
        const kwData = await directusCrud.list('campaign_keywords', {
          filter: { campaign_id: { _eq: campaignId } },
          limit: -1,
          useAdminToken: true
        });
        keywordsList = (kwData || []).map((k: any) => k.keyword).filter(Boolean);
      } catch (err) {
        log(`[Trends Route] Не удалось загрузить ключевые слова для кампании ${campaignId}`, 'warn');
      }

      const lang = language || 'ru';
      const geoMap: Record<string, string> = { ru: 'RU', en: 'US', es: 'ES' };
      const hlMap: Record<string, string> = { ru: 'ru', en: 'en', es: 'es' };
      const geo = geoMap[lang] || 'RU';
      const hl = hlMap[lang] || 'ru';

      const allSerpTrends: any[] = [];

      // 1. SerpAPI: Google Trends по каждому ключевому слову (related queries)
      // Используем короткие ключевые слова (1-3 слова) для лучших результатов SerpAPI
      const shortenKeyword = (kw: string): string => {
        const words = kw.trim().split(/\s+/);
        if (words.length <= 3) return kw.trim();
        // Берём первые 2-3 значимых слова
        const stopWords = new Set(['для', 'с', 'в', 'на', 'и', 'по', 'из', 'к', 'от', 'the', 'for', 'with', 'and', 'of', 'in', 'to']);
        const meaningful = words.filter(w => !stopWords.has(w.toLowerCase()));
        return meaningful.slice(0, 2).join(' ');
      };

      // Берём уникальные короткие ключевые слова + название кампании
      const shortKeywords = new Set<string>();
      if (campaignName) shortKeywords.add(shortenKeyword(campaignName));
      for (const kw of keywordsList) {
        const short = shortenKeyword(kw);
        if (short && short.length >= 2) shortKeywords.add(short);
      }
      const searchKeywords = Array.from(shortKeywords).slice(0, 8);
      if (searchKeywords.length === 0) {
        searchKeywords.push(campaignName || 'trending');
      }
      log(`[Trends Route] Ключевые слова для SerpAPI: ${searchKeywords.join(', ')}`, 'info');

      for (const keyword of searchKeywords) {
        try {
          log(`[Trends Route] SerpAPI Google Trends для: "${keyword}"`, 'info');
          const trendsRes = await axios.get('https://serpapi.com/search.json', {
            params: {
              engine: 'google_trends',
              q: keyword,
              date: 'today 1-m',
              geo: geo,
              hl: hl,
              data_type: 'RELATED_QUERIES',
              api_key: serpApiKey
            },
            timeout: 60000
          });

          const data = trendsRes.data;
          log(`[Trends Route] SerpAPI ответ для "${keyword}": status=${trendsRes.status}, keys=${Object.keys(data || {}).join(',')}`, 'info');

          if (data?.related_queries) {
            log(`[Trends Route] related_queries keys: ${Object.keys(data.related_queries).join(',')}`, 'info');
          } else {
            log(`[Trends Route] related_queries отсутствует в ответе! Полный ответ: ${JSON.stringify(data).substring(0, 500)}`, 'warn');
          }

          const risingQueries = data?.related_queries?.rising || [];
          for (const q of risingQueries.slice(0, 5)) {
            const title = q.query || q.value;
            log(`[Trends Route] + Rising: "${title}" (value: ${q.extracted_value})`, 'info');
            allSerpTrends.push({
              title,
              source: 'Google Trends',
              sourceKeyword: keyword,
              views: q.extracted_value || 0,
              link: q.link || null,
              type: 'rising_query',
              raw: q
            });
          }

          const topQueries = data?.related_queries?.top || [];
          for (const q of topQueries.slice(0, 3)) {
            const title = q.query || q.value;
            log(`[Trends Route] + Top: "${title}" (value: ${q.extracted_value})`, 'info');
            allSerpTrends.push({
              title,
              source: 'Google Trends',
              sourceKeyword: keyword,
              views: q.extracted_value || 0,
              link: q.link || null,
              type: 'top_query',
              raw: q
            });
          }

          log(`[Trends Route] SerpAPI "${keyword}": rising=${risingQueries.length}, top=${topQueries.length}, добавлено=${risingQueries.slice(0, 5).length + topQueries.slice(0, 3).length}`, 'info');
        } catch (serpErr: any) {
          log(`[Trends Route] SerpAPI ошибка для "${keyword}": ${serpErr.message}`, 'warn');
        }
      }

      // 2. SerpAPI: Trending Now — реальные тренды за последние 24ч
      try {
        log(`[Trends Route] SerpAPI Trending Now (${geo})...`, 'info');
        const trendingRes = await axios.get('https://serpapi.com/search.json', {
          params: {
            engine: 'google_trends_trending_now',
            geo: geo,
            hl: hl,
            hours: 48,
            api_key: serpApiKey
          },
          timeout: 60000
        });

        const trendingData = trendingRes.data?.trending_searches || [];
        for (const t of trendingData.slice(0, 10)) {
          allSerpTrends.push({
            title: t.query || t.title,
            source: 'Google Trending',
            sourceKeyword: 'trending_now',
            views: t.search_volume || 0,
            link: t.link || t.google_trends_link || null,
            type: 'trending_now',
            description: t.articles?.[0]?.title || null,
            raw: t
          });
        }
        log(`[Trends Route] SerpAPI Trending Now: ${trendingData.length} трендов`, 'info');
      } catch (trendErr: any) {
        log(`[Trends Route] SerpAPI Trending Now ошибка: ${trendErr.message}`, 'warn');
      }

      log(`[Trends Route] Всего собрано ${allSerpTrends.length} трендов из SerpAPI`, 'info');

      // 3. AI обогащение: Gemini анализирует найденные тренды и добавляет описания
      let enrichedTrends: any[] = [];

      if (allSerpTrends.length > 0) {
        const langName = lang === 'ru' ? 'русском' : lang === 'en' ? 'английском' : 'испанском';
        const trendsForAi = allSerpTrends.map(t => `- ${t.title} (${t.source}, views: ${t.views})`).join('\n');

        const enrichPrompt = `Ты — аналитик трендов для бизнеса "${campaignName}".
Ключевые слова бизнеса: ${keywordsList.slice(0, 15).join(', ')}

Вот тренды из Google Trends:
${trendsForAi}

Задача:
1. Для каждого тренда добавь краткое описание (1-2 предложения).
2. Оцени релевантность СТРОГО по связи с бизнесом "${campaignName}":
   - "high" — тренд напрямую связан с тематикой бизнеса (SMM, маркетинг, AI, контент, соцсети)
   - "medium" — тренд косвенно связан или может быть использован для создания контента
   - "low" — тренд НЕ связан с бизнесом (спорт, развлечения, политика и т.д.)

ВАЖНО: Будь строгим. Тренды про футбол, криптовалюту, знаменитостей, погоду — это "low" для SMM-бизнеса.

Ответ СТРОГО в формате JSON массива (без markdown):
[
  {
    "title": "Точное название тренда из списка",
    "description": "Краткое описание",
    "relevance": "high/medium/low"
  }
]

Ответь на ${langName} языке.`;

        try {
          let aiResponse = '';
          try {
            aiResponse = await geminiVertexDirect.generateContent({
              prompt: enrichPrompt,
              model: 'gemini-3-pro-preview'
            });
          } catch (geminiErr: any) {
            log(`[Trends Route] Gemini недоступен для обогащения: ${geminiErr.message}`, 'warn');
            try {
              const deepseekApiKey = await apiKeyService.getApiKey(userId!, ApiServiceName.DEEPSEEK, token);
              if (deepseekApiKey) {
                const deepseek = new DeepSeekService({ apiKey: deepseekApiKey });
                aiResponse = await deepseek.generateText(enrichPrompt, {
                  model: 'deepseek-chat',
                  temperature: 0.5,
                  max_tokens: 5000
                });
              }
            } catch (dsErr: any) {
              log(`[Trends Route] DeepSeek тоже недоступен: ${dsErr.message}`, 'warn');
            }
          }

          if (aiResponse) {
            let cleaned = aiResponse.trim();
            if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
            if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
            if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
            cleaned = cleaned.trim();
            enrichedTrends = JSON.parse(cleaned);
          }
        } catch (parseErr) {
          log(`[Trends Route] Не удалось разобрать AI-обогащение, используем тренды без описаний`, 'warn');
        }
      }

      // 4. Объединяем SerpAPI данные с AI описаниями
      const enrichMap = new Map<string, any>();
      for (const e of enrichedTrends) {
        if (e.title) enrichMap.set(e.title.toLowerCase().trim(), e);
      }

      const deduped = new Map<string, any>();
      for (const trend of allSerpTrends as any[]) {
        const key = trend.title?.toLowerCase().trim();
        if (!key || deduped.has(key)) continue;

        const enrichment = enrichMap.get(key);
        deduped.set(key, {
          ...trend,
          description: enrichment?.description || trend.description || null,
          relevance: enrichment?.relevance || 'medium'
        });
      }

      // Фильтруем нерелевантные тренды (оставляем только high и medium)
      const allDeduped = Array.from(deduped.values());
      const finalTrends = enrichedTrends.length > 0
        ? allDeduped.filter(t => (t.relevance || '').toLowerCase() !== 'low')
        : allDeduped;

      log(`[Trends Route] После фильтрации по релевантности: ${finalTrends.length} из ${allDeduped.length} трендов`, 'info');

      // 5. Находим или создаём source "Google Trends (AI)" для этой кампании
      let globalSourceId: string | null = null;
      try {
        const existingSources = await directusCrud.list('campaign_content_sources', {
          useAdminToken: true,
          filter: {
            campaign_id: { _eq: String(campaignId) },
            type: { _eq: 'google_trends' }
          }
        });

        if (existingSources && existingSources.length > 0) {
          globalSourceId = (existingSources[0] as any).id;
          log(`[Trends Route] Найден существующий source: ${globalSourceId}`, 'info');
        } else {
          const newSource = await directusCrud.create('campaign_content_sources', {
            name: 'Google Trends (AI)',
            url: 'https://trends.google.com',
            type: 'google_trends',
            is_active: true,
            campaign_id: String(campaignId)
          }, { useAdminToken: true });
          globalSourceId = (newSource as any)?.id || null;
          log(`[Trends Route] Создан новый source: ${globalSourceId}`, 'info');
        }
      } catch (srcErr: any) {
        log(`[Trends Route] Ошибка создания source: ${srcErr.message}`, 'warn');
      }

      // 6. Сохраняем тренды в Directus
      const savedTopics = [];
      for (const trend of finalTrends as any[]) {
        try {
          const topicData: any = {
            title: trend.title || 'Без названия',
            sourceType: `AI: ${trend.source || 'Google Trends'}`,
            urlPost: trend.link || null,
            reactions: 0,
            comments: 0,
            views: trend.views || 0,
            is_bookmarked: false,
            campaign_id: String(campaignId),
            description: trend.description || null,
            raw_source_data: trend.raw || null
          };

          if (globalSourceId) {
            topicData.source_id = globalSourceId;
          }

          log(`[Trends Route] Saving trend "${trend.title}" with source_id: ${globalSourceId || 'NONE'}`, 'info');
          const savedItem = await directusCrud.create('campaign_trend_topics', topicData, { useAdminToken: true });
          savedTopics.push(savedItem);
        } catch (saveErr: any) {
          log(`[Trends Route] Ошибка сохранения тренда "${trend.title}": ${saveErr.message}`, 'error');
        }
      }

      log(`[Trends Route] Сохранено ${savedTopics.length} трендов (SerpAPI: ${allSerpTrends.length} raw, ${finalTrends.length} deduped) для кампании ${campaignId}`, 'info');

      res.json({
        success: true,
        message: `Найдено ${finalTrends.length} трендов (${allSerpTrends.length} из Google Trends)`,
        count: savedTopics.length,
        trends: savedTopics
      });

    } catch (error: any) {
      log(`[Trends Route] Ошибка при сборе глобальных трендов: ${error.message}`, 'error');
      res.status(500).json({ success: false, error: error.message || "Ошибка при сборе глобальных трендов" });
    }
  });

  app.post("/api/trend-sentiment/:trendId", authenticateUser, async (req: Request, res: Response) => {
    try {
      const { trendId } = req.params;

      log(`[Trends Route] Анализ настроения для тренда ${trendId}`, 'info');

      let comments: any[] = [];
      try {
        comments = await directusCrud.list('post_comment', {
          filter: { trent_post_id: { _eq: trendId } },
          limit: 500,
          useAdminToken: true
        });
      } catch (err: any) {
        log(`[Trends Route] ⚠️ Не удалось получить комментарии: ${err.message}`, 'warn');
      }

      const sentimentResult = await analyzeSentimentWithAI(comments || []);

      try {
        await directusCrud.update('campaign_trend_topics', trendId, {
          sentiment_analysis: sentimentResult
        }, { useAdminToken: true });
      } catch (err: any) {
        log(`[Trends Route] ⚠️ Не удалось сохранить sentiment_analysis в тренд: ${err.message}`, 'warn');
      }

      res.json({
        success: true,
        data: sentimentResult,
        commentsAnalyzed: (comments || []).length,
      });
    } catch (error: any) {
      log(`[Trends Route] ❌ Ошибка анализа настроения: ${error.message}`, 'error');
      res.status(500).json({ success: false, error: "Ошибка анализа настроения" });
    }
  });

  app.post("/api/analyze-comments", authenticateUser, async (req: Request, res: Response) => {
    try {
      const { trendId, level, campaignId } = req.body;

      if (!trendId) {
        return res.status(400).json({ success: false, message: "trendId обязателен" });
      }

      log(`[Analyze Comments] Анализ комментариев для тренда ${trendId}, уровень: ${level}`, 'info');

      let comments: any[] = [];
      try {
        comments = await directusCrud.list('post_comment', {
          filter: { trent_post_id: { _eq: trendId } },
          limit: 500,
          useAdminToken: true
        });
      } catch (err: any) {
        log(`[Analyze Comments] ⚠️ Не удалось получить комментарии: ${err.message}`, 'warn');
      }

      const sentimentResult = await analyzeSentimentWithAI(comments || []);
      const commentsCount = (comments || []).length;

      if (level === 'trend') {
        const analysis = {
          ...sentimentResult,
          engagement: commentsCount > 50 ? 'Высокая' : commentsCount > 10 ? 'Средняя' : 'Низкая',
          viral_potential: Math.min(100, Math.round(commentsCount * 1.5)),
          commentsAnalyzed: commentsCount,
        };

        try {
          await directusCrud.update('campaign_trend_topics', trendId, {
            sentiment_analysis: analysis
          }, { useAdminToken: true });
        } catch (err: any) {
          log(`[Analyze Comments] ⚠️ Не удалось сохранить анализ тренда: ${err.message}`, 'warn');
        }

        res.json({ success: true, data: { analysis, commentsAnalyzed: commentsCount } });
      } else if (level === 'source') {
        const trend = await directusCrud.list('campaign_trend_topics', {
          filter: { id: { _eq: trendId } },
          limit: 1,
          useAdminToken: true
        }) as any[];

        const sourceId = trend?.[0]?.source_id;
        let sourceAnalysis: Record<string, any> = { sentiment: 'neutral', confidence: 0 };

        if (sourceId) {
          let allSourceTrends: any[] = [];
          try {
            allSourceTrends = await directusCrud.list('campaign_trend_topics', {
              filter: { source_id: { _eq: sourceId } },
              limit: 500,
              useAdminToken: true
            });
          } catch (err: any) {
            log(`[Analyze Comments] ⚠️ Ошибка загрузки трендов источника: ${err.message}`, 'warn');
          }

          const analyzedTrends = allSourceTrends.filter((t: any) => t.sentiment_analysis?.sentiment);
          const totalTrends = allSourceTrends.length;
          const analyzedCount = analyzedTrends.length;

          let totalPos = 0, totalNeg = 0, totalNeu = 0;
          const allSourceThemes: string[] = [];
          if (analyzedCount > 0) {
            for (const at of analyzedTrends) {
              const sa = at.sentiment_analysis;
              totalPos += (sa.positive_percentage || sa.details?.positive || 0);
              totalNeg += (sa.negative_percentage || sa.details?.negative || 0);
              totalNeu += (sa.neutral_percentage || sa.details?.neutral || 0);
              if (sa.themes) allSourceThemes.push(...sa.themes);
            }
          }
          const posPercent = analyzedCount > 0 ? Math.round(totalPos / analyzedCount) : 0;
          const negPercent = analyzedCount > 0 ? Math.round(totalNeg / analyzedCount) : 0;
          const neuPercent = 100 - posPercent - negPercent;
          const uniqueSourceThemes = [...new Set(allSourceThemes)].slice(0, 7);

          const overallSentiment =
            posPercent > negPercent && posPercent > neuPercent ? 'positive'
            : negPercent > posPercent ? 'negative'
            : 'neutral';

          sourceAnalysis = {
            sentiment: overallSentiment,
            confidence: Math.max(posPercent, negPercent, neuPercent),
            positive_percentage: posPercent,
            negative_percentage: negPercent,
            neutral_percentage: neuPercent,
            details: { positive: posPercent, negative: negPercent, neutral: neuPercent },
            summary: analyzedCount > 0
              ? `ИИ проанализировал комментарии из ${analyzedCount} из ${totalTrends} трендов источника.`
              : 'Анализ трендов источника ещё не выполнен.',
            themes: uniqueSourceThemes.length > 0 ? uniqueSourceThemes : ['Общее обсуждение'],
            source_reputation: analyzedCount > 5 ? 'Высокая' : analyzedCount > 2 ? 'Средняя' : 'Начальная',
            audience_trust: Math.min(100, analyzedCount * 15),
            trendsAnalyzed: analyzedCount,
            totalTrends,
            analysisMethod: 'ai',
          };

          try {
            await directusCrud.update('campaign_content_sources', sourceId, {
              sentiment_analysis: sourceAnalysis
            }, { useAdminToken: true });
          } catch (err: any) {
            log(`[Analyze Comments] ⚠️ Не удалось сохранить анализ источника: ${err.message}`, 'warn');
          }
        }

        res.json({ success: true, data: { analysis: sourceAnalysis } });
      } else {
        res.status(400).json({ success: false, message: "level должен быть 'trend' или 'source'" });
      }
    } catch (error: any) {
      log(`[Analyze Comments] ❌ Ошибка: ${error.message}`, 'error');
      res.status(500).json({ success: false, message: "Ошибка анализа комментариев" });
    }
  });

  app.post("/api/sources/:sourceId/analyze", authenticateUser, async (req: Request, res: Response) => {
    try {
      const { sourceId } = req.params;

      log(`[Source Analyze] Анализ источника ${sourceId}`, 'info');

      let trends: any[] = [];
      try {
        trends = await directusCrud.list('campaign_trend_topics', {
          filter: { source_id: { _eq: sourceId } },
          limit: 500,
          useAdminToken: true
        });
      } catch (err: any) {
        log(`[Source Analyze] ⚠️ Не удалось получить тренды: ${err.message}`, 'warn');
      }

      const totalTrends = (trends || []).length;
      if (totalTrends === 0) {
        const emptyAnalysis = {
          sentiment: 'neutral',
          confidence: 0,
          details: { positive: 0, negative: 0, neutral: 100 },
          summary: 'Тренды для данного источника не найдены.',
          trendsAnalyzed: 0,
          totalTrends: 0,
          trendsWithComments: 0,
          totalComments: 0,
          analyzed_at: new Date().toISOString(),
        };
        return res.json({ success: true, data: emptyAnalysis });
      }

      log(`[Source Analyze] Найдено ${totalTrends} трендов. Анализируем комментарии каждого...`, 'info');

      let trendsWithComments = 0;
      let totalComments = 0;
      let analyzedCount = 0;

      for (const trend of trends) {
        let comments: any[] = [];
        try {
          comments = await directusCrud.list('post_comment', {
            filter: { trent_post_id: { _eq: trend.id } },
            limit: 500,
            useAdminToken: true
          });
        } catch (err: any) {
          continue;
        }

        if (comments.length === 0) continue;

        trendsWithComments++;
        totalComments += comments.length;

        const sentimentResult = await analyzeSentimentWithAI(comments);

        try {
          await directusCrud.update('campaign_trend_topics', trend.id, {
            sentiment_analysis: sentimentResult
          }, { useAdminToken: true });
          analyzedCount++;
        } catch (err: any) {
          log(`[Source Analyze] ⚠️ Не удалось сохранить анализ тренда ${trend.id}: ${err.message}`, 'warn');
        }
      }

      log(`[Source Analyze] Проанализировано ${analyzedCount} трендов с комментариями (${totalComments} комм.)`, 'info');

      const updatedTrends = await directusCrud.list('campaign_trend_topics', {
        filter: { source_id: { _eq: sourceId } },
        limit: 500,
        useAdminToken: true
      }) as any[];

      const analyzedTrends = updatedTrends.filter((t: any) => t.sentiment_analysis?.sentiment);
      const finalAnalyzedCount = analyzedTrends.length;

      const avgCommentsPerTrend = trendsWithComments > 0 ? Math.round(totalComments / trendsWithComments) : 0;

      const allThemes: string[] = [];
      let totalPosPercent = 0, totalNegPercent = 0, totalNeuPercent = 0;
      let totalScore = 0;
      const trendSummaries: string[] = [];

      for (const t of analyzedTrends) {
        const sa = t.sentiment_analysis;
        totalPosPercent += (sa.positive_percentage || sa.details?.positive || 0);
        totalNegPercent += (sa.negative_percentage || sa.details?.negative || 0);
        totalNeuPercent += (sa.neutral_percentage || sa.details?.neutral || 0);
        totalScore += (sa.score || sa.average_score || 5);
        if (sa.themes) allThemes.push(...sa.themes);
        if (sa.summary) trendSummaries.push(sa.summary);
      }

      let posPercent = 0, negPercent = 0, neuPercent = 0;
      let score = 5;
      if (finalAnalyzedCount > 0) {
        posPercent = Math.round(totalPosPercent / finalAnalyzedCount);
        negPercent = Math.round(totalNegPercent / finalAnalyzedCount);
        neuPercent = 100 - posPercent - negPercent;
        score = Math.round(totalScore / finalAnalyzedCount);
      }

      const overallSentiment =
        posPercent > negPercent && posPercent > neuPercent ? 'positive'
        : negPercent > posPercent ? 'negative'
        : 'neutral';

      const emoji = overallSentiment === 'positive' ? '😊' : overallSentiment === 'negative' ? '😟' : '😐';
      const uniqueThemes = [...new Set(allThemes)].slice(0, 7);

      const topTrends = analyzedTrends
        .sort((a: any, b: any) => {
          const aComments = a.sentiment_analysis?.commentsAnalyzed || a.sentiment_analysis?.total_comments || a.comments_count || 0;
          const bComments = b.sentiment_analysis?.commentsAnalyzed || b.sentiment_analysis?.total_comments || b.comments_count || 0;
          return bComments - aComments;
        })
        .slice(0, 5)
        .map((t: any) => ({
          id: t.id,
          title: t.title || t.name || 'Без названия',
          urlPost: t.urlPost || t.url_post || t.url || null,
          comments: t.sentiment_analysis?.commentsAnalyzed || t.sentiment_analysis?.total_comments || t.comments_count || 0,
          sentiment: t.sentiment_analysis?.sentiment || 'neutral',
          score: t.sentiment_analysis?.score || t.sentiment_analysis?.average_score || 5
        }));

      let aiSummary = '';
      let detailedSummary = '';
      if (finalAnalyzedCount > 0) {
        try {
          const summaryPrompt = `Ты — эксперт по анализу социальных медиа. Проведи подробный анализ источника контента на основе данных.

ДАННЫЕ ИСТОЧНИКА:
- Всего трендов: ${totalTrends}, проанализировано: ${finalAnalyzedCount}
- Всего комментариев: ${totalComments}
- Средняя активность: ${avgCommentsPerTrend} комментариев на пост
- Тональность: Позитивных ${posPercent}%, Негативных ${negPercent}%, Нейтральных ${neuPercent}%
- Средний рейтинг: ${score}/10
- Основные темы: ${uniqueThemes.length > 0 ? uniqueThemes.join(', ') : 'не определены'}

ТОП-5 ТРЕНДОВ ПО АКТИВНОСТИ:
${topTrends.map((t: any, i: number) => `${i + 1}. "${t.title}" — ${t.comments} комм., тональность: ${t.sentiment}, рейтинг: ${t.score}/10`).join('\n')}

${trendSummaries.length > 0 ? `ВЫВОДЫ ПО ТРЕНДАМ:\n${trendSummaries.slice(0, 10).map((s, i) => `${i + 1}. ${s}`).join('\n')}` : ''}

Ответь СТРОГО в формате JSON (без markdown, без \`\`\`):
{
  "summary": "Краткое резюме в 2-3 предложения: общая картина источника, ключевые выводы",
  "detailed_summary": "Подробный анализ в 5-7 предложений: характеристика аудитории, уровень вовлечённости, преобладающие настроения, какие темы вызывают наибольший отклик, сильные и слабые стороны источника, рекомендации по работе с ним",
  "themes": ["тема1", "тема2", "тема3", "тема4", "тема5"],
  "audience_type": "краткое описание типичной аудитории (1 предложение)",
  "recommendation": "одна ключевая рекомендация по работе с этим источником"
}`;

          const aiResponse = await geminiVertexDirect.generateContent({
            prompt: summaryPrompt,
            model: 'gemini-3-pro-preview'
          });

          try {
            const cleaned = aiResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            const parsed = JSON.parse(cleaned);
            if (parsed.summary && typeof parsed.summary === 'string') {
              aiSummary = parsed.summary;
            }
            if (parsed.detailed_summary && typeof parsed.detailed_summary === 'string') {
              detailedSummary = parsed.detailed_summary;
            }
            if (parsed.themes && Array.isArray(parsed.themes) && parsed.themes.length >= 2) {
              uniqueThemes.length = 0;
              uniqueThemes.push(...parsed.themes.filter((t: any) => typeof t === 'string' && t.length > 0).slice(0, 10));
            }
            if (parsed.audience_type && typeof parsed.audience_type === 'string') {
              detailedSummary += `\n\nАудитория: ${parsed.audience_type}`;
            }
            if (parsed.recommendation && typeof parsed.recommendation === 'string') {
              detailedSummary += `\n\nРекомендация: ${parsed.recommendation}`;
            }
          } catch (parseErr) {
            const cleanText = aiResponse.replace(/<[^>]*>/g, '').replace(/```[^`]*```/g, '').trim();
            if (cleanText.length > 20) {
              aiSummary = cleanText;
            }
            log(`[Source Analyze] AI ответил не JSON, используем как текст`, 'warn');
          }
        } catch (err: any) {
          log(`[Source Analyze] ⚠️ Не удалось сгенерировать AI резюме: ${err.message}`, 'warn');
        }
      }

      const sentimentLabel = overallSentiment === 'positive' ? 'положительное' : overallSentiment === 'negative' ? 'отрицательное' : 'нейтральное';
      const engagementLevel = avgCommentsPerTrend > 50 ? 'Высокая' : avgCommentsPerTrend > 10 ? 'Средняя' : 'Низкая';

      const sourceAnalysis: Record<string, any> = {
        sentiment: overallSentiment,
        overall_sentiment: overallSentiment,
        emoji,
        score,
        average_score: score,
        confidence: Math.max(posPercent, negPercent, neuPercent),
        details: { positive: posPercent, negative: negPercent, neutral: neuPercent },
        positive_percentage: posPercent,
        negative_percentage: negPercent,
        neutral_percentage: neuPercent,
        themes: uniqueThemes,
        summary: aiSummary || (finalAnalyzedCount > 0
          ? `Проанализировано ${totalComments} комментариев из ${finalAnalyzedCount} трендов. Общая тональность: ${sentimentLabel} (рейтинг ${score}/10). ${engagementLevel} активность аудитории (${avgCommentsPerTrend} комментариев на пост).`
          : `Тренды найдены (${totalTrends}), но комментарии ещё не собраны.`),
        detailed_summary: detailedSummary || null,
        top_trends: topTrends,
        trendsAnalyzed: finalAnalyzedCount,
        analyzed_trends: finalAnalyzedCount,
        totalTrends,
        total_trends: totalTrends,
        trendsWithComments,
        totalComments,
        total_comments: totalComments,
        commentsAnalyzed: totalComments,
        avgCommentsPerTrend,
        analyzed_at: new Date().toISOString(),
        analysisMethod: 'ai',
      };

      try {
        await directusCrud.update('campaign_content_sources', sourceId, {
          sentiment_analysis: sourceAnalysis
        }, { useAdminToken: true });
      } catch (err: any) {
        log(`[Source Analyze] ⚠️ Не удалось сохранить анализ источника: ${err.message}`, 'warn');
      }

      res.json({ success: true, data: sourceAnalysis });
    } catch (error: any) {
      log(`[Source Analyze] ❌ Ошибка анализа источника: ${error.message}`, 'error');
      res.status(500).json({ success: false, error: "Ошибка анализа источника" });
    }
  });

  /**
   * POST /api/trends/collect-direct
   * Прямой сбор трендов через скрейпер (Telegram, VK, YouTube, Instagram)
   * без n8n, для всех платформ из campaign_content_sources
   */
  app.post("/api/trends/collect-direct", authenticateUser, async (req: Request, res: Response) => {
    try {
      const { campaignId, postsPerPlatform, daysSince } = req.body;
      const userId = req.user?.id;
      const authToken = req.user?.token;

      if (!userId || !authToken) return res.status(401).json({ error: 'Unauthorized' });
      if (!campaignId) return res.status(400).json({ error: 'campaignId обязателен' });

      log(`[Trends Direct] 🚀 Запрос сбора трендов: кампания=${campaignId}, userId=${userId}`, 'info');

      // Запускаем в фоне — не ждём завершения
      (async () => {
        try {
          const { collectTrendsForCampaign } = await import('../services/trend-collector');
          const result = await collectTrendsForCampaign({
            campaignId,
            userId,
            authToken,
            postsPerPlatform: postsPerPlatform || 20,
            daysSince: daysSince || 7
          });
          log(`[Trends Direct] ✅ Завершён сбор: ${JSON.stringify(result)}`, 'info');
        } catch (err: any) {
          log(`[Trends Direct] ❌ Ошибка фонового сбора: ${err.message}`, 'error');
        }
      })();

      res.json({
        success: true,
        message: 'Сбор трендов запущен в фоне (Telegram, VK, YouTube, Instagram)',
        campaignId
      });
    } catch (error: any) {
      log(`[Trends Direct] ❌ Ошибка запуска: ${error.message}`, 'error');
      res.status(500).json({ error: 'Ошибка запуска сбора трендов' });
    }
  });
}

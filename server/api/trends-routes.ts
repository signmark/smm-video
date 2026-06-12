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
import { getPublicBaseUrl, SCRAPER_BASE, getScraperApiKey } from '../services/trend-collector';

// ─── Comment collector — тот же скрейпер что и для трендов ───────────────────
const COMMENT_SCRAPER_BASE = SCRAPER_BASE;

interface PendingCommentEntry { trendId: string; insertedAt: number; }
// urlPost.toLowerCase() → { trendId, insertedAt }
const pendingCommentUrls = new Map<string, PendingCommentEntry>();
setInterval(() => {
  const cutoff = Date.now() - 2 * 3600_000;
  for (const [k, v] of pendingCommentUrls) {
    if (v.insertedAt < cutoff) pendingCommentUrls.delete(k);
  }
}, 600_000).unref();

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
      const minViews = req.body.minViews ?? campaignTrendSettings.minViews ?? 300;
      const maxTrendsPerSource = req.body.maxTrendsPerSource ?? campaignTrendSettings.maxTrendsPerSource ?? 5;
      const maxSourcesPerPlatform = req.body.maxSourcesPerPlatform ?? campaignTrendSettings.maxSourcesPerPlatform ?? 10;
      const minFollowers = req.body.minFollowers ?? campaignTrendSettings.minFollowers ?? {
        instagram: 5000,
        telegram: 2000,
        vk: 3000,
        facebook: 5000,
        youtube: 10000
      };

      // Ключевые слова: из запроса → из настроек кампании → из коллекции campaign_keywords
      let resolvedKeywords: string[] = [];
      if (keywords && Array.isArray(keywords) && keywords.length > 0) {
        resolvedKeywords = keywords;
      } else if (campaignTrendSettings.keywords && Array.isArray(campaignTrendSettings.keywords)) {
        resolvedKeywords = campaignTrendSettings.keywords;
      } else {
        try {
          const kwData = await directusCrud.list('campaign_keywords', {
            filter: { campaign_id: { _eq: campaignId } },
            fields: ['keyword'],
            limit: 20,
            useAdminToken: true
          }) as any[];
          resolvedKeywords = (kwData || []).map((k: any) => k.keyword).filter(Boolean);
        } catch {
          // ignore
        }
      }

      log(`[Trends Route] Параметры: days=${collectionDays}, maxTrends=${maxTrendsPerSource}, maxSources=${maxSourcesPerPlatform}, collectSources=${collectSources}, keywords=${resolvedKeywords.length}, platforms=${JSON.stringify(platforms)}`, 'info');

      // Запускаем прямой сбор фоново, сразу отвечаем клиенту
      (async () => {
        try {
          const { collectTrendsForCampaign } = await import('../services/trend-collector');
          const result = await collectTrendsForCampaign({
            campaignId,
            userId: userId!,
            authToken,
            postsPerPlatform: maxTrendsPerSource,
            daysSince: collectionDays,
            platforms: platforms || ['telegram', 'vk', 'youtube', 'instagram'],
            collectSources: collectSources ?? false,
            keywords: resolvedKeywords,
            maxSourcesPerPlatform,
            minFollowers,
            sourcesList: Array.isArray(sourcesList) && sourcesList.length > 0 ? sourcesList : undefined
          });
          log(`[Trends Route] ✅ Прямой сбор завершён: TG=${result.telegram}, VK=${result.vk}, YT=${result.youtube}, IG=${result.instagram}, total=${result.total}`, 'info');

          // Дополнительно уведомляем N8N если настроен (для совместимости с обработчиком комментариев)
          const n8nWebhookUrl = process.env.N8N_TRENDS_COLLECT_WEBHOOK;
          if (n8nWebhookUrl && result.total > 0) {
            axios.post(n8nWebhookUrl, {
              campaignId,
              userID: userId,
              collectionDays,
              minViews,
              maxTrendsPerSource,
              maxSourcesPerPlatform,
              minFollowers,
              platforms,
              collectSources: false,
              collectComments
            }, { timeout: 10000 }).catch((e: any) => {
              log(`[Trends Route] N8N notify failed (non-critical): ${e.message}`, 'warn');
            });
          }
        } catch (err: any) {
          log(`[Trends Route] ❌ Ошибка прямого сбора трендов: ${err.message}`, 'error');
        }
      })();

      res.json({
        success: true,
        message: 'Сбор трендов запущен',
        campaignId,
        params: {
          platforms: platforms || ['telegram', 'vk', 'youtube', 'instagram'],
          collectSources: collectSources ?? false,
          keywords: resolvedKeywords.length,
          days: collectionDays,
          maxTrendsPerSource,
          maxSourcesPerPlatform
        }
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
   * POST /api/trends/tg-webhook
   * Основной хук — скрейпер POSTит сюда результат TG-задачи когда готово.
   * Формат скрейпера: { task_id, status, result: { posts: [...] }, error }
   * Задача была зарегистрирована в pendingTgTasks в trend-collector.ts.
   */
  app.post("/api/trends/tg-webhook", async (req: Request, res: Response) => {
    // Сразу отвечаем 200 — скрейпер не должен ждать пока мы сохраняем
    res.json({ success: true });

    try {
      const body = req.body;
      // ВНИМАНИЕ: используем console.* напрямую — логгер режет info/warn/error в production
      // (logger.ts), а этот путь сейчас активно диагностируем и нужен виден на проде.
      console.log(`[TG Webhook] 📥 Получен колбэк: ${JSON.stringify(body).substring(0, 800)}`);

      const taskId = body?.task_id || body?.taskId || body?.job_id || body?.id || body?.result?.task_id;
      const status = (body?.status ?? body?.result?.status ?? '').toString().toLowerCase();
      const errorMsg = body?.error || body?.result?.error;

      // Колбэк считаем провалом ТОЛЬКО при явной ошибке или фейл-статусе.
      // Любой иной статус (success/ok/finished/done/completed/processing и т.п.) НЕ повод
      // выбрасывать результат — если в теле есть посты, мы их сохраняем.
      const isFailure = !!errorMsg || ['error', 'failed', 'failure'].includes(status);
      if (isFailure) {
        console.error(`[TG Webhook] ❌ Задача ${taskId} с ошибкой: ${errorMsg || status}`);
        if (taskId) {
          const { pendingTgTasks } = await import('../services/trend-collector');
          pendingTgTasks.delete(String(taskId));
        }
        return;
      }

      // Достаём посты (несколько возможных форматов вложенности)
      const result = body?.result || body;
      const posts: any[] = result?.posts || result?.items || result?.data || body?.posts || [];

      console.log(`[TG Webhook] task_id=${taskId} | status=${status || '—'} | posts=${posts.length}`);

      if (!taskId) {
        console.warn(`[TG Webhook] ⚠️ Нет task_id в теле — невозможно найти кампанию`);
        return;
      }

      const { pendingTgTasks, saveTrendPosts } = await import('../services/trend-collector');
      const task = pendingTgTasks.get(String(taskId));

      if (!task) {
        console.warn(`[TG Webhook] ⚠️ task_id=${taskId} НЕ найден в реестре (id из колбэка не совпал с зарегистрированными из batch, либо истёк TTL)`);
        return;
      }

      if (posts.length === 0) {
        console.log(`[TG Webhook] ℹ️ Нет постов в колбэке для кампании ${task.campaignId} (этот батч пустой)`);
        pendingTgTasks.delete(String(taskId));
        return;
      }

      const saved = await saveTrendPosts(posts, 'telegram', task.campaignId, task.sourceIdMap);
      console.log(`[TG Webhook] ✅ Сохранено ${saved} TG-постов для кампании ${task.campaignId}`);
      pendingTgTasks.delete(String(taskId));
    } catch (error: any) {
      console.error(`[TG Webhook] 💥 Критическая ошибка: ${error.message}`);
    }
  });

  /**
   * POST /api/trends/collect-trends-callback
   * Легаси-эндпоинт (для старых вызовов через callTelegramTrendsCollectDirect).
   * Поддерживает как старый формат { posts, metadata } так и новый { task_id, status, result }.
   */
  app.post("/api/trends/collect-trends-callback", async (req: Request, res: Response) => {
    // Отвечаем сразу
    res.json({ success: true });

    try {
      const body = req.body;
      log(`[TG Callback Legacy] 📥 ${JSON.stringify(body).substring(0, 400)}`, 'info');

      // Новый формат скрейпера: { task_id, status, result: { posts } }
      if (body?.task_id || body?.taskId) {
        const taskId = body.task_id || body.taskId;
        const posts: any[] = body?.result?.posts || body?.result?.items || [];
        const campaignId = body?.result?.metadata?.campaignId || body?.metadata?.campaignId;

        if (campaignId && posts.length > 0) {
          const { saveTrendPosts } = await import('../services/trend-collector');
          const saved = await saveTrendPosts(posts, 'telegram', String(campaignId), undefined);
          log(`[TG Callback Legacy] ✅ Сохранено ${saved} постов для кампании ${campaignId} (task=${taskId})`, 'info');
        } else {
          log(`[TG Callback Legacy] ⚠️ task=${taskId} — нет campaignId или постов`, 'warn');
        }
        return;
      }

      // Старый формат: { posts: [...], metadata: { campaignId } }
      const posts: any[] = body?.posts || [];
      const campaignId = body?.metadata?.campaignId;

      if (!campaignId || posts.length === 0) {
        log(`[TG Callback Legacy] ⚠️ Нет campaignId или постов`, 'warn');
        return;
      }

      const { saveTrendPosts } = await import('../services/trend-collector');
      const saved = await saveTrendPosts(posts, 'telegram', String(campaignId), undefined);
      log(`[TG Callback Legacy] ✅ Сохранено ${saved} постов для кампании ${campaignId}`, 'info');
    } catch (error: any) {
      log(`[TG Callback Legacy] 💥 Ошибка: ${error.message}`, 'error');
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

    console.log(`[TelegramCollect] POST ${externalApiUrl} post_url=${postUrl}`);

    try {
      const response = await axios.post(externalApiUrl, requestPayload, {
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        timeout: 10000
      });
      console.log(`[TelegramCollect] Response ${response.status}`);
      return true;
    } catch (err: any) {
      console.error(`[TelegramCollect] Error ${postUrl}: ${err.message}`);
      return false;
    }
  }

  /**
   * Пакетный сбор комментариев через скрейпер (тот же что и для трендов).
   *
   * Telegram: POST /api/telegram/collect-comments-batch
   *   Callback: { task_id, status, results: [{ post_url, comments: [{ id, from_id, text, date (unix-secs), ... }] }] }
   *
   * VK: POST /api/vk/collect-comments-batch
   *   Callback: { task_id, status, results: [{ post_url, comments: [{ id, from_id, text, date (ISO), likes, ... }] }] }
   *
   * Оба принимают: { post_urls[], limit, download_media, callback_url }
   */
  async function callBatchCollectComments(
    platform: 'telegram' | 'vk',
    trends: Array<{ id: string; urlPost: string }>
  ): Promise<void> {
    const apiKey = await getScraperApiKey();
    if (!apiKey) {
      console.error('[CommentCollector] No scraper API key');
      return;
    }

    const post_urls = trends.map(t => t.urlPost).filter(Boolean);
    if (post_urls.length === 0) return;

    const callback_url = `${getPublicBaseUrl()}/api/trends/collect-comments-callback`;

    // Регистрируем маппинг urlPost → trendId для быстрой обработки колбэка
    const now = Date.now();
    for (const t of trends) {
      if (t.urlPost) {
        pendingCommentUrls.set(t.urlPost.toLowerCase().trim(), { trendId: t.id, insertedAt: now });
      }
    }

    const endpoint = platform === 'telegram'
      ? `${COMMENT_SCRAPER_BASE}/api/telegram/collect-comments-batch`
      : `${COMMENT_SCRAPER_BASE}/api/vk/collect-comments-batch`;

    const payload = { post_urls, limit: 1000, download_media: false, callback_url };

    console.log(`[CommentCollector] ${platform.toUpperCase()} batch: ${post_urls.length} posts → ${endpoint} callback=${callback_url}`);

    try {
      const resp = await axios.post(endpoint, payload, {
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        timeout: 30000
      });
      console.log(`[CommentCollector] ${platform.toUpperCase()} accepted: HTTP ${resp.status} data=${JSON.stringify(resp.data).substring(0, 200)}`);
    } catch (err: any) {
      console.error(`[CommentCollector] ${platform.toUpperCase()} error: HTTP ${err.response?.status} ${err.message}`);
    }
  }

  /**
   * Запуск сбора комментариев для набора трендов.
   * Telegram и VK отправляются пакетом на 31.129.109.216 по платформам.
   */
  app.post("/api/trends/collect-comments", authenticateUser, async (req: Request, res: Response) => {
    try {
      const { trendIds, campaignId } = req.body;

      if (!trendIds?.length) {
        return res.status(400).json({ success: false, error: "trendIds обязателен" });
      }

      console.log(`[Trends] collect-comments: ${trendIds.length} trends, campaign=${campaignId}`);

      const trends = await directusCrud.list('campaign_trend_topics', {
        filter: { id: { _in: trendIds } },
        limit: -1,
        useAdminToken: true
      }) as any[];

      const tgTrends: Array<{ id: string; urlPost: string }> = [];
      const vkTrends: Array<{ id: string; urlPost: string }> = [];

      for (const t of (trends || [])) {
        const urlPost = (t.urlPost || t.url_post || '').trim();
        if (!urlPost) continue;
        if (urlPost.includes('t.me/')) tgTrends.push({ id: t.id, urlPost });
        else if (urlPost.includes('vk.com/') || urlPost.includes('vk.ru/')) vkTrends.push({ id: t.id, urlPost });
      }

      console.log(`[Trends] collect-comments: tg=${tgTrends.length} vk=${vkTrends.length}`);

      if (tgTrends.length > 0) {
        callBatchCollectComments('telegram', tgTrends).catch(e => console.error('[Trends] TG batch error:', e.message));
      }
      if (vkTrends.length > 0) {
        callBatchCollectComments('vk', vkTrends).catch(e => console.error('[Trends] VK batch error:', e.message));
      }

      res.json({
        success: true,
        message: "Запрос на сбор комментариев принят",
        data: { total: (trends || []).length, telegram: tgTrends.length, vk: vkTrends.length }
      });
    } catch (error: any) {
      console.error(`[Trends] collect-comments error: ${error.message}`);
      res.status(500).json({ success: false, error: "Ошибка при запуске сбора комментариев" });
    }
  });

  /**
   * Запуск сбора комментариев для одного тренда
   */
  app.post("/api/trends/collect-comments-single", authenticateUser, async (req: Request, res: Response) => {
    try {
      const { trendId, campaignId } = req.body;

      if (!trendId) {
        return res.status(400).json({ success: false, error: "trendId обязателен" });
      }

      console.log(`[Trends] collect-comments-single: trendId=${trendId} campaign=${campaignId}`);

      const trends = await directusCrud.list('campaign_trend_topics', {
        filter: { id: { _eq: trendId } },
        limit: 1,
        useAdminToken: true
      }) as any[];

      const trend = trends?.[0];
      if (!trend) {
        return res.status(404).json({ success: false, error: "Тренд не найден" });
      }

      const urlPost = (trend.urlPost || trend.url_post || '').trim();
      if (!urlPost) {
        return res.status(400).json({ success: false, error: "У тренда нет urlPost" });
      }

      if (urlPost.includes('t.me/')) {
        callBatchCollectComments('telegram', [{ id: trend.id, urlPost }])
          .catch(e => console.error('[Trends] TG single error:', e.message));
      } else if (urlPost.includes('vk.com/') || urlPost.includes('vk.ru/')) {
        callBatchCollectComments('vk', [{ id: trend.id, urlPost }])
          .catch(e => console.error('[Trends] VK single error:', e.message));
      } else {
        console.warn(`[Trends] collect-comments-single: unknown platform for ${urlPost}`);
      }

      res.json({ success: true, message: "Запрос на сбор комментариев принят" });
    } catch (error: any) {
      console.error(`[Trends] collect-comments-single error: ${error.message}`);
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
   * Callback от скрейпера (217.26.25.95) с результатами сбора комментариев.
   *
   * Batch (collect-comments-batch):
   *   { task_id, status, results: [{ post_url, comments }] }
   *
   * Single (collect-comments):
   *   { task_id, status, post_url, comments }
   *   или { post_url, comments }
   *   или { result: { post_url, comments } }
   */
  app.post("/api/trends/collect-comments-callback", async (req: Request, res: Response) => {
    try {
      const bodyStr = JSON.stringify(req.body).substring(0, 2000);
      console.log(`[CommentCallback] Received. body(2000):\n${bodyStr}`);

      // ── Нормализуем входящие данные в единый массив items ────────────────────
      type RawItem = { original_link?: string; post_url?: string; comments: any[] };
      let items: RawItem[] = [];

      if (Array.isArray(req.body)) {
        items = req.body;
      } else if (Array.isArray(req.body?.results)) {
        // Батч: { task_id, status, results: [{ post_url, comments }] }
        items = req.body.results;
      } else if (Array.isArray(req.body?.body)) {
        items = req.body.body;
      } else if (req.body?.post_url || req.body?.result?.post_url) {
        // Одиночный: { post_url, comments } или { result: { post_url, comments } }
        const post_url = req.body.post_url ?? req.body.result?.post_url;
        const comments = req.body.comments ?? req.body.result?.comments ?? [];
        items = [{ post_url, original_link: post_url, comments }];
      } else if (req.body?.status === 'error') {
        console.error(`[CommentCallback] Scraper error: ${req.body.error}`);
        return res.json({ success: true });
      } else {
        console.warn(`[CommentCallback] Unrecognized body format, keys=${Object.keys(req.body || {}).join(',')}`);
        return res.json({ success: true });
      }

      if (items.length === 0) {
        console.log('[CommentCallback] No items');
        return res.json({ success: true });
      }

      console.log(`[CommentCallback] Processing ${items.length} post(s)`);

      /** Варианты URL для поиска в Directus (скрейпер может вернуть чуть иначе) */
      function urlVariants(url: string): string[] {
        const u = url.trim();
        const variants = new Set<string>();
        variants.add(u);
        variants.add(u.toLowerCase());
        // без trailing slash
        variants.add(u.replace(/\/$/, ''));
        variants.add(u.toLowerCase().replace(/\/$/, ''));
        // с trailing slash
        variants.add(`${u}/`);
        // без https://
        const noProto = u.replace(/^https?:\/\//i, '');
        variants.add(`https://${noProto}`);
        variants.add(`http://${noProto}`);
        variants.add(noProto);
        return [...variants].filter(Boolean);
      }

      /** Ищет trendId по URL: сначала в памяти (Map), потом в Directus по всем вариантам */
      async function findTrendId(postUrl: string): Promise<string | undefined> {
        const key = postUrl.toLowerCase().trim();
        const pending = pendingCommentUrls.get(key);
        if (pending) {
          pendingCommentUrls.delete(key);
          return pending.trendId;
        }
        // Также проверяем все варианты URL в Map
        for (const v of urlVariants(postUrl)) {
          const p = pendingCommentUrls.get(v.toLowerCase());
          if (p) { pendingCommentUrls.delete(v.toLowerCase()); return p.trendId; }
        }
        // Fallback: Directus — ищем по всем вариантам URL
        const variants = urlVariants(postUrl);
        const found = await directusCrud.list('campaign_trend_topics', {
          filter: { urlPost: { _in: variants } },
          limit: 1,
          useAdminToken: true
        });
        if (found?.[0]?.id) return found[0].id;
        console.warn(`[CommentCallback] Trend not found. Tried variants: ${variants.join(' | ')}`);
        return undefined;
      }

      let totalSaved = 0;

      for (const item of items) {
        const postUrl = (item.original_link || item.post_url || '').trim();
        const comments = item.comments;

        if (!postUrl || !Array.isArray(comments)) {
          console.warn(`[CommentCallback] Skipping item: no postUrl or comments not array`);
          continue;
        }
        if (comments.length === 0) {
          console.log(`[CommentCallback] 0 comments for ${postUrl}`);
          continue;
        }

        const trendId = await findTrendId(postUrl);
        if (!trendId) continue;

        const platform = postUrl.includes('vk.') ? 'vk' : 'telegram';
        console.log(`[CommentCallback] trend=${trendId} platform=${platform} comments_in=${comments.length} url=${postUrl}`);

        let saved = 0;
        for (const comment of comments) {
          if (!comment.text || !String(comment.text).trim()) continue;

          // Дата: Unix-секунды → ISO  или  ISO строка → ISO
          let commentDate = new Date().toISOString();
          if (comment.date) {
            if (typeof comment.date === 'number') {
              const ms = String(comment.date).length <= 11 ? comment.date * 1000 : comment.date;
              commentDate = new Date(ms).toISOString();
            } else if (typeof comment.date === 'string') {
              const parsed = new Date(comment.date);
              if (!isNaN(parsed.getTime())) commentDate = parsed.toISOString();
            }
          }

          try {
            await directusCrud.create('post_comment', {
              trent_post_id: trendId,
              comment_id: String(comment.id ?? comment.comment_id ?? ''),
              text: String(comment.text),
              author: String(comment.from_id ?? comment.author_name ?? comment.author ?? ''),
              date: commentDate,
              platform
            }, { useAdminToken: true });
            saved++;
            totalSaved++;
          } catch (e: any) {
            const msg: string = e.message || '';
            if (!msg.includes('duplicate') && !msg.includes('unique') && !msg.includes('UNIQUE')) {
              console.warn(`[CommentCallback] Save error trend=${trendId}: ${msg}`);
            }
          }
        }

        console.log(`[CommentCallback] Saved ${saved}/${comments.length} for trend=${trendId}`);

        // Обновляем счётчик комментариев в тренде (реальное количество сохранённых)
        if (saved > 0) {
          try {
            // Получаем текущий счётчик, суммируем
            const trendRec = await directusCrud.list('campaign_trend_topics', {
              filter: { id: { _eq: trendId } },
              fields: ['id', 'comments'],
              limit: 1,
              useAdminToken: true
            });
            const existing = Number(trendRec?.[0]?.comments ?? 0);
            await directusCrud.update('campaign_trend_topics', trendId, {
              comments: existing + saved
            }, { useAdminToken: true });
            console.log(`[CommentCallback] Updated trend ${trendId} comments: ${existing} → ${existing + saved}`);
          } catch (upd: any) {
            console.warn(`[CommentCallback] Failed to update trend comments count: ${upd.message}`);
          }
        }
      }

      console.log(`[CommentCallback] Done. Total saved: ${totalSaved}`);
      res.json({ success: true, saved: totalSaved });
    } catch (error: any) {
      console.error(`[CommentCallback] Fatal: ${error.message}`);
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

  // ──────────────────────────────────────────────────────────────────────────
  // Scraper Analytics API (прокси к http://217.26.25.95:3030/api/v1/...)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/scraper/monitoring/channels — список зарегистрированных каналов
   */
  app.get('/api/scraper/monitoring/channels', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { getMonitoredChannels } = await import('../services/scraper-analytics');
      const channels = await getMonitoredChannels();
      res.json({ success: true, data: channels });
    } catch (err: any) {
      log(`[ScraperAnalytics] GET monitoring/channels error: ${err.message}`, 'error');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/scraper/monitoring/channels — зарегистрировать канал
   */
  app.post('/api/scraper/monitoring/channels', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { platform, platform_channel_id, name, metadata } = req.body;
      if (!platform || !platform_channel_id) {
        return res.status(400).json({ success: false, error: 'platform и platform_channel_id обязательны' });
      }
      const { createMonitoringChannel } = await import('../services/scraper-analytics');
      const channel = await createMonitoringChannel({ platform, platform_channel_id, name, metadata });
      if (!channel) return res.status(502).json({ success: false, error: 'Скрейпер не ответил' });
      res.json({ success: true, data: channel });
    } catch (err: any) {
      log(`[ScraperAnalytics] POST monitoring/channels error: ${err.message}`, 'error');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/scraper/channels/:channelId/overview — обзор канала
   */
  app.get('/api/scraper/channels/:channelId/overview', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { channelId } = req.params;
      const { getChannelOverview } = await import('../services/scraper-analytics');
      const overview = await getChannelOverview(channelId);
      if (!overview) return res.status(404).json({ success: false, error: 'Канал не найден или нет данных' });
      res.json({ success: true, data: overview });
    } catch (err: any) {
      log(`[ScraperAnalytics] GET overview error: ${err.message}`, 'error');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/scraper/channels/:channelId/analytics — аналитика за период
   * Query: from_date, to_date, granularity (day|week|month)
   */
  app.get('/api/scraper/channels/:channelId/analytics', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { channelId } = req.params;
      const { from_date, to_date, granularity } = req.query as Record<string, string>;
      const { getChannelAnalytics } = await import('../services/scraper-analytics');
      const data = await getChannelAnalytics(channelId, {
        from_date,
        to_date,
        granularity: (granularity as any) || 'day'
      });
      if (!data) return res.status(404).json({ success: false, error: 'Нет данных аналитики' });
      res.json({ success: true, data });
    } catch (err: any) {
      log(`[ScraperAnalytics] GET analytics error: ${err.message}`, 'error');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/scraper/trends/posts — топ постов из скрейпера
   * Query: platform, from_date, to_date, limit, channel_ids (comma-separated)
   */
  app.get('/api/scraper/trends/posts', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { platform, from_date, to_date, limit, channel_ids } = req.query as Record<string, string>;
      const { getTrendingPosts } = await import('../services/scraper-analytics');
      const posts = await getTrendingPosts({
        platform,
        from_date,
        to_date,
        limit: limit ? Number(limit) : 50,
        channel_ids: channel_ids ? channel_ids.split(',') : undefined
      });
      res.json({ success: true, data: posts, total: posts.length });
    } catch (err: any) {
      log(`[ScraperAnalytics] GET trends/posts error: ${err.message}`, 'error');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/scraper/trends/hashtags — топ хэштегов
   * Query: platform, from_date, to_date, limit
   */
  app.get('/api/scraper/trends/hashtags', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { platform, from_date, to_date, limit } = req.query as Record<string, string>;
      const { getTrendingHashtags } = await import('../services/scraper-analytics');
      const hashtags = await getTrendingHashtags({
        platform,
        from_date,
        to_date,
        limit: limit ? Number(limit) : 30
      });
      res.json({ success: true, data: hashtags, total: hashtags.length });
    } catch (err: any) {
      log(`[ScraperAnalytics] GET trends/hashtags error: ${err.message}`, 'error');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/scraper/analytics/engagement — сравнительный engagement
   * Query: platform, channel_ids (comma-separated), from_date, to_date
   */
  app.get('/api/scraper/analytics/engagement', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { platform, channel_ids, from_date, to_date } = req.query as Record<string, string>;
      const { getEngagementComparison } = await import('../services/scraper-analytics');
      const data = await getEngagementComparison({
        platform,
        from_date,
        to_date,
        channel_ids: channel_ids ? channel_ids.split(',') : undefined
      });
      res.json({ success: true, data, total: data.length });
    } catch (err: any) {
      log(`[ScraperAnalytics] GET analytics/engagement error: ${err.message}`, 'error');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/scraper/monitoring/sync-campaign — авторегистрация каналов кампании в скрейпере
   * Body: { campaignId }
   */
  app.post('/api/scraper/monitoring/sync-campaign', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.body;
      if (!campaignId) return res.status(400).json({ success: false, error: 'campaignId обязателен' });

      const sources = await directusCrud.list('campaign_content_sources', {
        filter: { campaign_id: { _eq: campaignId } },
        fields: ['id', 'type', 'TgId', 'vkId', 'name', 'url'],
        limit: -1,
        useAdminToken: true
      }) as any[];

      const channels: Array<{ platform: string; id: string; name?: string }> = [];
      for (const s of sources || []) {
        const type = (s.type || '').toLowerCase();
        if (type === 'telegram' && s.TgId) {
          channels.push({ platform: 'telegram', id: s.TgId, name: s.name });
        } else if (type === 'vk' && s.vkId) {
          channels.push({ platform: 'vk', id: String(s.vkId), name: s.name });
        }
      }

      if (channels.length === 0) {
        return res.json({ success: true, registered: 0, message: 'Нет TG/VK каналов в кампании' });
      }

      const { ensureChannelsRegistered } = await import('../services/scraper-analytics');
      const idMap = await ensureChannelsRegistered(channels);

      res.json({
        success: true,
        registered: idMap.size,
        total: channels.length,
        message: `Зарегистрировано/найдено ${idMap.size} из ${channels.length} каналов`
      });
    } catch (err: any) {
      log(`[ScraperAnalytics] sync-campaign error: ${err.message}`, 'error');
      res.status(500).json({ success: false, error: err.message });
    }
  });
}

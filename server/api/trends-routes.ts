import { Express, Request, Response } from 'express';
import { authenticateUser } from '../middleware/user-auth';
import { directusApi } from '../directus';
import { directusCrud } from '../services/directus-crud';
import { log } from '../utils/logger';
import axios from 'axios';
import { DeepSeekService } from '../services/deepseek';
import { apiKeyService, ApiServiceName } from '../services/api-keys';
import { globalApiKeysService } from '../services/global-api-keys';
import { getPublicBaseUrl, SCRAPER_BASE, getScraperApiKey } from '../services/trend-collector';
import { geminiDirect } from '../services/gemini-direct';

// ─── AI фоллбэк для поиска каналов ───────────────────────────────────────────

/** Генерирует альтернативные поисковые запросы через Gemini API (через Cloudflare Worker прокси) */
async function generateAIAlternativeQueries(originalKeywords: string[], platform: 'telegram' | 'vk'): Promise<string[]> {
  const prompt = `Ты — эксперт по поиску каналов и сообществ в социальных сетях. Сгенерируй короткие поисковые запросы (2-3 слова) для поиска ${platform === 'telegram' ? 'Telegram-каналов' : 'VK-групп'} по следующим тематикам:

Тематики: ${originalKeywords.join(', ')}

Требования:
- Запросы должны быть на русском языке
- Каждый запрос — 2-3 слова максимум
- Запросы должны быть релевантны исходным тематикам
- Используй синонимы и смежные темы
- Верни ТОЛЬКО массив JSON строк, без markdown

Пример формата: ["запрос1", "запрос2", "запрос3"]`;

  try {
    // Получаем API ключ из环境 или Directus
    let apiKey = process.env.GEMINI_API_KEY;
    console.log(`[AI Fallback] GEMINI_API_KEY из env: ${apiKey ? 'есть' : 'нет'}`);
    if (!apiKey) {
      const { globalApiKeysService } = await import('../services/global-api-keys');
      const { ApiServiceName } = await import('../services/api-keys');
      apiKey = await globalApiKeysService.getGlobalApiKey(ApiServiceName.GEMINI) || undefined;
      console.log(`[AI Fallback] GEMINI_API_KEY из Directus: ${apiKey ? 'есть' : 'нет'}`);
    }
    if (!apiKey) {
      console.error(`[AI Fallback] GEMINI_API_KEY не настроен`);
      return [];
    }

    // Формируем URL через Cloudflare Worker прокси
    let baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const workerProxy = process.env.GEMINI_PROXY_URL;
    console.log(`[AI Fallback] GEMINI_PROXY_URL: ${workerProxy || 'не задан'}`);
    if (workerProxy) {
      try {
        const proxyUrl = new URL(workerProxy);
        const originalUrl = new URL(baseUrl);
        originalUrl.host = proxyUrl.host;
        originalUrl.protocol = proxyUrl.protocol;
        baseUrl = originalUrl.toString();
      } catch (e) {
        // если неверный URL прокси — используем прямой
      }
    }
    console.log(`[AI Fallback] URL: ${baseUrl.substring(0, 80)}...`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    console.log(`[AI Fallback] Response status: ${response.status}`);

    const data = await response.json();
    console.log(`[AI Fallback] Response data: ${JSON.stringify(data).substring(0, 300)}`);

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) {
      console.error(`[AI Fallback] Пустой ответ от Gemini: ${JSON.stringify(data).substring(0, 200)}`);
      return [];
    }

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const queries = JSON.parse(jsonMatch[0]);
        if (Array.isArray(queries) && queries.length > 0) {
          console.log(`[AI Fallback] Сгенерировано ${queries.length} запросов: ${queries.join(', ')}`);
          return queries.slice(0, 13);
        }
      } catch (parseErr) {
        // Если JSON обрезан — пробуем извлечь строки вручную
        const stringMatches = jsonMatch[0].match(/"([^"]+)"/g);
        if (stringMatches && stringMatches.length > 0) {
          const queries = stringMatches.map(s => s.replace(/"/g, ''));
          console.log(`[AI Fallback] Извлечено ${queries.length} запросов из обрезанного JSON: ${queries.join(', ')}`);
          return queries.slice(0, 13);
        }
      }
    }
    console.error(`[AI Fallback] Не удалось распарсить JSON из ответа: ${text.substring(0, 200)}`);
  } catch (err: any) {
    console.error(`[AI Fallback] Ошибка генерации запросов: ${err.message}`);
  }
  return [];
}

/** Повторный запрос к скрейперу с новыми запросами и регистрацией задачи */
async function callScraperRetry(
  endpoint: string,
  body: any,
  apiKey: string,
  campaignId: string,
  searchQueries: string[]
): Promise<void> {
  try {
    const url = `${SCRAPER_BASE}${endpoint}`;
    console.log(`[TG AI Retry] → ${endpoint} queries=${JSON.stringify(searchQueries)}`);
    const response = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      timeout: 45000,
    });
    const data = response.data;
    console.log(`[TG AI Retry] ← status=${response.status}`);

    // Извлекаем task_id и регистрируем для callback
    const taskIds: string[] = [];
    for (const arr of [data.task_ids, data.taskIds, data.tasks]) {
      if (Array.isArray(arr)) {
        for (const v of arr) {
          if (v?.task_id) taskIds.push(v.task_id);
          else if (typeof v === 'string') taskIds.push(v);
        }
      }
    }
    if (taskIds.length === 0 && data.task_id) {
      taskIds.push(data.task_id);
    }

    const { pendingTgFindGroupsTasks } = await import('../services/trend-collector');
    for (const tid of taskIds) {
      pendingTgFindGroupsTasks.set(String(tid), {
        campaignId,
        keywords: searchQueries,
        minMembers: body.min_members,
        maxGroups: body.limit,
        createdAt: Date.now(),
        isAiRetry: true,
      });
      console.log(`[TG AI Retry] 📝 Зарегистрирована задача ${tid} для кампании ${campaignId}`);
    }
  } catch (err: any) {
    console.error(`[TG AI Retry] ❌ Ошибка: ${err.message}`);
  }
}

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
    const aiResponse = await geminiDirect.generateContent({
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

      // Параметры: читаются из настроек кампании (campaignTrendSettings)
      const collectionDays = req.body.collectionDays ?? req.body.day_past ?? campaignTrendSettings.collectionDays ?? 7;
      const minViews = req.body.minViews ?? campaignTrendSettings.minViews ?? 300;
      const maxTrendsPerSource = req.body.maxTrendsPerSource ?? campaignTrendSettings.maxTrendsPerSource ?? 5;
      const maxSourcesPerPlatform = campaignTrendSettings.maxSourcesPerPlatform || undefined; // Из настроек кампании
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

      log(`[Trends Route] Параметры: days=${collectionDays}, maxTrends=${maxTrendsPerSource}, collectSources=${collectSources}, keywords=${resolvedKeywords.length}, platforms=${JSON.stringify(platforms)}`, 'info');

      // Если запущен сбор источников (скрейпер), проверяем что в настройках кампании задан лимит
      if (collectSources && !maxSourcesPerPlatform) {
        return res.status(400).json({
          success: false,
          error: 'Настройте лимит источников в настройках кампании (Параметры сбора трендов → Лимиты источников), иначе запуск сбора невозможен.'
        });
      }

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
            minFollowers,
            sourcesList: Array.isArray(sourcesList) && sourcesList.length > 0 ? sourcesList : undefined
          });
          log(`[Trends Route] ✅ Прямой сбор завершён: TG=${result.telegram}, VK=${result.vk}, YT=${result.youtube}, IG=${result.instagram}, total=${result.total}`, 'info');

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
          maxTrendsPerSource
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

      // result может быть массивом каналов (каждый со своим posts) или объектом с posts
      let posts: any[] = [];
      if (Array.isArray(result)) {
        for (const item of result) {
          if (Array.isArray(item?.posts) && item.posts.length > 0) {
            posts.push(...item.posts);
          }
        }
      } else {
        posts = result?.posts || result?.items || result?.data || body?.posts || [];
      }

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
   * POST /api/trends/vk-webhook
   * Скрейпер POSTит сюда результат VK-задачи когда готово.
   * Формат: { task_id, status, result: { posts: [...] }, error }
   * Задача была зарегистрирована в pendingVkTasks в trend-collector.ts.
   */
  app.post("/api/trends/vk-webhook", async (req: Request, res: Response) => {
    res.json({ success: true });

    try {
      const body = req.body;
      console.log(`[VK Webhook] 📥 Получен колбэк: ${JSON.stringify(body).substring(0, 800)}`);

      const taskId = body?.task_id || body?.taskId || body?.job_id || body?.id || body?.result?.task_id;
      const status = (body?.status ?? body?.result?.status ?? '').toString().toLowerCase();
      const errorMsg = body?.error || body?.result?.error;

      const isFailure = !!errorMsg || ['error', 'failed', 'failure'].includes(status);
      if (isFailure) {
        console.error(`[VK Webhook] ❌ Задача ${taskId} с ошибкой: ${errorMsg || status}`);
        if (taskId) {
          const { pendingVkTasks } = await import('../services/trend-collector');
          pendingVkTasks.delete(String(taskId));
        }
        return;
      }

      const result = body?.result || body;

      // result может быть массивом групп (каждая со своим posts) или объектом с posts
      let posts: any[] = [];
      if (Array.isArray(result)) {
        for (const item of result) {
          if (Array.isArray(item?.posts) && item.posts.length > 0) {
            posts.push(...item.posts);
          }
        }
      } else {
        posts = result?.posts || result?.items || result?.data || body?.posts || [];
      }

      console.log(`[VK Webhook] task_id=${taskId} | status=${status || '—'} | posts=${posts.length}`);

      if (!taskId) {
        console.warn(`[VK Webhook] ⚠️ Нет task_id в теле — невозможно найти кампанию`);
        return;
      }

      const { pendingVkTasks, saveTrendPosts } = await import('../services/trend-collector');
      const task = pendingVkTasks.get(String(taskId));

      if (!task) {
        console.warn(`[VK Webhook] ⚠️ task_id=${taskId} НЕ найден в реестре (истёк TTL или неизвестный id)`);
        return;
      }

      if (posts.length === 0) {
        console.log(`[VK Webhook] ℹ️ Нет постов в колбэке для кампании ${task.campaignId}`);
        pendingVkTasks.delete(String(taskId));
        return;
      }

      const saved = await saveTrendPosts(posts, 'vk', task.campaignId, task.sourceIdMap);
      console.log(`[VK Webhook] ✅ Сохранено ${saved} VK-постов для кампании ${task.campaignId}`);
      pendingVkTasks.delete(String(taskId));
    } catch (error: any) {
      console.error(`[VK Webhook] 💥 Критическая ошибка: ${error.message}`);
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
   * POST /api/trends/tg-find-groups-webhook
   * Колбэк от find-groups-batch для Telegram — скрейпер присылает найденные каналы.
   */
  app.post("/api/trends/tg-find-groups-webhook", async (req: Request, res: Response) => {
    res.json({ success: true });
    try {
      const body = req.body;
      console.log(`[TG FindGroups Webhook] 📥 ${JSON.stringify(body).substring(0, 500)}`);

      const taskId = body?.task_id || body?.taskId || body?.job_id || body?.id;
      const status = (body?.status ?? body?.result?.status ?? '').toString().toLowerCase();
      const errorMsg = body?.error || body?.result?.error;

      if (errorMsg || ['error', 'failed', 'failure'].includes(status)) {
        console.error(`[TG FindGroups Webhook] ❌ task=${taskId} ошибка: ${errorMsg || status}`);
        if (taskId) {
          const { pendingTgFindGroupsTasks } = await import('../services/trend-collector');
          pendingTgFindGroupsTasks.delete(String(taskId));
        }
        return;
      }

      // Формат скрейпера: result.results[].groups[] (батчи по ключам)
      const results = body?.result?.results || [];
      const channels: any[] = [];
      for (const r of results) {
        if (Array.isArray(r?.groups)) channels.push(...r.groups);
      }
      // Также поддерживаем старый формат
      if (channels.length === 0) {
        const legacy = body?.result?.channels || body?.result?.groups || body?.channels || body?.groups || [];
        if (Array.isArray(legacy)) channels.push(...legacy);
      }
      console.log(`[TG FindGroups Webhook] task=${taskId} | каналов=${channels.length}`);

      // Получаем task ДО удаления
      const { pendingTgFindGroupsTasks, saveSourcesToDB } = await import('../services/trend-collector');
      const task = taskId ? pendingTgFindGroupsTasks.get(String(taskId)) : null;
      const campaignId = task?.campaignId;
      if (taskId) {
        pendingTgFindGroupsTasks.delete(String(taskId));
      }

      // Если каналов 0 — генерируем альтернативные запросы через ИИ и повторяем поиск (только для НЕ retry задач)
      if (channels.length === 0 && task?.keywords?.length > 0 && campaignId && !task?.isAiRetry) {
        console.log(`[TG FindGroups Webhook] 🔄 0 каналов — генерирую альтернативные запросы через ИИ`);
        try {
          const altQueries = await generateAIAlternativeQueries(task.keywords, 'telegram');
          if (altQueries.length > 0) {
            console.log(`[TG FindGroups Webhook] 🤖 Альтернативные запросы: ${altQueries.join(', ')}`);
            // Повторяем поиск с альтернативными запросами
            const { getScraperApiKey } = await import('../services/trend-collector');
            const apiKey = await getScraperApiKey();
            const retryData = await callScraperRetry('/api/telegram/find-groups-batch', {
              queries: altQueries,
              limit: task.maxGroups,
              min_members: task.minMembers,
              unified: false,
              strict_min_members: true,
              async_mode: true,
              callback_url: `${getPublicBaseUrl()}/api/trends/tg-find-groups-webhook`,
              max_days_since_last_post: 30,
              include_channels_without_data: false,
              check_missing_activity: true,
            }, apiKey, campaignId, altQueries);
          }
        } catch (aiErr: any) {
          console.error(`[TG FindGroups Webhook] ❌ Ошибка ИИ фоллбэка: ${aiErr.message}`);
        }
      }

      // AI-фильтрация релевантности перед сохранением
      if (channels.length > 0 && task?.keywords?.length > 0) {
        try {
          const { filterByRelevance } = await import('../services/ai-relevance-filter');
          const filterResult = await filterByRelevance(channels, task.keywords, 'telegram');
          console.log(`[TG FindGroups Webhook] AI-фильтрация: ${filterResult.relevant.length}/${channels.length} релевантных`);
          if (filterResult.relevant.length > 0) {
            channels.length = 0;
            channels.push(...filterResult.relevant);
          }
        } catch (filterErr: any) {
          console.error(`[TG FindGroups Webhook] ⚠️ AI-фильтрация не удалась: ${filterErr.message}, сохраняем все`);
        }
      }

      // Сохраняем найденные каналы как источники
      if (channels.length > 0) {
        if (campaignId) {
          const saved = await saveSourcesToDB('telegram', channels, campaignId);
          console.log(`[TG FindGroups Webhook] ✅ Сохранено ${saved.savedIds.length} каналов для кампании ${campaignId}`);
        } else {
          console.log(`[TG FindGroups Webhook] ⚠️ Нет campaignId — каналы не сохранены: ${channels.map((c: any) => c.title || c.username || c.id).join(', ')}`);
        }
      }
    } catch (error: any) {
      console.error(`[TG FindGroups Webhook] 💥 ${error.message}`);
    }
  });

  /**
   * POST /api/trends/vk-find-groups-webhook
   * Колбэк от find-groups-batch для VK — скрейпер присылает найденные группы.
   */
  app.post("/api/trends/vk-find-groups-webhook", async (req: Request, res: Response) => {
    res.json({ success: true });
    try {
      const body = req.body;
      console.log(`[VK FindGroups Webhook] 📥 ${JSON.stringify(body).substring(0, 500)}`);

      const taskId = body?.task_id || body?.taskId || body?.job_id || body?.id;
      const status = (body?.status ?? body?.result?.status ?? '').toString().toLowerCase();
      const errorMsg = body?.error || body?.result?.error;

      if (errorMsg || ['error', 'failed', 'failure'].includes(status)) {
        console.error(`[VK FindGroups Webhook] ❌ task=${taskId} ошибка: ${errorMsg || status}`);
        if (taskId) {
          const { pendingVkFindGroupsTasks } = await import('../services/trend-collector');
          pendingVkFindGroupsTasks.delete(String(taskId));
        }
        return;
      }

      // Формат скрейпера: result.results[].groups[]
      const results = body?.result?.results || [];
      const groups: any[] = [];
      for (const r of results) {
        if (Array.isArray(r?.groups)) groups.push(...r.groups);
      }
      // Старый формат
      if (groups.length === 0) {
        const legacy = body?.result?.groups || body?.groups || [];
        if (Array.isArray(legacy)) groups.push(...legacy);
      }
      console.log(`[VK FindGroups Webhook] task=${taskId} | групп=${groups.length}`);

      // Получаем task ДО удаления
      const { saveSourcesToDB, pendingVkFindGroupsTasks } = await import('../services/trend-collector');
      const task = taskId ? pendingVkFindGroupsTasks.get(String(taskId)) : null;
      const campaignId = task?.campaignId;
      if (taskId) {
        pendingVkFindGroupsTasks.delete(String(taskId));
      }

      // Если групп 0 — генерируем альтернативные запросы через ИИ и повторяем поиск (только для НЕ retry задач)
      if (groups.length === 0 && task?.keywords?.length > 0 && campaignId && !task?.isAiRetry) {
        console.log(`[VK FindGroups Webhook] 🔄 0 групп — генерирую альтернативные запросы через ИИ`);
        try {
          const altQueries = await generateAIAlternativeQueries(task.keywords, 'vk');
          if (altQueries.length > 0) {
            console.log(`[VK FindGroups Webhook] 🤖 Альтернативные запросы: ${altQueries.join(', ')}`);
            const apiKey = await getScraperApiKey();
            const url = `${SCRAPER_BASE}/api/vk/find-groups-batch`;
            const retryBody = {
              queries: altQueries,
              limit: task.maxGroups,
              min_members: task.minMembers,
              unified: false,
              strict_min_members: true,
              async_mode: true,
              callback_url: `${getPublicBaseUrl()}/api/trends/vk-find-groups-webhook`,
            };
            const retryResponse = await axios.post(url, retryBody, {
              headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
              timeout: 45000,
            });
            const retryData = retryResponse.data;
            const retryTaskIds: string[] = [];
            for (const arr of [retryData.task_ids, retryData.tasks]) {
              if (Array.isArray(arr)) {
                for (const v of arr) {
                  if (v?.task_id) retryTaskIds.push(v.task_id);
                  else if (typeof v === 'string') retryTaskIds.push(v);
                }
              }
            }
            if (retryTaskIds.length === 0 && retryData.task_id) retryTaskIds.push(retryData.task_id);
            for (const tid of retryTaskIds) {
              pendingVkFindGroupsTasks.set(String(tid), {
                campaignId, keywords: altQueries, minMembers: task.minMembers,
                maxGroups: task.maxGroups, createdAt: Date.now(), isAiRetry: true,
              });
              console.log(`[VK AI Retry] 📝 Зарегистрирована задача ${tid}`);
            }
          }
        } catch (aiErr: any) {
          console.error(`[VK FindGroups Webhook] ❌ Ошибка ИИ фоллбэка: ${aiErr.message}`);
        }
      }

      // AI-фильтрация релевантности перед сохранением
      if (groups.length > 0 && task?.keywords?.length > 0) {
        try {
          const { filterByRelevance } = await import('../services/ai-relevance-filter');
          const filterResult = await filterByRelevance(groups, task.keywords, 'vk');
          console.log(`[VK FindGroups Webhook] AI-фильтрация: ${filterResult.relevant.length}/${groups.length} релевантных`);
          if (filterResult.relevant.length > 0) {
            groups.length = 0;
            groups.push(...filterResult.relevant);
          }
        } catch (filterErr: any) {
          console.error(`[VK FindGroups Webhook] ⚠️ AI-фильтрация не удалась: ${filterErr.message}, сохраняем все`);
        }
      }

      // Сохраняем найденные группы как источники
      if (groups.length > 0) {
        if (campaignId) {
          const saved = await saveSourcesToDB('vk', groups, campaignId);
          console.log(`[VK FindGroups Webhook] ✅ Сохранено ${saved.savedIds.length} групп для кампании ${campaignId}`);
        } else {
          console.log(`[VK FindGroups Webhook] ⚠️ Нет campaignId — группы не сохранены: ${groups.map((g: any) => g.name || g.screen_name || g.id).join(', ')}`);
        }
      }
    } catch (error: any) {
      console.error(`[VK FindGroups Webhook] 💥 ${error.message}`);
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

  // ─── Варианты URL для поиска тренда в Directus ──────────────────────────────
  function urlVariants(url: string): string[] {
    const u = url.trim();
    const set = new Set<string>();
    set.add(u);
    set.add(u.toLowerCase());
    set.add(u.replace(/\/$/, ''));
    set.add(u.toLowerCase().replace(/\/$/, ''));
    set.add(`${u}/`);
    const noProto = u.replace(/^https?:\/\//i, '');
    set.add(`https://${noProto}`);
    set.add(`http://${noProto}`);
    set.add(noProto);
    return [...set].filter(Boolean);
  }

  // ─── Поиск trendId по URL (Map → Directus fallback) ─────────────────────────
  async function findTrendId(postUrl: string): Promise<string | undefined> {
    const key = postUrl.toLowerCase().trim();
    const pending = pendingCommentUrls.get(key);
    if (pending) { pendingCommentUrls.delete(key); return pending.trendId; }
    for (const v of urlVariants(postUrl)) {
      const p = pendingCommentUrls.get(v.toLowerCase());
      if (p) { pendingCommentUrls.delete(v.toLowerCase()); return p.trendId; }
    }
    const found = await directusCrud.list('campaign_trend_topics', {
      filter: { urlPost: { _in: urlVariants(postUrl) } },
      limit: 1,
      useAdminToken: true
    });
    if (found?.[0]?.id) return found[0].id;
    console.warn(`[CommentSave] Trend not found. Variants: ${urlVariants(postUrl).join(' | ')}`);
    return undefined;
  }

  // ─── Сохранение массива items комментариев в Directus ────────────────────────
  async function processCommentItems(
    items: Array<{ original_link?: string; post_url?: string; comments: any[] }>,
    label: string
  ): Promise<number> {
    let totalSaved = 0;
    for (const item of items) {
      const postUrl = (item.original_link || item.post_url || '').trim();
      const comments = item.comments;
      if (!postUrl || !Array.isArray(comments) || comments.length === 0) continue;

      const trendId = await findTrendId(postUrl);
      if (!trendId) continue;

      const platform = postUrl.includes('vk.') ? 'vk' : 'telegram';
      console.log(`[${label}] trend=${trendId} platform=${platform} comments_in=${comments.length} url=${postUrl}`);

      let saved = 0;
      for (const comment of comments) {
        if (!comment.text || !String(comment.text).trim()) continue;
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
          const errCode: string = e.response?.data?.errors?.[0]?.extensions?.code || '';
          const msg: string = e.message || '';
          const isDuplicate = errCode === 'RECORD_NOT_UNIQUE' ||
            msg.includes('duplicate') || msg.includes('unique') || msg.includes('UNIQUE');
          if (!isDuplicate) {
            console.warn(`[${label}] Save error trend=${trendId}: ${msg}`);
          }
        }
      }
      console.log(`[${label}] Saved ${saved}/${comments.length} for trend=${trendId}`);

      if (saved > 0) {
        try {
          // Считаем реальное кол-во комментариев из БД, а не инкремент
          const actualComments = await directusCrud.list('post_comment', {
            filter: { trent_post_id: { _eq: trendId } },
            fields: ['id'],
            limit: -1,
            useAdminToken: true
          }) as any[];
          const actualCount = actualComments?.length ?? 0;
          await directusCrud.update('campaign_trend_topics', trendId, { comments: actualCount }, { useAdminToken: true });
          console.log(`[${label}] trend ${trendId} comments set to actual count: ${actualCount}`);
        } catch (upd: any) {
          console.warn(`[${label}] Failed to update trend comments count: ${upd.message}`);
        }
      }
    }
    return totalSaved;
  }

  // ─── Нормализация тела ответа скрейпера в массив items ───────────────────────
  // Форматы скрейпера:
  //   { task_id, status:"done", result: { status:"completed", results: [...] } }  ← основной
  //   { task_id, status, results: [...] }
  //   [...]
  //   { post_url, comments }  или  { result: { post_url, comments } }
  function normalizeScraperBody(body: any): Array<{ original_link?: string; post_url?: string; comments: any[] }> | null {
    if (Array.isArray(body)) return body;
    if (Array.isArray(body?.results)) return body.results;
    if (Array.isArray(body?.result?.results)) return body.result.results;       // VK callback format
    if (Array.isArray(body?.result?.posts_results)) return body.result.posts_results; // Telegram callback format
    if (Array.isArray(body?.body)) return body.body;
    if (body?.post_url || body?.result?.post_url) {
      const post_url = body.post_url ?? body.result?.post_url;
      return [{ post_url, original_link: post_url, comments: body.comments ?? body.result?.comments ?? [] }];
    }
    return null;
  }

  /**
   * Пакетный сбор комментариев через скрейпер (тот же что и для трендов).
   *
   * Telegram: POST /api/telegram/collect-comments-batch
   * VK:       POST /api/vk/collect-comments-batch
   * Оба:      { post_urls[], limit: 1000, download_media: false }
   *
   * Polling вместо callback: скрейпер возвращает task_id, мы опрашиваем
   * GET /tasks/status/{task_id} каждые 15с до status=completed (таймаут 10 мин).
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

    // Регистрируем маппинг urlPost → trendId (пригодится если колбэк всё-таки придёт)
    const now = Date.now();
    for (const t of trends) {
      if (t.urlPost) pendingCommentUrls.set(t.urlPost.toLowerCase().trim(), { trendId: t.id, insertedAt: now });
    }

    const endpoint = platform === 'telegram'
      ? `${COMMENT_SCRAPER_BASE}/api/telegram/collect-comments-batch`
      : `${COMMENT_SCRAPER_BASE}/api/vk/collect-comments-batch`;

    // callback_url оставляем как запасной вариант — вдруг заработает
    const callback_url = `${getPublicBaseUrl()}/api/trends/collect-comments-callback`;
    const payload = { post_urls, limit: 1000, download_media: false, callback_url };

    console.log(`[CommentCollector] ${platform.toUpperCase()} batch: ${post_urls.length} posts → ${endpoint}`);

    let taskId: string | undefined;
    try {
      const resp = await axios.post(endpoint, payload, {
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        timeout: 30000
      });
      console.log(`[CommentCollector] ${platform.toUpperCase()} accepted: HTTP ${resp.status} data=${JSON.stringify(resp.data).substring(0, 300)}`);
      taskId = resp.data?.task_id;
    } catch (err: any) {
      const s = err.response?.status;
      const detail = err.response?.data?.detail ?? err.message;
      const label = `[CommentCollector] ${platform.toUpperCase()}`;
      if (s === 400) console.error(`${label} 400 Bad Request — невалидные параметры: ${detail}`);
      else if (s === 403) console.error(`${label} 403 Forbidden — невалидный api-key или VK-аккаунт заблокирован: ${detail}`);
      else if (s === 404) console.error(`${label} 404 Not Found — канал/пост не найден: ${detail}`);
      else if (s === 500) console.error(`${label} 500 Internal Server Error: ${detail}`);
      else if (s === 502) console.error(`${label} 502 Bad Gateway — ошибка VK/Telegram API: ${detail}`);
      else if (s === 503) console.error(`${label} 503 Service Unavailable — нет активных аккаунтов: ${detail}`);
      else console.error(`${label} submit error: HTTP ${s ?? 'n/a'} ${detail}`);
      return;
    }

    if (!taskId) {
      console.warn(`[CommentCollector] ${platform.toUpperCase()} no task_id in response`);
    } else {
      console.log(`[CommentCollector] ${platform.toUpperCase()} task=${taskId} accepted — waiting for callback`);
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
   * Callback от скрейпера — запасной вариант (polling основной).
   * Форматы: { results: [...] } | [...] | { post_url, comments } | { result: {...} }
   */
  app.post("/api/trends/collect-comments-callback", async (req: Request, res: Response) => {
    try {
      console.log(`[CommentCallback] Received. body(2000):\n${JSON.stringify(req.body).substring(0, 2000)}`);

      if (req.body?.status === 'error') {
        console.error(`[CommentCallback] Scraper error: ${req.body.error}`);
        return res.json({ success: true });
      }

      const items = normalizeScraperBody(req.body);
      if (!items) {
        console.warn(`[CommentCallback] Unrecognized format, keys=${Object.keys(req.body || {}).join(',')}`);
        return res.json({ success: true });
      }
      if (items.length === 0) {
        console.log('[CommentCallback] No items');
        return res.json({ success: true });
      }

      console.log(`[CommentCallback] Processing ${items.length} post(s)`);
      res.json({ success: true });
      processCommentItems(items, 'CommentCallback').then(saved => {
        console.log(`[CommentCallback] Done. Total saved: ${saved}`);
      }).catch(err => {
        console.error(`[CommentCallback] Fatal: ${err.message}`);
      });
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
            aiResponse = await geminiDirect.generateContent({
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
          limit: -1,
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

          const aiResponse = await geminiDirect.generateContent({
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
   * GET /api/scraper/monitoring/channels — список каналов мониторинга
   * Query: platform, is_active, page, page_size, campaignId
   * Если campaignId указан — возвращает только каналы, принадлежащие кампании (Telegram + VK)
   */
  app.get('/api/scraper/monitoring/channels', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { platform, is_active, page, page_size, campaignId } = req.query as Record<string, string>;
      const { getMonitoredChannels } = await import('../services/scraper-analytics');
      const result = await getMonitoredChannels({
        platform: platform || undefined,
        is_active: is_active !== undefined ? is_active === 'true' : undefined,
        page: page ? Number(page) : undefined,
        page_size: page_size ? Number(page_size) : 100
      });

      // Если campaignId передан — фильтруем только собственные каналы кампании
      if (campaignId) {
        const campaign = await directusCrud.getById('user_campaigns', campaignId, { useAdminToken: true }) as any;
        const ownIds = new Set<string>();
        if (campaign?.social_media_settings?.telegram?.chatId) {
          ownIds.add(String(campaign.social_media_settings.telegram.chatId));
        }
        if (campaign?.social_media_settings?.vk?.groupId) {
          ownIds.add(String(campaign.social_media_settings.vk.groupId));
        }
        const filtered = result.items.filter(ch => ownIds.has(ch.platform_channel_id));
        return res.json({ success: true, data: filtered, total: filtered.length, page: 1, page_size: filtered.length });
      }

      res.json({ success: true, data: result.items, total: result.total, page: result.page, page_size: result.page_size });
    } catch (err: any) {
      log(`[ScraperAnalytics] GET monitoring/channels error: ${err.message}`, 'error');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * DELETE /api/scraper/monitoring/channels/:channelId — удалить канал из мониторинга
   */
  app.delete('/api/scraper/monitoring/channels/:channelId', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { channelId } = req.params;
      const { deleteMonitoringChannel } = await import('../services/scraper-analytics');
      const ok = await deleteMonitoringChannel(channelId);
      if (!ok) return res.status(502).json({ success: false, error: 'Не удалось удалить канал' });
      res.json({ success: true });
    } catch (err: any) {
      log(`[ScraperAnalytics] DELETE monitoring/channels error: ${err.message}`, 'error');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/scraper/monitoring/channels/:channelId/parse-status — статус парсинга
   */
  app.get('/api/scraper/monitoring/channels/:channelId/parse-status', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { channelId } = req.params;
      const { getChannelParseStatus } = await import('../services/scraper-analytics');
      const status = await getChannelParseStatus(channelId);
      if (!status) return res.status(404).json({ success: false, error: 'Канал не найден' });
      res.json({ success: true, data: status });
    } catch (err: any) {
      log(`[ScraperAnalytics] GET parse-status error: ${err.message}`, 'error');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/scraper/monitoring/channels/:channelId/force-parse — принудительный парсинг
   */
  app.post('/api/scraper/monitoring/channels/:channelId/force-parse', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { channelId } = req.params;
      const { forceParseChannel } = await import('../services/scraper-analytics');
      const result = await forceParseChannel(channelId);
      if (!result) return res.status(502).json({ success: false, error: 'Скрейпер не ответил' });
      res.json({ success: true, data: result });
    } catch (err: any) {
      log(`[ScraperAnalytics] POST force-parse error: ${err.message}`, 'error');
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
        granularity: (granularity as 'day' | 'week' | 'month') || 'day'
      });
      if (!data) return res.status(404).json({ success: false, error: 'Нет данных аналитики' });
      res.json({ success: true, data });
    } catch (err: any) {
      log(`[ScraperAnalytics] GET analytics error: ${err.message}`, 'error');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/scraper/channels/:channelId/posts — посты канала
   * Query: page, page_size, from_date, to_date
   */
  app.get('/api/scraper/channels/:channelId/posts', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { channelId } = req.params;
      const { page, page_size, from_date, to_date } = req.query as Record<string, string>;
      const { getChannelPosts } = await import('../services/scraper-analytics');
      const data = await getChannelPosts(channelId, {
        page: page ? Number(page) : 1,
        page_size: page_size ? Number(page_size) : 20,
        from_date,
        to_date
      });
      if (!data) return res.status(404).json({ success: false, error: 'Нет данных' });
      res.json({ success: true, data: data.items, total: data.total, page: data.page, has_next_page: data.has_next_page });
    } catch (err: any) {
      log(`[ScraperAnalytics] GET channel posts error: ${err.message}`, 'error');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/scraper/channels/:channelId/best-times — лучшее время для публикаций
   */
  app.get('/api/scraper/channels/:channelId/best-times', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { channelId } = req.params;
      const { getChannelBestTimes } = await import('../services/scraper-analytics');
      const data = await getChannelBestTimes(channelId);
      if (!data) return res.status(404).json({ success: false, error: 'Нет данных' });
      res.json({ success: true, data });
    } catch (err: any) {
      log(`[ScraperAnalytics] GET best-times error: ${err.message}`, 'error');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/scraper/channels/:channelId/posts/dynamics — динамика постов
   * Query: days, min_views, limit
   */
  app.get('/api/scraper/channels/:channelId/posts/dynamics', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { channelId } = req.params;
      const { days, min_views, limit } = req.query as Record<string, string>;
      const { getChannelPostsDynamics } = await import('../services/scraper-analytics');
      const data = await getChannelPostsDynamics(channelId, {
        days: days ? Number(days) : 7,
        min_views: min_views ? Number(min_views) : undefined,
        limit: limit ? Number(limit) : undefined
      });
      if (!data) return res.status(404).json({ success: false, error: 'Нет данных' });
      res.json({ success: true, data });
    } catch (err: any) {
      log(`[ScraperAnalytics] GET posts/dynamics error: ${err.message}`, 'error');
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
   * Query: platform, channel_ids (comma-separated), from_date, to_date, limit
   */
  app.get('/api/scraper/analytics/engagement', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { platform, channel_ids, from_date, to_date, limit } = req.query as Record<string, string>;
      const { getEngagementComparison } = await import('../services/scraper-analytics');
      const data = await getEngagementComparison({
        platform,
        from_date,
        to_date,
        limit: limit ? Number(limit) : undefined,
        channel_ids: channel_ids ? channel_ids.split(',') : undefined
      });
      res.json({ success: true, data: data.channels, best_performer: data.best_performer, from_date: data.from_date, to_date: data.to_date, total: data.channels.length });
    } catch (err: any) {
      log(`[ScraperAnalytics] GET analytics/engagement error: ${err.message}`, 'error');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/scraper/monitoring/scheduler/metrics-refresh — ручное обновление метрик
   * Body: { channels: [{id, platform, platform_channel_id}], days?, force? }
   */
  app.post('/api/scraper/monitoring/scheduler/metrics-refresh', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { channels, days, force } = req.body;
      if (!channels || !Array.isArray(channels) || channels.length === 0) {
        return res.status(400).json({ success: false, error: 'channels (массив объектов {id, platform, platform_channel_id}) обязателен' });
      }
      const { refreshChannelMetrics } = await import('../services/scraper-analytics');
      const result = await refreshChannelMetrics({ channels, days, force: force === true });
      if (!result) return res.status(502).json({ success: false, error: 'Скрейпер не ответил' });
      res.json({ success: true, data: result });
    } catch (err: any) {
      log(`[ScraperAnalytics] POST metrics-refresh error: ${err.message}`, 'error');
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

      // Регистрируем только СОБСТВЕННЫЕ каналы кампании (куда публикуем)
      // Анализ источников/трендов реализован отдельно
      const campaign = await directusCrud.getById('user_campaigns', campaignId, {
        useAdminToken: true
      }) as any;

      if (!campaign) {
        return res.status(404).json({ success: false, error: 'Кампания не найдена' });
      }

      const channels: Array<{ platform: string; id: string; name?: string }> = [];
      const sms = campaign.social_media_settings || {};

      if (sms.telegram?.chatId) {
        channels.push({
          platform: 'telegram',
          id: String(sms.telegram.chatId),
          name: sms.telegram.username ? `@${sms.telegram.username}` : campaign.name
        });
      }
      if (sms.vk?.groupId) {
        channels.push({
          platform: 'vk',
          id: String(sms.vk.groupId),
          name: campaign.name
        });
      }

      if (channels.length === 0) {
        return res.json({ success: true, registered: 0, message: 'Telegram и VK не настроены в кампании' });
      }

      // Отвечаем сразу — регистрация идёт фоново (скрейпер асинхронный)
      res.json({
        success: true,
        total: channels.length,
        message: `Запрос на регистрацию ${channels.length} каналов отправлен`
      });

      // Фоновая регистрация без блокировки HTTP-ответа
      import('../services/scraper-analytics').then(({ ensureChannelsRegistered }) => {
        ensureChannelsRegistered(channels).catch((err: any) => {
          log(`[ScraperAnalytics] background sync-campaign error: ${err.message}`, 'warn');
        });
      });
    } catch (err: any) {
      log(`[ScraperAnalytics] sync-campaign error: ${err.message}`, 'error');
      res.status(500).json({ success: false, error: err.message });
    }
  });
}

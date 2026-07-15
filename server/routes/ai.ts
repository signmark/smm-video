import { Express, Request, Response, Router } from 'express';
import { authenticateUser } from '../middleware/user-auth';
import { storage } from '../storage';
import { log } from '../utils/logger';
import { directusApi } from '../directus';
import { deepseekService, DeepSeekMessage } from '../services/deepseek';
import { geminiDirect } from '../services/gemini-direct';
import { GeminiImageService } from '../services/gemini-image';
import { aiService } from '../services/ai-service';
import { globalApiKeysService } from '../services/global-api-keys';
import { apiKeyService, ApiServiceName } from '../services/api-keys';
import { falAiUniversalService, FalAiModelName } from '../services/fal-ai-universal';
import { generateWithGptImage } from '../services/openai-image';
import { QwenService } from '../services/qwen';
import { aiAssistantService } from '../services/ai-assistant';
import axios from 'axios';
import * as crypto from 'crypto';
import { cleanupText } from '../utils/text';
import { cleanGeneratedSocialContent, getGeneratedSocialContentRules } from '../utils/generated-social-content';
import { getUsage, incrementUsage, canGenerate } from '../services/image-gen-tracker';
import { 
  getCachedResults, 
  getCachedKeywordsByUrl, 
  mergeKeywords, 
  extractFullSiteContent,
  searchCache,
  urlKeywordsCache,
  cleanupExpiredCache
} from '../utils/ai-helpers';

// Запускаем очистку кеша каждые 15 минут
setInterval(cleanupExpiredCache, 15 * 60 * 1000);

const BASIC_PLAN_LIMIT = 30;

async function getUserPlanFromDirectus(userId: string): Promise<string> {
  try {
    const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN;
    const resp = await directusApi.get(`/users/${userId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      params: { fields: 'plan,expire_date,is_smm_admin,is_smm_super' }
    });
    const userData = resp.data?.data;
    // Суперадмин/SMM-админ всегда получает полный доступ
    if (userData?.is_smm_admin || userData?.is_smm_super) return 'pro';
    const plan = userData?.plan || 'basic';
    const expireDate = userData?.expire_date;
    const isExpired = expireDate ? new Date(expireDate) < new Date() : false;
    return isExpired ? 'free' : plan;
  } catch {
    return 'basic';
  }
}

export function registerAiRoutes(app: Express) {
  // Vertex AI эндпоинт для улучшения текста с моделями Gemini
  app.post('/api/vertex-ai/improve-text', authenticateUser, async (req: Request, res: Response) => {
  try {
      const { text, prompt, model } = req.body;
      if (!text || !prompt) return res.status(400).json({ success: false, error: 'Текст и инструкции обязательны' });

      log(`[vertex-ai] Начинаем улучшение текста`, 'info');
      const improvedText = await aiService.generateContent({
        prompt: `${prompt}\n\nТекст для улучшения:\n${text}`,
        model: model || 'gemini-3-pro-preview',
        service: 'gemini',
        userId: req.user?.id,
        token: req.user?.token
      }).then(res => res.content);

      return res.json({ success: true, text: improvedText });
    } catch (error: any) {
      console.error('[vertex-ai] Ошибка:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // Прямая генерация контента (DeepSeek / Gemini) - теперь через унифицированный AiService
  app.post(['/api/generate', '/api/generate-content'], authenticateUser, async (req, res) => {
    try {
      const { prompt, keywords, tone, platform, service, model, temperature, max_tokens, systemPrompt, campaignId, useCampaignData, matchStyle } = req.body;
      const userId = req.user?.id;
      const token = req.user?.token;

      if (!userId || !token) return res.status(401).json({ error: "Не авторизован" });

      if (!req.user?.is_smm_admin && req.user?.expire_date && new Date(req.user.expire_date) <= new Date()) {
        return res.status(403).json({ error: 'Подписка истекла', message: 'Выберите тариф для продолжения работы.', subscriptionExpired: true });
      }

      log(`[API] Запрос на генерацию контента: service=${service}, model=${model}, useCampaignData=${useCampaignData}`, 'info');

      const result = await aiService.generateContent({
        prompt,
        keywords,
        tone,
        platform,
        service,
        model,
        temperature,
        maxTokens: max_tokens,
        systemPrompt: `${systemPrompt || 'Ты — опытный автор контента для социальных сетей.'}${getGeneratedSocialContentRules(platform)}`,
        userId,
        token,
        campaignId,
        useCampaignData,
        matchStyle
      });

      if (result?.content) {
        result.content = cleanGeneratedSocialContent(result.content, platform);
      }

      // КРИТИЧНО: Логируем полный ответ перед отправкой на фронтенд
      console.log('--- AI GENERATION RESPONSE START ---');
      console.log('Status: 200');
      console.log('Result Object:', JSON.stringify(result, null, 2));
      console.log('--- AI GENERATION RESPONSE END ---');

      log(`[API] Ответ от AiService (успех=${!!result?.success}, content=${!!result?.content})`, 'info');
      
      // Если генерация была вызвана через диалог генерации контента, 
      // фронтенд сам сохранит результат через POST /api/campaign-content.
      // Но если это была прямая команда ассистенту, нам нужно убедиться, что контент сохраняется.
      
      return res.json(result);
    } catch (error: any) {
      console.error('--- AI GENERATION ERROR START ---');
      console.error('Error Message:', error.message);
      if (error.response) {
        console.error('Response Status:', error.response.status);
        console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
      }
      console.error('--- AI GENERATION ERROR END ---');

      const rawMsg: string = error.message || '';
      let userMessage = rawMsg;
      if (rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED') || rawMsg.includes('quota') || rawMsg.includes('rate limit')) {
        userMessage = 'Лимит Gemini исчерпан. Квота бесплатного тарифа на сегодня закончилась. Переключитесь на DeepSeek или Qwen.';
      } else if (rawMsg.includes('503') || rawMsg.includes('UNAVAILABLE') || rawMsg.includes('high demand')) {
        userMessage = 'Gemini временно перегружен (503). Попробуйте через минуту или выберите DeepSeek / Qwen.';
      } else if (rawMsg.includes('404') || rawMsg.includes('NOT_FOUND')) {
        userMessage = 'Выбранная модель недоступна. Попробуйте другую модель.';
      }

      res.status(error.response?.status || 500).json({ 
        success: false, 
        error: userMessage,
        message: userMessage
      });
    }
  });

  // Генерация изображений Fal.ai
  app.post('/api/generate-image', authenticateUser, async (req, res) => {
    try {
      const locale = req.headers['x-locale'] as string || 'ru';
      const {
        prompt,
        model: modelField,
        modelName,
        imageSize,
        translatePrompt,
        numImages,
        width,
        height,
        negativePrompt,
        stylePreset,
        imageUrls, // для редактирования (nano-banana-pro/edit)
        quality,   // для gpt-image-1: 'low' | 'medium' | 'high'
      } = req.body;
      // Фронтенд может слать как `model`, так и `modelName`
      const model = modelName || modelField;
      const userId = req.user?.id;
      const token = req.user?.token;

      if (!req.user?.is_smm_admin && req.user?.expire_date && new Date(req.user.expire_date) <= new Date()) {
        return res.status(403).json({ error: 'Подписка истекла', message: 'Выберите тариф для продолжения работы.', subscriptionExpired: true });
      }

      // Проверка плана и месячного лимита генераций
      if (userId) {
        const plan = await getUserPlanFromDirectus(userId);
        if (plan === 'free') {
          return res.status(403).json({ success: false, error: 'Генерация изображений недоступна на вашем тарифе.' });
        }
        const TRIAL_PLAN_LIMIT = 10;
        const activeLimit = plan === 'trial' ? TRIAL_PLAN_LIMIT : plan === 'basic' ? BASIC_PLAN_LIMIT : null;
        if (activeLimit !== null && !(await canGenerate(userId, activeLimit))) {
          const usage = await getUsage(userId);
          return res.status(429).json({
            success: false,
            error: `Лимит генераций исчерпан (${usage.count}/${activeLimit} в месяц). Оформите подписку для продолжения.`,
            limitExceeded: true,
          });
        }
      }
      
      const isGeminiModel = model === 'gemini' 
        || model === 'fal-ai/nano-banana-pro' 
        || model === 'fal-ai/nano-banana-pro/edit';
      const isEditModel = model === 'fal-ai/nano-banana-pro/edit';
      const isOpenAIDirectModel = model === 'gpt-image-1' || model === 'gpt-image-2'
        || model === 'openai/gpt-image-1' || model === 'openai/gpt-image-2';

      // Ключ OpenAI (только для прямых OpenAI моделей)
      let openAiKey: string | null = null;
      if (isOpenAIDirectModel) {
        openAiKey = process.env.OPENAI_API_KEY || null;
        if (!openAiKey) openAiKey = await apiKeyService.getApiKey(userId!, 'openai' as ApiServiceName, token!).catch(() => null);
        if (!openAiKey) openAiKey = await globalApiKeysService.getGlobalApiKey('openai').catch(() => null);
        if (!openAiKey) openAiKey = await globalApiKeysService.getGlobalApiKey('OPENAI_API_KEY').catch(() => null);
        if (!openAiKey) return res.status(400).json({ error: "API ключ OpenAI не найден", key_missing: true });
      }

      // Ключ fal.ai нужен для всех не-Gemini и не-OpenAI моделей
      let falAiKey: string | null = null;
      if (!isGeminiModel && !isOpenAIDirectModel) {
        // Приоритет 1: env (работает и в dev/Replit)
        falAiKey = process.env.FAL_AI_KEY || process.env.FAL_KEY || null;
        // Приоритет 2: ключ пользователя из Directus
        if (!falAiKey) falAiKey = await apiKeyService.getApiKey(userId!, ApiServiceName.FAL_AI, token!);
        // Приоритет 3: глобальный ключ из Directus
        if (!falAiKey) falAiKey = await globalApiKeysService.getGlobalApiKey(ApiServiceName.FAL_AI);
        if (!falAiKey) return res.status(400).json({ error: "API ключ Fal.ai не найден", key_missing: true });
      }
      
      let result: string[] = [];

      if (isOpenAIDirectModel) {
        log(`[API] Генерация изображения через OpenAI gpt-image-1 (n=${numImages || 1})`, 'info');
        const sizeMap: Record<string, '1024x1024' | '1536x1024' | '1024x1536' | 'auto'> = {
          'landscape_4_3': '1536x1024',
          'portrait_4_3': '1024x1536',
          '1536x1024': '1536x1024',
          '1024x1536': '1024x1536',
          '1024x1024': '1024x1024',
        };
        const resolvedSize = (width && height)
          ? (width > height ? '1536x1024' : width < height ? '1024x1536' : '1024x1024')
          : sizeMap[imageSize] || '1024x1024';
        const gptResult = await generateWithGptImage({
          prompt,
          apiKey: openAiKey!,
          numImages: numImages ? parseInt(numImages.toString()) : 1,
          size: resolvedSize,
          quality: (quality as any) || 'medium',
          outputFormat: 'png',
          locale,
        });
        if (!gptResult.success || gptResult.imageUrls.length === 0) {
          throw new Error(gptResult.error || 'Не удалось сгенерировать изображение через OpenAI');
        }
        result = gptResult.imageUrls;
      } else if (isGeminiModel) {
        const modelLabel = isEditModel ? '🍌✏️ NanoBanana Pro/Edit' : model === 'fal-ai/nano-banana-pro' ? '🍌⚡ NanoBanana Pro' : '🍌 Nano Banana';
        log(`[API] Генерация изображения через Vertex AI + Service Account (${modelLabel})`, 'info');
        const geminiImageService = new GeminiImageService();
        const count = numImages ? parseInt(numImages.toString()) : 1;
        // Запускаем с задержкой 600мс между запросами чтобы не перегружать Vertex AI (rate limit)
        const STAGGER_MS = 600;
        const imageResults = await Promise.all(
          Array.from({ length: count }, (_, i) =>
            new Promise<Awaited<ReturnType<typeof geminiImageService.generateImage>>>(resolve => {
              setTimeout(() => {
                geminiImageService.generateImage({
                  prompt,
                  width: width ? parseInt(width.toString()) : 1024,
                  height: height ? parseInt(height.toString()) : 1024,
                  style: stylePreset,
                  negativePrompt
                }).then(resolve).catch(err => resolve({ success: false, error: err.message, model: 'gemini-2.5-flash-image (Vertex AI)', prompt }));
              }, i * STAGGER_MS);
            })
          )
        );
        result = imageResults
          .filter(r => r.success && (r.imageUrl || r.imageData))
          .map(r => r.imageUrl || `data:image/png;base64,${r.imageData}`);
        if (result.length === 0) {
          const firstError = imageResults[0]?.error || 'Не удалось сгенерировать изображение';
          throw new Error(firstError);
        }
      } else if (model === 'fal-ai/gpt-image-2') {
        // FAL.AI не поддерживает n>1 для openai/gpt-image-2 — делаем count параллельных запросов по 1
        const count = numImages ? parseInt(numImages.toString()) : 1;
        const STAGGER_MS = 300;
        log(`[API] GPT-Image-2 via FAL.AI: запускаем ${count} параллельных запросов`, 'info');
        const imageResults = await Promise.all(
          Array.from({ length: count }, (_, i) =>
            new Promise<string[]>(resolve => {
              setTimeout(async () => {
                try {
                  const urls = await falAiUniversalService.generateImages({
                    prompt,
                    model: 'openai/gpt-image-2' as FalAiModelName,
                    imageSize: imageSize || 'landscape_4_3',
                    token: falAiKey || undefined,
                    numImages: 1,
                    width: width ? parseInt(width.toString()) : undefined,
                    height: height ? parseInt(height.toString()) : undefined,
                    negativePrompt,
                    stylePreset,
                    quality: quality || undefined,
                  });
                  resolve(urls);
                } catch (err: any) {
                  log(`[API] GPT-Image-2 via FAL.AI запрос ${i + 1} не удался: ${err.message}`, 'warn');
                  resolve([]);
                }
              }, i * STAGGER_MS);
            })
          )
        );
        result = imageResults.flat();
        if (result.length === 0) throw new Error('FAL.AI gpt-image-2: не удалось получить изображения');
      } else {
        const falModel = model;
        result = await falAiUniversalService.generateImages({
          prompt,
          model: (falModel as FalAiModelName) || 'schnell',
          imageSize: imageSize || 'landscape_4_3',
          token: falAiKey || undefined,
          numImages: numImages ? parseInt(numImages.toString()) : undefined,
          width: width ? parseInt(width.toString()) : undefined,
          height: height ? parseInt(height.toString()) : undefined,
          negativePrompt,
          stylePreset,
          quality: quality || undefined,
        });
      }
      
      // Инкрементируем счётчик генераций после успеха
      let usageInfo: { count?: number; remaining?: number | null } = {};
      if (userId) {
        const plan = await getUserPlanFromDirectus(userId).catch(() => 'basic');
        const TRIAL_PLAN_LIMIT_INC = 10;
        if (plan === 'basic' || plan === 'trial') {
          const planLimit = plan === 'trial' ? TRIAL_PLAN_LIMIT_INC : BASIC_PLAN_LIMIT;
          const newCount = await incrementUsage(userId);
          usageInfo = { count: newCount, remaining: Math.max(0, planLimit - newCount) };
          log(`[image-gen] User ${userId.slice(0, 8)} ${plan} usage: ${newCount}/${planLimit}`, 'info');
        }
      }

      return res.json({ success: true, images: result, ...usageInfo });
    } catch (error: any) {
      console.error('[API] Ошибка генерации изображения:', error);
      const { localizedError, classifyOpenaiError, classifyGeminiError } = await import('../utils/locale-errors');
      const locale = req.headers['x-locale'] as string || 'ru';
      const msg: string = error.message || '';
      if (msg.toLowerCase().includes('timeout') || msg.includes('AbortError')) {
        return res.status(504).json({ error: localizedError('timeout', locale) });
      }
      if (msg.includes('429') || msg.toLowerCase().includes('quota')) {
        return res.status(429).json({ error: localizedError('openai_quota', locale) });
      }
      const errorKey = classifyOpenaiError(msg) || classifyGeminiError(msg);
      res.status(500).json({ error: errorKey !== 'generic' ? localizedError(errorKey, locale) : msg });
    }
  });

  // Перевод текста на английский (для промптов генерации изображений)
  app.post('/api/translate-to-english', authenticateUser, async (req, res) => {
    try {
      const { text } = req.body;
      if (!text?.trim()) return res.json({ success: true, translatedText: text || '' });

      const translatedText = await geminiDirect.generateContent({
        prompt: `Translate the following text to English. Return ONLY the translated text, no explanations, no quotes, no extra text:\n\n${text}`
      });

      return res.json({ success: true, translatedText: translatedText.trim() });
    } catch (error: any) {
      log(`[translate-to-english] Ошибка перевода: ${error.message}`, 'warn');
      return res.json({ success: false, translatedText: req.body.text || '' });
    }
  });

  // Генерация промпта для картинки
  app.post("/api/generate-image-prompt", authenticateUser, async (req, res) => {
    try {
      const { content, keywords } = req.body;
      if (!content) return res.status(400).json({ error: "Контент не указан" });
      
      const cleanContent = cleanupText(content).substring(0, 1000);
      const geminiPrompt = `Create a short, vivid English image prompt from this Russian text: "${cleanContent}"\nKeywords: ${keywords?.join(', ') || 'none'}\nUse visual descriptions, avoid quotes. Make it concise and artistic. Maximum 40 words.`;
      
      let prompt: string;
      try {
        const response = await aiService.generateContent({ 
          prompt: geminiPrompt, 
          model: 'gemini-2.5-flash',
          service: 'gemini',
          userId: req.user?.id,
          token: req.user?.token
        });
        prompt = response.content.replace(/['"]/g, '').trim();
      } catch (aiErr: any) {
        log(`[generate-image-prompt] AI недоступен (${aiErr.message?.slice(0,80)}), используем fallback`, 'warn');
        // Fallback: простой промпт из ключевых слов и первого предложения
        const kw = (keywords || []).slice(0, 5).join(', ');
        const firstSentence = cleanContent.replace(/[^a-zA-Zа-яёА-ЯЁ0-9 ,.\-!?]/g, '').split(/[.!?]/)[0]?.trim().slice(0, 120) || '';
        prompt = [
          'professional social media photo',
          kw || 'business concept',
          'clean modern design, high quality, studio lighting, 4k',
        ].filter(Boolean).join(', ');
      }
      
      return res.json({ success: true, prompt });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Поиск ключевых слов (SEO)
  app.post("/api/keywords/search", authenticateUser, async (req, res) => {
    try {
      const { keyword } = req.body;
      if (!keyword) return res.status(400).json({ error: "Ключевое слово не указано" });
      
      const cached = getCachedResults(keyword);
      if (cached) return res.json({ data: { keywords: cached } });
      
      const prompt = `Generate 10-15 relevant SEO keywords for: "${keyword}". Return as JSON array of objects: [{"keyword": "word", "trend": 1000, "competition": 50}]`;
      
      let content = '';
      
      try {
        const response = await aiService.generateContent({ 
          prompt,
          model: 'gemini-3-flash-preview',
          service: 'gemini',
          userId: req.user?.id,
          token: req.user?.token
        });
        content = response.content;
      } catch (geminiError: any) {
        log(`[keywords] Gemini failed: ${geminiError.message}, trying Qwen fallback`, 'warn');
        
        const qwenApiKey = await globalApiKeysService.getGlobalApiKey(ApiServiceName.QWEN);
        if (!qwenApiKey) {
          throw new Error('Gemini недоступен, ключ Qwen не найден в глобальных настройках');
        }
        
        const qwenService = new QwenService({ apiKey: qwenApiKey });
        content = await qwenService.generateText(prompt, { temperature: 0.7, max_tokens: 4096 });
        log(`[keywords] Qwen fallback succeeded`, 'info');
      }
      
      let keywords = [];
      const match = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) keywords = JSON.parse(match[0]);
      
      if (keywords.length > 0) {
        searchCache.set(keyword, { timestamp: Date.now(), results: keywords });
      }
      
      return res.json({ data: { keywords } });
    } catch (error: any) {
      console.error('--- KEYWORDS SEARCH ERROR START ---');
      console.error('Error Message:', error.message);
      if (error.response) {
        console.error('Response Status:', error.response.status);
        console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
      }
      console.error('--- KEYWORDS SEARCH ERROR END ---');
      
      res.status(error.response?.status || 500).json({ 
        success: false, 
        error: error.message,
        message: error.message 
      });
    }
  });

  // Анализ сайта для анкеты (переименовано для соответствия фронтенду)
  app.post("/api/keywords/analyze-website", authenticateUser, async (req, res) => {
    try {
      const { url, campaignId } = req.body;
      const locale = req.headers['x-locale'] as string || 'ru';
      const token = req.user?.token;
      if (!url) return res.status(400).json({ error: locale === 'en' ? 'URL is required' : locale === 'es' ? 'URL es obligatoria' : 'URL не указан' });

      const keywords = await aiService.analyzeWebsiteKeywords(url, campaignId, token);

      return res.json({ success: true, data: { keywords } });
    } catch (error: any) {
      console.error("[KEYWORDS_ANALYZE] Critical Error:", error.message);
      const locale = req.headers['x-locale'] as string || 'ru';
      const localizedMsg = locale === 'en'
        ? 'Failed to load website content. The site may be blocking automated requests. Try a different URL.'
        : locale === 'es'
        ? 'No se pudo cargar el contenido del sitio. El sitio puede estar bloqueando solicitudes automáticas. Intente con otra URL.'
        : error.message || 'Не удалось загрузить содержимое сайта. Сайт может блокировать автоматические запросы.';
      res.status(500).json({ success: false, error: localizedMsg });
    }
  });

  // Проверка валидности API ключей
  app.get('/api/ai/validate-keys', authenticateUser, async (req, res) => {
    try {
      const results = await aiService.validateApiKeys();
      return res.json({ success: true, results });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // Прокси для картинок
  app.get("/api/proxy-image", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL is required');
    
    try {
      const imageUrl = decodeURIComponent(url as string);
      console.log("[PROXY] Fetching URL:", imageUrl);
      console.log("PROXY_TARGET_RAW:", url);
      console.log("PROXY_TARGET_DECODED:", imageUrl);
      log(`[ProxyImage] Запрос изображения: ${imageUrl}`, 'info');

      const response = await axios.get(imageUrl, { 
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
      });

      const contentType = response.headers['content-type'] || 'image/jpeg';
      console.log("PROXY_RESPONSE_TYPE:", contentType);
      console.log("PROXY_RESPONSE_LENGTH:", response.data.length);

      res.setHeader('Content-Type', contentType);
      res.send(Buffer.from(response.data));
    } catch (e: any) {
      log(`[ProxyImage] Критическая ошибка проксирования: ${e.message}`, 'error');
      console.error("PROXY_ERROR:", e.message);
      if (e.response) {
        console.error("PROXY_ERROR_STATUS:", e.response.status);
      }
      res.status(500).send('Error proxying image: ' + e.message);
    }
  });

  const aiAssistantHandler = async (req: Request, res: Response) => {
    try {
      const { message, userId, campaignId, chatHistory, context } = req.body;

      if (!message) {
        return res.status(400).json({
          success: false,
          error: 'Сообщение обязательно'
        });
      }

      const authToken = req.headers.authorization?.replace('Bearer ', '') || req.user?.token;

      log(`[AI-ASSISTANT] Запрос: campaignId=${campaignId}, context=${context}, userId=${userId || req.user?.id}`, 'info');

      const result = await aiAssistantService.processCommand({
        message,
        userId: userId || req.user?.id,
        campaignId,
        authToken,
        userToken: authToken,
        chatHistory
      });

      return res.json(result);
    } catch (error: any) {
      console.error('[AI-ASSISTANT] Ошибка обработки команды:', error);
      return res.status(500).json({
        success: false,
        response: 'Произошла ошибка при обработке команды',
        error: error.message
      });
    }
  };

  app.post('/api/ai-assistant/process-command', authenticateUser, aiAssistantHandler);
  app.post('/api/autonomous-ai/execute', authenticateUser, aiAssistantHandler);
}

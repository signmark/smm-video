import axios from 'axios';
import { globalApiKeysService } from './global-api-keys';
import { apiKeyService, ApiServiceName } from './api-keys';
import * as logger from '../utils/logger';
import { log } from '../utils/logger';
import { geminiDirect } from './gemini-direct';
import { QwenService } from './qwen';
import { geminiProxyService } from './gemini-proxy';

import { extractFullSiteContent } from '../utils/ai-helpers';
import { directusApi } from '../directus';
import { webCrawlerAgent } from './web-crawler-agent';

export interface GenerateContentParams {
  prompt: string;
  systemPrompt?: string;
  keywords?: string[];
  tone?: string;
  platform?: string;
  model?: string;
  service?: string;
  temperature?: number;
  maxTokens?: number;
  userId?: string;
  token?: string;
  campaignId?: string;
  useCampaignData?: boolean;
}

export class AiService {
  /**
   * Проверяет валидность API ключей для различных сервисов
   */
  async validateApiKeys(): Promise<Record<string, { valid: boolean; error?: string }>> {
    const results: Record<string, { valid: boolean; error?: string }> = {};
    
    // 1. Проверка Gemini (Google AI)
    try {
      const apiKey = await globalApiKeysService.getGlobalApiKey(ApiServiceName.GEMINI) || 
                     await globalApiKeysService.getGlobalApiKey(ApiServiceName.GOOGLE_API_KEY);
      
      if (!apiKey) {
        results['gemini'] = { valid: false, error: 'Ключ не найден' };
      } else {
        // Используем прокси для проверки ключа в продакшене
        const { geminiProxyService } = await import('./gemini-proxy');
        geminiProxyService.setApiKey(apiKey);
        const isValid = await geminiProxyService.testApiKey();
        
        if (isValid) {
          results['gemini'] = { valid: true };
        } else {
          results['gemini'] = { valid: false, error: 'Ошибка проверки ключа через прокси' };
        }
      }
    } catch (error: any) {
      results['gemini'] = { valid: false, error: error.response?.data?.error?.message || error.message };
    }

    // 2. Проверка DeepSeek
    try {
      const apiKey = await globalApiKeysService.getGlobalApiKey(ApiServiceName.DEEPSEEK);
      if (!apiKey) {
        results['deepseek'] = { valid: false, error: 'Ключ не найден' };
      } else {
        await axios.get('https://api.deepseek.com/user/balance', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          timeout: 5000
        });
        results['deepseek'] = { valid: true };
      }
    } catch (error: any) {
      results['deepseek'] = { valid: false, error: error.response?.data?.error?.message || error.message };
    }

    return results;
  }

  /**
   * Генерирует контент с помощью Gemini (Google AI SDK / API)
   */
  async generateWithGemini(params: GenerateContentParams): Promise<any> {
    try {
      const { 
        prompt, 
        systemPrompt, 
        keywords = [], 
        tone = 'informative', 
        platform = 'facebook',
        model: inputModel,
        temperature = 0.7,
        maxTokens = 4096
      } = params;

      // Маппинг моделей — используем только реально существующие модели Google AI
      let modelId = inputModel || "gemini-2.5-flash";
      const serviceName = params.service || '';

      // Модели gemini-3.5+ передаём без изменений — пусть API отвечает сам
      const passThroughPattern = /gemini-3\.[5-9]|gemini-[4-9]\./;
      if (passThroughPattern.test(modelId) || passThroughPattern.test(serviceName)) {
        // если model не передан, но service содержит новую модель — используем service как modelId
        if (!passThroughPattern.test(modelId) && passThroughPattern.test(serviceName)) {
          modelId = serviceName;
        }
      // pro / 2.5-pro / 3-pro → gemini-2.5-pro (самая мощная из доступных)
      } else if (
        serviceName.includes('2.5-pro') || modelId.includes('2.5-pro') ||
        serviceName.includes('gemini-3-pro') || modelId.includes('gemini-3-pro') ||
        serviceName.includes('gemini-3.0-pro') || modelId.includes('gemini-3.0-pro')
      ) {
        modelId = "gemini-2.5-pro";
      // flash / 2.5-flash / 3.0-flash / 3-flash → gemini-2.5-flash
      } else if (
        serviceName.includes('2.5-flash') || modelId.includes('2.5-flash') ||
        serviceName.includes('gemini-3-flash') || modelId.includes('gemini-3-flash') ||
        serviceName.includes('gemini-3.0-flash') || modelId.includes('gemini-3.0-flash') ||
        serviceName.includes('flash') || modelId.includes('flash')
      ) {
        modelId = "gemini-2.5-flash";
      // общее «pro» без версии → 2.5-pro
      } else if (serviceName.includes('pro') || modelId.includes('pro')) {
        modelId = "gemini-2.5-pro";
      // всё остальное → flash (быстрее и дешевле)
      } else {
        modelId = "gemini-2.5-flash";
      }

      log(`[AiService] Model mapping: service="${serviceName}" → model="${modelId}"`, 'info');

      // 1. Получаем API ключ
      const { userId, token: userToken } = params;
      let apiKey = null;
      let keySource = 'none';
      
      // ПРИОРИТЕТ 1: .env (стандартная практика — env-переменные всегда выигрывают
      // над БД, чтобы при ротации ключей админу было достаточно правки .env + рестарта,
      // а не лазания в UI Directus).
      if (process.env.GEMINI_API_KEY) {
        apiKey = process.env.GEMINI_API_KEY;
        keySource = 'env-gemini-api-key';
      }

      // ПРИОРИТЕТ 2: Глобальные ключи из Directus (можно менять без перезапуска)
      if (!apiKey) {
        apiKey = await globalApiKeysService.getGlobalApiKey(ApiServiceName.GEMINI);
        if (apiKey) {
          keySource = 'global-gemini';
        } else {
          apiKey = await globalApiKeysService.getGlobalApiKey(ApiServiceName.GOOGLE_API_KEY);
          if (apiKey) keySource = 'global-google-api-key';
        }
      }

      // ПРИОРИТЕТ 3: Ключ пользователя из БД
      if (!apiKey && userId) {
        apiKey = await apiKeyService.getApiKey(userId, ApiServiceName.GEMINI, userToken);
        if (apiKey) {
          keySource = `user-gemini (${userId})`;
        } else {
          apiKey = await apiKeyService.getApiKey(userId, ApiServiceName.GOOGLE_API_KEY, userToken);
          if (apiKey) keySource = `user-google-api-key (${userId})`;
        }
      }

      // ПРИОРИТЕТ 5: VERTEX_AI_API_KEY из .env
      if (!apiKey) {
        apiKey = process.env.VERTEX_AI_API_KEY || null;
        if (apiKey) keySource = 'env-vertex-ai-api-key';
      }
      
      if (!apiKey) {
        log(`[AiService] Ошибка: API ключ Gemini не найден`, 'error');
        log(`[AiService] Пытаемся принудительно обновить кэш глобальных ключей...`, 'info');
        await globalApiKeysService.refreshCache();
        apiKey = await globalApiKeysService.getGlobalApiKey(ApiServiceName.GEMINI) || 
                 await globalApiKeysService.getGlobalApiKey(ApiServiceName.GOOGLE_API_KEY);
        
        if (apiKey) {
          log(`[AiService] Ключ найден после обновления кэша!`, 'info');
        } else {
          throw new Error('API ключ Gemini не найден в системе.');
        }
      }

      log(`[AiService] Using API Key from source: ${keySource}, prefix: ${apiKey?.substring(0, 8)}...`, 'info');

      // 2. Формируем промпт
      const keywordContext = keywords.length > 0 ? `\nКлючевые слова для использования: ${keywords.join(', ')}.` : '';
      const platformContext = platform ? `\nПлатформа: ${platform}.` : '';
      const toneContext = tone ? `\nТон текста: ${tone}.` : '';
      const fullPrompt = `${systemPrompt || 'Ты — опытный автор контента для социальных сетей.'}${platformContext}${toneContext}${keywordContext}\n\nЗадание: ${prompt}`;

      // 3. Используем Gemini Proxy (Cloudflare Worker) — основной способ
      logger.log(`[AiService] Using Gemini Proxy`, 'gemini');
        try {
          geminiProxyService.setApiKey(apiKey);
          const generatedText = await geminiProxyService.generateText({
            prompt: fullPrompt,
            model: modelId,
            apiKey, // явно передаём — защита от race condition в singleton
          });

          if (generatedText) {
            log(`[AiService] Content successfully generated via Gemini Proxy`, 'info');
            return {
              success: true,
              content: generatedText.trim(),
              model: modelId,
              service: 'gemini-proxy'
            };
          }
        } catch (proxyError: any) {
          log(`[AiService] Gemini Proxy failed: ${proxyError.message}`, 'warn');
          // При 429 / rate-limit — пробуем запасную модель
          const isTransient = proxyError.message?.includes('429') ||
            proxyError.message?.includes('503') ||
            proxyError.message?.includes('RESOURCE_EXHAUSTED') ||
            proxyError.message?.includes('UNAVAILABLE') ||
            proxyError.message?.includes('quota') ||
            proxyError.message?.includes('rate limit') ||
            proxyError.message?.includes('high demand') ||
            proxyError.message?.includes('temporarily');
          // Цепочка fallback: 2.5-flash
          const fallbackChain = ['gemini-2.5-flash'];
          const fallbackModels = fallbackChain.filter(m => m !== modelId);
          if (isTransient && fallbackModels.length > 0) {
            for (const fallbackModel of fallbackModels) {
              log(`[AiService] Transient error (${proxyError.message?.slice(0,60)}), retrying with ${fallbackModel}`, 'warn');
              try {
                const fallbackText = await geminiProxyService.generateText({
                  prompt: fullPrompt,
                  model: fallbackModel,
                  apiKey,
                });
                if (fallbackText) {
                  log(`[AiService] Fallback success with ${fallbackModel}`, 'info');
                  return { success: true, content: fallbackText.trim(), model: fallbackModel, service: 'gemini-proxy-fallback' };
                }
              } catch (fallbackErr: any) {
                log(`[AiService] Fallback model ${fallbackModel} also failed: ${fallbackErr.message?.slice(0,80)}`, 'warn');
              }
            }
          }
          throw proxyError;
        }

      throw new Error("Не удалось получить ответ от Gemini API всеми доступными методами.");

    } catch (error: any) {
      log(`[AiService] Critical Error: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Генерирует контент с помощью DeepSeek
   */
  async generateWithDeepSeek(params: GenerateContentParams): Promise<any> {
    try {
      const { 
        prompt, 
        systemPrompt, 
        model = 'deepseek-chat',
        temperature = 0.7,
        maxTokens = 2000,
        userId,
        token: userToken
      } = params;

      log(`[AiService] Запрос к DeepSeek (${model}). Промпт: ${prompt.substring(0, 100)}...`, 'info');

      let apiKey = null;
      if (userId) {
        apiKey = await apiKeyService.getApiKey(userId, ApiServiceName.DEEPSEEK, userToken);
      }
      
      if (!apiKey) {
        apiKey = await globalApiKeysService.getGlobalApiKey(ApiServiceName.DEEPSEEK);
      }
      
      if (!apiKey) {
        log(`[AiService] Ошибка: API ключ DeepSeek не найден`, 'error');
        throw new Error('API ключ DeepSeek не найден.');
      }

      const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
        model: model,
        messages: [
          { role: 'system', content: systemPrompt || 'You are a helpful assistant.' },
          { role: 'user', content: prompt }
        ],
        temperature: temperature,
        max_tokens: maxTokens
      }, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 60000
      });

      log(`[AiService] Контент успешно сгенерирован через DeepSeek`, 'info');

      return {
        success: true,
        content: response.data.choices[0].message.content,
        model: model,
        service: 'deepseek'
      };
    } catch (error: any) {
      log(`[AiService] Ошибка DeepSeek: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Генерирует контент с помощью Qwen
   */
  async generateWithQwen(params: GenerateContentParams): Promise<any> {
    try {
      const {
        prompt,
        systemPrompt,
        keywords = [],
        tone = 'informative',
        platform = 'facebook',
        model = 'qwen-plus',
        temperature = 0.7,
        maxTokens = 4096,
        userId,
        token: userToken
      } = params;

      log(`[AiService] Запрос к Qwen (${model}). Промпт: ${prompt.substring(0, 100)}...`, 'info');

      let apiKey = null;
      if (userId) {
        apiKey = await apiKeyService.getApiKey(userId, ApiServiceName.QWEN, userToken);
      }

      if (!apiKey) {
        apiKey = await globalApiKeysService.getGlobalApiKey(ApiServiceName.QWEN);
      }

      if (!apiKey) {
        log(`[AiService] Ошибка: API ключ Qwen не найден`, 'error');
        throw new Error('API ключ Qwen не найден.');
      }

      const keywordContext = keywords.length > 0 ? `\nКлючевые слова для использования: ${keywords.join(', ')}.` : '';
      const platformContext = platform ? `\nПлатформа: ${platform}.` : '';
      const toneContext = tone ? `\nТон текста: ${tone}.` : '';
      const fullPrompt = `${systemPrompt || 'Ты — опытный автор контента для социальных сетей.'}${platformContext}${toneContext}${keywordContext}\n\nЗадание: ${prompt}`;

      const qwenService = new QwenService({ apiKey });
      const content = await qwenService.generateText(fullPrompt, {
        model,
        temperature,
        maxTokens
      });

      log(`[AiService] Контент успешно сгенерирован через Qwen`, 'info');

      return {
        success: true,
        content: content,
        model: model,
        service: 'qwen'
      };
    } catch (error: any) {
      log(`[AiService] Ошибка Qwen: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Метод для автоматического выбора сервиса
   * При исчерпании квоты Gemini (429/RESOURCE_EXHAUSTED) автоматически переключается на DeepSeek.
   */
  async generateContent(params: GenerateContentParams): Promise<any> {
    const service = params.service || 'gemini';
    log(`[AiService] generateContent: service=${service}, model=${params.model || 'none'}, useCampaignData=${params.useCampaignData}`, 'info');

    // Подтягиваем данные анкеты кампании если включён чекбокс
    if (params.useCampaignData && params.campaignId && params.token) {
      try {
        const { directusApiManager } = await import('../directus');
        const directusUrl = process.env.DIRECTUS_URL;
        const resp = await fetch(`${directusUrl}/items/business_questionnaire?filter[campaign_id][_eq]=${params.campaignId}`, {
          headers: { 'Authorization': `Bearer ${params.token}` }
        });
        if (resp.ok) {
          const data = await resp.json() as any;
          const q = data?.data?.[0];
          if (q) {
            const parts: string[] = [];
            if (q.business_name) parts.push(`Название компании: ${q.business_name}`);
            if (q.business_description) parts.push(`Описание бизнеса: ${q.business_description}`);
            if (q.business_goals?.length) parts.push(`Цели бизнеса: ${q.business_goals.join(', ')}`);
            if (q.target_audience) {
              const ta = typeof q.target_audience === 'string' ? q.target_audience : JSON.stringify(q.target_audience);
              parts.push(`Целевая аудитория: ${ta}`);
            }
            if (q.competitors?.length) parts.push(`Конкуренты: ${q.competitors.join(', ')}`);
            if (q.keywords?.length) parts.push(`Ключевые слова бизнеса: ${q.keywords.join(', ')}`);
            if (q.tone_of_voice) parts.push(`Тон общения бренда: ${q.tone_of_voice}`);
            if (q.content_preferences) {
              const cp = typeof q.content_preferences === 'string' ? q.content_preferences : JSON.stringify(q.content_preferences);
              parts.push(`Предпочтения по контенту: ${cp}`);
            }
            if (parts.length > 0) {
              const campaignContext = `\n\nДАННЫЕ КАМПАНИИ (используй эту информацию вместо шаблонных плейсхолдеров типа [Ваше Имя], [Название компании] и т.д.):\n${parts.join('\n')}`;
              params = { ...params, systemPrompt: (params.systemPrompt || '') + campaignContext };
              log(`[AiService] Подтянута анкета кампании: ${parts.length} полей`, 'info');
            }
          }
        }
      } catch (e: any) {
        log(`[AiService] Не удалось подтянуть анкету кампании: ${e.message}`, 'warn');
      }
    }

    const isQuotaError = (err: any) => {
      const msg: string = err?.message || '';
      return msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') ||
        msg.includes('rate limit') || msg.includes('503') || msg.includes('UNAVAILABLE') ||
        msg.includes('high demand') || msg.includes('temporarily');
    };

    let result;
    if (service.includes('gemini') || service === 'apiservice') {
      try {
        result = await this.generateWithGemini(params);
      } catch (geminiErr: any) {
        if (isQuotaError(geminiErr)) {
          log(`[AiService] ⚠️ Gemini квота исчерпана — переключаемся на DeepSeek`, 'warn');
          try {
            result = await this.generateWithDeepSeek({ ...params, model: 'deepseek-chat', service: 'deepseek' });
            result = { ...result, isFallback: true, originalService: service };
            log(`[AiService] ✅ DeepSeek fallback успешен`, 'info');
          } catch (deepseekErr: any) {
            log(`[AiService] ❌ DeepSeek fallback тоже не удался: ${deepseekErr.message}`, 'error');
            throw geminiErr;
          }
        } else {
          throw geminiErr;
        }
      }
    } else if (service === 'deepseek') {
      result = await this.generateWithDeepSeek(params);
    } else if (service === 'qwen') {
      result = await this.generateWithQwen(params);
    } else {
      log(`[AiService] Неизвестный сервис "${service}", используем Gemini по умолчанию`, 'warn');
      try {
        result = await this.generateWithGemini(params);
      } catch (geminiErr: any) {
        if (isQuotaError(geminiErr)) {
          log(`[AiService] ⚠️ Gemini квота исчерпана — переключаемся на DeepSeek`, 'warn');
          try {
            result = await this.generateWithDeepSeek({ ...params, model: 'deepseek-chat', service: 'deepseek' });
            result = { ...result, isFallback: true, originalService: service };
          } catch (deepseekErr: any) {
            log(`[AiService] ❌ DeepSeek fallback тоже не удался: ${deepseekErr.message}`, 'error');
            throw geminiErr;
          }
        } else {
          throw geminiErr;
        }
      }
    }

    if (!result || !result.content) {
      log(`[AiService] ОШИБКА: Результат генерации пуст или не содержит контента`, 'error');
    }

    return result;
  }

  /**
   * Анализирует сайт и генерирует ключевые слова
   */
  async analyzeWebsiteKeywords(url: string, campaignId?: string, token?: string): Promise<any[]> {
    try {
      log(`[KEYWORDS_ANALYZE] Starting analysis for ${url}`, 'info');

      let websiteContent = "";
      try {
        const crawlResult = await webCrawlerAgent.crawlSite({ url });
        if (crawlResult.success && crawlResult.text && crawlResult.text.length > 50) {
          websiteContent = crawlResult.text;
          log(`[KEYWORDS_ANALYZE] Content obtained via crawler (${websiteContent.length} chars)`, 'info');
        } else {
          log(`[KEYWORDS_ANALYZE] Crawler returned insufficient content (${crawlResult.text?.length || 0} chars), trying Axios: ${crawlResult.error}`, 'warn');
          websiteContent = await extractFullSiteContent(url);
        }
      } catch (e: any) {
        log(`[KEYWORDS_ANALYZE] Crawler error, trying Axios: ${e.message}`, 'warn');
        try {
          websiteContent = await extractFullSiteContent(url);
        } catch (axErr: any) {
          log(`[KEYWORDS_ANALYZE] Axios also failed: ${axErr.message}`, 'error');
        }
      }

      if (!websiteContent || websiteContent.length < 50 || websiteContent.includes("Ошибка загрузки сайта")) {
        log(`[KEYWORDS_ANALYZE] Failed to get website content for ${url} (${websiteContent.length} chars)`, 'error');
        throw new Error(`Не удалось загрузить содержимое сайта ${url}. Сайт может блокировать автоматические запросы.`);
      }

      const prompt = `Проанализируй контент сайта и извлеки 10-15 РЕАЛЬНЫХ ключевых слов и фраз, которые ДЕЙСТВИТЕЛЬНО присутствуют или напрямую связаны с содержимым этого конкретного сайта.

КОНТЕНТ САЙТА:
${websiteContent.substring(0, 6000)}

ВАЖНЫЕ ПРАВИЛА:
1. Извлекай ТОЛЬКО ключевые слова, которые реально описывают этот конкретный сайт
2. Включи название компании/продукта/сервиса если оно есть
3. Включи конкретные услуги или продукты, упомянутые на сайте
4. Включи отраслевые термины, связанные с деятельностью сайта
5. НЕ используй общие фразы типа "качественные услуги", "профессиональный подход", "надежная компания"
6. Ключевые слова должны быть на том же языке, что и контент сайта

Верни ТОЛЬКО JSON массив без дополнительного текста:
[{"keyword": "конкретное слово с сайта", "trend": число от 100 до 10000, "competition": число от 10 до 100}]`;
      
      log(`[KEYWORDS_ANALYZE] Sending prompt to AI (${websiteContent.length} chars)...`, 'info');

      let result;
      try {
        const aiResponse = await this.generateContent({
          prompt,
          model: 'deepseek-chat',
          service: 'deepseek',
          token: token
        });
        result = aiResponse.content;
        log(`[KEYWORDS_ANALYZE] AI response received (${result.length} chars)`, 'info');
      } catch (aiError: any) {
         log(`[KEYWORDS_ANALYZE] AI Generation failed: ${aiError.message}`, 'error');
         throw new Error(`AI Generation failed: ${aiError.message}`);
      }

      let keywords = [];
      try {
        const match = result.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (match) {
            keywords = JSON.parse(match[0]);
        } else {
            keywords = JSON.parse(result);
        }
        log(`[KEYWORDS_ANALYZE] Successfully parsed ${keywords.length} keywords`, 'info');
      } catch (parseError) {
          log(`[KEYWORDS_ANALYZE] JSON Parse failed. Raw response: ${result.substring(0, 200)}...`, 'error');
      }
      
      log(`[KEYWORDS_ANALYZE] AI returned ${keywords.length} keywords.`, 'info');

      if (campaignId && keywords.length > 0 && token) {
        log(`[KEYWORDS_ANALYZE] Saving ${keywords.length} keywords for campaign ${campaignId}...`, 'info');
        for (const kw of keywords) {
          try {
            await directusApi.post('/items/campaign_keywords', {
              campaign_id: campaignId,
              keyword: (kw.keyword || "").substring(0, 255),
              trend_score: kw.trend || 0,
              mentions_count: kw.competition || 0,
              last_checked: new Date().toISOString()
            }, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
          } catch (e: any) {
            log(`[KEYWORDS_SAVE] Failed to save keyword "${kw.keyword}": ${e.message}`, 'error');
          }
        }
      }
      
      log(`[KEYWORDS_ANALYZE] Successfully processed keywords for ${campaignId}`, 'info');
      return keywords;
    } catch (error: any) {
      console.error("[KEYWORDS_ANALYZE] Critical Error:", error.response?.data || error.message);
      throw error;
    }
  }
}

export const aiService = new AiService();

import axios from 'axios';
import { globalApiKeysService } from './global-api-keys';
import { apiKeyService, ApiServiceName } from './api-keys';
import * as logger from '../utils/logger';
import { log } from '../utils/logger';
import { geminiVertexDirect } from './gemini-vertex-direct';
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

      // pro / 2.5-pro / 3-pro → gemini-2.5-pro (самая мощная из доступных)
      if (
        serviceName.includes('2.5-pro') || modelId.includes('2.5-pro') ||
        serviceName.includes('gemini-3-pro') || modelId.includes('gemini-3-pro') ||
        serviceName.includes('gemini-3.0-pro') || modelId.includes('gemini-3.0-pro')
      ) {
        modelId = "gemini-2.5-pro";
      // flash / 2.5-flash / 3.5-flash / 3-flash → gemini-2.5-flash
      } else if (
        serviceName.includes('2.5-flash') || modelId.includes('2.5-flash') ||
        serviceName.includes('3.5-flash') || modelId.includes('3.5-flash') ||
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
      const fullPrompt = `${systemPrompt || 'Вы — профессиональный SMM-менеджер.'}${platformContext}${toneContext}${keywordContext}\n\nЗадание: ${prompt}`;

      // 3. Выбор метода вызова в зависимости от формата ключа
      // ВАЖНО: ключи с префиксом AQ. — это НЕ Vertex AI ключи, а новый формат
      // AI Studio API key (Google переключил префикс с AIzaSy на AQ. для ключей с биллингом).
      // Vertex AI работает только через OAuth2/Service Account, не через ?key=. Поэтому
      // не маршрутизируем AQ. ключи на aiplatform.googleapis.com — отправляем в общий поток
      // через geminiProxyService, который дёргает правильный endpoint generativelanguage.googleapis.com.
      const isVertexKey = false;

      if (isVertexKey) {
        log(`[AiService] Detected Vertex AI API Key (AQ. format), routing to Vertex AI endpoint`, 'info');
        try {
          // Получаем Project ID: Service Account → env → ничего (тогда Vertex full-URL пропускаем)
          let projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_AI_PROJECT_ID || '';
          try {
            const credentials = await globalApiKeysService.getGoogleServiceAccountKey();
            if (credentials?.project_id) {
              projectId = credentials.project_id;
              log(`[AiService] Using Project ID from Service Account: ${projectId}`, 'info');
            }
          } catch (e: any) {
            log(`[AiService] Could not get Project ID from Service Account: ${e?.message || e}`, 'warn');
          }

          const vertexModels = [
            modelId,
            'gemini-2.5-pro',
            'gemini-2.5-flash',
            'gemini-2.0-flash',
            'gemini-1.5-pro'
          ].filter((v, i, a) => a.indexOf(v) === i);

          for (const vModel of vertexModels) {
            try {
              // Пытаемся использовать упрощенный URL
              let vertexUrl = `https://aiplatform.googleapis.com/v1/publishers/google/models/${vModel}:generateContent?key=${apiKey}`;
              
              // Если задан прокси-воркер Cloudflare, подменяем домен
              const workerProxy = process.env.GEMINI_PROXY_URL;
              if (workerProxy) {
                try {
                  const pUrl = new URL(workerProxy);
                  const vUrl = new URL(vertexUrl);
                  vUrl.host = pUrl.host;
                  vUrl.protocol = pUrl.protocol;
                  vertexUrl = vUrl.toString();
                } catch (e) {}
              }

              log(`[AiService] Vertex API Key Request: ${vModel}`, 'info');
              
              const requestData = {
                contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
                generationConfig: { 
                  temperature, 
                  maxOutputTokens: maxTokens,
                  topP: 0.95,
                  topK: 40
                }
              };

              const isStaging = process.env.NODE_ENV === 'staging' || process.env.NODE_ENV === 'production';
              
              let useProxy = false;
              if (process.env.FORCE_GEMINI_PROXY === 'true') {
                useProxy = true;
              } else if (process.env.FORCE_GEMINI_PROXY === 'false') {
                useProxy = false;
              } else {
                useProxy = isStaging;
              }
              
              const fetchOptions: any = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData),
                timeout: 60000
              };

              // Используем прокси для Vertex AI API Key в продакшене только если он настроен
              if (useProxy) {
                try {
                  const { SocksProxyAgent } = await import('socks-proxy-agent');
                  const proxyHost = process.env.PROXY_HOST;
                  const proxyPort = process.env.PROXY_PORT;
                  const proxyUsername = process.env.PROXY_USERNAME;
                  const proxyPassword = process.env.PROXY_PASSWORD;
                  
                  if (proxyHost && proxyPort) {
                    const authPart = (proxyUsername && proxyPassword) ? `${proxyUsername}:${proxyPassword}@` : '';
                    const proxyUrl = `socks5://${authPart}${proxyHost}:${proxyPort}`;
                    fetchOptions.agent = new SocksProxyAgent(proxyUrl);
                    log(`[AiService] Using configured proxy for Vertex AI API Key request`, 'info');
                  } else {
                    log(`[AiService] Proxy requested but not configured in .env, using direct connection`, 'warn');
                  }
                } catch (proxyErr) {
                  log(`[AiService] Failed to initialize proxy for Vertex AI API Key: ${proxyErr}`, 'warn');
                }
              }

              const vertexResponse = await fetch(vertexUrl, fetchOptions);
              const vertexData = await vertexResponse.json() as any;

              if (vertexData?.candidates?.[0]?.content?.parts?.[0]?.text) {
                log(`[AiService] Success with Vertex AI API Key (Simple URL), model: ${vModel}`, 'info');
                return {
                  success: true,
                  content: vertexData.candidates[0].content.parts[0].text.trim(),
                  model: vModel,
                  service: 'vertex-api-key'
                };
              }
            } catch (vErr: any) {
              log(`[AiService] Vertex API Key (Simple URL) failed for ${vModel}: ${vErr.response?.status || vErr.message}`, 'warn');
              
              // Если упрощенный URL не сработал, пробуем полный URL с Project ID
              try {
                const region = 'us-central1';
                let fullVertexUrl = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${vModel}:generateContent?key=${apiKey}`;
                
                // Если задан прокси-воркер Cloudflare, подменяем домен
                const workerProxy = process.env.GEMINI_PROXY_URL;
                if (workerProxy) {
                  try {
                    const pUrl = new URL(workerProxy);
                    const vUrl = new URL(fullVertexUrl);
                    vUrl.host = pUrl.host;
                    vUrl.protocol = pUrl.protocol;
                    fullVertexUrl = vUrl.toString();
                  } catch (e) {}
                }

                log(`[AiService] Vertex API Key Request (Full URL): ${vModel}`, 'info');
                
                const isStaging = process.env.NODE_ENV === 'staging' || process.env.NODE_ENV === 'production';
                
                let useProxy = false;
                if (process.env.FORCE_GEMINI_PROXY === 'true') {
                  useProxy = true;
                } else if (process.env.FORCE_GEMINI_PROXY === 'false') {
                  useProxy = false;
                } else {
                  useProxy = isStaging;
                }
                
                const fetchOptions: any = {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
                    generationConfig: { 
                      temperature, 
                      maxOutputTokens: maxTokens,
                      topP: 0.95,
                      topK: 40
                    }
                  }),
                  timeout: 60000
                };

                // Используем прокси для Vertex AI API Key (Full URL) в продакшене
                if (useProxy) {
                  try {
                    const proxyHost = process.env.PROXY_HOST;
                    const proxyPort = process.env.PROXY_PORT;
                    const proxyUsername = process.env.PROXY_USERNAME;
                    const proxyPassword = process.env.PROXY_PASSWORD;
                    if (proxyHost && proxyPort) {
                      const { SocksProxyAgent } = await import('socks-proxy-agent');
                      const auth = (proxyUsername && proxyPassword) ? `${proxyUsername}:${proxyPassword}@` : '';
                      const proxyUrl = `socks5://${auth}${proxyHost}:${proxyPort}`;
                      fetchOptions.agent = new SocksProxyAgent(proxyUrl);
                      log(`[AiService] Using proxy ${proxyHost}:${proxyPort} for Vertex AI API Key (Full URL) request`, 'info');
                    }
                  } catch (proxyErr) {
                    log(`[AiService] Failed to initialize proxy for Vertex AI API Key (Full URL): ${proxyErr}`, 'warn');
                  }
                }

                const vertexResponse = await fetch(fullVertexUrl, fetchOptions);
                const vertexData = await vertexResponse.json() as any;

                if (vertexData?.candidates?.[0]?.content?.parts?.[0]?.text) {
                  log(`[AiService] Success with Vertex AI API Key (Full URL), model: ${vModel}`, 'info');
                  return {
                    success: true,
                    content: vertexData.candidates[0].content.parts[0].text.trim(),
                    model: vModel,
                    service: 'vertex-api-key'
                  };
                }
              } catch (fullErr: any) {
                const errorStatus = fullErr.response?.status || 'unknown';
                const errorData = fullErr.response?.data ? JSON.stringify(fullErr.response.data) : fullErr.message;
                log(`[AiService] Vertex API Key (Full URL) failed for ${vModel}: ${errorStatus}`, 'warn');
                console.error(`[CRITICAL-VERTEX-ERROR] ${vModel}:`, errorData);
              }
              continue;
            }
          }
        } catch (vertexApiKeyError: any) {
          log(`[AiService] Vertex AI API Key logic failed: ${vertexApiKeyError.message}`, 'error');
        }
      } else {
        // Пытаемся использовать Vertex AI Service Account (если ключ не AQ.)
        try {
          log(`[AiService] Attempting Vertex AI Service Account for model ${modelId}`, 'info');
          const vertexContent = await geminiVertexDirect.generateContent({
            prompt: fullPrompt,
            model: modelId
          });
          
          if (vertexContent) {
            log(`[AiService] Content successfully generated via Vertex AI Service Account`, 'info');
            return {
              success: true,
              content: vertexContent.trim(),
              model: modelId,
              service: 'gemini-vertex'
            };
          }
        } catch (vertexError: any) {
          log(`[AiService] Vertex AI Service Account failed: ${vertexError.message}`, 'warn');
        }

        // Вызов API Google AI Studio через американский прокси (обязательно для AIzaSy ключей)
        logger.log(`[AiService] Using Gemini Proxy for AIzaSy key`, 'gemini');
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
          // Цепочка fallback: 2.5-flash → 1.5-flash → 1.5-flash-8b
          const fallbackChain = ['gemini-1.5-flash', 'gemini-1.5-flash-8b'];
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
      const fullPrompt = `${systemPrompt || 'Вы — профессиональный SMM-менеджер.'}${platformContext}${toneContext}${keywordContext}\n\nЗадание: ${prompt}`;

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
    log(`[AiService] generateContent: service=${service}, model=${params.model || 'none'}`, 'info');

    const isQuotaError = (err: any) => {
      const msg: string = err?.message || '';
      return msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || msg.includes('rate limit');
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
          result = await this.generateWithDeepSeek({ ...params, model: 'deepseek-chat', service: 'deepseek' });
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
        if (crawlResult.success && crawlResult.text) {
          websiteContent = crawlResult.text;
          log(`[KEYWORDS_ANALYZE] Content obtained via Puppeteer (${websiteContent.length} chars)`, 'info');
        } else {
          log(`[KEYWORDS_ANALYZE] Puppeteer failed, falling back to Axios: ${crawlResult.error}`, 'warn');
          websiteContent = await extractFullSiteContent(url);
        }
      } catch (e: any) {
        log(`[KEYWORDS_ANALYZE] Crawler error, falling back to Axios: ${e.message}`, 'warn');
        websiteContent = await extractFullSiteContent(url);
      }

      if (!websiteContent || websiteContent.length < 50 || websiteContent.includes("Ошибка загрузки сайта")) {
        log(`[KEYWORDS_ANALYZE] Failed to get website content: ${websiteContent.substring(0, 100)}`, 'error');
        throw new Error("Не удалось получить контент сайта для анализа ключевых слов");
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

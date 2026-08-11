import { GoogleGenerativeAI } from '@google/generative-ai';
import * as logger from '../utils/logger';
import { SocksProxyAgent } from 'socks-proxy-agent';
import fetch from 'node-fetch';


/**
 * Отправляется во все запросы к Gemini. См. комментарий у fetchOptions:
 * без User-Agent воркер Cloudflare отвечает 403 / error code 1010.
 */
export const GEMINI_USER_AGENT = 'smm-manager/1.0 (+https://smm.nplanner.ru)';

interface GeminiProxyOptions {
  apiKey: string;
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyPassword?: string;
}

/**
 * Реализация сервиса Gemini с поддержкой SOCKS5 прокси
 */
export class GeminiProxyService {
  private apiKey: string;
  private agent: SocksProxyAgent | null;
  private proxyUrl: string | null;
  private maxRetries: number = 3;
  
  /**
   * Определяет правильную версию API и URL для модели
   * @param model Название модели
   * @param apiKey API ключ (если используется Google AI Studio)
   * @returns Объект с версией API и базовым URL
   */
  private async getApiVersionForModel(model: string, apiKey?: string): Promise<{ version: string; baseUrl: string }> {
    let baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const workerProxy = process.env.GEMINI_PROXY_URL;
    if (workerProxy) {
      try {
        const proxyUrl = new URL(workerProxy);
        const originalUrl = new URL(baseUrl);
        originalUrl.host = proxyUrl.host;
        originalUrl.protocol = proxyUrl.protocol;
        baseUrl = originalUrl.toString();
        // AI-84: фрагменты ключа (10+8 символов) однозначно опознавали
        // настоящий ключ в проде. Печатаем только факт наличия и длину.
        const keyPreview = apiKey ? `[redacted len=${apiKey.length}]` : 'no-key';
        logger.log(`[gemini-proxy] REDIRECTING to Worker Proxy with key=${keyPreview}`, 'gemini');
      } catch (e) {
        logger.log(`[gemini-proxy] Invalid GEMINI_PROXY_URL: ${workerProxy}`, 'error');
      }
    }

    return { version: 'v1beta', baseUrl };
  }

  /**
   * Преобразует упрощенные названия моделей в правильные названия API
   * @param model Упрощенное название модели
   * @returns Правильное название для API
   */
  private mapModelToApiName(model: string): string {
    const modelMap: Record<string, string> = {
      // Несуществующие / устаревшие имена → реальные модели
      'gemini-3-pro-preview': 'gemini-2.5-pro',
      'gemini-3-flash-preview': 'gemini-2.5-flash',
      'gemini-3.0-pro': 'gemini-2.5-pro',
      'gemini-3.0-flash': 'gemini-2.5-flash',
      'gemini-3.0-flash-preview': 'gemini-2.5-flash',
      // Актуальные модели (прямое использование)
      'gemini-2.5-pro': 'gemini-2.5-pro',
      'gemini-2.5-flash': 'gemini-2.5-flash',
      'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite',
      // Устаревшие 2.0 → 2.5
      'gemini-2.0-flash': 'gemini-2.5-flash',
      'gemini-2.0-flash-lite': 'gemini-2.5-flash'
    };

    return modelMap[model] || model;
  }
  
  /**
   * Создает новый экземпляр GeminiProxyService
   * @param options Опции для инициализации сервиса
   */
  constructor(options: GeminiProxyOptions) {
    this.apiKey = options.apiKey;
    
    // Настройки прокси - только из переменных окружения
    const proxyHost = options.proxyHost || process.env.PROXY_HOST;
    const proxyPort = options.proxyPort || (process.env.PROXY_PORT ? parseInt(process.env.PROXY_PORT) : undefined);
    const proxyUsername = options.proxyUsername || process.env.PROXY_USERNAME;
    const proxyPassword = options.proxyPassword || process.env.PROXY_PASSWORD;
    
    if (proxyHost && proxyPort) {
      // Формируем URL прокси с учетными данными
      const authPart = (proxyUsername && proxyPassword) ? `${proxyUsername}:${proxyPassword}@` : '';
      this.proxyUrl = `socks5://${authPart}${proxyHost}:${proxyPort}`;
      
      // Создаем прокси-агент
      try {
        this.agent = new SocksProxyAgent(this.proxyUrl);
        const safeProxyUrl = this.proxyUrl.replace(/:[^:@]*@/, ':***@');
        logger.log(`[gemini-proxy] Инициализирован SOCKS5 прокси: ${safeProxyUrl}`, 'gemini');
      } catch (error) {
        logger.error(`[gemini-proxy] Ошибка инициализации SOCKS5 прокси: ${(error as Error).message}`, 'gemini');
        this.agent = null;
        this.proxyUrl = null;
      }
    } else {
      logger.log(`[gemini-proxy] Прокси не настроен, используется прямое соединение`, 'gemini');
      this.agent = null;
      this.proxyUrl = null;
    }
  }
  
  /**
   * Обновляет API ключ для сервиса
   * @param apiKey Новый API ключ
   */
  public setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  /**
   * Отправляет запрос к Gemini API через Cloudflare Worker прокси
   * @param url URL для запроса
   * @param body Тело запроса
   * @returns Ответ от API в виде JSON
   */
  async sendRequest(url: string, body: any): Promise<any> {
    let retries = 0;
    let lastError: Error | null = null;
    
    while (retries < this.maxRetries) {
      try {
        // Маскируем API ключ в URL для логов
        const safeUrl = typeof url === 'string' ? url.replace(/key=[^&]+/, 'key=****') : url;
        logger.log(`[gemini-proxy] Отправка запроса к: ${safeUrl}`, 'gemini');
        
        // Если задан прокси-воркер Cloudflare, используем его (агент не нужен)
        const workerProxy = process.env.GEMINI_PROXY_URL;
        let useWorker = false;
        if (workerProxy) {
          try {
            const proxyUrl = new URL(workerProxy);
            const originalUrl = new URL(url);
            originalUrl.host = proxyUrl.host;
            originalUrl.protocol = proxyUrl.protocol;
            url = originalUrl.toString();
            logger.log(`[gemini-proxy] 🚀 REDIRECTING to Worker Proxy: ${url.replace(/key=[^&]+/, 'key=****')}`, 'gemini');
            useWorker = true;
          } catch (e) {
            logger.log(`[gemini-proxy] ❌ Invalid GEMINI_PROXY_URL: ${workerProxy}`, 'error');
          }
        }

        const fetchOptions: any = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // User-Agent обязателен. Запросы к Gemini идут через воркер
            // Cloudflare (обход блокировки по региону), а Cloudflare отбивает
            // запрос без User-Agent как ботовый: HTTP 403, тело «error code:
            // 1010». Снаружи это неотличимо от «Gemini не работает».
            // Проверено 11.08 с прода: без заголовка 403, с заголовком 200.
            // Умолчание библиотеки сюда подставлять нельзя — оно меняется от
            // версии к версии, а заголовок здесь несёт функцию, а не вежливость.
            'User-Agent': GEMINI_USER_AGENT
          },
          body: JSON.stringify(body)
        };
        
        // Используем прокси для доступа к Gemini API
        const isReplit = process.env.REPLIT_DOMAINS || process.env.REPL_ID;
        const isStaging = process.env.NODE_ENV === 'staging' || process.env.NODE_ENV === 'production';
        
        let useProxy = false;
        if (process.env.FORCE_GEMINI_PROXY === 'true') {
          useProxy = true;
        } else if (process.env.FORCE_GEMINI_PROXY === 'false') {
          useProxy = false;
        } else {
          useProxy = isStaging && !isReplit;
        }
        
        // Используем SOCKS5 агент только если НЕ используем воркер и агент доступен
        if (!useWorker && this.agent && useProxy) {
          fetchOptions.agent = this.agent;
          logger.log(`[gemini-proxy] 🇺🇸 Используется SOCKS5 агент`, 'gemini');
        } else if (!useWorker && !isReplit && isStaging && !this.agent) {
          logger.warn(`[gemini-proxy] ⚠️ ВНИМАНИЕ: Прокси недоступен - прямое соединение может быть заблокировано Google`, 'gemini');
        }
        
        // Выполняем запрос
        const response = await fetch(url, fetchOptions);
        const status = response.status;
        
        logger.log(`[gemini-proxy] Получен ответ со статусом: ${status}`, 'gemini');
        
        if (status === 200) {
          // Успешный ответ
          const data = await response.json();
          return data;
        } else {
          // Обрабатываем ошибку
          const errorText = await response.text();
          throw new Error(`HTTP error ${status}: ${errorText}`);
        }
      } catch (error) {
        lastError = error as Error;
        // 404 — модель не существует, retry бессмысленен
        // 429 / RESOURCE_EXHAUSTED — квота исчерпана (дневной лимит), ждать бесполезно
        if (
          lastError.message?.includes('404') ||
          lastError.message?.includes('NOT_FOUND') ||
          lastError.message?.includes('429') ||
          lastError.message?.includes('RESOURCE_EXHAUSTED')
        ) {
          break;
        }
        retries++;
        
        if (retries < this.maxRetries) {
          const backoffTime = Math.pow(2, retries) * 500; // Экспоненциальная задержка
          logger.warn(`[gemini-proxy] Попытка ${retries} из ${this.maxRetries} не удалась. Повтор через ${backoffTime}ms. Ошибка: ${lastError.message}`, 'gemini');
          await new Promise(resolve => setTimeout(resolve, backoffTime));
        }
      }
    }
    
    // Если все попытки неудачны
    throw new Error(`[gemini-proxy] Максимальное количество попыток исчерпано. Последняя ошибка: ${lastError?.message || 'Неизвестная ошибка'}`);
  }
  
  /**
   * Тестирует доступность API Gemini и валидность API ключа
   * @returns true если API ключ действителен и доступен, иначе false
   */
  async testApiKey(): Promise<boolean> {
    try {
      const { baseUrl } = await this.getApiVersionForModel('gemini-2.5-flash', this.apiKey);

      // Тестовый промпт
      const requestData = {
        contents: [
          {
            parts: [
              {
                text: "Hello, this is a test message."
              }
            ]
          }
        ]
      };
      
      // Отправляем запрос
      if (!url) throw new Error('URL не получен от Vertex AI');
      await this.sendRequest(url, requestData, true);
      
      return true;
    } catch (error) {
      logger.error(`[gemini-proxy] Ошибка при тестировании API ключа: ${(error as Error).message}`, 'gemini');
      return false;
    }
  }
  
  /**
   * Улучшает текст с помощью Gemini API
   * @param params Параметры для улучшения текста
   * @returns Улучшенный текст
   */
  async improveText(params: { text: string; prompt: string; model?: string }): Promise<string> {
    try {
      const { text, prompt, model = 'gemini-2.5-pro' } = params;
      
      logger.log(`[gemini-proxy] Improving text with model: ${model}`, 'gemini');
      
      // Преобразуем модель в правильное название API
      const apiModel = this.mapModelToApiName(model);
      logger.log(`[gemini-proxy] Mapped model ${model} to API model: ${apiModel}`, 'gemini');
      
      // Определяем правильную версию API для модели
      const { baseUrl } = await this.getApiVersionForModel(apiModel, this.apiKey);
      
      // Все запросы теперь идут через Vertex AI или Google AI Studio
      const url = typeof baseUrl === 'string' ? baseUrl : `${baseUrl}`;
      
      // Формируем запрос
      const requestData = {
        contents: [
          {
            parts: [
              {
                text: `${prompt}\n\n${text}`
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.4,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 8192
        }
      };
      
      // Отправляем запрос
      const response = await this.sendRequest(url, requestData);
      
      // Обрабатываем ответ
      if (response.candidates && response.candidates.length > 0 && 
          response.candidates[0].content && 
          response.candidates[0].content.parts && 
          response.candidates[0].content.parts.length > 0) {
        // Gemini 2.5 thinking models return thought parts first; skip them
        const parts: any[] = response.candidates[0].content.parts;
        const nonThoughtParts = parts.filter((p: any) => !p.thought);
        const textParts = nonThoughtParts.length > 0 ? nonThoughtParts : parts;
        let resultText = textParts.map((p: any) => p.text || '').join('');
        
        // Очищаем текст от HTML-тегов и других артефактов
        resultText = resultText.replace(/<automatic_updates>[\s\S]*?<\/automatic_updates>/g, '');
        resultText = resultText.replace(/<[^>]*>/g, '');
        resultText = resultText.replace(/```html/g, ''); // Удаляем маркеры начала HTML-кода
        resultText = resultText.replace(/```/g, ''); // Удаляем оставшиеся маркеры кода
        
        // Удаляем технические разделители --- (маркер AI-генерации)
        resultText = resultText.replace(/\n---+\n/g, '\n\n'); // --- между абзацами → пустая строка
        resultText = resultText.replace(/^---+\s*\n?/g, ''); // --- в начале
        resultText = resultText.replace(/\n?\s*---+\s*$/g, ''); // --- в конце
        resultText = resultText.trim(); // Убираем лишние пробелы
        
        return resultText;
      }
      
      throw new Error('Неожиданный формат ответа от Gemini API');
    } catch (error) {
      logger.error(`[gemini-proxy] Ошибка при улучшении текста: ${(error as Error).message}`, 'gemini');
      throw error;
    }
  }
  
  /**
   * Генерирует текст с помощью Gemini API
   * @param params Параметры для генерации текста
   * @returns Сгенерированный текст
   */
  async generateText(params: { prompt: string; model?: string; apiKey?: string }): Promise<string> {
    try {
      const { prompt, model = 'gemini-2.5-pro' } = params;
      // Защита от race condition: если ключ передан в params — используем его локально,
      // не полагаясь на this.apiKey (который может быть перезаписан другим параллельным
      // вызовом setApiKey() от другого пользователя за время await'ов).
      const effectiveKey = params.apiKey || this.apiKey;

      logger.log(`[gemini-proxy] Generating text with model: ${model}`, 'gemini');
      
      // Преобразуем модель в правильное название API
      const apiModel = this.mapModelToApiName(model);
      logger.log(`[gemini-proxy] Mapped model ${model} to API model: ${apiModel}`, 'gemini');
      
      // Определяем правильную версию API для модели
      const { baseUrl } = await this.getApiVersionForModel(apiModel, effectiveKey);
      
      // Все запросы теперь идут через Vertex AI или Google AI Studio
      const url = typeof baseUrl === 'string' ? baseUrl : `${baseUrl}`;
      
      // Формируем запрос
      const requestData = {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 8192
        }
      };
      
      // Отправляем запрос
      const response = await this.sendRequest(url, requestData);
      
      // Обрабатываем ответ
      if (response.candidates && response.candidates.length > 0 && 
          response.candidates[0].content && 
          response.candidates[0].content.parts && 
          response.candidates[0].content.parts.length > 0) {
        // Gemini 2.5 thinking models return thought parts first; skip them
        const parts: any[] = response.candidates[0].content.parts;
        const nonThoughtParts = parts.filter((p: any) => !p.thought);
        const textParts = nonThoughtParts.length > 0 ? nonThoughtParts : parts;
        let resultText = textParts.map((p: any) => p.text || '').join('');
        
        // Очищаем текст от HTML-тегов и других артефактов
        resultText = resultText.replace(/<automatic_updates>[\s\S]*?<\/automatic_updates>/g, '');
        resultText = resultText.replace(/<[^>]*>/g, '');
        resultText = resultText.replace(/```html/g, ''); // Удаляем маркеры начала HTML-кода
        resultText = resultText.replace(/```/g, ''); // Удаляем оставшиеся маркеры кода
        
        // Удаляем технические разделители --- (маркер AI-генерации)
        resultText = resultText.replace(/\n---+\n/g, '\n\n'); // --- между абзацами → пустая строка
        resultText = resultText.replace(/^---+\s*\n?/g, ''); // --- в начале
        resultText = resultText.replace(/\n?\s*---+\s*$/g, ''); // --- в конце
        resultText = resultText.trim(); // Убираем лишние пробелы
        
        return resultText;
      }
      
      // Добавим детальное логирование структуры ответа для отладки
      logger.log(`[gemini-proxy] Неожиданная структура ответа от API: ${JSON.stringify(response, null, 2)}`, 'gemini');
      throw new Error(`Неожиданный формат ответа от Gemini API ${model}`);
    } catch (error) {
      logger.error(`[gemini-proxy] Ошибка при генерации текста: ${(error as Error).message}`, 'gemini');
      throw error;
    }
  }
}

// Создаем глобальный экземпляр сервиса - теперь используем только Vertex AI без API ключей
export const geminiProxyService = new GeminiProxyService({ 
  apiKey: '' // Заглушка, фактически не используется
});

// Безопасная инициализация без логирования ключей
logger.log(`[gemini-proxy] Инициализирован для работы с Vertex AI`, 'gemini');
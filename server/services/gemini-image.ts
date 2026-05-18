/**
 * Сервис для генерации изображений через Vertex AI Gemini Image API
 * Использует GA модель gemini-2.5-flash-image через Vertex AI endpoint
 * Поддерживает text-to-image генерацию с retry logic и географическую независимость
 */

import { GoogleGenAI, Modality } from "@google/genai";
import * as fs from 'fs';
import * as path from 'path';
import { apiKeyService, ApiServiceName } from './api-keys';

// Интерфейс для параметров генерации изображений
export interface GeminiImageOptions {
  prompt: string;                // Промт для генерации
  negativePrompt?: string;       // Негативный промт (добавляется к основному)
  width?: number;                // Ширина изображения (по умолчанию 1024)
  height?: number;               // Высота изображения (по умолчанию 1024)
  numImages?: number;            // Количество изображений (по умолчанию 1)
  userId?: string;               // ID пользователя для получения API ключа
  campaignId?: string;           // ID кампании (для аналитики)
  contentId?: string;            // ID контента (для аналитики)
  style?: string;                // Стиль изображения (photographic, digital-art, etc.)
  model?: 'gemini' | 'imagen4' | 'imagen4-fast' | 'imagen4-ultra'; // Модель генерации
}

// Интерфейс для результата генерации
export interface GeminiImageResult {
  success: boolean;
  imageUrl?: string;
  imageData?: string;            // Base64 данные изображения
  error?: string;
  generationTime?: number;       // Время генерации в миллисекундах
  model: string;
  prompt: string;
  metadata?: {
    width: number;
    height: number;
    format: string;
  };
}

export class GeminiImageService {
  private ai: GoogleGenAI;
  private readonly defaultModel = "gemini-2.5-flash-image-preview"; // Дефолтная модель
  private readonly maxRetries = 3; // Максимум попыток для retry logic
  private readonly retryDelay = 1000; // Начальная задержка в мс
  
  // Доступные модели для генерации изображений
  private readonly availableModels = {
    'gemini': 'gemini-2.5-flash-image-preview',  // $0.039/image, быстрая
    'imagen4': 'imagen-4.0-generate-001',         // $0.04/image, высокое качество
    'imagen4-fast': 'imagen-4.0-fast-generate-001', // $0.02/image, быстрая
    'imagen4-ultra': 'imagen-4.0-ultra-generate-001' // $0.06/image, максимальное качество
  };
  
  constructor(apiKey?: string) {
    // API ключ опционален - приоритет у OAuth2
    const key = apiKey || process.env.GEMINI_API_KEY || "";
    
    if (key) {
      this.ai = new GoogleGenAI({ apiKey: key });
      console.log('[GEMINI-IMAGE] 🔑 Инициализирован с API ключом');
    } else {
      console.log('[GEMINI-IMAGE] 🔐 Инициализирован для OAuth2 режима');
      // @ts-ignore - OAuth2 режим, ai не используется
      this.ai = null; // Будем использовать только OAuth2
    }
  }

  /**
   * Retry helper с экспоненциальной задержкой
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    retryCount: number = 0
  ): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      // Проверяем нужна ли повторная попытка (только для 500/503 ошибок)
      const shouldRetry = 
        retryCount < this.maxRetries &&
        (error.message?.includes('500') || error.message?.includes('503') || error.message?.includes('INTERNAL'));
      
      if (!shouldRetry) {
        throw error;
      }
      
      const delay = this.retryDelay * Math.pow(2, retryCount);
      console.log(`[GEMINI-IMAGE] ⏳ Retry ${retryCount + 1}/${this.maxRetries} after ${delay}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return this.retryWithBackoff(fn, retryCount + 1);
    }
  }

  /**
   * Создает расширенный промт с учетом стиля и негативного промпта
   */
  private buildEnhancedPrompt(options: GeminiImageOptions): string {
    let enhancedPrompt = options.prompt;

    // Добавляем стиль если указан
    if (options.style) {
      const styleMap: { [key: string]: string } = {
        'photographic': 'Professional photograph, high quality, realistic, detailed',
        'digital-art': 'Digital art, artistic, creative, vibrant colors',
        'cinematic': 'Cinematic style, dramatic lighting, movie-like composition',
        'anime': 'Anime style, manga art, japanese animation style',
        'abstract': 'Abstract art, non-representational, artistic interpretation',
        'portrait': 'Portrait photography, focused on subject, professional lighting',
        'landscape': 'Landscape photography, wide view, natural scenery'
      };
      
      const stylePrefix = styleMap[options.style] || options.style;
      enhancedPrompt = `${stylePrefix}. ${enhancedPrompt}`;
    }

    // Добавляем качественные модификаторы
    enhancedPrompt += '. High quality, detailed, professional';

    // Добавляем негативный промт если указан
    if (options.negativePrompt) {
      enhancedPrompt += `. Avoid: ${options.negativePrompt}`;
    }

    return enhancedPrompt;
  }

  /**
   * Генерирует изображение через Vertex AI Gemini Image API (gemini-2.5-flash-image)
   * Использует Vertex AI endpoint для обхода географических ограничений
   */
  async generateImage(options: GeminiImageOptions): Promise<GeminiImageResult> {
    const startTime = Date.now();
    
    try {
      console.log('[GEMINI-IMAGE] 🎨 Начинаем генерацию изображения через Vertex AI');
      console.log('[GEMINI-IMAGE] 📝 Промт:', options.prompt);
      console.log('[GEMINI-IMAGE] 🎭 Стиль:', options.style || 'default');

      // Получаем Google Service Account credentials (те же что для текста)
      const { globalApiKeysService } = await import('./global-api-keys.js');
      const credentials = await globalApiKeysService.getGoogleServiceAccountKey();
      
      if (!credentials) {
        throw new Error('Google Service Account credentials не найдены в Directus');
      }

      const projectId = credentials.project_id;
      const clientEmail = credentials.client_email;
      const privateKey = credentials.private_key;

      console.log('[GEMINI-IMAGE] 📧 Project ID:', projectId);
      console.log('[GEMINI-IMAGE] 📧 Client Email:', clientEmail);

      // Получаем OAuth2 access token через GoogleAuth
      const { GoogleAuth } = await import('google-auth-library');
      const auth = new GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      });

      const client = await auth.getClient();
      const accessTokenResponse = await client.getAccessToken();
      const accessToken = accessTokenResponse.token;

      if (!accessToken) {
        throw new Error('Не удалось получить access token для Vertex AI');
      }

      console.log('[GEMINI-IMAGE] ✅ Access token получен для Vertex AI');

      // Строим расширенный промт
      const enhancedPrompt = this.buildEnhancedPrompt(options);
      console.log('[GEMINI-IMAGE] 🚀 Расширенный промт:', enhancedPrompt);

      // Используем GA модель gemini-2.5-flash-image через Vertex AI
      const vertexModel = 'gemini-2.5-flash-image';
      const vertexUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${vertexModel}:generateContent`;

      console.log('[GEMINI-IMAGE] 🌐 Vertex AI URL:', vertexUrl);

      // Выполняем HTTP запрос к Vertex AI с retry logic и таймаутом 60 сек
      const VERTEX_TIMEOUT_MS = 60_000;
      const response = await this.retryWithBackoff(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), VERTEX_TIMEOUT_MS);

        let res: Response;
        try {
          res = await fetch(vertexUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contents: [{ 
                role: "user", 
                parts: [{ text: enhancedPrompt }] 
              }],
              generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
                temperature: 0.8,
                maxOutputTokens: 2048
              }
            }),
            signal: controller.signal
          });
        } catch (fetchErr: any) {
          if (fetchErr.name === 'AbortError') {
            throw new Error(`Vertex AI timeout after ${VERTEX_TIMEOUT_MS / 1000}s — попробуйте ещё раз`);
          }
          throw fetchErr;
        } finally {
          clearTimeout(timeoutId);
        }

        // КРИТИЧНО: Проверяем статус и выбрасываем ошибку для retry logic
        if (!res.ok) {
          const errorText = await res.text();
          console.error('[GEMINI-IMAGE] ❌ HTTP Error:', res.status, res.statusText);
          console.error('[GEMINI-IMAGE] ❌ Error details:', errorText.substring(0, 300));
          throw new Error(`HTTP ${res.status}: ${res.statusText} - ${errorText.substring(0, 200)}`);
        }

        return res;
      });

      console.log('[GEMINI-IMAGE] 📦 Получен успешный ответ от Gemini API');

      // Парсим JSON ответ
      const responseData = await response.json();
      console.log('[GEMINI-IMAGE] 📋 Получен ответ от API (детали скрыты для безопасности)');

      const candidates = responseData.candidates;
      if (!candidates || candidates.length === 0) {
        throw new Error('Нет кандидатов в ответе от Gemini API');
      }

      const content = candidates[0].content;
      if (!content || !content.parts) {
        throw new Error('Нет контента в ответе от Gemini API');
      }

      // Ищем изображение в ответе
      let imageData: string | undefined;
      let textResponse: string | undefined;

      for (const part of content.parts) {
        if (part.text) {
          textResponse = part.text;
          console.log('[GEMINI-IMAGE] 💬 Текстовый ответ:', part.text);
        } else if (part.inlineData && part.inlineData.data) {
          imageData = part.inlineData.data;
          console.log('[GEMINI-IMAGE] 🖼️ Получены данные изображения');
        }
      }

      if (!imageData) {
        throw new Error('Изображение не найдено в ответе от Gemini API');
      }

      console.log('[GEMINI-IMAGE] 📤 Начинаем загрузку изображения на постоянное хранилище...');

      // Загружаем изображение на Beget S3 для постоянного хранения
      let permanentImageUrl: string | undefined = undefined;
      try {
        const { begetS3StorageAws } = await import('./beget-s3-storage-aws');
        
        // Генерируем уникальное имя файла
        const fileName = `images/generated/gemini-${Date.now()}-${Math.random().toString(36).substring(7)}.png`;
        
        // Конвертируем base64 в Buffer
        const imageBuffer = Buffer.from(imageData, 'base64');
        
        // Загружаем на Beget S3
        const uploadResult = await begetS3StorageAws.uploadFile({
          key: fileName,
          fileData: imageBuffer,
          contentType: 'image/png'
        });
        
        if (uploadResult.success && uploadResult.url) {
          permanentImageUrl = uploadResult.url;
          console.log('[GEMINI-IMAGE] ✅ Изображение успешно загружено:', permanentImageUrl);
        } else {
          console.warn('[GEMINI-IMAGE] ⚠️ Не удалось загрузить изображение, используем base64 fallback');
        }
      } catch (uploadError) {
        console.error('[GEMINI-IMAGE] ❌ Ошибка загрузки изображения:', uploadError);
      }

      const generationTime = Date.now() - startTime;
      console.log('[GEMINI-IMAGE] ✅ Изображение сгенерировано за', generationTime, 'мс');

      return {
        success: true,
        imageUrl: permanentImageUrl, // Постоянный URL если загрузка успешна
        imageData: permanentImageUrl ? undefined : imageData, // base64 только как fallback
        generationTime,
        model: 'gemini-2.5-flash-image (Vertex AI)',
        prompt: options.prompt,
        metadata: {
          width: options.width || 1024,
          height: options.height || 1024,
          format: 'png'
        }
      };

    } catch (error: any) {
      const generationTime = Date.now() - startTime;
      console.error('[GEMINI-IMAGE] ❌ Ошибка генерации изображения:', error);
      
      return {
        success: false,
        error: error.message || 'Неизвестная ошибка при генерации изображения',
        generationTime,
        model: 'gemini-2.5-flash-image (Vertex AI)',
        prompt: options.prompt
      };
    }
  }

  /**
   * Генерирует изображение через обычный Gemini API (не Vertex AI),
   * с поддержкой Cloudflare Worker прокси (GEMINI_PROXY_URL).
   * Возвращает массив постоянных URL (через Beget S3).
   */
  async generateImageViaRegularApi(options: {
    prompt: string;
    numImages?: number;
    style?: string;
  }): Promise<string[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY не настроен');

    const enhancedPrompt = this.buildEnhancedPrompt({
      prompt: options.prompt,
      style: options.style
    });

    const numImages = Math.min(options.numImages || 1, 4);
    const urls: string[] = [];

    // Применяем Cloudflare Worker прокси если настроен (как в gemini-proxy.ts)
    const workerProxy = process.env.GEMINI_PROXY_URL;
    let baseUrl: string | undefined;
    if (workerProxy) {
      try {
        const pUrl = new URL(workerProxy);
        baseUrl = `${pUrl.protocol}//${pUrl.host}`;
        console.log(`[GEMINI-IMAGE] 🚀 Через Cloudflare Worker: ${baseUrl}`);
      } catch {
        console.warn('[GEMINI-IMAGE] ⚠️ Неверный GEMINI_PROXY_URL, используем прямое подключение');
      }
    } else {
      console.warn('[GEMINI-IMAGE] ⚠️ GEMINI_PROXY_URL не задан, прямое подключение');
    }

    // Модели для генерации изображений (проверены через ListModels + прямые запросы)
    const attempts = [
      { model: 'gemini-2.5-flash-image',          apiVersion: 'v1beta' },
      { model: 'gemini-3.1-flash-image-preview',  apiVersion: 'v1beta' },
      { model: 'gemini-3-pro-image-preview',      apiVersion: 'v1beta' },
    ];

    for (let i = 0; i < numImages; i++) {
      let imageData: string | undefined;
      let lastError: string = '';

      for (const { model, apiVersion } of attempts) {
        try {
          console.log(`[GEMINI-IMAGE] 🎨 Пробуем ${model} (${apiVersion})`);
          const sdkOptions: any = { apiKey };
          if (baseUrl) sdkOptions.httpOptions = { baseUrl, apiVersion };
          else sdkOptions.httpOptions = { apiVersion };
          const ai = new GoogleGenAI(sdkOptions);

          const response = await ai.models.generateContent({
            model,
            contents: enhancedPrompt,
            config: { responseModalities: [Modality.TEXT, Modality.IMAGE] }
          });

          const parts = response?.candidates?.[0]?.content?.parts || [];
          for (const part of parts as any[]) {
            if (part.inlineData?.data) {
              imageData = part.inlineData.data;
              console.log(`[GEMINI-IMAGE] ✅ Изображение получено: ${model} (${apiVersion})`);
              break;
            }
          }

          if (imageData) break;
        } catch (err: any) {
          lastError = err.message || String(err);
          console.warn(`[GEMINI-IMAGE] ❌ ${model} (${apiVersion}): ${lastError.substring(0, 120)}`);
        }
      }

      if (!imageData) throw new Error(`Ни одна модель Gemini не вернула изображение. Последняя ошибка: ${lastError}`);

      // Загружаем на Beget S3 для постоянного URL
      try {
        const { begetS3StorageAws } = await import('./beget-s3-storage-aws');
        const fileName = `images/generated/gemini-nano-${Date.now()}-${i}.png`;
        const uploadResult = await begetS3StorageAws.uploadFile({
          key: fileName,
          fileData: Buffer.from(imageData, 'base64'),
          contentType: 'image/png'
        });
        if (uploadResult.success && uploadResult.url) {
          urls.push(uploadResult.url);
        } else {
          urls.push(`data:image/png;base64,${imageData}`);
        }
      } catch {
        urls.push(`data:image/png;base64,${imageData}`);
      }
    }

    return urls;
  }

  /**
   * Сохраняет изображение в файл
   */
  async saveImage(imageData: string, filePath: string): Promise<boolean> {
    try {
      const buffer = Buffer.from(imageData, 'base64');
      const dir = path.dirname(filePath);
      
      // Создаем директорию если не существует
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(filePath, buffer);
      console.log('[GEMINI-IMAGE] 💾 Изображение сохранено:', filePath);
      return true;
    } catch (error) {
      console.error('[GEMINI-IMAGE] ❌ Ошибка сохранения изображения:', error);
      return false;
    }
  }

  /**
   * Получает информацию о доступных возможностях
   */
  getCapabilities() {
    return {
      provider: 'Gemini Vertex AI',
      model: 'gemini-2.5-flash-image',
      features: [
        'Text-to-image generation',
        'High quality output',
        'Generation (~12 seconds)',
        'OAuth2 authentication',
        'Excellent text rendering',
        'Style customization',
        'Negative prompts'
      ],
      pricing: '$0.039 per image',
      maxResolution: '1024x1024',
      supportedFormats: ['PNG'],
      styles: [
        'photographic',
        'digital-art', 
        'cinematic',
        'anime',
        'abstract',
        'portrait',
        'landscape'
      ]
    };
  }
}

// Функция для создания экземпляра сервиса (безопасная инициализация)
export function createGeminiImageService(apiKey?: string): GeminiImageService {
  return new GeminiImageService(apiKey);
}
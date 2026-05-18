import { log } from '../utils/logger.js';
import { GoogleAuth } from 'google-auth-library';
import { globalApiKeysService, VertexAIServiceAccount } from './global-api-keys';
import { SocksProxyAgent } from 'socks-proxy-agent';
import fetch from 'node-fetch';

/**
 * Прямой сервис для работы с Gemini через Vertex AI без зависимостей
 * Теперь использует GlobalApiKeysService для получения credentials из Директус
 */
class GeminiVertexDirect {
  private projectId?: string;
  private credentials?: VertexAIServiceAccount;
  private isInitialized = false;
  private agent: SocksProxyAgent | null = null;

  constructor() {
    this.initializeProxy();
  }

  /**
   * Инициализирует прокси-агент для обхода блокировок
   */
  private initializeProxy(): void {
    try {
      const proxyHost = process.env.PROXY_HOST;
      const proxyPort = process.env.PROXY_PORT;
      const proxyUsername = process.env.PROXY_USERNAME;
      const proxyPassword = process.env.PROXY_PASSWORD;
      
      if (proxyHost && proxyPort) {
        const authPart = (proxyUsername && proxyPassword) ? `${proxyUsername}:${proxyPassword}@` : '';
        const proxyUrl = `socks5://${authPart}${proxyHost}:${proxyPort}`;
        this.agent = new SocksProxyAgent(proxyUrl);
        log(`[gemini-vertex-direct] SOCKS5 прокси инициализирован`, 'info');
      } else {
        log(`[gemini-vertex-direct] Прокси не настроен, используется прямое соединение`, 'info');
        this.agent = null;
      }
    } catch (error) {
      log(`[gemini-vertex-direct] Ошибка инициализации прокси: ${error}`, 'warn');
      this.agent = null;
    }
  }

  private getLocationForModel(model: string): string {
    // Gemini 3 модели требуют global location
    if (model.includes('gemini-3')) {
      return 'global';
    }
    return 'us-central1';
  }

  private getEndpointForModel(model: string): string {
    const location = this.getLocationForModel(model);
    if (location === 'global') {
      return 'aiplatform.googleapis.com';
    }
    return `${location}-aiplatform.googleapis.com`;
  }

  /**
   * Инициализирует credentials из GlobalApiKeysService
   */
  private async initializeCredentials(): Promise<void> {
    if (this.isInitialized && this.credentials) {
      return;
    }

    try {
      log(`[gemini-vertex-direct] Получение Google Service Account credentials из Директус`, 'info');
      
      const credentials = await globalApiKeysService.getGoogleServiceAccountKey();
      
      if (!credentials) {
        throw new Error('Google Service Account Key (GOOGLE_SERVICE_ACCOUNT_KEY) не найден в Директус');
      }

      if (!credentials.project_id || !credentials.private_key || !credentials.client_email) {
        throw new Error('Отсутствуют обязательные поля в Vertex AI credentials');
      }

      this.credentials = credentials;
      this.projectId = credentials.project_id;
      this.isInitialized = true;

      log(`[gemini-vertex-direct] Успешно инициализирован для проекта ${this.projectId} с client_email ${credentials.client_email}`, 'info');
    } catch (error) {
      log(`[gemini-vertex-direct] Ошибка инициализации credentials: ${error}`, 'error');
      throw error;
    }
  }

  /**
   * Получает access token напрямую через JWT
   */
  private async getDirectAccessToken(): Promise<string> {
    try {
      // Убеждаемся, что credentials инициализированы
      await this.initializeCredentials();
      
      if (!this.credentials) {
        throw new Error('Credentials не инициализированы');
      }
      
      log(`[gemini-vertex-direct] Получаем прямой access token`, 'info');
      
      const auth = new GoogleAuth({
        credentials: this.credentials,
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      });
      
      const client = await auth.getClient();
      const accessTokenResponse = await client.getAccessToken();
      
      if (!accessTokenResponse.token) {
        throw new Error('Не удалось получить access token');
      }
      
      log(`[gemini-vertex-direct] Access token получен успешно`, 'info');
      return accessTokenResponse.token;
      
    } catch (error) {
      log(`[gemini-vertex-direct] Ошибка получения токена: ${(error as Error).message}`, 'error');
      throw error;
    }
  }

  /**
   * Улучшает текст с помощью Gemini через Vertex AI
   */
  async improveText(params: { text: string; prompt: string; model?: string }): Promise<string> {
    try {
      const { text, prompt, model = 'gemini-3-pro-preview' } = params;
      
      log(`[gemini-vertex-direct] Запрос улучшения текста с моделью: ${model}`, 'info');
      
      // Получаем токен доступа
      const accessToken = await this.getDirectAccessToken();
      
      // Убеждаемся, что credentials инициализированы
      await this.initializeCredentials();
      
      if (!this.projectId) {
        throw new Error('Project ID не инициализирован');
      }
      
      // Формируем URL для Vertex AI API (global для gemini-3, us-central1 для остальных)
      const endpoint = this.getEndpointForModel(model);
      const location = this.getLocationForModel(model);
      let url = `https://${endpoint}/v1/projects/${this.projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
      
      // Если задан прокси-воркер Cloudflare, подменяем домен (только для региональных моделей)
      const workerProxy = process.env.GEMINI_PROXY_URL;
      const isGlobalModel = location === 'global';
      if (workerProxy && !isGlobalModel) {
        try {
          const pUrl = new URL(workerProxy);
          const vUrl = new URL(url);
          vUrl.host = pUrl.host;
          vUrl.protocol = pUrl.protocol;
          url = vUrl.toString();
          log(`[gemini-vertex-direct] Используется Cloudflare Worker прокси: ${pUrl.host}`, 'info');
        } catch (e) {
          log(`[gemini-vertex-direct] Ошибка парсинга GEMINI_PROXY_URL: ${e}`, 'warn');
        }
      } else if (isGlobalModel) {
        log(`[gemini-vertex-direct] Глобальная модель ${model} — прямое подключение к ${endpoint}`, 'info');
      }

      const requestData = {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${prompt}\n\nТекст для улучшения:\n${text}`
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 8192
        }
      };
      
      log(`[gemini-vertex-direct] Отправляем запрос к: ${url}`, 'info');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 минуты для AI обработки
      
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
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify(requestData),
        signal: controller.signal
      };

      // Глобальные модели (gemini-3) доступны напрямую, SOCKS5 не нужен
      // Региональные модели: SOCKS5 если нет Worker прокси
      if (this.agent && useProxy && !isGlobalModel && !workerProxy) {
        fetchOptions.agent = this.agent;
        log(`[gemini-vertex-direct] 🇺🇸 Используется SOCKS5 прокси для Vertex AI`, 'info');
      } else if (isGlobalModel) {
        log(`[gemini-vertex-direct] 🌐 Прямое подключение к глобальному эндпоинту (без прокси)`, 'info');
      }
      
      const response = await fetch(url, fetchOptions);
      
      clearTimeout(timeoutId);
      
      const responseText = await response.text();
      log(`[gemini-vertex-direct] Ответ получен (${response.status}): ${responseText.substring(0, 200)}...`, 'info');
      
      if (!response.ok) {
        throw new Error(`Vertex AI HTTP error ${response.status}: ${responseText}`);
      }
      
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (parseError) {
        throw new Error('Неверный формат ответа от Vertex AI');
      }
      
      // Извлекаем текст из ответа
      const candidates = responseData.candidates;
      if (!candidates || candidates.length === 0) {
        throw new Error('Vertex AI не вернул результатов');
      }
      
      const content = candidates[0].content;
      if (!content || !content.parts || content.parts.length === 0) {
        throw new Error('Неверная структура ответа от Vertex AI');
      }
      
      let improvedText = content.parts[0].text || '';
      
      // Очищаем служебный текст от AI
      improvedText = improvedText
        .replace(/^.*?(вот улучшенный вариант|улучшенный текст|улучшенная версия).*?:/gi, '')
        .replace(/^.*?(here's|here is).*?:/gi, '')
        .replace(/^[^\w\n]*/, '') // Удаляем символы в начале
        .trim();
      
      log(`[gemini-vertex-direct] Текст успешно улучшен`, 'info');
      return improvedText;
      
    } catch (error) {
      log(`[gemini-vertex-direct] Ошибка при улучшении текста: ${(error as Error).message}`, 'error');
      throw error;
    }
  }

  /**
   * Генерирует контент с помощью Gemini через Vertex AI
   */
  async generateContent(params: { prompt: string; model?: string }): Promise<string> {
    try {
      const { prompt, model = 'gemini-3-pro-preview' } = params;
      
      log(`[gemini-vertex-direct] Запрос генерации текста с моделью: ${model}`, 'info');
      
      // Получаем токен доступа
      const accessToken = await this.getDirectAccessToken();
      
      // Убеждаемся, что credentials инициализированы
      await this.initializeCredentials();
      
      if (!this.projectId) {
        throw new Error('Project ID не инициализирован');
      }
      
      // Формируем URL для Vertex AI API (global для gemini-3, us-central1 для остальных)
      const endpoint = this.getEndpointForModel(model);
      const location = this.getLocationForModel(model);
      let url = `https://${endpoint}/v1/projects/${this.projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
      
      // Если задан прокси-воркер Cloudflare, подменяем домен (только для региональных моделей)
      const workerProxy = process.env.GEMINI_PROXY_URL;
      const isGlobalModel = location === 'global';
      if (workerProxy && !isGlobalModel) {
        try {
          const pUrl = new URL(workerProxy);
          const vUrl = new URL(url);
          vUrl.host = pUrl.host;
          vUrl.protocol = pUrl.protocol;
          url = vUrl.toString();
          log(`[gemini-vertex-direct] Используется Cloudflare Worker прокси: ${pUrl.host}`, 'info');
        } catch (e) {
          log(`[gemini-vertex-direct] Ошибка парсинга GEMINI_PROXY_URL: ${e}`, 'warn');
        }
      } else if (isGlobalModel) {
        log(`[gemini-vertex-direct] Глобальная модель ${model} — прямое подключение к ${endpoint}`, 'info');
      }

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
          maxOutputTokens: 8192
        }
      };
      
      log(`[gemini-vertex-direct] Отправляем запрос к: ${url}`, 'info');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 минуты для AI обработки
      
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
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify(requestData),
        signal: controller.signal
      };

      // Глобальные модели (gemini-3) доступны напрямую, SOCKS5 не нужен
      // Региональные модели: SOCKS5 если нет Worker прокси
      if (this.agent && useProxy && !isGlobalModel && !workerProxy) {
        fetchOptions.agent = this.agent;
        log(`[gemini-vertex-direct] 🇺🇸 Используется SOCKS5 прокси для Vertex AI`, 'info');
      } else if (isGlobalModel) {
        log(`[gemini-vertex-direct] 🌐 Прямое подключение к глобальному эндпоинту (без прокси)`, 'info');
      }
      
      const response = await fetch(url, fetchOptions);
      
      clearTimeout(timeoutId);
      
      const responseText = await response.text();
      log(`[gemini-vertex-direct] Ответ получен (${response.status}): ${responseText.substring(0, 200)}...`, 'info');
      
      if (!response.ok) {
        throw new Error(`Vertex AI HTTP error ${response.status}: ${responseText}`);
      }
      
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (parseError) {
        throw new Error('Неверный формат ответа от Vertex AI');
      }
      
      // Извлекаем текст из ответа
      const candidates = responseData.candidates;
      if (!candidates || candidates.length === 0) {
        throw new Error('Vertex AI не вернул результатов');
      }
      
      const content = candidates[0].content;
      if (!content || !content.parts || content.parts.length === 0) {
        throw new Error('Неверная структура ответа от Vertex AI');
      }
      
      const generatedText = content.parts[0].text || '';
      
      log(`[gemini-vertex-direct] Текст успешно сгенерирован`, 'info');
      return generatedText;
      
    } catch (error) {
      log(`[gemini-vertex-direct] Ошибка при генерации текста: ${(error as Error).message}`, 'error');
      throw error;
    }
  }

  /**
   * Генерирует текст (алиас для generateContent)
   */
  async generateText(params: { prompt: string; model?: string }): Promise<string> {
    return this.generateContent(params);
  }

  /**
   * Генерирует изображение с помощью Gemini Image через Vertex AI
   * Модели: gemini-2.5-flash-image, gemini-3-pro-preview-image
   */
  async generateImage(params: { 
    prompt: string; 
    model?: string;
    aspectRatio?: string;
    numImages?: number;
    imageUrl?: string; // Для редактирования: передать исходное изображение
  }): Promise<{ images: Array<{ url: string; base64?: string }> }> {
    try {
      const { 
        prompt, 
        model = 'gemini-2.5-flash-image',
        aspectRatio = '1:1',
        numImages = 1,
        imageUrl
      } = params;
      
      log(`[gemini-vertex-direct] 🖼️ Запрос генерации изображения с моделью: ${model}`, 'info');
      
      // Получаем токен доступа
      const accessToken = await this.getDirectAccessToken();
      
      // Убеждаемся, что credentials инициализированы
      await this.initializeCredentials();
      
      if (!this.projectId) {
        throw new Error('Project ID не инициализирован');
      }
      
      // Формируем URL для Vertex AI API (генерация изображений)
      const endpoint = this.getEndpointForModel(model);
      const location = this.getLocationForModel(model);
      let url = `https://${endpoint}/v1/projects/${this.projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
      
      // Если задан прокси-воркер Cloudflare, подменяем домен (только для региональных моделей)
      const workerProxy = process.env.GEMINI_PROXY_URL;
      const isGlobalModel = location === 'global';
      if (workerProxy && !isGlobalModel) {
        try {
          const pUrl = new URL(workerProxy);
          const vUrl = new URL(url);
          vUrl.host = pUrl.host;
          vUrl.protocol = pUrl.protocol;
          url = vUrl.toString();
        } catch (e) {
          log(`[gemini-vertex-direct] Ошибка парсинга GEMINI_PROXY_URL: ${e}`, 'warn');
        }
      }
      
      // Строим части запроса — для редактирования добавляем исходное изображение
      const userParts: any[] = [];
      if (imageUrl) {
        try {
          log(`[gemini-vertex-direct] 🖼️ Обрабатываем исходное изображение: ${imageUrl.substring(0, 60)}`, 'info');
          let imgBase64: string;
          let mimeType: string;
          if (imageUrl.startsWith('data:')) {
            // base64 data URL: data:<mimeType>;base64,<data>
            const commaIdx = imageUrl.indexOf(',');
            const meta = imageUrl.substring(5, commaIdx); // e.g. "image/jpeg;base64"
            mimeType = meta.split(';')[0] || 'image/jpeg';
            imgBase64 = imageUrl.substring(commaIdx + 1);
            log(`[gemini-vertex-direct] ✅ Data URL декодирован (mimeType=${mimeType}, ~${(imgBase64.length * 0.75 / 1024).toFixed(0)} KB)`, 'info');
          } else {
            const imgResp = await fetch(imageUrl);
            const imgBuffer = await imgResp.arrayBuffer();
            imgBase64 = Buffer.from(imgBuffer).toString('base64');
            mimeType = imgResp.headers.get('content-type') || 'image/jpeg';
            log(`[gemini-vertex-direct] ✅ Изображение загружено по URL (${(imgBuffer.byteLength / 1024).toFixed(0)} KB)`, 'info');
          }
          userParts.push({ inlineData: { mimeType, data: imgBase64 } });
        } catch (imgErr: any) {
          log(`[gemini-vertex-direct] ⚠️ Не удалось обработать изображение: ${imgErr.message}, продолжаем без него`, 'warn');
        }
      }
      // Для режима редактирования явно указываем Gemini работать с предоставленным изображением
      const editingPrefix = imageUrl
        ? 'Edit the image I provided. Apply this change: '
        : '';
      userParts.push({ text: `${editingPrefix}${prompt}` });

      const requestData = {
        contents: [
          {
            role: "user",
            parts: userParts
          }
        ],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"]
        }
      };
      
      log(`[gemini-vertex-direct] 🖼️ Отправляем запрос к: ${url}`, 'info');

      const directUrl = `https://${this.getEndpointForModel(model)}/v1/projects/${this.projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
      const usedProxy = url !== directUrl;

      const buildFetchOptions = (signal: AbortSignal, useAgent: boolean): any => {
        const opts: any = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          body: JSON.stringify(requestData),
          signal
        };
        if (useAgent && this.agent && !isGlobalModel) {
          opts.agent = this.agent;
        }
        return opts;
      };

      let response: Response;
      const fallbackToDirect = async (reason: string): Promise<Response> => {
        log(`[gemini-vertex-direct] ⚠️ ${reason}, пробуем прямой URL без SOCKS5: ${directUrl}`, 'warn');
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 180000);
        const r = await fetch(directUrl, buildFetchOptions(ctrl.signal, false));
        clearTimeout(tid);
        return r;
      };

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 сек на прокси
        if (this.agent && !isGlobalModel) {
          log(`[gemini-vertex-direct] 🇺🇸 Используется SOCKS5 прокси для генерации изображений`, 'info');
        } else if (isGlobalModel) {
          log(`[gemini-vertex-direct] 🌐 Прямое подключение для генерации изображений (глобальная модель)`, 'info');
        }
        response = await fetch(url, buildFetchOptions(controller.signal, true));
        clearTimeout(timeoutId);
        // Фолбэк если прокси вернул HTTP-ошибку (404, 502, 503 и т.д.)
        if (!response.ok && usedProxy) {
          response = await fallbackToDirect(`Прокси вернул ${response.status}`);
        }
      } catch (proxyErr: any) {
        if (usedProxy) {
          response = await fallbackToDirect(`Прокси недоступен (${proxyErr.message})`);
        } else {
          throw proxyErr;
        }
      }
      
      const responseText = await response.text();
      log(`[gemini-vertex-direct] 🖼️ Ответ получен (${response.status})`, 'info');
      
      if (!response.ok) {
        throw new Error(`Vertex AI HTTP error ${response.status}: ${responseText}`);
      }
      
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (parseError) {
        throw new Error('Неверный формат ответа от Vertex AI Image');
      }
      
      // Извлекаем изображения из ответа
      const candidates = responseData.candidates;
      if (!candidates || candidates.length === 0) {
        throw new Error('Vertex AI не вернул результатов');
      }
      
      const content = candidates[0].content;
      if (!content || !content.parts || content.parts.length === 0) {
        throw new Error('Неверная структура ответа от Vertex AI Image');
      }
      
      // Ищем части с изображениями (inline_data)
      const images: Array<{ url: string; base64?: string }> = [];
      
      for (const part of content.parts) {
        if (part.inlineData && part.inlineData.mimeType?.startsWith('image/')) {
          const base64Data = part.inlineData.data;
          const mimeType = part.inlineData.mimeType;
          
          // Загружаем изображение на S3 для получения постоянного URL
          let finalUrl = '';
          try {
            const { BegetS3StorageAws } = await import('./beget-s3-storage-aws');
            const s3Storage = new BegetS3StorageAws();
            
            // Определяем расширение по MIME типу
            const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'png';
            const fileName = `gemini-image-${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
            const key = `generated-images/${fileName}`;
            
            // Конвертируем base64 в Buffer
            const imageBuffer = Buffer.from(base64Data, 'base64');
            
            // Загружаем на S3 через AWS SDK
            const uploadResult = await s3Storage.uploadFile({
              key: key,
              fileData: imageBuffer,
              contentType: mimeType
            });
            
            if (uploadResult.success && uploadResult.url) {
              finalUrl = uploadResult.url;
              log(`[gemini-vertex-direct] 🖼️ Изображение загружено на S3: ${finalUrl}`, 'info');
            } else {
              // Fallback на data URL если загрузка не удалась
              finalUrl = `data:${mimeType};base64,${base64Data}`;
              log(`[gemini-vertex-direct] 🖼️ S3 недоступен: ${uploadResult.error}, используем data URL`, 'warn');
            }
          } catch (s3Error) {
            // Fallback на data URL при ошибке S3
            finalUrl = `data:${mimeType};base64,${base64Data}`;
            log(`[gemini-vertex-direct] 🖼️ Ошибка S3: ${(s3Error as Error).message}, используем data URL`, 'warn');
          }
          
          images.push({
            url: finalUrl,
            base64: base64Data
          });
        }
      }
      
      if (images.length === 0) {
        // Логируем что именно вернул Vertex AI для диагностики
        const partsSummary = content.parts.map((p: any) => {
          if (p.text) return `text(${p.text.substring(0, 100)})`;
          if (p.inlineData) return `inlineData(mimeType=${p.inlineData.mimeType}, size=${p.inlineData.data?.length || 0})`;
          return `unknown(${JSON.stringify(Object.keys(p))})`;
        }).join(', ');
        const finishReason = candidates[0].finishReason || 'unknown';
        log(`[gemini-vertex-direct] ⚠️ Нет изображений. finishReason=${finishReason}, parts=[${partsSummary}]`, 'warn');
        throw new Error(`Vertex AI не вернул изображений (finishReason=${finishReason})`);
      }
      
      log(`[gemini-vertex-direct] 🖼️ Успешно сгенерировано ${images.length} изображений`, 'info');
      return { images };
      
    } catch (error) {
      log(`[gemini-vertex-direct] 🖼️ Ошибка при генерации изображения: ${(error as Error).message}`, 'error');
      throw error;
    }
  }
}

// Создаем и экспортируем экземпляр
export const geminiVertexDirect = new GeminiVertexDirect();

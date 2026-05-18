import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { log } from '../utils/logger';

/**
 * Единый клиент для работы с FAL.AI API
 * Центральное место для всех запросов к FAL.AI
 */
export class FalAiClient {
  private client: AxiosInstance;
  private apiKey: string = '';
  private readonly baseUrl = 'https://queue.fal.run';

  constructor() {
    // Инициализируем клиент с базовым URL
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 300000, // 5 минут таймаут
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    log('FalAiClient создан', 'fal-ai');
  }

  /**
   * Устанавливает API-ключ для клиента
   * @param apiKey API-ключ FAL.AI в формате 'id:secret' или с префиксом 'Key id:secret'
   */
  setApiKey(apiKey: string): void {
    if (!apiKey) {
      console.error('FalAiClient: получен пустой API-ключ');
      return;
    }

    // Проверяем, приходит ли ключ уже с префиксом "Key "
    const hasKeyPrefix = apiKey.startsWith('Key ');
    
    // Сохраняем базовый ключ (без префикса "Key ")
    // Если префикс есть - убираем его для внутреннего хранения
    // FAL.AI требует в заголовке формат: 'Key id:secret'
    const baseKey = hasKeyPrefix ? apiKey.substring(4) : apiKey;
    
    // Сохраняем базовый ключ
    this.apiKey = baseKey;
    
    // Проверка наличия формата id:secret в ключе
    if (!baseKey.includes(':')) {
      console.warn('FalAiClient: API-ключ не содержит символ ":", это может вызвать проблемы с авторизацией');
    }
    
    // Маскируем ключ для логов
    const colonIndex = baseKey.indexOf(':');
    const maskedKey = colonIndex > 0
      ? `${baseKey.substring(0, 10)}...${colonIndex > 0 ? ':***' : ''}`
      : `${baseKey.substring(0, 5)}...${baseKey.substring(baseKey.length - 5)}`;
    
    log(`FalAiClient: установлен API-ключ${hasKeyPrefix ? ' (с префиксом Key)' : ''} (${maskedKey})`, 'fal-ai');
  }

  /**
   * Выполняет запрос к FAL.AI API
   * @param endpoint Эндпоинт API (не включая базовый URL)
   * @param data Данные запроса
   * @param config Дополнительная конфигурация запроса
   * @returns Результат запроса
   */
  async request<T = any>(endpoint: string, data: any, config: AxiosRequestConfig = {}): Promise<T> {
    if (!this.apiKey) {
      throw new Error('FalAiClient: API-ключ не установлен. Вызовите setApiKey() перед выполнением запросов.');
    }

    const url = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    
    try {
      // ВАЖНО: Заголовок авторизации всегда должен быть в формате "Key {apiKey}"
      const headers = {
        ...config.headers,
        'Authorization': `Key ${this.apiKey}`
      };
      
      // Добавляем отладочную информацию для важного заголовка
      console.log(`[FalAiClient] Используемый заголовок Authorization: ${headers.Authorization}`);

      // Логируем детали запроса (для отладки)
      console.log(`[FalAiClient] Запрос к ${url}`);
      console.log(`[FalAiClient] Заголовок Authorization: "Key ${this.apiKey.substring(0, 5)}..."`);
      
      // Выполняем запрос
      const response = await this.client.post(url, data, {
        ...config,
        headers
      });

      return response.data;
    } catch (error: any) {
      console.error(`[FalAiClient] Ошибка запроса к ${url}:`, error.message);
      
      // Дополнительная информация об ошибке для отладки
      if (error.response) {
        console.error(`Статус код: ${error.response.status}`);
        console.error(`Ответ сервера:`, error.response.data);
      }
      
      throw error;
    }
  }
  
  /**
   * Генерирует изображение с помощью модели fast-sdxl
   * @param prompt Текстовый запрос для генерации
   * @param options Дополнительные параметры
   * @returns Объект с массивом URL изображений
   */
  async generateImage(prompt: string, options: {
    negativePrompt?: string;
    width?: number;
    height?: number;
    numImages?: number;
    model?: string;
  } = {}): Promise<{ images: string[] }> {
    const {
      negativePrompt = '',
      width = 1024,
      height = 1024,
      numImages = 1,
      model = 'fast-sdxl'
    } = options;
    
    // Формируем эндпоинт в зависимости от модели
    // Все модели используют универсальный шаблон fal-ai/{model}
    let endpoint = `fal-ai/${model || 'fast-sdxl'}`;
    
    // Формируем данные запроса
    const requestData = {
      prompt,
      negative_prompt: negativePrompt,
      width,
      height,
      num_images: numImages
    };
    
    // Выполняем запрос
    const result = await this.request(endpoint, requestData);
    
    // Обрабатываем различные варианты ответа FAL.AI API
    if (!result) {
      throw new Error('Пустой ответ от FAL.AI API');
    }
    
    // Проверяем, был ли запрос поставлен в очередь
    if (result.status === 'IN_QUEUE' && result.status_url) {
      return await this.pollQueueResult(result.status_url);
    }
    
    // Извлекаем URL изображений из результата
    return this.extractImagesFromResult(result);
  }
  
  /**
   * Опрашивает статус очереди пока результат не будет готов
   * @param statusUrl URL для проверки статуса
   * @returns Объект с массивом URL изображений
   */
  private async pollQueueResult(statusUrl: string): Promise<{ images: string[] }> {
    console.log(`[FalAiClient] Запрос поставлен в очередь, ожидаем результат (${statusUrl})`);
    
    // Максимальное время ожидания - 4 минуты
    const maxWaitTime = 240 * 1000; // в миллисекундах
    const pollInterval = 3000; // интервал проверки - 3 секунды
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        // Запрашиваем статус
        const authHeader = `Key ${this.apiKey}`;
        console.log(`[FalAiClient] Запрос статуса с заголовком: ${authHeader}`);
        
        const statusResponse = await axios.get(statusUrl, {
          headers: {
            'Authorization': authHeader,
            'Accept': 'application/json'
          }
        });
        
        // Проверяем, готов ли результат
        if (statusResponse.data.status === 'COMPLETED') {
          console.log(`[FalAiClient] Результат готов`);
          return this.extractImagesFromResult(statusResponse.data);
        }
        
        if (statusResponse.data.status === 'FAILED') {
          throw new Error(`Ошибка генерации: ${statusResponse.data.error || 'Неизвестная ошибка'}`);
        }
        
        // Ждем перед следующей проверкой
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error: any) {
        console.error(`[FalAiClient] Ошибка при проверке статуса:`, error.message);
        throw error;
      }
    }
    
    throw new Error('Превышено время ожидания результата');
  }
  
  /**
   * Извлекает URL изображений из результата разных форматов FAL.AI API
   * @param result Результат запроса к API
   * @returns Объект с массивом URL изображений
   */
  private extractImagesFromResult(result: any): { images: string[] } {
    const images: string[] = [];
    
    // Проверяем различные форматы результата
    if (result.images && Array.isArray(result.images)) {
      // Поддержка формата с массивом изображений
      images.push(...result.images.map((img: any) => {
        if (typeof img === 'string') return img;
        return img.url || img.image || '';
      }).filter(Boolean));
    } else if (result.output) {
      // Поддержка формата с полем output
      if (Array.isArray(result.output)) {
        images.push(...result.output);
      } else if (typeof result.output === 'string') {
        images.push(result.output);
      }
    } else if (result.image) {
      // Поддержка формата с полем image
      images.push(result.image);
    } else if (result.url) {
      // Поддержка формата с полем url
      images.push(result.url);
    }
    
    if (images.length === 0) {
      console.error('[FalAiClient] Не удалось извлечь URL изображений из ответа:', result);
      throw new Error('Не удалось извлечь URL изображений из ответа');
    }
    
    return { images };
  }
}

// Экспортируем синглтон клиента для использования во всем приложении
export const falAiClient = new FalAiClient();
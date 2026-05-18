/**
 * Специализированный клиент для работы с моделями FAL.AI Flux
 * Используется для Schnell, Juggernaut Flux и других моделей из пространства имен Flux
 */

import axios from 'axios';

export interface FluxGenerateOptions {
  prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  num_images?: number;
  model: string;
  apiKey: string;
}

export class FalAiFluxClient {
  /**
   * Нормализует количество изображений в параметре num_images, ограничивая его от 1 до 6
   * @param numImagesParam Параметр количества изображений в любом формате
   * @returns Нормализованное значение от 1 до 6
   */
  private normalizeNumImages(numImagesParam: number | string | undefined): number {
    // Если параметр не указан, возвращаем значение по умолчанию - 3
    if (numImagesParam === undefined || numImagesParam === null) {
      return 3;
    }
    
    // Преобразуем в число, если это строка
    let numImages = typeof numImagesParam === 'number' ? 
      numImagesParam : 
      parseInt(String(numImagesParam)) || 3;
    
    // Ограничиваем диапазон от 1 до 6
    return Math.max(1, Math.min(6, numImages));
  }
  /**
   * Генерирует изображения с использованием моделей из пространства имен Flux
   * @param options Параметры генерации
   * @returns Массив URL сгенерированных изображений
   */
  async generateImages(options: FluxGenerateOptions): Promise<string[]> {
    console.log(`[fal-ai-flux] Генерация изображений с использованием модели ${options.model}`);

    // Новый формат URL для API FAL.AI
    // Базовый URL для моделей FAL.AI: https://hub.fal.ai/
    
    let apiUrl = '';
    let modelId = '';
    
    if (options.model === 'schnell') {
      // Для schnell используем специальный endpoint
      apiUrl = 'https://hub.fal.ai/v1/schnell/generate'; // Используем hub.fal.ai вместо api.fal.ai для решения проблем с DNS
      modelId = 'schnell';
    } else if (options.model.startsWith('flux/')) {
      // Для новых моделей Flux используем единый endpoint
      const modelName = options.model.replace('flux/', '');
      apiUrl = 'https://hub.fal.ai/v1/images/generate'; // Используем hub.fal.ai вместо api.fal.ai для решения проблем с DNS
      modelId = modelName;
      console.log(`[fal-ai-flux] Используем endpoint для Flux с моделью ${modelId}`);
    } else {
      // Для других моделей используем стандартный endpoint
      apiUrl = 'https://hub.fal.ai/v1/images/generate'; // Используем hub.fal.ai вместо api.fal.ai для решения проблем с DNS
      modelId = options.model;
    }
    
    // Формируем данные запроса в зависимости от модели
    let requestData: any = {};
    
    if (options.model === 'schnell') {
      // Для schnell используем формат согласно документации
      // Нормализуем количество изображений с помощью единого метода
      const numImages = this.normalizeNumImages(options.num_images);
      requestData = {
        prompt: options.prompt,
        negative_prompt: options.negative_prompt || '',
        width: options.width || 1024,
        height: options.height || 1024,
        num_outputs: numImages // Используем нормализованное значение
      };
    } else if (options.model.startsWith('flux/')) {
      // Для моделей Flux используем поле model_name
      // Нормализуем количество изображений с помощью единого метода
      const numImages = this.normalizeNumImages(options.num_images);
      requestData = {
        model_name: modelId,
        prompt: options.prompt,
        negative_prompt: options.negative_prompt || '',
        image_width: options.width || 1024,
        image_height: options.height || 1024,
        num_images: numImages, // Используем нормализованное значение
        seed: Math.floor(Math.random() * 1000000) // Случайный seed для разнообразия результатов
      };
    } else {
      // Для стандартных моделей
      // Нормализуем количество изображений с помощью единого метода
      const numImages = this.normalizeNumImages(options.num_images);
      requestData = {
        model_name: modelId,
        prompt: options.prompt,
        negative_prompt: options.negative_prompt || '',
        width: options.width || 1024,
        height: options.height || 1024,
        num_images: numImages // Используем нормализованное значение
      };
    }
    
    // Формируем заголовки запроса
    const headers = {
      'Authorization': options.apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    
    try {
      console.log(`[fal-ai-flux] Отправка запроса к ${apiUrl}`);
      console.log(`[fal-ai-flux] Данные запроса:`, JSON.stringify(requestData));
      
      // Отправляем запрос
      const response = await axios.post(apiUrl, requestData, {
        headers,
        timeout: 60000 // 1 минута на инициацию запроса
      });
      
      console.log(`[fal-ai-flux] Получен ответ, статус: ${response.status}`);
      
      // Логируем структуру ответа для отладки
      try {
        console.log(`[fal-ai-flux] Структура ответа:`, JSON.stringify(response.data).substring(0, 500) + '...');
      } catch (e) {
        console.log(`[fal-ai-flux] Не удалось сериализовать ответ`);
      }
      
      // Проверяем наличие request_id в ответе
      if (response.data && response.data.request_id) {
        console.log(`[fal-ai-flux] Получен request_id: ${response.data.request_id}`);
        
        // Ждем завершения генерации
        return await this.waitForCompletion(response.data.request_id, options.apiKey);
      } else if (response.data && response.data.images) {
        // Если результат уже в ответе
        console.log(`[fal-ai-flux] Изображения уже есть в ответе, количество: ${response.data.images.length}`);
        return this.extractImageUrls(response.data);
      } else {
        throw new Error('Неожиданный формат ответа от API');
      }
    } catch (error: any) {
      console.error(`[fal-ai-flux] Ошибка при генерации изображений: ${error.message}`);
      if (error.response) {
        console.error(`[fal-ai-flux] Ошибка API: ${error.response.status}`, error.response.data);
      }
      throw error;
    }
  }
  
  /**
   * Ждет завершения генерации и получает результат
   * @param requestId ID запроса
   * @param apiKey API-ключ
   * @returns Массив URL сгенерированных изображений
   */
  private async waitForCompletion(requestId: string, apiKey: string): Promise<string[]> {
    console.log(`[fal-ai-flux] Ожидание завершения генерации для request_id: ${requestId}`);
    
    const maxAttempts = 60; // Максимальное количество попыток (2 минуты при 2-секундном интервале)
    
    // URL для получения статуса запроса в новом формате API FAL.AI
    const requestUrl = `https://hub.fal.ai/v1/jobs/${requestId}`; // Используем hub.fal.ai вместо api.fal.ai для решения проблем с DNS
    console.log(`[fal-ai-flux] URL для проверки статуса: ${requestUrl}`);
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        console.log(`[fal-ai-flux] Проверка статуса, попытка ${attempt + 1}/${maxAttempts}`);
        
        const response = await axios.get(requestUrl, {
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        });
        
        console.log(`[fal-ai-flux] Получен ответ статуса, HTTP код: ${response.status}`);
        
        // Логируем ответ для отладки
        try {
          console.log(`[fal-ai-flux] Структура ответа:`, JSON.stringify(response.data).substring(0, 300) + '...');
        } catch (e) {
          console.log(`[fal-ai-flux] Не удалось сериализовать ответ`);
        }
        
        // Проверяем, завершена ли генерация
        if (response.data.status === 'COMPLETED' || response.data.state === 'COMPLETED') {
          console.log(`[fal-ai-flux] Генерация завершена, извлекаем URL изображений`);
          
          // Проверяем наличие изображений в ответе
          const imageUrls = this.extractImageUrls(response.data);
          if (imageUrls.length > 0) {
            console.log(`[fal-ai-flux] Найдено ${imageUrls.length} URL изображений`);
            return imageUrls;
          }
          
          // Если результат не найден в основном ответе, пытаемся получить через output
          if (response.data.output_url) {
            console.log(`[fal-ai-flux] Найден output_url, получаем дополнительные данные`);
            try {
              const outputResponse = await axios.get(response.data.output_url, {
                headers: { 'Accept': 'application/json' }
              });
              
              const outputUrls = this.extractImageUrls(outputResponse.data);
              if (outputUrls.length > 0) {
                console.log(`[fal-ai-flux] Найдено ${outputUrls.length} URL изображений в output`);
                return outputUrls;
              }
            } catch (outputError: any) {
              console.error(`[fal-ai-flux] Ошибка при получении output данных: ${outputError.message}`);
            }
          }
        } else if (response.data.status === 'FAILED' || response.data.state === 'FAILED' || 
                  response.data.status === 'CANCELED' || response.data.state === 'CANCELED') {
          // Логируем детали ошибки, если они есть
          if (response.data.error) {
            console.error(`[fal-ai-flux] Ошибка генерации: ${JSON.stringify(response.data.error)}`);
          }
          throw new Error(`Генерация изображения не удалась: ${response.data.status || response.data.state}`);
        }
        
        // Ждем перед следующей попыткой
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error: any) {
        console.error(`[fal-ai-flux] Ошибка при проверке статуса: ${error.message}`);
        if (error.response) {
          console.error(`[fal-ai-flux] Детали ошибки HTTP: ${error.response.status}`, 
            error.response.data ? JSON.stringify(error.response.data).substring(0, 200) : 'No data');
        }
        
        // Ждем перед следующей попыткой
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Если это последняя попытка, выбрасываем ошибку
        if (attempt === maxAttempts - 1) {
          throw new Error(`Превышено максимальное количество попыток получения результата`);
        }
      }
    }
    
    throw new Error(`Не удалось получить результат генерации`);
  }
  
  /**
   * Извлекает URL изображений из ответа API
   * @param data Данные ответа API
   * @returns Массив URL изображений
   */
  private extractImageUrls(data: any): string[] {
    if (!data) return [];
    
    const urls: string[] = [];
    
    // Рекурсивная функция для извлечения URL
    const extract = (obj: any) => {
      // Если это строка, проверяем, является ли она URL изображения
      if (typeof obj === 'string' && this.isImageUrl(obj)) {
        urls.push(obj);
        return;
      }
      
      // Если это массив, обрабатываем каждый элемент
      if (Array.isArray(obj)) {
        obj.forEach(item => extract(item));
        return;
      }
      
      // Если это объект, обрабатываем каждое свойство
      if (obj && typeof obj === 'object') {
        // Сначала проверяем известные поля
        if (obj.images && Array.isArray(obj.images)) {
          obj.images.forEach((image: any) => {
            if (typeof image === 'string' && this.isImageUrl(image)) {
              urls.push(image);
            } else if (image && image.url && typeof image.url === 'string' && this.isImageUrl(image.url)) {
              urls.push(image.url);
            } else {
              extract(image);
            }
          });
        } else if (obj.image && typeof obj.image === 'string' && this.isImageUrl(obj.image)) {
          urls.push(obj.image);
        } else if (obj.url && typeof obj.url === 'string' && this.isImageUrl(obj.url)) {
          urls.push(obj.url);
        } else if (obj.output) {
          extract(obj.output);
        } else {
          // Обрабатываем все остальные свойства объекта
          for (const key in obj) {
            extract(obj[key]);
          }
        }
      }
    };
    
    // Запускаем извлечение URL
    extract(data);
    
    // Выводим результат в лог
    if (urls.length > 0) {
      console.log(`[fal-ai-flux] Извлечено ${urls.length} URL изображений`);
      console.log(`[fal-ai-flux] Пример URL: ${urls[0].substring(0, 100)}...`);
    } else {
      console.log(`[fal-ai-flux] Не удалось извлечь URL изображений из ответа`);
    }
    
    return urls;
  }
  
  /**
   * Проверяет, является ли строка URL изображения
   * @param url URL для проверки
   * @returns true, если URL является URL изображения
   */
  private isImageUrl(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    
    // Проверяем, что URL содержит признаки изображения или валидного CDN-хоста
    return (
      url.includes('fal.media') || 
      url.includes('.jpg') || 
      url.includes('.jpeg') || 
      url.includes('.png') || 
      url.includes('.webp') ||
      url.includes('cdn.') || 
      url.includes('images.') ||
      url.includes('/image/')
    );
  }
}

// Экспортируем инстанс клиента
export const falAiFluxClient = new FalAiFluxClient();
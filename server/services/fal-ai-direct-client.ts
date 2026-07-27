/**
 * Прямой клиент для FAL.AI API без асинхронных запросов
 * Этот клиент использует прямые вызовы API FAL.AI без промежуточной проверки статуса
 * для максимальной совместимости с разными моделями
 */

import axios from 'axios';
import { resolveSizeParams } from './fal-size-params';

export interface DirectGenerateOptions {
  prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  num_images?: number;
  model: string;
  apiKey: string;
  style_preset?: string; // Добавляем параметр стиля
}

export class FalAiDirectClient {
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
    
    // Ограничиваем диапазон от 1 до 4 (максимальное значение снижено до 4 из-за ограничений моделей)
    return Math.max(1, Math.min(4, numImages));
  }

  /**
   * Очищает промпт от JSON-структуры, если она присутствует
   * @param prompt Исходный промпт
   * @returns Очищенный промпт
   */
  private cleanPromptFromJsonStructure(prompt: string): string {
    if (!prompt) return prompt;
    
    // Если промпт выглядит как JSON-строка, попытаемся извлечь чистый текст
    if (prompt.includes('"prompt":') || prompt.includes('"prompt": ') || 
        prompt.startsWith('{') || prompt.startsWith('"{')) {
      try {
        // Попытка извлечь чистый текст из JSON-строки с разными возможными форматами
        const match = prompt.match(/"prompt":\s*"([^"]+)"/i);
        if (match && match[1]) {
          console.log(`[fal-ai-direct] Обнаружена и исправлена JSON-структура в промпте`);
          return match[1];
        }
        
        // Проверка на формат "prompt"="text"
        const altMatch = prompt.match(/"prompt"\s*=\s*"([^"]+)"/i);
        if (altMatch && altMatch[1]) {
          console.log(`[fal-ai-direct] Обнаружена и исправлена альтернативная JSON-структура в промпте`);
          return altMatch[1];
        }
        
        // Если это валидный JSON, попробуем его разобрать
        if (prompt.startsWith('{') || prompt.startsWith('"{')) {
          try {
            // Убираем кавычки в начале и конце, если они есть
            let cleanedJson = prompt;
            if (prompt.startsWith('"') && prompt.endsWith('"')) {
              cleanedJson = prompt.slice(1, -1);
            }
            
            // Попытка разбора JSON
            const jsonObj = JSON.parse(cleanedJson);
            if (jsonObj.prompt) {
              console.log(`[fal-ai-direct] Успешно извлечен промпт из JSON-объекта`);
              return jsonObj.prompt;
            }
          } catch (jsonError: any) {
            console.warn(`[fal-ai-direct] Не удалось разобрать JSON: ${jsonError?.message || 'Неизвестная ошибка'}`);
          }
        }
      } catch (e) {
        // В случае ошибки оставляем промпт как есть
        console.warn(`[fal-ai-direct] Не удалось обработать JSON-структуру в промпте`);
      }
    }
    
    return prompt;
  }
  /**
   * Генерирует изображения с использованием прямого API FAL.AI 
   * @param options Параметры генерации
   * @returns Массив URL сгенерированных изображений
   */
  async generateImages(options: DirectGenerateOptions): Promise<string[]> {
    console.log(`[fal-ai-direct] Генерация изображений с использованием модели ${options.model}`);
    
    // Формируем URL и данные запроса в зависимости от модели
    let apiUrl: string;
    let requestData: any;
    
    // Нормализуем API ключ
    const apiKey = this.formatApiKey(options.apiKey);
    
    // Используем hub.fal.ai вместо api.fal.ai для решения проблем с DNS
    if (options.model === 'fast-sdxl') {
      // Специальный URL для быстрого SDXL
      apiUrl = 'https://api.fal.ai/v1/fast-sdxl/image'; // Используем api.fal.ai вместо hub.fal.ai
      
      // Убеждаемся, что размеры являются числами
      const width = typeof options.width === 'number' ? options.width : parseInt(options.width as any) || 1024;
      const height = typeof options.height === 'number' ? options.height : parseInt(options.height as any) || 1024;
      const numImages = this.normalizeNumImages(options.num_images);
      
      console.log(`[fal-ai-direct] Подготовка запроса к fast-sdxl с размерами: ${width}x${height}`);
      
      requestData = {
        prompt: options.prompt,
        negative_prompt: options.negative_prompt || '',
        ...resolveSizeParams(options.model, width, height),
        num_images: numImages
      };
      
      // Добавляем параметр стиля, если он есть
      if (options.style_preset) {
        console.log(`[fal-ai-direct] Используем стиль ${options.style_preset} для fast-sdxl`);
        (requestData as any).style_preset = options.style_preset;
      }
    } else if (options.model === 'sdxl') {
      // Стандартный SDXL
      apiUrl = 'https://api.fal.ai/v1/stable-diffusion/sdxl-lightning'; // Используем api.fal.ai вместо hub.fal.ai
      
      // Убеждаемся, что размеры являются числами
      const width = typeof options.width === 'number' ? options.width : parseInt(String(options.width)) || 1024;
      const height = typeof options.height === 'number' ? options.height : parseInt(String(options.height)) || 1024;
      
      // Используем единый метод для нормализации количества изображений (от 1 до 6)
      const numImages = this.normalizeNumImages(options.num_images);
      
      console.log(`[fal-ai-direct] Подготовка запроса к SDXL с размерами: ${width}x${height}, изображений: ${numImages}`);
      console.log(`[fal-ai-direct] Тип параметра num_images: ${typeof options.num_images}, значение: ${options.num_images}`);
      
      requestData = {
        prompt: options.prompt,
        negative_prompt: options.negative_prompt || '',
        ...resolveSizeParams(options.model, width, height),
        num_images: numImages
      };
      
      // Добавляем параметр стиля, если он есть
      if (options.style_preset) {
        console.log(`[fal-ai-direct] Используем стиль ${options.style_preset} для SDXL`);
        (requestData as any).style_preset = options.style_preset;
      }
    } else if (options.model === 'schnell') {
      // Специальный URL для Schnell (в соответствии с официальной документацией)
      apiUrl = 'https://hub.fal.ai/v1/schnell/generate'; // Используем hub.fal.ai (рабочий endpoint)
      
      // Убеждаемся, что размеры являются числами
      const width = typeof options.width === 'number' ? options.width : parseInt(String(options.width)) || 1024;
      const height = typeof options.height === 'number' ? options.height : parseInt(String(options.height)) || 1024;
      
      // Для Schnell модели ограничиваем максимальное количество изображений до 4
      const maxImagesForSchnell = 4;
      const numImages = Math.min(this.normalizeNumImages(options.num_images), maxImagesForSchnell);
      console.log(`[fal-ai-direct] Модель Schnell: ограничено количество изображений до ${maxImagesForSchnell}, запрошено: ${this.normalizeNumImages(options.num_images)}`);

      // Дополнительное логирование для отладки
      console.log(`[fal-ai-direct] Подготовка запроса к Schnell с размерами: ${width}x${height}, изображений: ${numImages}`);
      console.log(`[fal-ai-direct] Тип параметра num_images: ${typeof options.num_images}, значение: ${options.num_images}`);
      
      // Очищаем промпт от возможной JSON-структуры
      let cleanPrompt = this.cleanPromptFromJsonStructure(options.prompt);
      
      // Добавляем стиль в промпт, если он указан
      if (options.style_preset && !cleanPrompt.toLowerCase().includes(options.style_preset.toLowerCase())) {
        console.log(`[fal-ai-direct] Добавляем стиль ${options.style_preset} в промпт для модели schnell`);
        cleanPrompt = `${cleanPrompt}, ${options.style_preset} style`;
      }

      requestData = {
        input: {
          prompt: cleanPrompt,
          negative_prompt: options.negative_prompt || '',
          image_size: {
            width: width,
            height: height
          },
          num_inference_steps: 4, // Рекомендуемое значение из документации
          num_images: numImages
        }
      };
    } else if (options.model === 'fooocus') {
      // Поддержка модели Fooocus
      apiUrl = 'https://api.fal.ai/v1/fooocus/generate'; // Используем api.fal.ai вместо hub.fal.ai
      
      // Убеждаемся, что размеры являются числами
      const width = typeof options.width === 'number' ? options.width : parseInt(String(options.width)) || 1024;
      const height = typeof options.height === 'number' ? options.height : parseInt(String(options.height)) || 1024;
      
      // Используем единый метод для нормализации количества изображений (от 1 до 6)
      const numImages = this.normalizeNumImages(options.num_images);
      
      console.log(`[fal-ai-direct] Подготовка запроса к Fooocus с размерами: ${width}x${height}, изображений: ${numImages}`);
      console.log(`[fal-ai-direct] Тип параметра num_images: ${typeof options.num_images}, значение: ${options.num_images}`);
      
      // Очищаем промпт от возможной JSON-структуры
      let cleanPrompt = this.cleanPromptFromJsonStructure(options.prompt);
      
      // Добавляем стиль в промпт, если он указан
      if (options.style_preset && !cleanPrompt.toLowerCase().includes(options.style_preset.toLowerCase())) {
        console.log(`[fal-ai-direct] Добавляем стиль ${options.style_preset} в промпт для модели fooocus`);
        cleanPrompt = `${cleanPrompt}, ${options.style_preset} style`;
      }
      
      requestData = {
        prompt: cleanPrompt,
        negative_prompt: options.negative_prompt || '',
        ...resolveSizeParams(options.model, width, height),
        num_images: numImages
      };
    } else if (options.model.startsWith('flux/')) {
      // Выделяем имя модели из пространства имен flux
      const modelName = options.model.replace('flux/', '');
      apiUrl = 'https://hub.fal.ai/v1/images/generate';
      
      // Убеждаемся, что размеры являются числами
      const width = typeof options.width === 'number' ? options.width : parseInt(String(options.width)) || 1024;
      const height = typeof options.height === 'number' ? options.height : parseInt(String(options.height)) || 1024;
      
      // Используем единый метод для нормализации количества изображений (от 1 до 6)
      const numImages = this.normalizeNumImages(options.num_images);
      
      console.log(`[fal-ai-direct] Подготовка запроса к Flux (${modelName}) с размерами: ${width}x${height}, изображений: ${numImages}`);
      console.log(`[fal-ai-direct] Тип параметра num_images: ${typeof options.num_images}, значение: ${options.num_images}`);
      
      // Очищаем промпт от возможной JSON-структуры
      let cleanPrompt = this.cleanPromptFromJsonStructure(options.prompt);
      
      // Добавляем стиль в промпт, если он указан
      if (options.style_preset && !cleanPrompt.toLowerCase().includes(options.style_preset.toLowerCase())) {
        console.log(`[fal-ai-direct] Добавляем стиль ${options.style_preset} в промпт для модели flux/${modelName}`);
        cleanPrompt = `${cleanPrompt}, ${options.style_preset} style`;
      }

      requestData = {
        model_name: modelName,
        prompt: cleanPrompt,
        negative_prompt: options.negative_prompt || '',
        ...resolveSizeParams(options.model, width, height),
        num_images: numImages
      };
    } else {
      // Для других моделей используем общий endpoint
      apiUrl = 'https://hub.fal.ai/v1/images/generate';
      
      // Убеждаемся, что размеры являются числами
      const width = typeof options.width === 'number' ? options.width : parseInt(String(options.width)) || 1024;
      const height = typeof options.height === 'number' ? options.height : parseInt(String(options.height)) || 1024;
      
      // Используем единый метод для нормализации количества изображений (от 1 до 6)
      const numImages = this.normalizeNumImages(options.num_images);
      
      // Очищаем промпт от возможной JSON-структуры
      let cleanPrompt = this.cleanPromptFromJsonStructure(options.prompt);

      // Добавляем стиль в промпт, если он указан
      if (options.style_preset && !cleanPrompt.toLowerCase().includes(options.style_preset.toLowerCase())) {
        console.log(`[fal-ai-direct] Добавляем стиль ${options.style_preset} в промпт для модели ${options.model}`);
        cleanPrompt = `${cleanPrompt}, ${options.style_preset} style`;
      }

      console.log(`[fal-ai-direct] Подготовка запроса к модели ${options.model} с размерами: ${width}x${height}, изображений: ${numImages}`);
      console.log(`[fal-ai-direct] Тип параметра num_images: ${typeof options.num_images}, значение: ${options.num_images}`);

      requestData = {
        model_name: options.model,
        prompt: cleanPrompt,
        negative_prompt: options.negative_prompt || '',
        ...resolveSizeParams(options.model, width, height),
        num_images: numImages
      };
    }
    
    // Формируем заголовки запроса
    const headers = {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    
    try {
      console.log(`[fal-ai-direct] Отправка запроса к ${apiUrl}`);
      console.log(`[fal-ai-direct] Данные запроса:`, JSON.stringify(requestData).substring(0, 300));
      
      // Отправляем запрос с увеличенным timeout
      const response = await axios.post(apiUrl, requestData, {
        headers,
        timeout: 120000 // 2 минуты на ожидание - модели могут генерировать долго
      });
      
      console.log(`[fal-ai-direct] Получен ответ, статус: ${response.status}`);
      
      // Логируем структуру ответа для отладки
      try {
        console.log(`[fal-ai-direct] Структура ответа:`, JSON.stringify(response.data).substring(0, 500) + '...');
      } catch (e) {
        console.log(`[fal-ai-direct] Не удалось сериализовать ответ`);
      }
      
      // Извлекаем URL изображений из ответа
      const imageUrls = this.extractImageUrls(response.data);
      
      if (imageUrls.length > 0) {
        console.log(`[fal-ai-direct] Найдено ${imageUrls.length} URL изображений`);
        return imageUrls;
      } else {
        throw new Error('В ответе API не найдены URL изображений');
      }
    } catch (error: any) {
      console.error(`[fal-ai-direct] Ошибка при генерации изображений: ${error.message}`);
      
      if (error.response) {
        console.error(`[fal-ai-direct] Статус ошибки: ${error.response.status}`, 
          error.response.data ? JSON.stringify(error.response.data).substring(0, 300) : 'No data');
      }
      
      throw error;
    }
  }
  
  /**
   * Форматирует API ключ в правильный формат для FAL.AI
   * Согласно документации https://docs.fal.ai/, ключ должен быть в формате "Key {key}"
   */
  private formatApiKey(apiKey: string): string {
    if (!apiKey) return '';
    
    // Удаляем любые существующие префиксы и пробелы
    let cleanKey = apiKey.trim();
    if (cleanKey.startsWith('Key ')) {
      cleanKey = cleanKey.substring(4).trim();
    }
    if (cleanKey.startsWith('Bearer ')) {
      cleanKey = cleanKey.substring(7).trim();
    }
    
    // Добавляем правильный префикс "Key" для FAL.AI API
    return `Key ${cleanKey}`;
  }
  
  /**
   * Извлекает URL изображений из ответа API
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
    
    return urls;
  }
  
  /**
   * Проверяет, является ли строка URL изображения
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
export const falAiDirectClient = new FalAiDirectClient();
/**
 * Официальный клиент для FAL.AI API
 * Реализация использует официальную библиотеку @fal-ai/client
 */

import { fal } from '@fal-ai/client';
import { apiKeyService } from './api-keys';
import { resolveSizeParams } from './fal-size-params';

export interface GenerateImageOptions {
  prompt: string;
  negative_prompt?: string;  // Используем snake_case для соответствия API FAL.AI
  width?: number;
  height?: number;
  num_images?: number;       // Используем snake_case для соответствия API FAL.AI
  model: string;
  token?: string;            // Опционально токен для авторизации
  style_preset?: string;     // Стиль изображения (например, anime, photographic, cinematic)
  
  // Поддержка camelCase для совместимости с универсальным сервисом
  negativePrompt?: string;   // Алиас для negative_prompt
  numImages?: number;        // Алиас для num_images
  stylePreset?: string;      // Алиас для style_preset
  
  // Для edit-моделей (image-to-image)
  imageUrls?: string[];      // URL исходных изображений для редактирования
  image_urls?: string[];     // snake_case алиас
}

export class FalAiOfficialClient {
  private initialized = false;

  /**
   * Преобразует размеры в формат image_size для FAL API
   * @param width Ширина изображения
   * @param height Высота изображения
   * @returns Строка формата размера или объект с размерами
   */
  private getImageSizeFormat(width: number, height: number): string {
    const ratio = width / height;
    
    // Определяем ближайший стандартный формат
    if (Math.abs(ratio - 1) < 0.1) return 'square';
    if (Math.abs(ratio - 4/3) < 0.1) return 'landscape_4_3';
    if (Math.abs(ratio - 3/4) < 0.1) return 'portrait_3_4';
    if (Math.abs(ratio - 16/9) < 0.1) return 'landscape_16_9';
    if (Math.abs(ratio - 9/16) < 0.1) return 'portrait_9_16';
    
    // По умолчанию квадратное изображение
    return 'square';
  }

  /**
   * Инициализирует клиент с API ключом
   * @param apiKey API ключ для FAL.AI
   */
  initialize(apiKey: string): void {
    if (!apiKey) {
      throw new Error('API ключ не может быть пустым');
    }
    
    // Удаляем любые префиксы для работы с SDK
    let cleanKey = apiKey.trim();
    
    // Удаляем префикс "Key " или "Bearer " если он есть
    if (cleanKey.startsWith('Key ')) {
      cleanKey = cleanKey.substring(4).trim();
    } else if (cleanKey.startsWith('Bearer ')) {
      cleanKey = cleanKey.substring(7).trim();
    }
    
    console.log('[fal-ai-official] Ключ обработан для инициализации SDK');

    // Настраиваем официальный клиент FAL.AI с ЧИСТЫМ ключом (без префикса)
    try {
      fal.config({
        credentials: cleanKey
      });
      console.log('[fal-ai-official] Клиент успешно инициализирован');
    } catch (error) {
      console.error(`[fal-ai-official] Ошибка при инициализации клиента: ${(error as Error).message}`);
      throw error;
    }

    this.initialized = true;
    console.log('[fal-ai-official] Клиент успешно инициализирован');
  }

  /**
   * Генерирует изображения с использованием официального клиента FAL.AI
   * @param options Параметры генерации
   * @returns Массив URL сгенерированных изображений
   */
  async generateImages(options: GenerateImageOptions): Promise<string[]> {
    console.log(`[fal-ai-official] Генерация изображений с использованием модели ${options.model}`);
    
    // Определяем API ключ в порядке приоритета:
    // 1. Переданный токен (options.token)
    // 2. Переменная окружения FAL_AI_API_KEY
    let apiKey = options.token || process.env.FAL_AI_API_KEY;
    
    if (!apiKey) {
      throw new Error('API ключ FAL.AI не найден ни в параметрах, ни в переменных окружения');
    }
    
    // Инициализируем клиент с корректным ключом
    this.initialize(apiKey);

    try {
      // Подготавливаем ID модели для официального клиента
      const modelId = this.formatModelId(options.model);
      
      // Подготавливаем параметры запроса
      const input = this.prepareInputParams(options);
      
      console.log(`[fal-ai-official] Запрос к модели ${modelId} с параметрами:`, JSON.stringify(input).substring(0, 300));
      
      // Отправляем запрос используя официальный клиент
      console.log('[fal-ai-official] Ожидаем ответ...');
      const result = await fal.subscribe(modelId, {
        input,
        onQueueUpdate: (update) => {
          console.log(`[fal-ai-official] Статус: ${update.status}`);
          
          // Вывод логов генерации в удобном формате
          if (update.status === "IN_PROGRESS" && update.logs && Array.isArray(update.logs)) {
            console.log('[fal-ai-official] Логи генерации:');
            update.logs.map((log) => log.message).forEach(message => {
              console.log(`[fal-ai-model] ${message}`);
            });
          }
          
          // Для отладки - вывод всего объекта обновления
          console.log('[fal-ai-official] Полное содержимое update:', JSON.stringify(update).substring(0, 500));
        }
      });
      
      console.log('[fal-ai-official] Получен ответ:', JSON.stringify(result).substring(0, 300) + '...');
      
      // Извлекаем URL изображений из результата
      const imageUrls = this.extractImageUrls(result);
      
      if (imageUrls.length > 0) {
        console.log(`[fal-ai-official] Найдено ${imageUrls.length} URL изображений:`, imageUrls);
        return imageUrls;
      } else {
        throw new Error('В ответе API не найдены URL изображений');
      }
    } catch (error: any) {
      console.error(`[fal-ai-official] Ошибка при генерации изображений с моделью ${options.model}: ${error.message}`);
      
      if (error.response) {
        console.error(`[fal-ai-official] Статус ошибки: ${error.response.status}`, 
          error.response.data ? JSON.stringify(error.response.data).substring(0, 300) : 'No data');
      }
      
      // Бросаем ошибку с дополнительной информацией о используемых параметрах
      throw new Error(`Ошибка при генерации изображений с моделью ${options.model}: ${error.message}. Проверьте API ключ и параметры запроса.`);
    }
  }

  /**
   * Форматирует ID модели для официального клиента
   * @param model Имя модели
   * @returns Форматированный ID модели для официального клиента
   */
  private formatModelId(model: string): string {
    // Маппинг моделей на их идентификаторы для официального клиента
    const modelMap: Record<string, string> = {
      'schnell': 'fal-ai/flux/schnell',
      'fast-sdxl': 'fal-ai/fast-sdxl',
      'fooocus': 'fal-ai/fooocus',
      'flux/juggernaut-xl-lightning': 'rundiffusion-fal/juggernaut-flux/lightning',
      'flux/juggernaut-xl-lora': 'rundiffusion-fal/juggernaut-flux-lora',
      'flux/flux-lora': 'fal-ai/flux-lora',
    };

    // Если модель начинается с flux/ и не найдена в маппинге
    if (model.startsWith('flux/') && !modelMap[model]) {
      return `fal-ai/${model}`;
    }
    
    // Если модель содержит полный путь с rundiffusion-fal, оставляем как есть
    if (model.startsWith('rundiffusion-fal/')) {
      return model;
    }
    
    // Если модель содержит полный путь с fal-ai, оставляем как есть
    if (model.startsWith('fal-ai/')) {
      return model;
    }

    // Возвращаем маппинг или исходную модель, если маппинг не найден
    return modelMap[model] || model;
  }

  /**
   * Подготавливает параметры запроса в зависимости от модели
   * @param options Параметры генерации
   * @returns Подготовленные параметры для API запроса
   */
  private prepareInputParams(options: GenerateImageOptions): any {
    // Определяем базовые параметры, с поддержкой как snake_case, так и camelCase форматов
    // Используем значения из snake_case или camelCase параметров
    const numImages = options.num_images || options.numImages || 1;
    const stylePreset = options.style_preset || options.stylePreset;
    
    // Добавляем стиль в промпт для всех моделей
    let updatedPrompt = options.prompt;
    if (stylePreset && !updatedPrompt.toLowerCase().includes(stylePreset.toLowerCase())) {
      console.log(`[fal-ai-official] Добавляем стиль ${stylePreset} в промпт для модели ${options.model}`);
      // Добавляем стиль в конец промпта
      updatedPrompt = `${updatedPrompt}, ${stylePreset} style`;
    }

    const baseParams = {
      prompt: updatedPrompt,
      negative_prompt: options.negative_prompt || options.negativePrompt || '',
    };
    
    console.log(`[fal-ai-official] Параметры запроса для ${options.model}: prompt="${baseParams.prompt?.substring(0, 30)}...", negative_prompt="${baseParams.negative_prompt?.substring(0, 30)}...", num_images=${numImages}${stylePreset ? `, style_preset=${stylePreset}` : ''}`);

    // Специфические параметры для разных моделей
    if (options.model === 'schnell' || options.model === 'fal-ai/schnell' || options.model === 'fal-ai/flux/schnell') {
      const schnellParams = {
        prompt: baseParams.prompt,
        negative_prompt: baseParams.negative_prompt,
        ...resolveSizeParams(options.model, options.width, options.height),
        num_inference_steps: 4, // Значение по умолчанию из документации
        num_images: numImages
      };

      return schnellParams;
    } else if (options.model === 'fast-sdxl' || options.model === 'fal-ai/fast-sdxl') {
      const sdxlParams = {
        ...baseParams,
        ...resolveSizeParams(options.model, options.width, options.height),
        num_images: numImages
      };

      return sdxlParams;

    } else if (options.model === 'fooocus' || options.model === 'fal-ai/fooocus') {
      const fooocusParams = {
        ...baseParams,
        ...resolveSizeParams(options.model, options.width, options.height),
        num_images: numImages
      };

      return fooocusParams;
    }
    // Обработка NanoBanana Pro (Gemini 3 Pro Image через FAL)
    else if (options.model === 'nano-banana-pro' || options.model === 'fal-ai/nano-banana-pro') {
      const nanoBananaProParams = {
        prompt: baseParams.prompt,
        negative_prompt: baseParams.negative_prompt,
        ...resolveSizeParams(options.model, options.width, options.height),
        num_images: numImages
      };
      console.log(`[fal-ai-official] Параметры для NanoBanana Pro: ${JSON.stringify(nanoBananaProParams)}`);
      return nanoBananaProParams;
    }
    // Обработка NanoBanana Pro/Edit (редактирование изображений)
    else if (options.model === 'nano-banana-pro/edit' || options.model === 'fal-ai/nano-banana-pro/edit') {
      const imageUrls = (options as any).imageUrls || (options as any).image_urls || [];
      // Для edit-модели всегда 1 изображение на выходе
      const nanoBananaEditParams = {
        prompt: baseParams.prompt,
        negative_prompt: baseParams.negative_prompt,
        image_urls: imageUrls,
        num_images: 1
      };
      console.log(`[fal-ai-official] Параметры для NanoBanana Pro/Edit: prompt="${baseParams.prompt?.substring(0, 50)}...", images=${imageUrls.length}, output=1`);
      return nanoBananaEditParams;
    }
    // GPT-Image-2 через fal.ai (openai/gpt-image-2).
    // SM-31. Здесь слались OpenAI-поля size и n. У fal-эндпоинта таких полей нет:
    // он ждёт image_size и num_images, а неизвестные молча отбрасывает и берёт свой
    // дефолт image_size = landscape_4_3. Выбранный человеком размер из-за этого не
    // применялся никогда, и картинка всегда выходила 4:3. Формат сверен со схемой
    // fal 2026-08-18. quality модель понимает, его оставляем.
    else if (options.model === 'openai/gpt-image-2') {
      const quality = (options as any).quality || 'medium';
      const params: Record<string, any> = {
        prompt: baseParams.prompt,
        ...resolveSizeParams(options.model, options.width, options.height),
        quality,
        num_images: numImages || 1,
      };
      console.log(`[fal-ai-official] Параметры для gpt-image-2: ${JSON.stringify(params)}`);
      return params;
    }
    // Обработка моделей rundiffusion-fal
    else if (options.model.includes('rundiffusion-fal/juggernaut-flux')) {
      const juggernautParams = {
        ...baseParams,
        ...resolveSizeParams(options.model, options.width, options.height),
        num_images: numImages
      };

      return juggernautParams;
    }
    // Обработка моделей flux/
    else if (options.model.includes('flux/') || options.model.includes('fal-ai/flux')) {
      return {
        ...baseParams,
        ...resolveSizeParams(options.model, options.width, options.height),
        num_images: numImages
      };
    }

    // Для неизвестных моделей используем стандартные параметры
    return {
      ...baseParams,
      ...resolveSizeParams(options.model, options.width, options.height),
      num_images: numImages
    };
  }

  /**
   * Извлекает URL изображений из ответа API
   * @param result Результат вызова API
   * @returns Массив URL изображений
   */
  private extractImageUrls(result: any): string[] {
    if (!result) return [];
    
    console.log('[fal-ai-official] Извлечение URL изображений из ответа API:');
    console.log(JSON.stringify(result, null, 2));
    
    const urls: string[] = [];
    
    // Проверяем формат ответа от Juggernaut-Flux API (данные в data.images[].url)
    if (result.data && result.data.images && Array.isArray(result.data.images)) {
      console.log(`[fal-ai-official] Обнаружен формат ответа Juggernaut-Flux API с ${result.data.images.length} изображениями`);
      
      for (const img of result.data.images) {
        if (img && img.url && typeof img.url === 'string' && this.isImageUrl(img.url)) {
          console.log(`[fal-ai-official] Найден URL изображения в data.images[].url: ${img.url}`);
          urls.push(img.url);
        }
      }
      
      if (urls.length > 0) {
        console.log(`[fal-ai-official] Извлечено ${urls.length} URL изображений из Juggernaut-Flux API`);
        return urls;
      }
    }
    
    // Для стандартного API с изображениями в output.images (для других моделей)
    if (result.output && result.output.images && Array.isArray(result.output.images)) {
      console.log(`[fal-ai-official] Найдены изображения в output.images (${result.output.images.length} шт.)`);
      
      for (const img of result.output.images) {
        if (typeof img === 'string' && this.isImageUrl(img)) {
          console.log(`[fal-ai-official] Найден прямой URL: ${img}`);
          urls.push(img);
        } else if (img && img.url && typeof img.url === 'string') {
          console.log(`[fal-ai-official] Найден URL в объекте: ${img.url}`);
          urls.push(img.url);
        }
      }
      
      if (urls.length > 0) {
        console.log(`[fal-ai-official] Извлечено ${urls.length} URL изображений из output.images`);
        return urls;
      }
    }
    
    // Рекурсивный поиск для всех остальных случаев
    const findImageUrls = (obj: any, path = ''): string[] => {
      const foundUrls: string[] = [];
      
      if (!obj || typeof obj !== 'object') return foundUrls;
      
      // Проверка на массив объектов с полем url
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          const item = obj[i];
          const itemPath = `${path}[${i}]`;
          
          if (typeof item === 'string' && this.isImageUrl(item)) {
            console.log(`[fal-ai-official] Найден URL изображения в ${itemPath}: ${item}`);
            foundUrls.push(item);
          } else if (item && typeof item === 'object') {
            // Рекурсивный поиск в объекте
            const nestedUrls = findImageUrls(item, itemPath);
            foundUrls.push(...nestedUrls);
          }
        }
      } else {
        // Обработка всех полей объекта
        for (const [key, value] of Object.entries(obj)) {
          const keyPath = path ? `${path}.${key}` : key;
          
          // Проверка специальных названий полей
          if (key === 'url' && typeof value === 'string' && this.isImageUrl(value)) {
            console.log(`[fal-ai-official] Найден URL изображения в ${keyPath}: ${value}`);
            foundUrls.push(value);
          } else if (key === 'image_url' && typeof value === 'string' && this.isImageUrl(value)) {
            console.log(`[fal-ai-official] Найден URL изображения в ${keyPath}: ${value}`);
            foundUrls.push(value);
          } else if (key === 'content_url' && typeof value === 'string' && this.isImageUrl(value)) {
            console.log(`[fal-ai-official] Найден URL изображения в ${keyPath}: ${value}`);
            foundUrls.push(value);
          } else if (typeof value === 'string' && this.isImageUrl(value)) {
            console.log(`[fal-ai-official] Найден URL изображения в ${keyPath}: ${value}`);
            foundUrls.push(value);
          } else if (value && typeof value === 'object') {
            // Рекурсивный поиск для объектов и массивов
            const nestedUrls = findImageUrls(value, keyPath);
            foundUrls.push(...nestedUrls);
          }
        }
      }
      
      return foundUrls;
    };
    
    // Запускаем полный рекурсивный поиск
    const recursiveUrls = findImageUrls(result);
    if (recursiveUrls.length > 0) {
      console.log(`[fal-ai-official] Найдено ${recursiveUrls.length} URL изображений через рекурсивный поиск`);
      urls.push(...recursiveUrls);
    }
    
    if (urls.length > 0) {
      console.log(`[fal-ai-official] Всего извлечено ${urls.length} URL изображений`);
    } else {
      console.warn('[fal-ai-official] Не удалось извлечь URL изображений из ответа API');
    }
    
    return urls;
  }

  /**
   * Проверяет, является ли строка URL изображения
   * @param url Строка для проверки
   * @returns true, если строка похожа на URL изображения
   */
  private isImageUrl(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    
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
export const falAiOfficialClient = new FalAiOfficialClient();
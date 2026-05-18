/**
 * Универсальный сервис для работы с FAL.AI API
 * Поддерживает все модели FAL.AI: Schnell, SDXL, Fast-SDXL, Fooocus, и др.
 * Обеспечивает единый интерфейс для всех моделей и корректное извлечение URL изображений
 */

import axios from 'axios';
import { apiKeyService } from './api-keys';
import { falAiDirectClient } from './fal-ai-direct-client';
import { falAiOfficialClient } from './fal-ai-official-client';
import { MODEL_SPECIFIC_STYLES } from '../../shared/fal-ai-styles';

// Типы поддерживаемых моделей FAL.AI (Nanobanana теперь через Google Vertex AI напрямую)
export type FalAiModelName = 
  | 'fast-sdxl' 
  | 'schnell' 
  | 'fooocus' 
  | 'flux/juggernaut-xl-lora' 
  | 'flux/juggernaut-xl-lightning' 
  | 'flux/flux-lora'
  | 'rundiffusion-fal/juggernaut-flux/lightning'
  | 'rundiffusion-fal/juggernaut-flux-lora'
  | 'fal-ai/flux-lora'
  | 'openai/gpt-image-2';

// Параметры для генерации медиафайлов (изображений или видео)
export interface FalAiGenerateOptions {
  prompt: string;                // Промт для генерации
  negativePrompt?: string;       // Негативный промт
  width?: number;                // Ширина изображения/видео
  height?: number;               // Высота изображения/видео
  imageSize?: string;            // Строковый формат размера изображения (portrait_3_4, landscape_16_9 и т.д.)
  numImages?: number;            // Количество изображений (для видео обычно 1)
  model?: string | FalAiModelName; // Модель для генерации
  token?: string;                // Токен авторизации
  userId?: string;               // ID пользователя для получения API ключа
  contentId?: string;            // ID контента (для аналитики)
  campaignId?: string;           // ID кампании (для аналитики)
  fps?: number;                  // Кадров в секунду (только для видео)
  duration?: number;             // Длительность в секундах (только для видео)
  stylePreset?: string;          // Предустановленный стиль генерации (например, anime, photographic, cinematic, base)
  imageUrls?: string[];          // URL исходных изображений для edit-моделей (image-to-image)
  quality?: 'low' | 'medium' | 'high'; // Качество для gpt-image-1
}

// Основной класс сервиса
class FalAiUniversalService {
  private readonly timeoutMs: number = 300000; // 5 минут на ожидание результата

  /**
   * Нормализует название модели в корректный URL-совместимый формат
   * @param modelName Название модели
   * @returns Нормализованное название модели
   */
  private normalizeModelName(modelName: string | FalAiModelName = 'fast-sdxl'): string {
    // Проверяем, содержит ли уже путь к модели
    if (typeof modelName === 'string' && modelName.includes('/')) {
      return modelName; // Уже полный путь
    }
    
    // Возвращаем название модели как есть без специальных преобразований
    return modelName;
  }
  
  /**
   * Нормализует стиль для конкретной модели с использованием карты соответствия
   * @param stylePreset Исходный стиль
   * @param model Название модели
   * @returns Нормализованный стиль для конкретной модели
   */
  /**
   * Определяет стиль из промпта
   * Промпт может содержать стиль в начале, например: "Anime style. Человек бежит с собакой"
   * @param prompt Промпт для генерации
   * @returns Объект с извлеченным стилем и очищенным промптом
   */
  private extractStyleFromPrompt(prompt: string): { style: string | undefined; cleanedPrompt: string } {
    if (!prompt) return { style: undefined, cleanedPrompt: prompt };
    
    // Доступные стили и их вариации для поиска в промпте
    const stylePatterns = {
      'photographic': [/photographic style/i, /photo[ -]?realistic/i, /photo style/i],
      'cinematic': [/cinematic style/i, /cinematic/i, /movie style/i, /film style/i],
      'anime': [/anime style/i, /anime/i, /manga style/i, /manga/i],
      'base': [/base style/i, /basic style/i, /default style/i],
      'isometric': [/isometric style/i, /isometric/i],
      'digital-art': [/digital[ -]?art/i, /digital style/i],
      'comic-book': [/comic[ -]?book/i, /comic style/i],
      'fantasy-art': [/fantasy[ -]?art/i, /fantasy style/i],
      'line-art': [/line[ -]?art/i, /line drawing/i, /contour style/i],
      'lowpoly': [/low[ -]?poly/i, /lowpoly/i, /low polygon/i],
      'pixel-art': [/pixel[ -]?art/i, /8[ -]?bit/i, /16[ -]?bit/i],
      'texture': [/texture style/i, /textured/i],
      'oil-painting': [/oil[ -]?painting/i, /oil paint/i],
      'watercolor': [/watercolor/i, /water[ -]?color/i],
    };
    
    let detectedStyle: string | undefined = undefined;
    let cleanedPrompt = prompt;
    
    // Ищем все стили в промпте
    for (const [style, patterns] of Object.entries(stylePatterns)) {
      for (const pattern of patterns) {
        const match = prompt.match(pattern);
        if (match) {
          detectedStyle = style;
          // Удаляем упоминание стиля из промпта
          cleanedPrompt = prompt.replace(pattern, '').trim();
          // Удаляем начальные символы пунктуации
          cleanedPrompt = cleanedPrompt.replace(/^[,\.\s:;]+/, '').trim();
          break;
        }
      }
      
      if (detectedStyle) break; // Если стиль найден, прекращаем поиск
    }
    
    return { style: detectedStyle, cleanedPrompt };
  }
  
  /**
   * Добавляет формат изображения в промпт
   * Требуется для моделей, которые лучше понимают размер через промпт, например: "portrait_9_16, киберпанк город"
   * @param prompt Исходный промпт
   * @param formattedSize Формат размера для добавления в промпт (например, 'portrait_9_16', 'landscape_16_9')
   * @returns Обновленный промпт с добавленным форматом размера
   */
  private addImageSizeToPrompt(prompt: string, formattedSize: string): string {
    if (!prompt || !formattedSize) return prompt;
    
    // Проверяем, содержит ли промпт уже какой-либо формат размера
    const sizePatterns = [
      /portrait_\d+_\d+/i,              // portrait_9_16
      /landscape_\d+_\d+/i,             // landscape_16_9
      /square_\d+_\d+/i,                // square_1_1
      /ultrawide_\d+_\d+/i,             // ultrawide_21_9
      /mobile_\d+_\d+/i,                // mobile_9_18
      /cinematic_\d+_\d+/i,             // cinematic_235_1
      /\d+:\d+/i,                      // 16:9, 9:16, 1:1
      /\d+\s*[xX]\s*\d+/i,             // 1024x768, 576 x 1024
      /vertical(?:\s+wallpaper)?/i,    // vertical wallpaper
      /tall\s+image/i,                 // tall image
      /horizontal(?:\s+wallpaper)?/i,  // horizontal wallpaper
      /wide\s+image/i,                 // wide image
      /panorama/i                      // panoramic view
    ];
    
    // Если промпт уже содержит указание формата, не изменяем его
    for (const pattern of sizePatterns) {
      if (pattern.test(prompt)) {
        console.log(`[fal-ai-universal] Промпт уже содержит указание формата, не добавляем формат ${formattedSize}`);
        return prompt;
      }
    }
    
    // Добавляем формат в начало промпта (это более надёжно работает с моделями)
    const updatedPrompt = `${formattedSize}, ${prompt}`;
    console.log(`[fal-ai-universal] Добавлен формат ${formattedSize} в промпт: ${updatedPrompt}`);
    
    return updatedPrompt;
  }
  
  /**
   * Добавляет стиль в промпт, если он ещё не указан
   * @param prompt Исходный промпт
   * @param style Стиль для добавления в промпт (например, 'anime', 'photorealistic')
   * @returns Обновленный промпт с добавленным стилем
   */
  private addStyleToPrompt(prompt: string, style: string): string {
    if (!prompt || !style) return prompt;
    
    // Проверяем, содержит ли промпт уже указание стиля
    const stylePatterns = {
      'photographic': [/photographic style/i, /photo[ -]?realistic/i, /photo style/i],
      'cinematic': [/cinematic style/i, /cinematic/i, /movie style/i, /film style/i],
      'anime': [/anime style/i, /anime/i, /manga style/i, /manga/i],
      'base': [/base style/i, /basic style/i, /default style/i],
      'isometric': [/isometric style/i, /isometric/i],
      'digital-art': [/digital[ -]?art/i, /digital style/i],
      'comic-book': [/comic[ -]?book/i, /comic style/i],
      'fantasy-art': [/fantasy[ -]?art/i, /fantasy style/i],
      'line-art': [/line[ -]?art/i, /line drawing/i, /contour style/i],
      'lowpoly': [/low[ -]?poly/i, /lowpoly/i, /low polygon/i],
      'pixel-art': [/pixel[ -]?art/i, /8[ -]?bit/i, /16[ -]?bit/i],
      'texture': [/texture style/i, /textured/i],
      'oil-painting': [/oil[ -]?painting/i, /oil paint/i],
      'watercolor': [/watercolor/i, /water[ -]?color/i],
    };
    
    // Проверяем, содержит ли промпт уже указание какого-либо стиля
    for (const [styleName, patterns] of Object.entries(stylePatterns)) {
      for (const pattern of patterns) {
        if (pattern.test(prompt)) {
          console.log(`[fal-ai-universal] Промпт уже содержит стиль ${styleName}, не добавляем стиль ${style}`);
          return prompt;
        }
      }
    }
    
    // Форматируем стиль для добавления в промпт
    let styledPrompt: string;
    
    // Если стиль - одно из ключевых слов, добавляем слово "style"
    if (['photographic', 'cinematic', 'anime', 'base', 'isometric', 'digital-art', 'comic-book',
         'fantasy-art', 'line-art', 'lowpoly', 'pixel-art', 'texture', 'oil-painting', 'watercolor'].includes(style)) {
      styledPrompt = `${style} style, ${prompt}`;
    } else {
      // Иначе просто добавляем стиль как есть
      styledPrompt = `${style}, ${prompt}`;
    }
    
    console.log(`[fal-ai-universal] Добавлен стиль ${style} в промпт: ${styledPrompt}`);
    return styledPrompt;
  }
  
  /**
   * Преобразует числовые размеры (width/height) в строковый формат для промпта
   * @param width Ширина изображения
   * @param height Высота изображения
   * @returns Строковый формат размера для промпта (например, 'portrait_9_16', 'landscape_16_9')
   */
  private getFormattedSizeForPrompt(width: number, height: number): string {
    if (!width || !height) return '';
    
    // Определяем ориентацию изображения
    let orientation: string;
    
    if (width > height) {
      orientation = 'landscape';
    } else if (width < height) {
      orientation = 'portrait';
    } else {
      return 'square_1_1'; // Квадрат
    }
    
    // Ищем известные соотношения сторон
    const ratio = width / height;
    
    if (orientation === 'landscape') {
      if (Math.abs(ratio - (16/9)) < 0.1) return 'landscape_16_9';
      if (Math.abs(ratio - (3/2)) < 0.1) return 'landscape_3_2';
      if (Math.abs(ratio - (4/3)) < 0.1) return 'landscape_4_3';
      if (Math.abs(ratio - (21/9)) < 0.1) return 'landscape_21_9';
      if (Math.abs(ratio - (16/10)) < 0.1) return 'landscape_16_10';
    } else {
      if (Math.abs(ratio - (9/16)) < 0.1) return 'portrait_9_16';
      if (Math.abs(ratio - (2/3)) < 0.1) return 'portrait_2_3';
      if (Math.abs(ratio - (3/4)) < 0.1) return 'portrait_3_4';
      if (Math.abs(ratio - (4/5)) < 0.1) return 'portrait_4_5';
    }
    
    // Если не нашли подходящее стандартное соотношение, возвращаем текущее в формате WxH
    return `${width}x${height}`;
  }

  private normalizeStyleForModel(stylePreset: string | undefined, model: string): string | undefined {
    if (!stylePreset) return undefined;
    
    // Определяем базовое название модели без пути
    let baseModelName = model;
    if (model.includes('/')) {
      // Получаем только последний компонент пути
      const parts = model.split('/');
      baseModelName = parts[parts.length - 1];
    }
    
    // Проверяем, есть ли специальные соответствия для этой модели
    if (baseModelName.includes('schnell')) {
      // Для Schnell используем карту соответствия schnell
      const styleMap = MODEL_SPECIFIC_STYLES['schnell'] as Record<string, string>;
      return styleMap[stylePreset] || stylePreset;
    } else if (baseModelName.includes('juggernaut')) {
      // Для Juggernaut используем карту соответствия juggernaut
      const styleMap = MODEL_SPECIFIC_STYLES['juggernaut'] as Record<string, string>;
      return styleMap[stylePreset] || stylePreset;
    } else if (baseModelName.includes('flux')) {
      // Для Flux используем карту соответствия flux
      const styleMap = MODEL_SPECIFIC_STYLES['flux'] as Record<string, string>;
      return styleMap[stylePreset] || stylePreset;
    } else if (baseModelName.includes('sdxl')) {
      // Для SDXL используем карту соответствия sdxl
      const styleMap = MODEL_SPECIFIC_STYLES['sdxl'] as Record<string, string>;
      return styleMap[stylePreset] || stylePreset;
    }
    
    // Если нет специальных соответствий, возвращаем стиль как есть
    return stylePreset;
  }
  
  /**
   * Специализированный метод для генерации изображений с помощью модели Schnell
   * @param options Параметры генерации (без указания модели, так как это всегда Schnell)
   * @returns Массив URL сгенерированных изображений
   */
  async generateWithSchnell(options: Omit<FalAiGenerateOptions, 'model'> & { imageSize?: string }): Promise<string[]> {
    // Извлекаем параметр стиля из опций
    const stylePreset = (options as any).stylePreset;
    console.log(`[fal-ai-universal] Генерация изображений с использованием модели Schnell (специальный метод)`);
    
    // Получаем API ключ
    let apiKey: string | null = null;
    
    if (options.token && options.userId) {
      apiKey = await apiKeyService.getApiKey(options.userId, 'fal_ai', options.token);
      
      if (!apiKey) {
        throw new Error('API ключ FAL.AI не найден для пользователя');
      }
      
      apiKey = this.formatApiKey(apiKey);
    } else if (options.token) {
      // Если передан только токен, используем его напрямую
      apiKey = this.formatApiKey(options.token);
    } else {
      throw new Error('Отсутствует токен или userId для получения API ключа');
    }
    
    // Для Schnell всегда используем прямой API
    try {
      // Проверяем, содержит ли ключ префикс, и добавляем его при необходимости
      let directApiKey = apiKey;
      if (!directApiKey.startsWith('Key ') && !directApiKey.startsWith('Bearer ')) {
        directApiKey = `Key ${directApiKey}`;
        console.log('[fal-ai-universal] Добавлен префикс Key для Schnell API');
      }
      
      // Убеждаемся, что размеры являются числами
      const width = typeof options.width === 'number' ? options.width : parseInt(options.width as any) || 1024;
      const height = typeof options.height === 'number' ? options.height : parseInt(options.height as any) || 1024;
      const numImages = typeof options.numImages === 'number' ? options.numImages : parseInt(options.numImages as any) || 1;
      
      // Нормализуем стиль для модели Schnell
      const normalizedStyle = this.normalizeStyleForModel(stylePreset, 'schnell');
      if (normalizedStyle && normalizedStyle !== stylePreset) {
        console.log(`[fal-ai-universal] Стиль для Schnell нормализован из ${stylePreset} в ${normalizedStyle}`);
      }
      
      console.log(`[fal-ai-universal] Отправляем запрос к Schnell API с размерами: ${width}x${height}, стиль: ${normalizedStyle || 'не указан'}`);
      
      // Обновляем запрос в соответствии с официальной документацией FAL.AI
      return await falAiDirectClient.generateImages({
        model: 'schnell',
        apiKey: directApiKey,
        prompt: options.prompt,
        negative_prompt: options.negativePrompt,
        width: width,
        height: height,
        num_images: numImages,
        style_preset: normalizedStyle || '' // Добавляем передачу нормализованного параметра стиля
      });
    } catch (error: any) {
      console.error(`[fal-ai-universal] Ошибка при использовании Schnell API: ${error.message}`);
      
      // Добавляем больше логирования для диагностики проблемы
      if (error.response) {
        console.error(`[fal-ai-universal] Статус ошибки: ${error.response.status}`, 
          error.response.data ? JSON.stringify(error.response.data).substring(0, 300) : 'No data');
      }
      
      throw new Error(`Ошибка генерации с Schnell: ${error.message}`);
    }
  }

  /**
   * Форматирует API ключ в правильный формат для FAL.AI
   * @param apiKey API ключ
   * @returns Отформатированный API ключ
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
   * Проверяет, является ли строка допустимым URL изображения или видео
   * @param url Строка для проверки
   * @returns true, если строка является URL изображения или видео
   */
  private isValidImageUrl(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    
    // Проверяем, что URL содержит признаки изображения/видео или валидного CDN-хоста
    return (
      url.includes('fal.media') || 
      // Изображения
      url.includes('.jpg') || 
      url.includes('.jpeg') || 
      url.includes('.png') || 
      url.includes('.webp') ||
      // Видео
      url.includes('.mp4') ||
      url.includes('.webm') ||
      url.includes('.mov') ||
      url.includes('.avi') ||
      // Общие CDN и пути
      url.includes('cdn.') || 
      url.includes('images.') ||
      url.includes('videos.') ||
      url.includes('/image/') ||
      url.includes('/video/')
    );
  }

  /**
   * Генерирует медиаконтент (изображения или видео) с использованием выбранной модели
   * @param options Параметры генерации
   * @returns Массив URL сгенерированных изображений или видео
   */
  /**
   * Всегда добавляем информацию о размере в промпт, чтобы подстраховать все модели
   * Это помогает как моделям, которые опираются на параметры API, так и моделям, которые анализируют промпт
   */
  private shouldAddSizeToPrompt(): boolean {
    // Всегда добавляем размер в промпт для всех моделей
    return true;
  }
  
  /**
   * Всегда добавляем стиль в промпт, если он указан
   * Это помогает всем моделям лучше понимать желаемый стиль изображения
   */
  private shouldAddStyleToPrompt(): boolean {
    return true;
  }
  
  async generateImages(options: FalAiGenerateOptions): Promise<string[]> {
    // Получаем API ключ
    let apiKey: string | null = null;
    
    if (options.token && options.userId) {
      apiKey = await apiKeyService.getApiKey(options.userId, 'fal_ai', options.token);
      
      if (!apiKey) {
        throw new Error('API ключ FAL.AI не найден для пользователя');
      }
      
      apiKey = this.formatApiKey(apiKey);
    } else if (options.token) {
      // Если передан только токен, используем его напрямую
      apiKey = this.formatApiKey(options.token);
    } else {
      throw new Error('Отсутствует токен или userId для получения API ключа');
    }
    
    // Определяем модель для дальнейших проверок
    const model = this.normalizeModelName(options.model);
    
    // Копируем исходный промпт
    let workingPrompt = options.prompt;
    
    // Параметры размера
    const hasWidthHeight = options.width && options.height;
    const hasImageSize = options.imageSize;
    
    // Шаг1: Делаем размеры кратными 64 для всех параметров width/height
    if (hasWidthHeight) {
      const width = Number(options.width);
      const height = Number(options.height);
      
      // Гарантируем, что ширина и высота кратны 64 для стабильной генерации
      if (width % 64 !== 0 || height % 64 !== 0) {
        const adjustedWidth = Math.round(width / 64) * 64;
        const adjustedHeight = Math.round(height / 64) * 64;
        
        if (adjustedWidth !== width || adjustedHeight !== height) {
          console.log(`[fal-ai-universal] Корректируем размеры с ${width}x${height} на ${adjustedWidth}x${adjustedHeight} (кратно 64)`);
          options.width = adjustedWidth;
          options.height = adjustedHeight;
        }
      }
    }
    
    // Шаг2: Преобразуем stringImageSize в числовые параметры, если нужно
    if (hasImageSize && !hasWidthHeight && typeof options.imageSize === 'string') {
      // Если imageSize в формате "1024x768", преобразуем его в width/height
      const dimensionsMatch = options.imageSize.match(/^(\d+)x(\d+)$/i);
      if (dimensionsMatch) {
        const extractedWidth = parseInt(dimensionsMatch[1]);
        const extractedHeight = parseInt(dimensionsMatch[2]);
        
        if (!isNaN(extractedWidth) && !isNaN(extractedHeight)) {
          // Корректируем до кратных 64
          const adjustedWidth = Math.round(extractedWidth / 64) * 64;
          const adjustedHeight = Math.round(extractedHeight / 64) * 64;
          
          console.log(`[fal-ai-universal] Преобразуем imageSize ${options.imageSize} в числовые параметры: ${adjustedWidth}x${adjustedHeight}`);
          options.width = adjustedWidth;
          options.height = adjustedHeight;
        }
      }
      // Если imageSize в формате "portrait_9_16", преобразуем его в width/height
      else {
        // Размеры для известных форматов - все кратны 64
        const formatDimensions: Record<string, [number, number]> = {
          'portrait_9_16': [576, 1024],    // 9:16
          'portrait_2_3': [768, 1152],     // 2:3
          'portrait_3_4': [768, 1024],     // 3:4
          'portrait_4_5': [832, 1024],     // 4:5 (832:1040)
          'landscape_16_9': [1152, 640],   // 16:9 (1152:648)
          'landscape_3_2': [1152, 768],    // 3:2
          'landscape_4_3': [1024, 768],    // 4:3
          'landscape_21_9': [1344, 576],   // 21:9
          'landscape_16_10': [1152, 704],  // 16:10 (1152:720)
          'square_1_1': [1024, 1024],      // 1:1
          'square': [1024, 1024]           // Алиас для square_1_1
        };
        
        // Проверяем, есть ли предварительно заданные размеры для этого формата
        if (formatDimensions[options.imageSize]) {
          const dimensions = formatDimensions[options.imageSize];
          const [width, height] = dimensions;
          console.log(`[fal-ai-universal] Преобразуем формат ${options.imageSize} в числовые параметры: ${width}x${height}`);
          options.width = width;
          options.height = height;
        } else {
          // Если неизвестный формат, используем стандартный размер
          console.log(`[fal-ai-universal] Неизвестный формат ${options.imageSize}, используем стандартный размер`);
          options.width = 1024;
          options.height = 1024;
        }
      }
    }
    
    // Для OpenAI-нативных моделей (gpt-image-2) НЕ добавляем мусор в промпт —
    // они используют отдельные поля size/quality и не нуждаются в prompt-хаках
    const isOpenAiNativeModel = model === 'openai/gpt-image-2';

    // Шаг3: Добавляем стиль в промпт, если он указан в параметрах
    if (!isOpenAiNativeModel && options.stylePreset && this.shouldAddStyleToPrompt()) {
      console.log(`[fal-ai-universal] Добавляем стиль ${options.stylePreset} в промпт`);
      workingPrompt = this.addStyleToPrompt(workingPrompt, options.stylePreset);
    }
    
    // Шаг4: Добавляем размер в промпт (для OpenAI-нативных моделей пропускаем)
    if (!isOpenAiNativeModel && this.shouldAddSizeToPrompt()) {
      // Если есть числовые параметры width/height
      if (options.width && options.height) {
        const width = Number(options.width);
        const height = Number(options.height);
        const formattedSize = this.getFormattedSizeForPrompt(width, height);
        
        console.log(`[fal-ai-universal] Добавляем формат ${formattedSize} (на основе ${width}x${height}) в промпт`);
        workingPrompt = this.addImageSizeToPrompt(workingPrompt, formattedSize);
      }
      // Если есть строковый параметр imageSize и нет числовых width/height
      else if (options.imageSize && typeof options.imageSize === 'string') {
        console.log(`[fal-ai-universal] Добавляем формат ${options.imageSize} в промпт`);
        workingPrompt = this.addImageSizeToPrompt(workingPrompt, options.imageSize);
        
        // Переводим строковый формат в числовые параметры, если возможно
        const formatDimensions: Record<string, [number, number]> = {
          'portrait_9_16': [576, 1024],    // 9:16
          'portrait_2_3': [768, 1152],     // 2:3
          'portrait_3_4': [768, 1024],     // 3:4
          'portrait_4_5': [832, 1024],     // 4:5 (832:1040)
          'landscape_16_9': [1152, 640],   // 16:9 (1152:648)
          'landscape_3_2': [1152, 768],    // 3:2
          'landscape_4_3': [1024, 768],    // 4:3
          'landscape_21_9': [1344, 576],   // 21:9
          'landscape_16_10': [1152, 704],  // 16:10 (1152:720)
          'square_1_1': [1024, 1024],      // 1:1
          'square': [1024, 1024]           // Алиас для square_1_1
        };
        
        // Проверяем, есть ли размеры для этого формата
        const dimensions = formatDimensions[options.imageSize];
        if (dimensions) {
          const [width, height] = dimensions;
          console.log(`[fal-ai-universal] Преобразуем формат ${options.imageSize} в числовые параметры: ${width}x${height}`);
          options.width = width;
          options.height = height;
        }
      }
      // Если нет никаких параметров размера, используем стандартный размер
      else {
        // Для всех моделей добавляем стандартный размер
        console.log('[fal-ai-universal] Добавляем стандартный размер square_1_1 в промпт');
        workingPrompt = this.addImageSizeToPrompt(workingPrompt, 'square_1_1');
        // Также добавляем стандартные размеры для API
        options.width = 1024;
        options.height = 1024;
      }
    }
    
    // Записываем обновленный промпт обратно в опции
    options.prompt = workingPrompt;
    console.log(`[fal-ai-universal] Окончательный промпт: '${workingPrompt}'`);
    if (options.width && options.height) {
      console.log(`[fal-ai-universal] Числовые параметры размера: ${options.width}x${options.height}`);
    }
    // Нормализуем модель еще раз (на случай, если мы изменили её в процессе)
    
    // Сначала проверяем, является ли модель Flux или другой моделью с путём (vendor/model)
    if (model.includes('/')) {
      // Для Flux и других моделей с путём используем официальный клиент с SDK
      console.log(`[fal-ai-universal] Модель с путём (${model}), используем официальный клиент`);
      
      try {
        // Создаем чистый ключ без префикса для официального SDK
        let cleanKey = apiKey.trim();
        if (cleanKey.startsWith('Key ')) {
          cleanKey = cleanKey.substring(4).trim();
        }
        
        // Добавляем расширенное логирование
        console.log(`[fal-ai-universal] Отправляем запрос в официальный клиент:`, {
          model,
          prompt: options.prompt,
          negativePrompt: options.negativePrompt,
          width: options.width,
          height: options.height,
          numImages: options.numImages || 1,
          imageUrls: options.imageUrls?.length || 0
        });
        
        const result = await falAiOfficialClient.generateImages({
          model: model,
          token: cleanKey, // Для SDK нужен чистый ключ без префикса "Key"
          prompt: options.prompt,
          negative_prompt: options.negativePrompt, // Здесь используем camelCase, который преобразуется в snake_case внутри метода
          width: options.width,
          height: options.height,
          num_images: options.numImages, // Здесь используем camelCase, который преобразуется в snake_case внутри метода
          imageUrls: options.imageUrls, // Передаём URL исходных изображений для edit-моделей
          ...(options.quality ? { quality: options.quality } : {}),
        } as any);
        
        // Логируем результат для анализа
        console.log(`[fal-ai-universal] Результат от официального клиента:`, result);
        
        return result;
      } catch (officialError: any) {
        console.error(`[fal-ai-universal] Ошибка при использовании официального клиента для модели ${model}: ${officialError.message}`);
        
        // Если официальный клиент не сработал, пробуем прямой клиент
        console.log(`[fal-ai-universal] Пробуем прямой клиент для модели ${model}`);
        
        try {
          // Для прямого API может потребоваться другой формат ключа
          let directApiKey = apiKey;
          // Если ключ не имеет префикса, добавим его для прямого API
          if (!directApiKey.startsWith('Key ') && !directApiKey.startsWith('Bearer ')) {
            directApiKey = `Key ${directApiKey}`;
            console.log('[fal-ai-universal] Добавлен префикс Key для прямого API');
          }
          
          return await falAiDirectClient.generateImages({
            model: model,
            apiKey: directApiKey,
            prompt: options.prompt,
            negative_prompt: options.negativePrompt,
            width: options.width,
            height: options.height,
            num_images: options.numImages
          });
        } catch (directError: any) {
          console.error(`[fal-ai-universal] Ошибка при использовании прямого клиента: ${directError.message}`);
          // Если обе попытки не удались, выбрасываем оригинальную ошибку от официального клиента
          throw officialError;
        }
      }
    } else {
      // Для классических моделей (schnell, fooocus, sdxl) используем прямой клиент
      console.log(`[fal-ai-universal] Классическая модель (${model}), используем прямой клиент`);
      
      try {
        // Для прямого API может потребоваться другой формат ключа
        let directApiKey = apiKey;
        // Если ключ не имеет префикса, добавим его для прямого API
        if (!directApiKey.startsWith('Key ') && !directApiKey.startsWith('Bearer ')) {
          directApiKey = `Key ${directApiKey}`;
          console.log('[fal-ai-universal] Добавлен префикс Key для прямого API');
        }
        
        // Убеждаемся, что размеры являются числами
        const width = typeof options.width === 'number' ? options.width : parseInt(options.width as any) || 1024;
        const height = typeof options.height === 'number' ? options.height : parseInt(options.height as any) || 1024;
        const numImages = typeof options.numImages === 'number' ? options.numImages : parseInt(options.numImages as any) || 1;
        
        // Нормализуем стиль для данной модели
        const normalizedStyle = this.normalizeStyleForModel(options.stylePreset, model);
        if (normalizedStyle && normalizedStyle !== options.stylePreset) {
          console.log(`[fal-ai-universal] Стиль нормализован из ${options.stylePreset} в ${normalizedStyle} для модели ${model}`);
        }
        
        console.log(`[fal-ai-universal] Отправляем запрос к модели ${model} с размерами: ${width}x${height}, стиль: ${normalizedStyle || 'не указан'}`);
        
        return await falAiDirectClient.generateImages({
          model: model,
          apiKey: directApiKey,
          prompt: options.prompt,
          negative_prompt: options.negativePrompt,
          width: width,
          height: height,
          num_images: numImages,
          style_preset: normalizedStyle // Передаем нормализованный параметр стиля
        });
      } catch (directError: any) {
        console.error(`[fal-ai-universal] Ошибка при использовании прямого клиента для модели ${model}: ${directError.message}`);
        
        // Даже для классических моделей можно попробовать официальный клиент как запасной вариант
        console.log(`[fal-ai-universal] Пробуем официальный клиент для модели ${model}`);
        
        try {
          // Создаем чистый ключ без префикса для официального SDK
          let cleanKey = apiKey.trim();
          if (cleanKey.startsWith('Key ')) {
            cleanKey = cleanKey.substring(4).trim();
          }
          
          // Убеждаемся, что размеры являются числами
          const width = typeof options.width === 'number' ? options.width : parseInt(options.width as any) || 1024;
          const height = typeof options.height === 'number' ? options.height : parseInt(options.height as any) || 1024;
          const numImages = typeof options.numImages === 'number' ? options.numImages : parseInt(options.numImages as any) || 1;
          
          console.log(`[fal-ai-universal] Отправляем запрос к официальному клиенту для модели ${model} с размерами: ${width}x${height}, стиль: ${options.stylePreset || 'не указан'}`);
          
          // Создаем объект параметров
          const params: any = {
            model: model,
            token: cleanKey,
            prompt: options.prompt,
            negative_prompt: options.negativePrompt, // Передается клиенту, который отобразит его внутренне
            width: width,
            height: height,
            num_images: numImages // Передается клиенту, который отобразит его внутренне
          };
          
          // Добавляем параметр стиля, если он указан
          if (options.stylePreset) {
            params.style_preset = options.stylePreset;
          }
          
          return await falAiOfficialClient.generateImages(params);
        } catch (officialError: any) {
          console.error(`[fal-ai-universal] Ошибка при использовании официального клиента: ${officialError.message}`);
          // Если обе попытки не удались, выбрасываем оригинальную ошибку от прямого клиента
          throw directError;
        }
      }
    }
  }
}

// Экспортируем инстанс сервиса
export const falAiUniversalService = new FalAiUniversalService();
import * as falClient from "@fal-ai/serverless-client";
import { log } from '../utils/logger';
import { apiKeyService } from './api-keys';

/**
 * Сервис для работы с fal.ai с использованием официального SDK
 */
export class FalAiSdkService {
  private apiKey: string;
  private client: any | null = null;

  constructor(apiKey: string = '') {
    this.apiKey = apiKey;
    if (apiKey) {
      this.initializeWithKey(apiKey);
    }
  }

  /**
   * Инициализировать клиент с API ключом
   */
  initializeWithKey(apiKey: string): void {
    // Расширенное логирование для отладки
    if (apiKey) {
      console.log(`DEBUG FAL.AI SDK: Получен ключ API длиной ${apiKey.length} символов`);
      console.log(`DEBUG FAL.AI SDK: Ключ начинается с "Key ": ${apiKey.startsWith('Key ')}`);
      console.log(`DEBUG FAL.AI SDK: Первые 10 символов: "${apiKey.substring(0, 10)}..."`);
      
      if (apiKey.startsWith('Key ')) {
        console.log(`[FAL.AI] Инициализация с ключом, имеющим префикс "Key" - правильный формат`);
      } else {
        console.log(`[FAL.AI] Инициализация с ключом без префикса "Key"`);
      }
      
      if (!apiKey.includes(':')) {
        console.log(`[FAL.AI] Предупреждение: ключ не содержит символ ":", используем как есть`);
      }
    }
    
    // Сохраняем ключ в оригинальном формате БЕЗ модификаций
    this.apiKey = apiKey;
    try {
      // Используем объект falClient напрямую
      this.client = falClient;
      log('FalAiSdkService: клиент инициализирован успешно', 'fal-ai');
    } catch (err) {
      console.error('Ошибка при инициализации fal.ai клиента:', err);
      log(`FalAiSdkService: ошибка инициализации: ${err}`, 'fal-ai');
    }
  }
  
  /**
   * Инициализирует сервис с API ключом пользователя из централизованного сервиса API ключей
   * @param userId ID пользователя
   * @param authToken Токен авторизации для Directus (опционально)
   * @returns true в случае успешной инициализации, false в случае ошибки
   */
  async initializeFromApiKeyService(userId: string, authToken?: string): Promise<boolean> {
    return this.initialize(userId, authToken);
  }
  
  /**
   * Инициализирует сервис с API ключом пользователя из централизованного сервиса API ключей
   * @param userId ID пользователя
   * @param authToken Токен авторизации для Directus (опционально)
   * @returns true в случае успешной инициализации, false в случае ошибки
   */
  async initialize(userId: string, authToken?: string): Promise<boolean> {
    try {
      // Используем централизованный сервис API ключей
      const apiKey = await apiKeyService.getApiKey(userId, 'fal_ai', authToken);
      
      if (apiKey) {
        this.initializeWithKey(apiKey);
        log('FAL.AI SDK: API ключ успешно получен через API Key Service', 'fal-ai');
        console.log('FAL.AI SDK: API ключ успешно получен через API Key Service');
        return true;
      } else {
        // Проверяем, не установлен ли уже ключ в сервисе
        if (this.apiKey && this.apiKey.length > 0) {
          console.log('FAL.AI SDK: Используем существующий API ключ');
          return true;
        }
        
        log('FAL.AI SDK: API ключ не найден', 'fal-ai');
        console.log('FAL.AI SDK: API ключ не найден');
        return false;
      }
    } catch (error) {
      console.error('Ошибка при инициализации FAL.AI SDK сервиса:', error);
      
      // Если у нас все равно есть валидный ключ - можно использовать
      if (this.apiKey && this.apiKey.length > 0) {
        console.log('FAL.AI SDK: Несмотря на ошибку, используем существующий API ключ');
        return true;
      }
      
      return false;
    }
  }

  /**
   * Обновить API ключ
   */
  updateApiKey(newApiKey: string): void {
    this.apiKey = newApiKey;
    this.initializeWithKey(newApiKey);
  }

  /**
   * Проверить статус API
   */
  async checkApiStatus(): Promise<{ success: boolean; message: string }> {
    if (!this.apiKey || !this.client) {
      return { success: false, message: 'Клиент не инициализирован. Необходим API ключ.' };
    }

    try {
      // Пробуем быстрый запрос для проверки связи через прямой HTTP запрос
      const axios = require('axios');
      // Ключ должен использоваться в точно том же формате, как он хранится в Directus
      // Только логируем для отладки
      if (this.apiKey.startsWith('Key ')) {
        console.log(`[FAL.AI] API ключ имеет префикс "Key" - должен работать корректно`); 
      } else {
        console.log(`[FAL.AI] API ключ без префикса "Key" - используем как есть`);
      }
      
      // Используем ключ как есть, без модификаций
      const authHeader = this.apiKey;
        
      const result = await axios({
        url: 'https://queue.fal.run/fal-ai/stable-diffusion-v35-medium',
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        data: {
          prompt: 'test image',
          num_inference_steps: 1,
        }
      });

      return { success: true, message: 'API доступно и работает' };
    } catch (error: any) {
      console.error('Ошибка при проверке API:', error);
      return { 
        success: false, 
        message: `Ошибка API: ${error.message || 'Неизвестная ошибка'}` 
      };
    }
  }

  /**
   * Сгенерировать изображение
   * @param modelId ID модели (например, 'flux/schnell', 'fal-ai/fast-sdxl', 'fal-ai/fooocus')
   * @param input Данные для генерации
   * @returns Результат генерации
   */
  async generateImage(modelId: string, input: any): Promise<any> {
    if (!this.apiKey || !this.client) {
      throw new Error('Клиент не инициализирован. Необходим API ключ.');
    }

    console.log(`FalAiSdkService: генерация изображения с моделью ${modelId}`);
    console.log('Входные данные:', JSON.stringify(input).substring(0, 200));

    try {
      // Формируем конфигурацию для запроса
      // Все модели обрабатываем одинаково без специальных правил для Schnell
      // Определяем корректный modelId
      let sanitizedModelId;
      if (modelId.includes('fal-ai/')) {
        sanitizedModelId = modelId;
      } else {
        sanitizedModelId = `fal-ai/${modelId}`;
      }
      
      // Используем ключ в точно таком же формате, как он хранится в Directus
      // Расширенное логирование для отладки вызова FAL.AI
      console.log(`DEBUG FAL.AI GENERATE IMAGE: Текущий API ключ длиной ${this.apiKey.length} символов`);
      console.log(`DEBUG FAL.AI GENERATE IMAGE: Ключ начинается с "Key ": ${this.apiKey.startsWith('Key ')}`);
      console.log(`DEBUG FAL.AI GENERATE IMAGE: Первые 10 символов: "${this.apiKey.substring(0, 10)}..."`);
      
      // Улучшенное логирование без модификации ключа
      if (this.apiKey.startsWith('Key ')) {
        console.log(`[FAL.AI] API ключ имеет префикс "Key" - для generateImage`); 
      } else {
        console.log(`[FAL.AI] API ключ без префикса "Key" - используем как есть для generateImage`);
      }
      
      // ВАЖНО: проверяем формат ключа и добавляем префикс "Key" если нужно
      let authHeader = this.apiKey;
      if (!authHeader.startsWith('Key ') && authHeader.includes(':')) {
        console.log(`🔑 ИСПРАВЛЕНИЕ ФОРМАТА КЛЮЧА: добавляем префикс 'Key '`);
        authHeader = `Key ${authHeader}`;
        // Сохраняем исправленный ключ для будущего использования
        this.apiKey = authHeader;
      }
      
      // Показываем полный заголовок для отладки (в тестовой среде)
      console.log(`🔴 ПОЛНЫЙ ЗАГОЛОВОК AUTHORIZATION: "${authHeader}"`);
      console.log(`🔴 ДЛИНА: ${authHeader.length} символов`);
      console.log(`🔴 НАЧИНАЕТСЯ С 'Key ': ${authHeader.startsWith('Key ') ? 'ДА' : 'НЕТ'}`);
      console.log(`🔴 СОДЕРЖИТ ':': ${authHeader.includes(':') ? 'ДА' : 'НЕТ'}`);
      
      // Проверяем и исправляем параметры для совместимости с API
      
      // Унифицированная обработка параметров для всех моделей
      // Преобразуем numImages в num_images для всех моделей одинаково
      if (input.numImages && !input.num_images) {
        console.log('🔄 Преобразование параметра numImages в num_images для совместимости с API');
        input.num_images = input.numImages;
        // Удаляем numImages чтобы избежать путаницы
        delete input.numImages;
      }
      
      // Проверяем, что num_images - это число
      if (input.num_images && typeof input.num_images === 'string') {
        input.num_images = parseInt(input.num_images, 10);
      }
      
      // Гарантируем, что у нас всегда есть num_images и оно не меньше 1
      if (!input.num_images || input.num_images < 1) {
        input.num_images = 1;
      }
      
      // Проверяем параметры ширины и высоты
      if (input.width && typeof input.width === 'string') {
        input.width = parseInt(input.width, 10);
      }
      
      if (input.height && typeof input.height === 'string') {
        input.height = parseInt(input.height, 10);
      }
      
      // Убедимся, что высота и ширина имеют допустимые значения
      if (!input.width || input.width < 512) {
        console.log('⚠️ Корректировка ширины изображения: установлено минимальное значение 512');
        input.width = 512;
      }
      
      if (!input.height || input.height < 512) {
        console.log('⚠️ Корректировка высоты изображения: установлено минимальное значение 512');
        input.height = 512;
      }
      
      console.log(`📊 Параметры запроса: ${input.num_images || 1} изображений, размер ${input.width}x${input.height}`);
      
      // Формируем URL в зависимости от модели - унифицированная обработка
      let apiUrl;
      if (sanitizedModelId.includes('/')) {
        // Для моделей вида 'fal-ai/fast-sdxl' или других с путями
        apiUrl = `https://queue.fal.run/${sanitizedModelId}`;
      } else {
        // Для остальных моделей добавляем стандартный префикс fal-ai
        apiUrl = `https://queue.fal.run/fal-ai/${sanitizedModelId}`;
      }
      
      // Детальное логирование запроса
      console.log(`🌐 URL запроса: ${apiUrl}`);
      console.log(`📦 Параметры запроса: ${JSON.stringify({
        ...input,
        num_images: input.num_images || 1,
        model: sanitizedModelId
      }).substring(0, 200)}...`);
        
      const requestConfig = {
        url: apiUrl,
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        data: input
      };

      // Вручную используем axios для отправки запроса
      const axios = require('axios');
      const response = await axios(requestConfig);
      
      console.log('Статус ответа:', response.status);
      console.log('Результат генерации:', JSON.stringify(response.data).substring(0, 200));
      
      return response.data;
    } catch (error: any) {
      console.error('Ошибка при генерации изображения:', error);
      if (error.response) {
        console.error('Детали ошибки:', {
          status: error.response.status,
          data: error.response.data
        });
      }
      throw new Error(`Ошибка генерации: ${error.message || 'Неизвестная ошибка'}`);
    }
  }
}

// Создаем экземпляр сервиса без ключа, он будет инициализирован через apiKeyService
export const falAiSdk = new FalAiSdkService();
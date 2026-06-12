import { directusApiManager } from '../directus';
import { log } from '../utils/logger';
import { directusCrud } from './directus-crud';
import { globalApiKeysService } from './global-api-keys';

// Получаем инстанс Axios для Directus API
const directusApi = directusApiManager.instance;

// Типы API сервисов, используемых в приложении
export enum ApiServiceName {
  SOCIAL_SEARCHER = 'social_searcher',
  APIFY = 'apify',
  DEEPSEEK = 'deepseek',
  FAL_AI = 'fal_ai',
  XMLRIVER = 'xmlriver',
  QWEN = 'qwen',
  CLAUDE = 'claude',
  GEMINI = 'gemini',
  GOOGLE_API_KEY = 'GOOGLE_API_KEY',
  VERTEX_AI_SERVICE_ACCOUNT = 'vertex_ai_service_account',
  VERTEX_AI_API_KEY = 'VERTEX_AI_API_KEY',
  TELEGRAM_COLLECT_COMMENTS = 'telegram_collect_comments',
  COLLECT_COMMENTS_BEARER = 'collect_comments_bearer',
  SERPAPI_KEY = 'SERPAPI_KEY',
  TRENDS_SCRAPER = 'trends_scraper'
}

// Маппинг имен сервисов как они записаны в БД
const SERVICE_NAME_DB_MAPPING: Record<ApiServiceName, string> = {
  [ApiServiceName.SOCIAL_SEARCHER]: 'social_searcher',
  [ApiServiceName.APIFY]: 'apify',
  [ApiServiceName.DEEPSEEK]: 'deepseek',
  [ApiServiceName.FAL_AI]: 'FAL_AI',
  [ApiServiceName.XMLRIVER]: 'xmlriver',
  [ApiServiceName.QWEN]: 'qwen',
  [ApiServiceName.CLAUDE]: 'claude',
  [ApiServiceName.GEMINI]: 'gemini',
  [ApiServiceName.GOOGLE_API_KEY]: 'GOOGLE_API_KEY',
  [ApiServiceName.VERTEX_AI_SERVICE_ACCOUNT]: 'vertex_ai_service_account',
  [ApiServiceName.VERTEX_AI_API_KEY]: 'VERTEX_AI_API_KEY',
  [ApiServiceName.TELEGRAM_COLLECT_COMMENTS]: 'telegram_collect_comments',
  [ApiServiceName.COLLECT_COMMENTS_BEARER]: 'collect_comments_bearer',
  [ApiServiceName.SERPAPI_KEY]: 'SERPAPI_KEY',
  [ApiServiceName.TRENDS_SCRAPER]: 'trends_scraper'
};

// Индексы полей в UI и их сопоставление с сервисами в случае отсутствия service_name
// Этот маппинг соответствует порядку полей в интерфейсе "Настройки API ключей"
const SERVICE_INDEX_MAPPING: Record<number, ApiServiceName> = {
  0: ApiServiceName.SOCIAL_SEARCHER,  // Первое поле в UI - API Ключ Social Searcher
  1: ApiServiceName.APIFY,            // Второе поле в UI - API Ключ Apify
  2: ApiServiceName.DEEPSEEK,         // Третье поле в UI - API Ключ DeepSeek
  3: ApiServiceName.FAL_AI,           // Четвертое поле в UI - API Ключ FAL.AI
  4: ApiServiceName.XMLRIVER,         // Пятое поле в UI - API Ключ XMLRiver
  5: ApiServiceName.QWEN,             // Шестое поле в UI - API Ключ Qwen
  6: ApiServiceName.CLAUDE,           // Седьмое поле в UI - API Ключ Claude
  7: ApiServiceName.GEMINI,           // Восьмое поле в UI - API Ключ Gemini
  8: ApiServiceName.VERTEX_AI_SERVICE_ACCOUNT  // Девятое поле в UI - Vertex AI Service Account
};

// Интерфейс для хранения API ключей и метаданных
interface ApiKeyCache {
  [userId: string]: {
    [serviceName in ApiServiceName]?: {
      key: string;
      expiresAt: number; // Время истечения кэша
    }
  };
}

/**
 * Сервис для управления API ключами
 * Централизованное хранение, кэширование и получение API ключей из Directus
 */
export class ApiKeyService {
  private keyCache: ApiKeyCache = {};
  private readonly cacheDuration = 30 * 60 * 1000; // 30 минут
  
  constructor() {
    // Инициализация сервиса
    console.log('API Key Service initialized');
    
    // Запускаем периодическую очистку кэша
    setInterval(() => this.cleanupCache(), 10 * 60 * 1000); // каждые 10 минут
  }
  
  /**
   * Получает API ключ из кэша или из Directus
   * @param userId ID пользователя
   * @param serviceName Название сервиса
   * @param authToken Токен авторизации для Directus
   * @returns API ключ или null, если ключ не найден
   */
  async getApiKey(userId: string, serviceName: ApiServiceName, authToken?: string): Promise<string | null> {
    console.log(`[DEBUG] API-KEYS: Запрашивается ключ для сервиса: ${serviceName}, пользователя: ${userId}`);
    console.log(`[DEBUG] API-KEYS: Тип userId: ${typeof userId}, значение: "${userId}"`);
    
    // НОВАЯ ЛОГИКА: Сначала пробуем получить глобальный API ключ
    const globalKey = await globalApiKeysService.getGlobalApiKey(serviceName);
    if (globalKey) {
      console.log(`[${serviceName}] Используется глобальный API ключ`);
      log(`Using global ${serviceName} API key`, 'api-keys');
      return globalKey;
    }
    
    // Если глобальный ключ не найден, пробуем получить пользовательский ключ
    console.log(`[${serviceName}] Глобальный ключ не найден, пробуем пользовательский ключ`);
    
    // ВАЖНОЕ ПРАВИЛО: Все пользовательские API ключи должны браться ТОЛЬКО из Directus (через user_api_keys)
    // Если нет userId, не можем получить ключ из Directus
    if (!userId) {
      log(`Cannot fetch ${serviceName} API key: missing userId. API keys must come only from Directus user settings.`, 'api-keys');
      return null;
    }
    
    // 1. Сначала проверяем кэш пользовательских ключей
    if (this.keyCache[userId]?.[serviceName]?.key &&
        this.keyCache[userId][serviceName]!.expiresAt > Date.now()) {
      log(`Using cached ${serviceName} API key for user ${userId}`, 'api-keys');
      return this.keyCache[userId][serviceName]!.key;
    }
    
    // 2. Если ключа нет в кэше или он устарел, пытаемся получить из Directus
    try {
      // Получаем название сервиса в БД из маппинга
      const dbServiceName = SERVICE_NAME_DB_MAPPING[serviceName];
      console.log(`[${serviceName}] Получаем ключ для пользователя ${userId}, сервис в БД: ${dbServiceName}`);
      
      // Делаем прямой запрос к Directus через API как в SettingsDialog
      // Это гарантирует одинаковое поведение на фронтенде и бэкенде
      const response = await directusApi.get('/items/user_api_keys', {
        params: {
          filter: {
            user_id: { _eq: userId }
          },
          fields: ['id', 'service_name', 'api_key']
        },
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined
      });
      
      const apiKeys = response.data?.data || [];
      console.log(`[${serviceName}] Получено ${apiKeys.length} ключей для пользователя ${userId}`);
      
      // Аналогично SettingsDialog.tsx, ищем ключ по service_name
      const apiKeyData = apiKeys.find((key: any) => 
        key.service_name === dbServiceName);
      
      if (apiKeyData && apiKeyData.api_key) {
        console.log(`[${serviceName}] Найден ключ с точным совпадением service_name=${dbServiceName}`);
        let apiKey = apiKeyData.api_key;
        
        // Специальная обработка для FAL.AI, но мы НЕ модифицируем ключ здесь.
        // Ключ для FAL.AI хранится в БД без префикса "Key ".
        // Добавление префикса "Key " делается непосредственно при вызове API в сервисе falai.ts
        if (serviceName === ApiServiceName.FAL_AI) {
          console.log(`[${serviceName}] Найден ключ FAL.AI (длина: ${apiKey.length}, содержит двоеточие: ${apiKey.includes(':')})`);
          
          // Для отладки запоминаем формат ключа но НЕ модифицируем его
          if (apiKey.startsWith('Key ')) {
            console.log(`[${serviceName}] ВНИМАНИЕ: Ключ FAL.AI в БД уже содержит префикс 'Key ', что может привести к двойному префиксу.`);
          }
        }
        
        if (serviceName === ApiServiceName.XMLRIVER) {
          try {
            JSON.parse(apiKey);
            console.log(`[${serviceName}] Ключ уже в JSON формате`);
          } catch (e) {
            console.log(`[${serviceName}] Форматирование ключа XMLRiver в JSON`);
            if (apiKey.includes(':')) {
              const [user, key] = apiKey.split(':');
              apiKey = JSON.stringify({ user: user.trim(), key: key.trim() });
            } else {
              apiKey = JSON.stringify({ user: "16797", key: apiKey.trim() });
            }
          }
        }
        
        // Сохраняем в кэш
        if (!this.keyCache[userId]) {
          this.keyCache[userId] = {};
        }
        
        this.keyCache[userId][serviceName] = {
          key: apiKey,
          expiresAt: Date.now() + this.cacheDuration
        };
        
        log(`Successfully fetched ${serviceName} API key from Directus for user ${userId}`, 'api-keys');
        return apiKey;
      }
      
      // Если ключ не найден по service_name, проверяем дополнительные варианты
      console.log(`[${serviceName}] Не найден ключ с service_name=${dbServiceName}, пробуем альтернативные методы`);
      
      // Пробуем найти по индексу (как в SettingsDialog.tsx)
      const serviceIndex = Object.entries(SERVICE_INDEX_MAPPING).find(
        ([_, mappedService]) => mappedService === serviceName
      );
      
      if (serviceIndex && apiKeys.length > 0) {
        const index = parseInt(serviceIndex[0], 10);
        console.log(`[${serviceName}] Индекс сервиса в UI: ${index}`);
        
        if (apiKeys.length > index) {
          const keyByPosition = apiKeys[index];
          if (keyByPosition && keyByPosition.api_key) {
            console.log(`[${serviceName}] Найден ключ по позиции ${index} в списке`);
            let apiKey = keyByPosition.api_key;
            
            // Обработка специальных форматов
            if (serviceName === ApiServiceName.FAL_AI && !apiKey.startsWith('Key ') && apiKey.includes(':')) {
              apiKey = `Key ${apiKey}`;
            }
            
            // Сохраняем в кэш
            if (!this.keyCache[userId]) {
              this.keyCache[userId] = {};
            }
            
            this.keyCache[userId][serviceName] = {
              key: apiKey,
              expiresAt: Date.now() + this.cacheDuration
            };
            
            // Также обновляем service_name в БД для будущих запросов
            try {
              await directusCrud.update('user_api_keys', keyByPosition.id, {
                service_name: dbServiceName
              }, {
                userId, authToken
              });
              console.log(`[${serviceName}] Обновлен service_name для ключа по ID: ${keyByPosition.id}`);
            } catch (e) {
              console.error(`[${serviceName}] Ошибка при обновлении service_name:`, e);
            }
            
            return apiKey;
          }
        }
      }
      
      log(`${serviceName} API key not found in user settings for user ${userId}`, 'api-keys');
      console.warn(`⚠️ [${serviceName}] API ключ не найден в настройках пользователя. Необходимо добавить ключ в Directus.`);
      return null;
    } catch (error) {
      console.error(`Error fetching ${serviceName} API key:`, error);
      
      // Детальное логирование ошибки
      if ('response' in (error as any)) {
        const axiosError = error as any;
        console.error('Error details:', {
          status: axiosError.response?.status,
          data: axiosError.response?.data,
          message: axiosError.message
        });
        
        // Если ошибка 401, добавляем дополнительную информацию
        if (axiosError.response?.status === 401) {
          log(`Unauthorized error (401) while fetching ${serviceName} API key - token may be invalid or expired`, 'api-keys');
        }
      }
      
      log(`Error fetching ${serviceName} API key: ${error instanceof Error ? error.message : String(error)}`, 'api-keys');
      return null;
    }
  }
  
  /**
   * Сохраняет новый API ключ в Directus
   * @param userId ID пользователя
   * @param serviceName Название сервиса
   * @param apiKey API ключ для сохранения
   * @param authToken Токен авторизации для Directus
   * @returns true в случае успеха, false в случае ошибки
   */
  async saveApiKey(userId: string, serviceName: ApiServiceName, apiKey: string, authToken?: string): Promise<boolean> {
    try {
      if (!userId) {
        log(`Cannot save ${serviceName} API key: missing userId`, 'api-keys');
        return false;
      }
      
      // Для FAL.AI - проверка и форматирование ключа при сохранении
      if (serviceName === ApiServiceName.FAL_AI) {
        // Если ключ начинается с "Key ", удаляем префикс для хранения в БД
        if (apiKey.startsWith('Key ')) {
          const originalKey = apiKey;
          apiKey = apiKey.substring(4);
          console.log(`[${serviceName}] Удаляем префикс "Key " у ключа для сохранения в БД`);
          console.log(`[${serviceName}] Исходный ключ: ${originalKey.substring(0, 8)}... => Сохраняемый: ${apiKey.substring(0, 4)}...`);
        }
        
        // Проверка формата ключа (должен содержать ":")
        if (!apiKey.includes(':')) {
          console.warn(`[${serviceName}] API ключ может быть в неправильном формате. Правильный формат должен содержать разделитель ":"`);
          log(`[${serviceName}] API ключ для пользователя ${userId} сохраняется, но может не работать с FAL.AI API`, 'api-keys');
        } else {
          console.log(`[${serviceName}] Ключ в правильном формате (содержит ":")"`);
        }
      }
      
      // Для XMLRiver - хранение комбинации user ID и API ключа
      if (serviceName === ApiServiceName.XMLRIVER) {
        try {
          // Проверяем, не передан ли уже ключ в JSON формате
          const parsed = JSON.parse(apiKey);
          
          // Если это объект с полями user и key, значит уже отформатирован
          if (typeof parsed === 'object' && 'user' in parsed && 'key' in parsed) {
            console.log(`[${serviceName}] Получен API ключ в формате JSON, сохраняем как есть`);
          } else {
            // Иначе это некорректный формат, пробуем создать JSON формат заново
            console.warn(`[${serviceName}] Некорректный формат JSON для XMLRiver API ключа`);
          }
        } catch (e) {
          // Если не удалось распарсить JSON, то это строка с API ключом
          // Форматируем в JSON объект
          console.log(`[${serviceName}] Преобразуем обычный ключ в формат JSON`);
          
          // Предполагаем, что ключ содержит два значения: user_id:api_key
          if (apiKey.includes(':')) {
            const [user, key] = apiKey.split(':');
            apiKey = JSON.stringify({ user: user.trim(), key: key.trim() });
            console.log(`[${serviceName}] Сохраняем ключ в формате JSON с user_id:api_key`);
          } else {
            // Если разделитель не найден, предполагаем, что это только API ключ без user ID
            // Используем значение по умолчанию для user ID (16797)
            apiKey = JSON.stringify({ user: "16797", key: apiKey.trim() });
            console.log(`[${serviceName}] Сохраняем ключ в формате JSON с user_id по умолчанию (16797)`);
          }
        }
      }
      
      // Сначала проверяем, существует ли уже ключ для этого сервиса/пользователя
      console.log(`[${serviceName}] Проверка существующих API ключей для пользователя ${userId} с использованием DirectusCrud`);
      
      // Получаем название сервиса в БД из маппинга
      const dbServiceName = SERVICE_NAME_DB_MAPPING[serviceName];
      console.log(`[${serviceName}] DB service name mapping: '${serviceName}' -> '${dbServiceName}'`);
      
      const existingKeys = await directusCrud.list('user_api_keys', {
        userId: userId,
        authToken: authToken,
        filter: {
          user_id: { _eq: userId },
          service_name: { _eq: dbServiceName }
        },
        fields: ['id']
      });
      
      let result;
      
      if (existingKeys.length > 0) {
        // Обновляем существующий ключ
        // Явное приведение типа для устранения ошибки типизации
        const existingKey = existingKeys[0] as { id: string };
        const keyId = existingKey.id;
        console.log(`[${serviceName}] Обновление существующего API ключа с ID ${keyId}`);
        
        result = await directusCrud.update('user_api_keys', keyId, {
          api_key: apiKey,
          updated_at: new Date().toISOString()
        }, {
          userId: userId,
          authToken: authToken
        });
        
        log(`Updated ${serviceName} API key for user ${userId}`, 'api-keys');
      } else {
        // Создаем новый ключ
        console.log(`[${serviceName}] Создание нового API ключа для пользователя ${userId}`);
        
        result = await directusCrud.create('user_api_keys', {
          user_id: userId,
          service_name: dbServiceName,
          api_key: apiKey,
          created_at: new Date().toISOString()
        }, {
          userId: userId,
          authToken: authToken
        });
        
        log(`Created new ${serviceName} API key for user ${userId}`, 'api-keys');
      }
      
      // Обновляем кэш
      if (!this.keyCache[userId]) {
        this.keyCache[userId] = {};
      }
      
      this.keyCache[userId][serviceName] = {
        key: apiKey,
        expiresAt: Date.now() + this.cacheDuration
      };
      
      return true;
    } catch (error) {
      console.error(`Error saving ${serviceName} API key:`, error);
      
      // Детальное логирование ошибки
      if ('response' in (error as any)) {
        const axiosError = error as any;
        console.error('Error details:', {
          status: axiosError.response?.status,
          data: axiosError.response?.data,
          message: axiosError.message
        });
      }
      
      log(`Error saving ${serviceName} API key: ${error instanceof Error ? error.message : String(error)}`, 'api-keys');
      return false;
    }
  }
  
  /**
   * Очищает устаревшие ключи из кэша
   */
  private cleanupCache(): void {
    const now = Date.now();
    let cleanedCount = 0;
    
    Object.keys(this.keyCache).forEach(userId => {
      Object.keys(this.keyCache[userId]).forEach(serviceName => {
        const service = serviceName as ApiServiceName;
        if (this.keyCache[userId][service]!.expiresAt < now) {
          delete this.keyCache[userId][service];
          cleanedCount++;
        }
      });
      
      // Если у пользователя не осталось ключей, удаляем его из кэша
      if (Object.keys(this.keyCache[userId]).length === 0) {
        delete this.keyCache[userId];
      }
    });
    
    if (cleanedCount > 0) {
      log(`Cleaned up ${cleanedCount} expired API keys from cache`, 'api-keys');
    }
  }
  
  /**
   * Получает API ключ из переменных окружения
   * @param serviceName Название сервиса
   * @returns API ключ или null, если ключ не найден
   */
  private getKeyFromEnvironment(serviceName: ApiServiceName): string | null {
    // ВАЖНО: API ключи должны храниться ТОЛЬКО в базе данных Directus
    // Этот метод теперь всегда возвращает null, чтобы исключить использование переменных окружения
    
    console.warn(`[${serviceName}] ⚠️ ВНИМАНИЕ: Запрошен ключ из переменных окружения!`);
    console.warn(`[${serviceName}] ⚠️ API ключи хранятся ТОЛЬКО в базе данных Directus!`);
    console.warn(`[${serviceName}] ⚠️ Пользователь должен добавить ключ через интерфейс настроек.`);
    
    // Всегда возвращаем null, чтобы приложение не использовало ключи из .env
    return null;
  }
  
  /**
   * Сбрасывает кэшированный ключ для пользователя и сервиса
   * @param userId ID пользователя
   * @param serviceName Название сервиса
   */
  invalidateCache(userId: string, serviceName: ApiServiceName): void {
    if (this.keyCache[userId]?.[serviceName]) {
      delete this.keyCache[userId][serviceName];
      log(`Invalidated cached ${serviceName} API key for user ${userId}`, 'api-keys');
    }
  }
  
  /**
   * Исправляет/обновляет формат ключа FAL.AI для пользователя
   * @param userId ID пользователя
   * @param authToken Токен авторизации (опционально)
   * @returns true, если ключ был успешно обновлен
   */
  async fixFalAiKeyFormat(userId: string, authToken?: string): Promise<boolean> {
    try {
      // Получаем текущий ключ FAL.AI для пользователя
      console.log(`[fal_ai] Получаем ключ для проверки формата`);
      const keys = await directusCrud.list('user_api_keys', {
        userId: userId,
        authToken: authToken,
        filter: {
          user_id: { _eq: userId }
        },
        fields: ['id', 'service_name', 'api_key']
      });
      
      // Ищем ключ FAL.AI, либо по service_name, либо по порядку
      // Явное приведение типа для устранения ошибки типизации
      const typedKeys = keys as Array<{ id: string; service_name?: string; api_key?: string }>;
      
      let falKeyItem = typedKeys.find(key => 
        key.service_name && key.service_name.toLowerCase() === 'fal_ai');
      
      // Если нет ключа с service_name, но у нас есть массив с ключами, пробуем использовать индекс
      if (!falKeyItem && typedKeys.length > 4 && typedKeys[4] && typedKeys[4].api_key) {
        falKeyItem = typedKeys[4]; // FAL.AI - пятый ключ в интерфейсе (индекс 4)
        console.log(`[fal_ai] Используем ключ по индексу 4 (FAL.AI - 5-й в UI)`);
      }
      
      if (falKeyItem && falKeyItem.api_key) {
        const apiKey = falKeyItem.api_key;
        
        // Проверяем формат ключа - теперь мы храним ключи БЕЗ префикса "Key "
        if (apiKey.startsWith('Key ')) {
          console.log(`[fal_ai] Ключ содержит префикс "Key ", который нужно удалить для хранения в БД`);
          // Убираем префикс для хранения в БД
          const cleanKey = apiKey.substring(4);
          
          // Обновляем ключ в БД
          await directusCrud.update('user_api_keys', falKeyItem.id, {
            api_key: cleanKey,
            service_name: 'fal_ai', // Устанавливаем service_name, если его не было
            updated_at: new Date().toISOString()
          }, {
            userId: userId,
            authToken: authToken
          });
          
          console.log(`[fal_ai] Префикс "Key " удален из ключа в БД`);
          return true;
        } else if (apiKey.includes(':')) {
          console.log(`[fal_ai] Ключ уже в правильном формате для хранения (без префикса "Key"), обновляем service_name`);
          
          // Обновляем service_name в БД
          await directusCrud.update('user_api_keys', falKeyItem.id, {
            service_name: 'fal_ai',
            updated_at: new Date().toISOString()
          }, {
            userId: userId,
            authToken: authToken
          });
          
          // Инвалидируем кэш
          this.invalidateCache(userId, ApiServiceName.FAL_AI);
          
          console.log(`[fal_ai] Ключ успешно обновлен в БД с правильным форматом`);
          return true;
        } else {
          console.log(`[fal_ai] Ключ в неизвестном формате, не содержит ":"`, apiKey);
          return false;
        }
      } else {
        console.log(`[fal_ai] Ключ не найден в БД для пользователя ${userId}`);
        return false;
      }
    } catch (error) {
      console.error(`[fal_ai] Ошибка при обновлении формата ключа:`, error);
      return false;
    }
  }
}

// Экспортируем экземпляр сервиса для использования во всем приложении
export const apiKeyService = new ApiKeyService();
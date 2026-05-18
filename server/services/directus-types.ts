/**
 * Типы для работы с Directus API
 */

/**
 * Результат запроса на аутентификацию
 */
export interface DirectusAuthResult {
  access_token: string;
  refresh_token: string;
  expires: number;
  user?: DirectusUser;
}

/**
 * Базовая информация о пользователе Directus
 */
export interface DirectusUser {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  role?: string;
  [key: string]: any; // Дополнительные поля
}

/**
 * Опции для запросов к Directus API
 */
export interface DirectusRequestOptions {
  userId?: string;
  authToken?: string;
  useAdminToken?: boolean;
  fields?: string[];
  sort?: string[];
  limit?: number;
  page?: number;
  filter?: Record<string, any>;
  search?: string;
  meta?: string[];
  deep?: Record<string, any>;
}

/**
 * Параметры для создания записи
 */
export interface DirectusCreateOptions<T> extends DirectusRequestOptions {
  data: T;
}

/**
 * Параметры для обновления записи
 */
export interface DirectusUpdateOptions<T> extends DirectusRequestOptions {
  data: Partial<T>;
}

/**
 * Преобразование camelCase в snake_case для совместимости с Directus
 * @param obj Объект для преобразования
 */
export function convertCamelToSnake(obj: Record<string, any>): Record<string, any> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }

  const result: Record<string, any> = {};

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      const value = obj[key];

      // Рекурсивно обрабатываем вложенные объекты
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result[snakeKey] = convertCamelToSnake(value);
      } else if (Array.isArray(value)) {
        // Обрабатываем массивы
        result[snakeKey] = value.map(item => {
          if (item !== null && typeof item === 'object') {
            return convertCamelToSnake(item);
          }
          return item;
        });
      } else {
        result[snakeKey] = value;
      }
    }
  }

  return result;
}

/**
 * Преобразование snake_case в camelCase для удобства использования в коде
 * @param obj Объект для преобразования
 */
export function convertSnakeToCamel(obj: Record<string, any>): Record<string, any> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }

  const result: Record<string, any> = {};

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      const value = obj[key];

      // Рекурсивно обрабатываем вложенные объекты
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result[camelKey] = convertSnakeToCamel(value);
      } else if (Array.isArray(value)) {
        // Обрабатываем массивы
        result[camelKey] = value.map(item => {
          if (item !== null && typeof item === 'object') {
            return convertSnakeToCamel(item);
          }
          return item;
        });
      } else {
        result[camelKey] = value;
      }
    }
  }

  return result;
}

/**
 * Преобразует даты в строковый формат ISO для передачи в Directus
 * @param obj Объект для преобразования
 */
export function prepareDatesForDirectus(obj: Record<string, any>): Record<string, any> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }

  const result: Record<string, any> = {};

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];

      if (value instanceof Date) {
        result[key] = value.toISOString();
      } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = prepareDatesForDirectus(value);
      } else if (Array.isArray(value)) {
        result[key] = value.map(item => {
          if (item instanceof Date) {
            return item.toISOString();
          } else if (item !== null && typeof item === 'object') {
            return prepareDatesForDirectus(item);
          }
          return item;
        });
      } else {
        result[key] = value;
      }
    }
  }

  return result;
}

/**
 * Преобразует строковые даты из Directus в объекты Date
 * @param obj Объект для преобразования
 */
export function processDirectusDates(obj: Record<string, any>): Record<string, any> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }

  const result: Record<string, any> = {};
  const dateFields = ['created_at', 'updated_at', 'scheduled_at', 'published_at', 'date', 'expires_at'];

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];

      if (typeof value === 'string' && dateFields.includes(key)) {
        try {
          result[key] = new Date(value);
        } catch (e) {
          result[key] = value;
        }
      } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = processDirectusDates(value);
      } else if (Array.isArray(value)) {
        result[key] = value.map(item => {
          if (item !== null && typeof item === 'object') {
            return processDirectusDates(item);
          }
          return item;
        });
      } else {
        result[key] = value;
      }
    }
  }

  return result;
}

/**
 * Подготавливает объект данных для отправки в Directus
 * Преобразует camelCase в snake_case и форматирует даты
 * @param data Объект данных
 */
export function prepareDataForDirectus<T extends Record<string, any>>(data: T): Record<string, any> {
  // Сначала конвертируем camelCase в snake_case
  const snakeCaseData = convertCamelToSnake(data);
  
  // Затем форматируем даты
  return prepareDatesForDirectus(snakeCaseData);
}

/**
 * Обрабатывает данные, полученные из Directus
 * Преобразует snake_case в camelCase и строковые даты в объекты Date
 * @param data Объект данных из Directus
 */
export function processDirectusData<T extends Record<string, any>>(data: T): Record<string, any> {
  // Сначала обрабатываем даты
  const processedDates = processDirectusDates(data);
  
  // Затем конвертируем snake_case в camelCase
  return convertSnakeToCamel(processedDates);
}
/**
 * DirectusCrud - Единый сервис для CRUD операций с Directus
 * 
 * Правила использования:
 * 1. ВСЕГДА передавать authToken (JWT) - никогда userId
 * 2. Для системных операций использовать useAdminToken: true
 * 3. Не дублировать логику авторизации - она централизована здесь
 */
import axios, { AxiosRequestConfig } from 'axios';
import { DirectusAuthResult, DirectusRequestOptions } from './directus-types';
import { adminTokenManager } from './admin-token-manager';
import { logEvent } from '../utils/logger';
import { guardWriteData } from './directus-schema-guard';

/**
 * AI-65, этап 3. Граница с Directus — то место, через которое ходит почти всё,
 * и до сих пор она молчала: неуспешный ответ просто бросался дальше и умирал в
 * ближайшем catch. Именно так остались невидимыми AI-39 и AI-64 — половина
 * тогдашних 403 не оставила в логе ни одной строки.
 *
 * Пишем ровно то, по чему потом строится оповещение: коллекция, код состояния и
 * стабильная машинная причина. Ни тела запроса, ни ответа Directus, ни URL с
 * параметрами — в них уезжают и токены, и пользовательские данные.
 */

/** Коллекция из адреса: `/items/campaign_content/123` -> `campaign_content`. */
export function collectionFromUrl(url: string): string {
  const items = url.match(/\/items\/([A-Za-z0-9_]+)/);
  if (items) return items[1];

  // Служебные разделы Directus: /users/me, /files, /auth/refresh.
  const first = url.replace(/^\//, '').split(/[/?]/)[0];
  return first || 'unknown';
}

/**
 * Стабильная причина отказа. Сначала код самого Directus (FORBIDDEN,
 * RECORD_NOT_UNIQUE, INVALID_CREDENTIALS) — он машинный и не меняется от
 * правки формулировок. Текст сообщения не берём: в нём бывают и данные
 * пользователя, и подставленные значения.
 */
/**
 * Уровень записи об отказе.
 *
 * RECORD_NOT_UNIQUE — не авария, а штатный исход состязания за блокировку
 * публикации: два цикла одновременно пытаются создать одну и ту же запись, и
 * проигравший получает отказ. Писать это предупреждением значит вернуть в
 * журнал ровно тот фон, от которого избавила AI-120.
 */
export function levelForDirectusFailure(
  status: number | undefined,
  reason: string,
): 'debug' | 'warn' | 'error' {
  if (reason === 'RECORD_NOT_UNIQUE') return 'debug';
  if (status === undefined || status >= 500) return 'error';
  return 'warn';
}

export function directusErrorCode(err: any): string {
  const code = err?.response?.data?.errors?.[0]?.extensions?.code;
  if (typeof code === 'string' && code) return code;
  if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') return 'timeout';
  if (typeof err?.code === 'string' && err.code) return err.code;
  if (err?.response?.status) return `http_${err.response.status}`;
  return 'unknown';
}

export class RefreshTokenExpiredError extends Error {
  constructor(message: string = 'Refresh token истёк или недействителен') {
    super(message);
    this.name = 'RefreshTokenExpiredError';
  }
}

type CrudOperation = 'create' | 'read' | 'update' | 'delete' | 'list' | 'custom';

interface RequestConfig {
  method: string;
  url: string;
  data?: any;
  params?: Record<string, any>;
  authToken?: string;
}

export class DirectusCrud {
  private readonly directusUrl: string;
  private readonly logPrefix = 'directus-crud';
  private refreshTokenPromises: Map<string, Promise<DirectusAuthResult>> = new Map();
  private adminTokenCache: { token: string; expiresAt: number } | null = null;

  constructor() {
    const isProduction = process.env.NODE_ENV === 'production' || process.env.ENV === 'production';
    // ВАЖНО: В Replit или локально в проде используем внешний URL, если не задан DIRECTUS_URL
    this.directusUrl = process.env.DIRECTUS_URL || (isProduction ? 'https://directus.nplanner.ru' : 'https://directus.nplanner.ru');

    // Убеждаемся, что URL не содержит лишних слэшей в конце
    this.directusUrl = this.directusUrl.replace(/\/$/, '');

    console.log(`[directus-crud] Initialized with URL: ${this.directusUrl} (env: ${process.env.NODE_ENV || 'not set'})`);
  }

  /**
   * Выполняет HTTP запрос к Directus API
   */
  private async executeRequest<T>(config: RequestConfig): Promise<T> {
    const axiosConfig: AxiosRequestConfig = {
      method: config.method,
      url: `${this.directusUrl}${config.url}`,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
      },
      paramsSerializer: (params) => {
        const parts: string[] = [];

        const serializeValue = (prefix: string, value: any) => {
          if (value === undefined || value === null) return;
          if (Array.isArray(value)) {
            if (prefix === 'sort' || prefix === 'meta' || prefix === 'fields') {
              parts.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(value.join(','))}`);
            } else {
              value.forEach((item: any, index: number) => {
                if (typeof item === 'object' && item !== null) {
                  serializeValue(`${prefix}[${index}]`, item);
                } else {
                  parts.push(`${encodeURIComponent(prefix)}[]=${encodeURIComponent(String(item))}`);
                }
              });
            }
          } else if (typeof value === 'object') {
            for (const [k, v] of Object.entries(value)) {
              serializeValue(`${prefix}[${k}]`, v);
            }
          } else {
            parts.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
          }
        };

        for (const [key, value] of Object.entries(params)) {
          serializeValue(key, value);
        }
        return parts.join('&');
      }
    };

    if (config.data) axiosConfig.data = config.data;
    if (config.params) axiosConfig.params = config.params;

    if (config.authToken) {
      axiosConfig.headers = {
        ...axiosConfig.headers,
        'Authorization': `Bearer ${config.authToken}`
      };
    }

    const startedAt = Date.now();

    try {
      const response = await axios(axiosConfig);
      return response.data.data;
    } catch (error: any) {
      const status = error?.response?.status;

      logEvent(
        'directus.request_failed',
        {
          system: 'directus',
          operation: config.method,
          collection: collectionFromUrl(config.url),
          status,
          reason: directusErrorCode(error),
          durationMs: Date.now() - startedAt,
        },
        // Нет ответа вовсе (сеть, таймаут) или 5xx — это наша беда;
        // 4xx чаще означает отказ в доступе и разбирается вызывающим кодом.
        levelForDirectusFailure(status, directusErrorCode(error)),
        'directus',
      );

      // Поведение не меняем: ошибка уходит вызывающему коду ровно как раньше.
      throw error;
    }
  }

  /**
   * Получает админский токен с кэшированием
   */
  private async getAdminToken(): Promise<string> {
    if (this.adminTokenCache && this.adminTokenCache.expiresAt > Date.now()) {
      return this.adminTokenCache.token;
    }

    // Единый источник admin-токена — adminTokenManager: он проверяет статический
    // токен на живость и при протухании входит по email/паролю. Раньше здесь была
    // своя копия логики, которая брала статический токен БЕЗ проверки и кэшировала
    // на 24 часа — из-за чего протухший токен ронял все админские операции разом.
    const token = await adminTokenManager.getAdminToken();
    if (!token) {
      logEvent('directus.admin_token_missing', { system: 'directus', reason: 'no_credentials' }, 'error', 'directus');
      throw new Error('Admin credentials not configured');
    }

    // Локальное зеркало кэша менеджера (у него TTL 30 мин) — чуть короче, чтобы
    // не пережить его инвалидацию.
    this.adminTokenCache = { token, expiresAt: Date.now() + 25 * 60 * 1000 };
    return token;
  }

  /**
   * Публичный метод для получения admin-токена (для использования в других модулях)
   */
  async getAdminTokenPublic(): Promise<string> {
    return this.getAdminToken();
  }

  /**
   * Определяет какой токен использовать для запроса.
   *
   * Если токена нет и анонимность не заявлена явно — это забытый токен, а не
   * публичный запрос. Раньше такой вызов уходил в Directus вообще без заголовка
   * Authorization, получал 403 и умирал в ближайшем catch: так молча ломались
   * загрузка autonomous_settings и подгрузка выбранных трендов.
   */
  private async resolveToken(
    options: DirectusRequestOptions,
    operation: CrudOperation,
    collection: string,
  ): Promise<string | undefined> {
    if (options.useAdminToken) {
      return this.getAdminToken();
    }
    if (!options.authToken && !options.allowAnonymous) {
      logEvent(
        'directus.request_anonymous',
        { system: 'directus', operation, collection, reason: 'token_missing' },
        // Именно error, а не warn: этот запрос гарантированно получит 403, то
        // есть какая-то возможность продукта уже сломана. Так и было до перевода
        // на события — понижать уровень заодно с переносом было бы подменой.
        'error',
        'directus',
        `${operation} ${collection}: запрос без токена. Directus ответит 403. ` +
          `Если анонимность намеренная, передайте allowAnonymous: true.`,
      );
    }
    return options.authToken;
  }

  /**
   * Формирует параметры запроса
   */
  private buildParams(options: DirectusRequestOptions): Record<string, any> {
    const params: Record<string, any> = {};
    if (options.filter) params.filter = options.filter;
    if (options.sort?.length) params.sort = options.sort;
    if (options.limit) params.limit = options.limit;
    if (options.page) params.page = options.page;
    if (options.fields?.length) params.fields = options.fields;
    if (options.search) params.search = options.search;
    if (options.meta?.length) params.meta = options.meta;
    if (options.deep) params.deep = options.deep;
    return params;
  }

  /**
   * Выполняет операцию с retry логикой
   */
  private async executeWithRetry<T>(
    operation: CrudOperation,
    collection: string,
    executor: () => Promise<T>
  ): Promise<T> {
    const maxRetries = 3;
    const retryableStatuses = [502, 503, 504, 429];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await executor();
      } catch (error: any) {
        const statusCode = error.response?.status;
        const isRetryable = statusCode && retryableStatuses.includes(statusCode);
        const isLastAttempt = attempt === maxRetries;

        // AI-65. Здесь было два console.*: текст ошибки axios (в нём полный URL
        // запроса вместе с параметрами) и ЦЕЛИКОМ тело ответа Directus. Второе
        // прямо запрещено: в теле уезжают и данные пользователя, и содержимое
        // записи. Сам отказ уже записан событием directus.request_failed в
        // executeRequest — с коллекцией, кодом состояния и машинной причиной,
        // то есть со всем, по чему потом строится оповещение. Дублировать его
        // здесь незачем.

        if (isRetryable && !isLastAttempt) {
          const delay = Math.pow(2, attempt) * 1000;
          logEvent(
            'directus.request_retry',
            { system: 'directus', operation, collection, status: statusCode, attempt: attempt + 1, durationMs: delay },
            'debug',
            'directus',
          );
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      }
    }

    throw new Error('Unexpected error in executeWithRetry');
  }

  /**
   * Создает запись в коллекции
   */
  async create<T>(collection: string, data: Record<string, any>, options: DirectusRequestOptions = {}): Promise<T> {
    const safeData = guardWriteData(collection, data) as Record<string, any>;
    return this.executeWithRetry('create', collection, async () => {
      const authToken = await this.resolveToken(options, 'create', collection);
      return this.executeRequest<T>({
        method: 'post',
        url: `/items/${collection}`,
        data: safeData,
        authToken
      });
    });
  }

  /**
   * Получает список записей
   */
  async list<T>(collection: string, options: DirectusRequestOptions = {}): Promise<T[]> {
    return this.executeWithRetry('list', collection, async () => {
      const authToken = await this.resolveToken(options, 'list', collection);
      const params = this.buildParams(options);
      return this.executeRequest<T[]>({
        method: 'get',
        url: `/items/${collection}`,
        params,
        authToken
      });
    });
  }

  /**
   * Получает запись по ID
   */
  async getById<T>(collection: string, id: string | number, options: DirectusRequestOptions = {}): Promise<T | null> {
    return this.executeWithRetry('read', collection, async () => {
      const authToken = await this.resolveToken(options, 'read', collection);
      try {
        return await this.executeRequest<T>({
          method: 'get',
          url: `/items/${collection}/${id}`,
          authToken
        });
      } catch (error: any) {
        if (error.response?.status === 404) return null;
        throw error;
      }
    });
  }

  /**
   * Обновляет запись
   */
  async update<T>(collection: string, id: string | number, data: Record<string, any>, options: DirectusRequestOptions = {}): Promise<T> {
    const safeData = guardWriteData(collection, data) as Record<string, any>;
    return this.executeWithRetry('update', collection, async () => {
      const authToken = await this.resolveToken(options, 'update', collection);
      return this.executeRequest<T>({
        method: 'patch',
        url: `/items/${collection}/${id}`,
        data: safeData,
        authToken
      });
    });
  }

  /**
   * Удаляет запись
   */
  async delete(collection: string, id: string | number, options: DirectusRequestOptions = {}): Promise<void> {
    return this.executeWithRetry('delete', collection, async () => {
      const authToken = await this.resolveToken(options, 'delete', collection);
      await axios.delete(`${this.directusUrl}/items/${collection}/${id}`, {
        headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
        timeout: 15000
      });
    });
  }

  /**
   * Выполняет произвольный запрос к Directus API
   */
  async custom<T>(method: string, path: string, data?: any, options: DirectusRequestOptions = {}): Promise<T> {
    return this.executeWithRetry('custom', path, async () => {
      const authToken = await this.resolveToken(options, 'custom', path);
      return this.executeRequest<T>({
        method: method.toLowerCase(),
        url: path,
        data: method.toUpperCase() !== 'GET' ? data : undefined,
        params: method.toUpperCase() === 'GET' ? data : undefined,
        authToken
      });
    });
  }

  /**
   * Поиск записей (алиас для list с расширенными параметрами)
   */
  async searchItems<T>(collection: string, options: DirectusRequestOptions = {}): Promise<T[]> {
    return this.list<T>(collection, options);
  }

  /**
   * Алиас для update (обратная совместимость)
   */
  async updateItem<T>(collection: string, id: string | number, data: Record<string, any>, options: DirectusRequestOptions = {}): Promise<T> {
    return this.update<T>(collection, id, data, options);
  }

  /**
   * Алиас для getById (обратная совместимость)
   */
  async read<T>(collection: string, id: string | number, options: DirectusRequestOptions = {}): Promise<T | null> {
    return this.getById<T>(collection, id, options);
  }

  /**
   * Алиас для list (обратная совместимость)
   */
  async readMany<T>(collection: string, options: DirectusRequestOptions = {}): Promise<T[]> {
    return this.list<T>(collection, options);
  }

  /**
   * Авторизация пользователя
   */
  async login(email: string, password: string): Promise<DirectusAuthResult> {
    const response = await axios.post(`${this.directusUrl}/auth/login`, { email, password });

    if (!response.data?.data?.access_token) {
      throw new Error('Invalid login response');
    }

    return {
      access_token: response.data.data.access_token,
      refresh_token: response.data.data.refresh_token,
      expires: response.data.data.expires
    };
  }

  /**
   * Обновление токена
   */
  async refreshToken(refreshToken: string): Promise<DirectusAuthResult> {
    const existingPromise = this.refreshTokenPromises.get(refreshToken);
    if (existingPromise) return existingPromise;

    const refreshPromise = this.executeRefreshToken(refreshToken);
    this.refreshTokenPromises.set(refreshToken, refreshPromise);

    try {
      return await refreshPromise;
    } finally {
      this.refreshTokenPromises.delete(refreshToken);
    }
  }

  private async executeRefreshToken(refreshToken: string): Promise<DirectusAuthResult> {
    try {
      const response = await axios.post(`${this.directusUrl}/auth/refresh`, {
        refresh_token: refreshToken
      });

      if (!response.data?.data?.access_token) {
        throw new Error('Invalid refresh response');
      }

      return {
        access_token: response.data.data.access_token,
        refresh_token: response.data.data.refresh_token,
        expires: response.data.data.expires
      };
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new RefreshTokenExpiredError(error.response?.data?.errors?.[0]?.message);
      }
      throw error;
    }
  }

  /**
   * Получает текущего пользователя по токену
   */
  async getCurrentUser(options: DirectusRequestOptions): Promise<any> {
    const { authToken } = options;
    if (!authToken) throw new Error('Auth token is required');

    try {
      const tokenParts = authToken.split('.');
      if (tokenParts.length !== 3) throw new Error('Invalid token format');

      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      if (!payload.id) throw new Error('Invalid token payload');

      return {
        id: payload.id,
        email: payload.email || 'unknown@email.com'
      };
    } catch (error) {
      const response = await axios.get(`${this.directusUrl}/users/me`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
        timeout: 15000
      });
      return response.data.data;
    }
  }

  /**
   * Получает пользователя по токену
   */
  async getUserByToken(token: string): Promise<any | null> {
    try {
      return await this.getCurrentUser({ authToken: token });
    } catch (error) {
      console.error(`[${this.logPrefix}] getUserByToken failed:`, error);
      return null;
    }
  }

  /**
   * Получает админский токен (для внешнего использования)
   */
  async getAdminAuthToken(): Promise<string | null> {
    try {
      return await this.getAdminToken();
    } catch (error) {
      console.error(`[${this.logPrefix}] getAdminAuthToken failed:`, error);
      return null;
    }
  }
}

export const directusCrud = new DirectusCrud();

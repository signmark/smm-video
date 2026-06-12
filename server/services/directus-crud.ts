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

    const response = await axios(axiosConfig);
    return response.data.data;
  }

  /**
   * Получает админский токен с кэшированием
   */
  private async getAdminToken(): Promise<string> {
    if (this.adminTokenCache && this.adminTokenCache.expiresAt > Date.now()) {
      return this.adminTokenCache.token;
    }

    // КРИТИЧНО: Приоритет DIRECTUS_STATIC_TOKEN, DIRECTUS_DEV_TOKEN (Replit dev), DIRECTUS_ADMIN_TOKEN или DIRECTUS_TOKEN
    const staticToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_DEV_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN;
    if (staticToken) {
      // Проверяем: если это JWT (3 части через точку), смотрим exp
      const parts = staticToken.split('.');
      if (parts.length === 3) {
        try {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
          const expMs = (payload.exp || 0) * 1000;
          if (expMs > 0 && expMs < Date.now()) {
            console.warn(`[directus-crud] ⚠️ DIRECTUS_ADMIN_TOKEN является JWT и истёк ${new Date(expMs).toISOString()} — попытка войти через email/password`);
            // Не используем истёкший токен, падаем к email/password ниже
          } else {
            const cacheUntil = expMs > 0 ? expMs - 60000 : Date.now() + 24 * 60 * 60 * 1000;
            console.log(`[directus-crud] 🔑 Using JWT admin token from environment (valid until ${new Date(cacheUntil).toISOString()})`);
            this.adminTokenCache = { token: staticToken, expiresAt: cacheUntil };
            return staticToken;
          }
        } catch {
          // Не удалось распарсить — используем как есть
          console.log(`[directus-crud] 🔑 Using static admin token from environment`);
          this.adminTokenCache = { token: staticToken, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
          return staticToken;
        }
      } else {
        // Не JWT — статический токен, не истекает
        console.log(`[directus-crud] 🔑 Using static admin token from environment`);
        this.adminTokenCache = { token: staticToken, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
        return staticToken;
      }
    }

    const email = process.env.DIRECTUS_ADMIN_EMAIL;
    const password = process.env.DIRECTUS_ADMIN_PASSWORD;

    if (!email || !password) {
      console.error(`[directus-crud] ❌ Admin credentials missing!`);
      console.error(`[directus-crud] Checked env: DIRECTUS_ADMIN_EMAIL=${!!process.env.DIRECTUS_ADMIN_EMAIL}, DIRECTUS_ADMIN_PASSWORD=${!!process.env.DIRECTUS_ADMIN_PASSWORD}`);
      console.error(`[directus-crud] Also checked for static token: DIRECTUS_STATIC_TOKEN=${!!process.env.DIRECTUS_STATIC_TOKEN}, DIRECTUS_ADMIN_TOKEN=${!!process.env.DIRECTUS_ADMIN_TOKEN}`);
      console.error(`[directus-crud] Current NODE_ENV: ${process.env.NODE_ENV}`);
      throw new Error('Admin credentials not configured');
    }

    try {
      console.log(`[directus-crud] 🔑 Logging in as admin: ${email} to ${this.directusUrl}`);
      const response = await axios.post(`${this.directusUrl}/auth/login`, {
        email,
        password,
        mode: 'json',
        expires: 86400 // 24 часа
      });
      const token = response.data.data.access_token;
      const expires = response.data.data.expires || 86400000;

      this.adminTokenCache = {
        token,
        expiresAt: Date.now() + expires - 60000
      };

      console.log(`[directus-crud] ✅ Admin token obtained successfully`);
      return token;
    } catch (error: any) {
      console.error(`[directus-crud] ❌ Admin login failed: ${error.message}`);
      if (error.response) {
        console.error(`[directus-crud] Response: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * Публичный метод для получения admin-токена (для использования в других модулях)
   */
  async getAdminTokenPublic(): Promise<string> {
    return this.getAdminToken();
  }

  /**
   * Определяет какой токен использовать для запроса
   */
  private async resolveToken(options: DirectusRequestOptions): Promise<string | undefined> {
    if (options.useAdminToken) {
      return this.getAdminToken();
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

        const isHttpError = error.response != null;
        const errCode = error.response?.data?.errors?.[0]?.extensions?.code;
        const isDuplicate = errCode === 'RECORD_NOT_UNIQUE';

        if (!isDuplicate) {
          const logFn = (isRetryable || !isHttpError) ? console.error : console.warn;
          logFn(`[${this.logPrefix}] ${operation} ${collection} failed (attempt ${attempt + 1}/${maxRetries + 1}):`, error.message);
          if (isHttpError) {
            logFn(`[${this.logPrefix}] Response body [${error.response.status}]:`, JSON.stringify(error.response.data ?? '(empty)'));
          }
        }

        if (isRetryable && !isLastAttempt) {
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`[${this.logPrefix}] Retrying in ${delay}ms...`);
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
    return this.executeWithRetry('create', collection, async () => {
      const authToken = await this.resolveToken(options);
      return this.executeRequest<T>({
        method: 'post',
        url: `/items/${collection}`,
        data,
        authToken
      });
    });
  }

  /**
   * Получает список записей
   */
  async list<T>(collection: string, options: DirectusRequestOptions = {}): Promise<T[]> {
    return this.executeWithRetry('list', collection, async () => {
      const authToken = await this.resolveToken(options);
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
      const authToken = await this.resolveToken(options);
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
    return this.executeWithRetry('update', collection, async () => {
      const authToken = await this.resolveToken(options);
      return this.executeRequest<T>({
        method: 'patch',
        url: `/items/${collection}/${id}`,
        data,
        authToken
      });
    });
  }

  /**
   * Удаляет запись
   */
  async delete(collection: string, id: string | number, options: DirectusRequestOptions = {}): Promise<void> {
    return this.executeWithRetry('delete', collection, async () => {
      const authToken = await this.resolveToken(options);
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
      const authToken = await this.resolveToken(options);
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

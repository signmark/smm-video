import { directusCrud } from './directus-crud';
import { directusApiManager } from '../directus';
import { DirectusAuthResult, DirectusUser } from './directus-types';
import { log } from '../utils/logger';
import { EventEmitter } from 'events';

/**
 * Информация о токене и пользователе
 */
interface SessionInfo {
  userId: string;
  token: string;
  refreshToken: string;
  expiresAt: number;
  user?: DirectusUser;
}

// Создаем глобальный эмиттер событий для коммуникации между компонентами
if (!global.directusEventEmitter) {
  global.directusEventEmitter = new EventEmitter();
  // Увеличиваем лимит слушателей, так как у нас может быть много компонентов,
  // подписанных на события авторизации
  global.directusEventEmitter.setMaxListeners(50);
}

/**
 * Менеджер авторизации и сессий пользователей для Directus
 */
export class DirectusAuthManager {
  private logPrefix: string = 'directus-auth';
  private sessionCache: Record<string, SessionInfo> = {};
  private maxCacheSize: number = 100; // Максимум 100 сессий в кэше
  private sessionRefreshIntervalMs: number = 1 * 60 * 1000; // 1 минута - проверяем часто для ACCESS_TOKEN_TTL=15min
  private sessionRefreshIntervalId?: NodeJS.Timeout;
  private refreshingTokens: Set<string> = new Set(); // Отслеживание активных обновлений токенов
  private maxRefreshAttempts: number = 5; // Увеличено с 3 до 5 для устойчивости к временным сбоям
  private refreshAttempts: Record<string, number> = {}; // Счетчики попыток по пользователям
  private lastRefreshAttemptTime: Record<string, number> = {}; // Время последней попытки для exponential backoff
  private refreshLocks: Map<string, Promise<{ token: string; refreshToken: string; expiresAt: number } | null>> = new Map(); // Distributed lock для предотвращения race condition
  private lastCacheCleanup: number = Date.now();
  
  constructor() {
    log('DirectusAuthManager initialized', this.logPrefix);
    this.startSessionRefreshInterval();
    this.setupEventListeners();
  }
  
  /**
   * Вычисляет задержку для exponential backoff с jitter
   * @param attempt Номер попытки (0-based)
   * @returns Задержка в миллисекундах
   */
  private calculateBackoffDelay(attempt: number): number {
    // Базовая задержка 1 секунда, максимум 30 секунд
    const baseDelay = 1000;
    const maxDelay = 30000;
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    // Добавляем jitter (случайность) до 1 секунды
    const jitter = Math.random() * 1000;
    return exponentialDelay + jitter;
  }
  
  /**
   * Проверяет, нужно ли ждать перед следующей попыткой (exponential backoff)
   * @param userId ID пользователя
   * @returns true если нужно подождать
   */
  private shouldWaitForBackoff(userId: string): boolean {
    const lastAttempt = this.lastRefreshAttemptTime[userId];
    const attempts = this.refreshAttempts[userId] || 0;
    
    if (!lastAttempt || attempts === 0) {
      return false;
    }
    
    const requiredDelay = this.calculateBackoffDelay(attempts - 1);
    const timeSinceLastAttempt = Date.now() - lastAttempt;
    
    return timeSinceLastAttempt < requiredDelay;
  }
  
  /**
   * Помечает сессию как требующую повторной аутентификации (soft-invalidation)
   * Вместо удаления сессии из БД помечаем её флагом needs_reauth
   * @param userId ID пользователя
   */
  private async softInvalidateSession(userId: string): Promise<void> {
    log(`🔄 Soft-invalidating session for user ${userId} (marking for re-auth)`, this.logPrefix);
    
    // Очищаем локальные кеши
    delete this.sessionCache[userId];
    directusApiManager.clearAuthTokenCache(userId);
    delete this.refreshAttempts[userId];
    delete this.lastRefreshAttemptTime[userId];
    
    // Уведомляем систему о необходимости повторной авторизации
    directusApiManager.handleTokenRefreshFailed(userId, new Error('Session requires re-authentication'));
    
    // НЕ удаляем сессию из БД - просто помечаем что нужна повторная авторизация
    // Это позволит пользователю войти заново без потери данных
    log(`✅ Session for user ${userId} soft-invalidated (user will need to re-login)`, this.logPrefix);
  }
  
  /**
   * Извлекает дату истечения из JWT токена
   * @param token JWT токен
   * @returns timestamp истечения в миллисекундах или null если не удалось распарсить
   */
  private parseTokenExpiry(token: string): number | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return null;
      }
      
    // КРИТИЧНО: JWT использует base64url, нужно конвертировать в base64
    // base64url: - и _ вместо + и /, без padding (=)
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    
    // Добавляем padding если нужно
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    
    const payload = JSON.parse(Buffer.from(base64, 'base64').toString());
    
    if (payload.exp) {
      // exp в JWT - это Unix timestamp в СЕКУНДАХ, конвертируем в миллисекунды
      return payload.exp * 1000;
    }
    
    return null;
  } catch (error) {
    // log(`Failed to parse token expiry: ${(error as Error).message}`, this.logPrefix);
    return null;
  }
}

/**
 * Проверяет, является ли токен валидным (не истёкшим)
 * @param token JWT токен
 * @returns true если токен валиден
 */
public isTokenValid(token: string): boolean {
  const expiry = this.parseTokenExpiry(token);
  if (!expiry) return false;
  return expiry > Date.now() + (60 * 1000); // Запас 1 минута
}
  
  /**
   * Настраивает слушатели событий для взаимодействия с другими компонентами
   */
  private setupEventListeners(): void {
    // Обработка запросов на обновление токена от directusApiManager
    global.directusEventEmitter.on('refresh-token-needed', async (userId: string) => {
      log(`Получено событие refresh-token-needed для пользователя ${userId}`, this.logPrefix);
      
      // DISTRIBUTED LOCK: Если уже есть активный refresh для этого пользователя,
      // ждём его результат вместо запуска нового
      if (this.refreshLocks.has(userId)) {
        log(`[LOCK] Ожидаем завершения активного refresh для пользователя ${userId}`, this.logPrefix);
        try {
          await this.refreshLocks.get(userId);
        } catch (e) {
          // Игнорируем ошибки - они уже обработаны в основном потоке
        }
        return;
      }
      
      // EXPONENTIAL BACKOFF: Проверяем, нужно ли ждать перед следующей попыткой
      if (this.shouldWaitForBackoff(userId)) {
        const attempts = this.refreshAttempts[userId] || 0;
        const delay = this.calculateBackoffDelay(attempts - 1);
        const waitTime = Math.max(0, delay - (Date.now() - (this.lastRefreshAttemptTime[userId] || 0)));
        log(`[BACKOFF] Ждём ${Math.round(waitTime/1000)}s перед попыткой ${attempts + 1} для пользователя ${userId}`, this.logPrefix);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      // Проверяем, не превышено ли количество попыток обновления
      if (this.refreshAttempts[userId] && this.refreshAttempts[userId] >= this.maxRefreshAttempts) {
        log(`⚠️ Превышено максимальное количество попыток (${this.maxRefreshAttempts}) для пользователя ${userId}. Используем soft-invalidation.`, this.logPrefix);
        
        // SOFT-INVALIDATION: НЕ удаляем сессию из БД, только помечаем для повторной авторизации
        await this.softInvalidateSession(userId);
        return;
      }
      
      // Создаём promise для distributed lock
      const refreshPromise = this.performRefreshWithLock(userId);
      this.refreshLocks.set(userId, refreshPromise);
      
      try {
        await refreshPromise;
      } finally {
        this.refreshLocks.delete(userId);
      }
    });
  }
  
  /**
   * Выполняет refresh токена с блокировкой для предотвращения race condition
   * @param userId ID пользователя
   */
  private async performRefreshWithLock(userId: string): Promise<{ token: string; refreshToken: string; expiresAt: number } | null> {
    // Записываем время попытки для exponential backoff
    this.lastRefreshAttemptTime[userId] = Date.now();
    
    // Отмечаем, что начали обрабатывать запрос на обновление токена
    this.refreshingTokens.add(userId);
    
    try {
      // Получаем текущую сессию
      const sessionInfo = this.sessionCache[userId];
      
      if (!sessionInfo) {
        log(`Нет сохраненной сессии для пользователя ${userId}`, this.logPrefix);
        throw new Error('Нет сохраненной сессии');
      }
      
      // Если сессия не имеет refreshToken, пробуем выполнить полную аутентификацию
      if (!sessionInfo.refreshToken) {
        log(`Отсутствует refresh token для пользователя ${userId}, попытка повторной авторизации`, this.logPrefix);
        
        // Пробуем получить токен админа, если userId совпадает с админским
        if (process.env.DIRECTUS_ADMIN_EMAIL && this.isAdminId(userId)) {
          log(`Попытка получить токен администратора для пользователя ${userId}`, this.logPrefix);
          const adminSession = await this.getAdminSession();
          
          if (adminSession) {
            // Уведомляем систему об успешном обновлении токена
            directusApiManager.handleTokenRefreshed(
              userId,
              adminSession.token,
              '', // Нет refresh token для админа
              24 * 60 * 60 // 24 часа
            );
            
            // Сбрасываем счетчик попыток
            delete this.refreshAttempts[userId];
            delete this.lastRefreshAttemptTime[userId];
            
            return { token: adminSession.token, refreshToken: '', expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
          }
        }
        
        // Если не удалось получить токен админа или это не админский userId,
        // сообщаем о неудаче
        directusApiManager.handleTokenRefreshFailed(userId, new Error('Отсутствует refresh token'));
        
        // Увеличиваем счетчик попыток
        this.refreshAttempts[userId] = (this.refreshAttempts[userId] || 0) + 1;
        
        return null;
      }
      
      // Обновляем токен с помощью refresh token
      log(`Обновление токена для пользователя ${userId} с помощью refresh token`, this.logPrefix);
      const refreshResult = await directusCrud.refreshToken(sessionInfo.refreshToken);
      
      const newExpiresAt = Date.now() + (refreshResult.expires * 1000);
      
      // Обновляем информацию о сессии
      this.sessionCache[userId] = {
        ...sessionInfo,
        token: refreshResult.access_token,
        refreshToken: refreshResult.refresh_token,
        expiresAt: newExpiresAt
      };
      
      // Обновляем кэш в Directus API Manager
      directusApiManager.cacheAuthToken(
        userId, 
        refreshResult.access_token, 
        refreshResult.expires, 
        refreshResult.refresh_token
      );
      
      // Уведомляем систему об успешном обновлении токена
      directusApiManager.handleTokenRefreshed(
        userId,
        refreshResult.access_token,
        refreshResult.refresh_token,
        refreshResult.expires
      );
      
      // Сбрасываем счетчики при успехе
      delete this.refreshAttempts[userId];
      delete this.lastRefreshAttemptTime[userId];
      
      log(`✅ Токен для пользователя ${userId} успешно обновлен`, this.logPrefix);
      
      // КРИТИЧНО: Сохраняем новый refresh_token в БД асинхронно
      // Без этого после перезапуска сервера старый (инвалидированный) refresh_token вызывает re-login
      const newExpiresAtDate = new Date(newExpiresAt);
      const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
      import('./telegram-session-storage').then(({ telegramSessionStorage }) => {
        telegramSessionStorage.updateTokensForUser(userId, refreshResult.access_token, refreshResult.refresh_token, newExpiresAtDate, adminToken || undefined)
          .catch((e: any) => log(`⚠️ [TOKEN-SYNC] Не удалось синхронизировать токен в БД для ${userId}: ${e.message}`, this.logPrefix));
      });
      
      return { token: refreshResult.access_token, refreshToken: refreshResult.refresh_token, expiresAt: newExpiresAt };
    } catch (error: any) {
      const errorMessage = error?.response?.data || error?.message || String(error);
      log(`❌ Ошибка при обновлении токена для пользователя ${userId}: ${JSON.stringify(errorMessage)}`, this.logPrefix);
      
      // Если Directus вернул "Invalid user credentials", значит refresh_token невалиден
      if (JSON.stringify(errorMessage).includes('Invalid user credentials')) {
        log(`⚠️ Refresh token для пользователя ${userId} окончательно недействителен. Принудительная инвалидация.`, this.logPrefix);
        await this.softInvalidateSession(userId);
        return null;
      }

      // Увеличиваем счетчик попыток
      this.refreshAttempts[userId] = (this.refreshAttempts[userId] || 0) + 1;
      
      // Уведомляем систему о неудачном обновлении токена
      directusApiManager.handleTokenRefreshFailed(userId, error);
      
      // Если превышено максимальное количество попыток, используем soft-invalidation
      if (this.refreshAttempts[userId] >= this.maxRefreshAttempts) {
        log(`⚠️ Превышено максимальное количество попыток (${this.maxRefreshAttempts}) для пользователя ${userId}. Soft-invalidation.`, this.logPrefix);
        await this.softInvalidateSession(userId);
      }
      
      return null;
    } finally {
      // В любом случае удаляем пользователя из списка обрабатываемых
      this.refreshingTokens.delete(userId);
    }
  }
  
  /**
   * Проверяет, является ли указанный userId идентификатором администратора
   * @param userId ID пользователя для проверки
   * @returns true, если это ID администратора
   */
  private isAdminId(userId: string): boolean {
    // Если в кэше сессий есть пользователь с таким ID и он помечен как администратор
    if (this.sessionCache[userId]?.user?.role === 'admin') {
      return true;
    }
    
    // Проверяем, совпадает ли ID с полученным ранее ID администратора
    // (в зависимости от логики вашего приложения этот метод может быть расширен)
    return false;
  }

  /**
   * Авторизует администратора и возвращает токен
   * @param email Email администратора
   * @param password Пароль администратора
   * @returns Токен администратора
   */
  async authenticateAdmin(email: string, password: string): Promise<{ token: string; userId: string } | null> {
    try {
      log(`Authenticating admin: ${email}`, this.logPrefix);
      
      const authResult = await directusCrud.login(email, password);
      
      // Получаем информацию о пользователе
      const user = await directusCrud.getCurrentUser({
        authToken: authResult.access_token
      });
      
      // Кэшируем сессию администратора
      this.sessionCache[user.id] = {
        userId: user.id,
        token: authResult.access_token,
        refreshToken: authResult.refresh_token,
        expiresAt: Date.now() + (authResult.expires * 1000),
        user
      };
      
      // Кэшируем токен в Directus API Manager
      directusApiManager.cacheAuthToken(user.id, authResult.access_token, authResult.expires);
      
      log(`Admin ${email} (${user.id}) successfully authenticated`, this.logPrefix);
      
      return {
        token: authResult.access_token,
        userId: user.id
      };
    } catch (error) {
      log(`Error during admin authentication for ${email}: ${(error as Error).message}`, this.logPrefix);
      return null;
    }
  }

  /**
   * Авторизует пользователя и сохраняет информацию о сессии
   * @param email Email пользователя
   * @param password Пароль пользователя
   * @returns Информация о пользователе и токене
   */
  async login(email: string, password: string): Promise<{
    userId: string;
    token: string;
    refreshToken: string;
    user: DirectusUser;
  }> {
    try {
      log(`Attempting to log in user: ${email}`, this.logPrefix);
      
      const authResult = await directusCrud.login(email, password);
      
      // Получаем информацию о пользователе
      const user = await directusCrud.getCurrentUser({
        authToken: authResult.access_token
      });
      
      // КРИТИЧНО: Извлекаем реальную дату истечения из JWT токена
      const expiresAt = this.parseTokenExpiry(authResult.access_token) || (Date.now() + (authResult.expires * 1000));
      
      // Кэшируем сессию
      this.sessionCache[user.id] = {
        userId: user.id,
        token: authResult.access_token,
        refreshToken: authResult.refresh_token,
        expiresAt,
        user
      };
      
      // Кэшируем токен в Directus API Manager для обратной совместимости
      directusApiManager.cacheAuthToken(user.id, authResult.access_token, authResult.expires, authResult.refresh_token);
      
      log(`User ${email} (${user.id}) successfully logged in`, this.logPrefix);
      
      return {
        userId: user.id,
        token: authResult.access_token,
        refreshToken: authResult.refresh_token,
        user
      };
    } catch (error) {
      log(`Error during login for user ${email}: ${(error as Error).message}`, this.logPrefix);
      throw new Error(`Failed to login: ${(error as Error).message}`);
    }
  }

  /**
   * Обновляет токен пользователя по refresh token
   * С поддержкой distributed lock, exponential backoff и soft-invalidation
   * @param userId ID пользователя
   * @returns Обновленная информация о токене
   */
  async refreshSession(userId: string): Promise<{ token: string; refreshToken: string; expiresAt: number } | null> {
    // DISTRIBUTED LOCK: Если уже есть активный refresh для этого пользователя,
    // ждём его результат вместо запуска нового
    const existingLock = this.refreshLocks.get(userId);
    if (existingLock) {
      log(`[LOCK] refreshSession: Ожидаем завершения активного refresh для пользователя ${userId}`, this.logPrefix);
      try {
        return await existingLock;
      } catch (e) {
        return null;
      }
    }
    
    // EXPONENTIAL BACKOFF: Проверяем, нужно ли ждать перед следующей попыткой
    if (this.shouldWaitForBackoff(userId)) {
      const attempts = this.refreshAttempts[userId] || 0;
      const delay = this.calculateBackoffDelay(attempts - 1);
      const waitTime = Math.max(0, delay - (Date.now() - (this.lastRefreshAttemptTime[userId] || 0)));
      log(`[BACKOFF] refreshSession: Ждём ${Math.round(waitTime/1000)}s перед попыткой ${attempts + 1} для ${userId}`, this.logPrefix);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Проверяем, не превышено ли количество попыток обновления
    if (this.refreshAttempts[userId] && this.refreshAttempts[userId] >= this.maxRefreshAttempts) {
      log(`⚠️ refreshSession: Превышено максимальное количество попыток (${this.maxRefreshAttempts}) для ${userId}. Soft-invalidation.`, this.logPrefix);
      
      // SOFT-INVALIDATION вместо удаления из БД
      await this.softInvalidateSession(userId);
      return null;
    }
    
    // Создаём promise для distributed lock
    const refreshPromise = this.executeRefreshSession(userId);
    this.refreshLocks.set(userId, refreshPromise);
    
    try {
      return await refreshPromise;
    } finally {
      this.refreshLocks.delete(userId);
    }
  }
  
  /**
   * Внутренний метод выполнения refresh сессии (без lock логики)
   */
  private async executeRefreshSession(userId: string): Promise<{ token: string; refreshToken: string; expiresAt: number } | null> {
    // Записываем время попытки для exponential backoff
    this.lastRefreshAttemptTime[userId] = Date.now();
    
    // Отмечаем, что начали обрабатывать запрос на обновление токена
    this.refreshingTokens.add(userId);
    
    try {
      const sessionInfo = this.sessionCache[userId];
      
      if (!sessionInfo || !sessionInfo.refreshToken) {
        log(`No refresh token available for user ${userId}`, this.logPrefix);
        
        // Если это админский ID, пробуем получить сессию администратора
        if (this.isAdminId(userId)) {
          log(`Попытка получить токен администратора для пользователя ${userId}`, this.logPrefix);
          const adminSession = await this.getAdminSession();
          
          if (adminSession) {
            // Уведомляем систему об успешном обновлении токена
            directusApiManager.handleTokenRefreshed(
              userId,
              adminSession.token,
              '', // Нет refresh token для админа
              24 * 60 * 60 // 24 часа
            );
            
            // Создаем новую сессию в кэше
            this.sessionCache[userId] = {
              userId,
              token: adminSession.token,
              refreshToken: '',
              expiresAt: Date.now() + (24 * 60 * 60 * 1000),
              user: {
                id: userId,
                email: process.env.DIRECTUS_ADMIN_EMAIL || 'admin@example.com',
                first_name: 'Admin',
                last_name: 'User',
                role: 'admin'
              }
            };
            
            // Сбрасываем счетчики
            delete this.refreshAttempts[userId];
            delete this.lastRefreshAttemptTime[userId];
            
            return {
              token: adminSession.token,
              refreshToken: '', // Нет refresh token для админа
              expiresAt: Date.now() + (24 * 60 * 60 * 1000)
            };
          }
        }
        
        // Если не удалось получить токен админа или это не админский userId,
        // увеличиваем счетчик неудачных попыток
        this.refreshAttempts[userId] = (this.refreshAttempts[userId] || 0) + 1;
        
        return null;
      }
      
      log(`Refreshing session for user ${userId}`, this.logPrefix);
      
      // КРИТИЧНО: Получаем админский токен ДО refreshSession чтобы избежать циклической зависимости
      // Используем static token напрямую, не вызывая getAdminAuthToken()
      const adminToken = process.env.DIRECTUS_STATIC_TOKEN || '';
      
      const authResult = await directusCrud.refreshToken(sessionInfo.refreshToken);
      
      // КРИТИЧНО: Извлекаем реальную дату истечения из JWT токена
      // Это надёжнее чем вычислять Date.now() + expires, т.к. использует точное значение из токена
      const newExpiresAt = this.parseTokenExpiry(authResult.access_token) || (Date.now() + (authResult.expires * 1000));
      
      // Обновляем информацию о сессии
      this.sessionCache[userId] = {
        ...sessionInfo,
        token: authResult.access_token,
        refreshToken: authResult.refresh_token,
        expiresAt: newExpiresAt
      };
      
      // Обновляем кэш в Directus API Manager с обновленным refresh token
      directusApiManager.cacheAuthToken(
        userId, 
        authResult.access_token, 
        authResult.expires, 
        authResult.refresh_token
      );
      
      // КРИТИЧНО: Синхронизируем новый refresh_token в Directus DB (telegram_sessions)
      // Это необходимо, потому что Directus ротирует refresh_token при каждом обновлении
      // Передаём adminToken напрямую чтобы избежать циклической зависимости
      try {
        const { telegramSessionStorage } = await import('./telegram-session-storage');
        await telegramSessionStorage.updateTokensForUser(
          userId,
          authResult.access_token,
          authResult.refresh_token,
          new Date(newExpiresAt),
          adminToken // КРИТИЧНО: передаём токен напрямую, избегая повторного вызова getAdminAuthToken()
        );
      } catch (error) {
        // Не прерываем работу если синхронизация не удалась - токен остался в кэше
        log(`⚠️ Не удалось синхронизировать refresh_token в БД для user ${userId}: ${(error as Error).message}`, this.logPrefix);
      }
      
      // Сбрасываем счетчики при успехе
      delete this.refreshAttempts[userId];
      delete this.lastRefreshAttemptTime[userId];
      
      log(`✅ Session for user ${userId} successfully refreshed and synchronized`, this.logPrefix);
      
      return {
        token: authResult.access_token,
        refreshToken: authResult.refresh_token,
        expiresAt: newExpiresAt
      };
    } catch (error: any) {
      const errorMessage = error?.response?.data || error?.message || String(error);
      log(`❌ Error refreshing session for user ${userId}: ${JSON.stringify(errorMessage)}`, this.logPrefix);
      
      // Если Directus вернул "Invalid user credentials", значит refresh_token невалиден
      if (JSON.stringify(errorMessage).includes('Invalid user credentials')) {
        log(`⚠️ Refresh token for user ${userId} is permanently invalid. Soft-invalidating.`, this.logPrefix);
        await this.softInvalidateSession(userId);
        return null;
      }

      // Увеличиваем счетчик неудачных попыток
      this.refreshAttempts[userId] = (this.refreshAttempts[userId] || 0) + 1;
      
      // Если превышено максимальное количество попыток, используем soft-invalidation
      if (this.refreshAttempts[userId] >= this.maxRefreshAttempts) {
        log(`⚠️ Превышено максимальное количество попыток (${this.maxRefreshAttempts}) для ${userId}. Soft-invalidation.`, this.logPrefix);
        await this.softInvalidateSession(userId);
      }
      
      return null;
    } finally {
      // В любом случае удаляем пользователя из списка обрабатываемых
      this.refreshingTokens.delete(userId);
    }
  }

  /**
   * Получает текущую сессию пользователя
   * @param userId ID пользователя
   * @returns Информация о сессии или null, если сессия не найдена
   */
  getUserData(userId: string): any | null {
    return this.sessionCache[userId]?.user || null;
  }

  getSession(userId: string): SessionInfo | null {
    const session = this.sessionCache[userId];
    
    if (!session) {
      return null;
    }
    
    // Проверяем, не истек ли токен
    if (session.expiresAt <= Date.now()) {
      log(`Session for user ${userId} has expired`, this.logPrefix);
      return null;
    }
    
    return session;
  }

  /**
   * Получает токен авторизации для пользователя
   * @param userId ID пользователя
   * @param autoRefresh Автоматически обновлять токен, если он истек
   * @returns Токен авторизации или null, если токен не найден
   */
  async getAuthToken(userId: string, autoRefresh: boolean = true): Promise<string | null> {
    // Проверяем, есть ли действующая сессия в кэше
    const session = this.getSession(userId);
    
    if (session) {
      log(`Found valid session for user ${userId}`, this.logPrefix);
      return session.token;
    }
    
    // Проверяем, есть ли токен в directusApiManager
    let cachedToken = null;
    
    try {
      cachedToken = directusApiManager.getCachedToken(userId);
      
      if (cachedToken) {
        // Если токен все еще действителен
        if (cachedToken.expiresAt > Date.now()) {
          log(`Found valid token in directusApiManager cache for user ${userId}`, this.logPrefix);
          
          // Кэшируем его локально для будущих вызовов
          this.sessionCache[userId] = {
            userId,
            token: cachedToken.token,
            refreshToken: cachedToken.refreshToken || '', // Добавляем refreshToken если он есть
            expiresAt: cachedToken.expiresAt,
            user: undefined
          };
          
          return cachedToken.token;
        }
        // Если токен истек, но есть refresh token - возможно потребуется обновление
        else if (cachedToken.refreshToken) {
          log(`Found expired token with refresh token in directusApiManager cache for user ${userId}`, this.logPrefix);
          
          // Кэшируем его локально для будущих вызовов и обновления
          this.sessionCache[userId] = {
            userId,
            token: cachedToken.token,
            refreshToken: cachedToken.refreshToken,
            expiresAt: cachedToken.expiresAt,
            user: undefined
          };
          
          // Здесь мы не возвращаем токен, а продолжаем выполнение,
          // чтобы запустить процесс обновления если autoRefresh=true
        }
      }
    } catch (error) {
      log(`Error when trying to get token from directusApiManager: ${error}`, this.logPrefix);
    }
    
    // Если требуется автоматическое обновление и у нас есть кэш, который можно обновить
    if (autoRefresh) {
      // Проверяем, не запущен ли уже процесс обновления токена
      if (this.refreshingTokens.has(userId)) {
        log(`Token refresh for user ${userId} is already in progress, waiting...`, this.logPrefix);
        
        // Создаем промис, который разрешится, когда обновление завершится
        const refreshPromise = new Promise<string | null>((resolve) => {
          // Создаем обработчик события обновления токена
          const refreshHandler = (refreshedUserId: string, success: boolean, token: string) => {
            if (refreshedUserId === userId) {
              // Удаляем обработчик, чтобы избежать утечек памяти
              global.directusEventEmitter.off('token-refreshed', refreshHandler);
              
              if (success) {
                resolve(token);
              } else {
                resolve(null);
              }
            }
          };
          
          // Устанавливаем таймаут для предотвращения бесконечного ожидания
          const timeoutId = setTimeout(() => {
            global.directusEventEmitter.off('token-refreshed', refreshHandler);
            log(`Token refresh timeout for user ${userId}`, this.logPrefix);
            resolve(null);
          }, 10000); // 10 секунд таймаут
          
          // Подписываемся на событие обновления токена
          global.directusEventEmitter.once('token-refreshed', refreshHandler);
        });
        
        return refreshPromise;
      }
      
      log(`No valid session found, attempting to refresh for user ${userId}`, this.logPrefix);
      
      // Инициируем процесс обновления токена
      const refreshedSession = await this.refreshSession(userId);
      
      if (refreshedSession) {
        // Оповещаем о успешном обновлении токена, передавая новый refresh_token
        global.directusEventEmitter.emit('token-refreshed', userId, true, refreshedSession.refreshToken);
        return refreshedSession.token;
      } else {
        // Если у нас есть пользователь админ, пробуем получить новую сессию для него
        if (process.env.DIRECTUS_ADMIN_EMAIL && this.isAdminId(userId)) {
          log(`Attempting to get a new admin session for user ${userId}`, this.logPrefix);
          const adminSession = await this.getAdminSession();
          
          if (adminSession) {
            global.directusEventEmitter.emit('token-refreshed', userId, true, adminSession.token);
            return adminSession.token;
          }
        }
        
        // Оповещаем о неудачном обновлении токена
        global.directusEventEmitter.emit('token-refreshed', userId, false, '');
      }
    }
    
    log(`No valid token found for user ${userId}`, this.logPrefix);
    return null;
  }

  /**
   * Завершает сессию пользователя
   * @param userId ID пользователя
   */
  logout(userId: string): void {
    if (this.sessionCache[userId]) {
      delete this.sessionCache[userId];
      delete this.refreshAttempts[userId];
      delete this.lastRefreshAttemptTime[userId];
      directusApiManager.clearAuthTokenCache(userId);
      log(`Session for user ${userId} terminated`, this.logPrefix);
    }
  }

  /**
   * Проверяет и обновляет истекающие сессии
   * PROACTIVE REFRESH: Обновляет токены ЗА 7 минут ДО истечения для предотвращения 401 ошибок
   */
  private async refreshExpiringSessions(): Promise<void> {
    const now = Date.now();
    // КРИТИЧНО: Обновляем токены за 7 минут до истечения (для ACCESS_TOKEN_TTL=15min)
    // Это предотвращает 401 ошибки при параллельных запросах и дает больший запас времени
    const expirationThreshold = now + (7 * 60 * 1000); // 7 минут до истечения
    
    // КРИТИЧНО: Не пытаемся обновлять токены, которые истекли больше 24 часов назад
    // Это позволяет пользователю работать сутки без перелогина даже при временных сбоях
    const tooOldThreshold = now - (24 * 60 * 60 * 1000); // 24 часа назад
    
    for (const userId in this.sessionCache) {
      const session = this.sessionCache[userId];
      
      // Если токен истёк слишком давно (>1 час), используем soft-invalidation
      if (session.expiresAt < tooOldThreshold) {
        log(`⚠️ Token for user ${userId} expired ${Math.round((now - session.expiresAt) / 60000)} minutes ago (too old). Soft-invalidating.`, this.logPrefix);
        // SOFT-INVALIDATION: НЕ удаляем из БД, только очищаем кеши
        await this.softInvalidateSession(userId);
        continue;
      }
      
      // КРИТИЧНО: Пропускаем сессии с превышенным лимитом попыток обновления
      // Используем soft-invalidation вместо жёсткого удаления
      if (this.refreshAttempts[userId] && this.refreshAttempts[userId] >= this.maxRefreshAttempts) {
        log(`[PROACTIVE-REFRESH] User ${userId} - max refresh attempts exceeded, soft-invalidating`, this.logPrefix);
        await this.softInvalidateSession(userId);
        continue;
      }
      
      // Пропускаем, если токен ещё долго будет действителен
      if (session.expiresAt >= expirationThreshold) {
        continue;
      }
      
      // Пропускаем, если уже обновляем токен для этого пользователя или есть активный lock
      if (this.refreshingTokens.has(userId) || this.refreshLocks.has(userId)) {
        continue;
      }
      
      const minutesUntilExpiry = Math.floor((session.expiresAt - now) / 60000);
      log(`[PROACTIVE-REFRESH] Token for user ${userId} expires in ${minutesUntilExpiry} minutes, refreshing now`, this.logPrefix);
      
      // Обновляем токен асинхронно (не блокируем цикл)
      this.refreshSession(userId).catch(error => {
        log(`[PROACTIVE-REFRESH] Failed to refresh token for user ${userId}: ${error.message}`, this.logPrefix);
      });
    }
  }

  /**
   * Запускает интервал обновления сессий с контролем памяти
   */
  private startSessionRefreshInterval(): void {
    if (this.sessionRefreshIntervalId) {
      clearInterval(this.sessionRefreshIntervalId);
    }
    
    this.sessionRefreshIntervalId = setInterval(() => {
      this.refreshExpiringSessions();
    }, this.sessionRefreshIntervalMs);
    
    log(`Session refresh interval started (${this.sessionRefreshIntervalMs}ms)`, this.logPrefix);
  }

  /**
   * Получает все активные сессии пользователей
   * @returns Массив информации об активных сессиях
   */
  getAllActiveSessions(): { userId: string; token: string; expiresAt: number }[] {
    const now = Date.now();
    const activeSessions: { userId: string; token: string; expiresAt: number }[] = [];
    
    for (const userId in this.sessionCache) {
      const session = this.sessionCache[userId];
      
      // Проверяем, что сессия действительна
      if (session.expiresAt > now) {
        activeSessions.push({
          userId: session.userId,
          token: session.token,
          expiresAt: session.expiresAt
        });
      }
    }
    
    log(`Found ${activeSessions.length} active sessions`, this.logPrefix);
    return activeSessions;
  }

  /**
   * Полная очистка всех данных и остановка интервалов
   */
  shutdown(): void {
    if (this.sessionRefreshIntervalId) {
      clearInterval(this.sessionRefreshIntervalId);
      this.sessionRefreshIntervalId = undefined;
    }
    
    // Очищаем все кэши и структуры данных
    this.sessionCache = {};
    this.refreshingTokens.clear();
    this.refreshAttempts = {};
    this.lastRefreshAttemptTime = {};
    this.refreshLocks.clear();
    
    log('🔴 DirectusAuthManager: Полная очистка памяти выполнена', this.logPrefix);
  }
  
  /**
   * Добавляет сессию администратора в кэш
   * @param session Данные о сессии администратора
   */
  addAdminSession(session: { id: string; token: string; email?: string }): void {
    const userId = session.id;
    const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 часа
    
    this.sessionCache[userId] = {
      userId,
      token: session.token,
      refreshToken: '',
      expiresAt,
      user: {
        id: userId,
        email: session.email || 'admin@example.com',
        first_name: 'Admin',
        last_name: 'User',
        role: 'admin'
      }
    };
    
    // Также сохраняем в кэше API менеджера
    directusApiManager.cacheAuthToken(userId, session.token, expiresAt);
    
    log(`Admin session for user ${userId} added to cache`, this.logPrefix);
  }
  
  /**
   * Интерфейс для авторизации администратора и получения токена
   * @returns Результат авторизации
   */
  async loginAdmin(): Promise<{ success: boolean; token?: string }> {
    try {
      const session = await this.getAdminSession();
      if (!session) {
        return { success: false };
      }
      return { success: true, token: session.token };
    } catch (error) {
      log(`Error during admin login: ${(error as Error).message}`, this.logPrefix);
      return { success: false };
    }
  }

  /**
   * Получает сессию администратора для API запросов
   * @returns Информация о сессии администратора или null, если не удалось получить
   */
  async getAdminSession(): Promise<{ token: string; id: string } | null> {
    try {
      // ИСПОЛЬЗУЕМ ТОЛЬКО СТАТИЧЕСКИЙ ТОКЕН
      const token = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
      
      if (!token) {
        log('Missing DIRECTUS_STATIC_TOKEN or DIRECTUS_ADMIN_TOKEN environment variables', this.logPrefix);
        return null;
      }
      
      // Создаем имитацию сессии администратора с статическим токеном
      // ID используем дефолтный или из env, если есть
      const adminId = 'admin-static-user-id'; 
      const adminEmail = process.env.DIRECTUS_ADMIN_EMAIL || 'admin@static.token';
      
      // Сохраняем сессию в кэше
      this.addAdminSession({
        id: adminId,
        token: token,
        email: adminEmail
      });
      
      log(`Static Admin session created successfully (${adminId})`, this.logPrefix);
      
      return {
        token: token,
        id: adminId
      };
      
      /*
      // Старая логика закомментирована
      // Пытаемся авторизоваться с учетными данными администратора
      const email = process.env.DIRECTUS_ADMIN_EMAIL;
      const password = process.env.DIRECTUS_ADMIN_PASSWORD;
      
      if (!email || !password) {
        log('Missing DIRECTUS_ADMIN_EMAIL or DIRECTUS_ADMIN_PASSWORD environment variables', this.logPrefix);
        return null;
      }
      
      log(`Attempting to login as admin (${email})`, this.logPrefix);
      
      const authResult = await directusCrud.login(email, password);
      
      // Получаем информацию о пользователе администратора
      const adminUser = await directusCrud.getCurrentUser({
        authToken: authResult.access_token
      });
      
      // Сохраняем сессию в кэше
      this.addAdminSession({
        id: adminUser.id,
        token: authResult.access_token,
        email: adminUser.email
      });
      
      log(`Admin login successful (${adminUser.id})`, this.logPrefix);
      
      return {
        token: authResult.access_token,
        id: adminUser.id
      };
      */
    } catch (error) {
      log(`Error getting admin session: ${(error as Error).message}`, this.logPrefix);
      return null;
    }
  }

  /**
   * Получает административный токен для доступа к системным коллекциям
   * @returns Административный токен или null
   */
  async getAdminAuthToken(): Promise<string | null> {
    try {
      // ИСПОЛЬЗУЕМ ТОЛЬКО СТАТИЧЕСКИЙ ТОКЕН
      // Убираем зависимость от логина/пароля администратора
      const token = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
      
      if (token) {
        // Кэшируем токен как админскую сессию для совместимости (опционально)
        // Но главное - возвращаем его сразу
        return token;
      }
      
      // Старая логика с логином закомментирована для предотвращения ошибок
      /*
      // 1. Ищем админскую сессию в кэше
      const adminSessions = Object.values(this.sessionCache).filter(session => 
        session.user?.email && 
        (session.user.email === process.env.DIRECTUS_ADMIN_EMAIL || 
         session.user.email === 'admin@nplanner.ru')
      );
      
      if (adminSessions.length > 0) {
        const adminSession = adminSessions[0];
        if (adminSession.expiresAt > Date.now()) {
          return adminSession.token;
        }
      }
      
      // 2. Проверяем наличие статического токена (DIRECTUS_STATIC_TOKEN)
      if (process.env.DIRECTUS_STATIC_TOKEN) {
        log('Using DIRECTUS_STATIC_TOKEN for admin access', this.logPrefix);
        return process.env.DIRECTUS_STATIC_TOKEN;
      }
      
      // 3. Пытаемся авторизоваться через Email/Password
      const adminEmail = process.env.DIRECTUS_ADMIN_EMAIL;
      const adminPassword = process.env.DIRECTUS_ADMIN_PASSWORD;
      
      if (!adminEmail || !adminPassword) {
        log('⚠️ Warning: DIRECTUS_ADMIN_EMAIL or DIRECTUS_ADMIN_PASSWORD not set. Cannot login as admin dynamically.', this.logPrefix);
        return null;
      }
      
      try {
        const loginResult = await this.login(adminEmail, adminPassword);
        return loginResult.token;
      } catch (loginError) {
        log(`❌ Failed to login as admin: ${(loginError as Error).message}`, this.logPrefix);
        return null;
      }
      */
     
      log('❌ Static Admin Token not found in environment variables (DIRECTUS_STATIC_TOKEN or DIRECTUS_ADMIN_TOKEN)', this.logPrefix);
      return null;
    } catch (error) {
      log(`Error getting admin auth token: ${(error as Error).message}`, this.logPrefix);
      return null;
    }
  }

  /**
   * Останавливает интервал обновления сессий
   */
  dispose(): void {
    if (this.sessionRefreshIntervalId) {
      clearInterval(this.sessionRefreshIntervalId);
      this.sessionRefreshIntervalId = undefined;
      log('Session refresh interval stopped', this.logPrefix);
    }
  }

  /**
   * Добавляет или обновляет сессию пользователя в кэше для proactive refresh
   * КРИТИЧНО: Этот метод должен вызываться после любого логина (Telegram bot, WebApp, etc)
   * чтобы сессия участвовала в автоматическом обновлении токенов
   * 
   * @param params Параметры сессии
   * @param params.userId ID пользователя
   * @param params.token Access token
   * @param params.refreshToken Refresh token для автообновления
   * @param params.user Информация о пользователе (опционально)
   */
  upsertSession(params: {
    userId: string;
    token: string;
    refreshToken: string;
    user?: DirectusUser;
  }): void {
    const { userId, token, refreshToken, user } = params;
    
    // КРИТИЧНО: Используем parseTokenExpiry() для извлечения реальной даты истечения из JWT
    // Это надёжнее чем вычисления, т.к. использует точное значение exp из токена
    const expiresAt = this.parseTokenExpiry(token) || (Date.now() + (15 * 60 * 1000)); // fallback 15 минут
    
    // Добавляем сессию в кэш для proactive refresh
    this.sessionCache[userId] = {
      userId,
      token,
      refreshToken,
      expiresAt,
      user
    };
    
    // Очищаем счётчик попыток обновления, если был
    delete this.refreshAttempts[userId];
    
    const minutesUntilExpiry = Math.floor((expiresAt - Date.now()) / 60000);
    log(`✅ Session upserted for user ${userId} (expires in ${minutesUntilExpiry} minutes, proactive refresh enabled)`, this.logPrefix);
    
    // Проверяем лимит кэша и очищаем старые сессии при необходимости
    const sessionCount = Object.keys(this.sessionCache).length;
    if (sessionCount > this.maxCacheSize) {
      this.cleanupOldSessions();
    }
  }

  /**
   * Очистка старых сессий при превышении лимита кэша
   */
  private cleanupOldSessions(): void {
    const now = Date.now();
    const sessions = Object.entries(this.sessionCache);
    
    // Сортируем по времени истечения (старые сессии первыми)
    sessions.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    
    // Удаляем старые сессии, пока не достигнем безопасного размера
    const targetSize = Math.floor(this.maxCacheSize * 0.8); // 80% от макс
    while (sessions.length > targetSize) {
      const [userId] = sessions.shift()!;
      delete this.sessionCache[userId];
      log(`Removed old session for user ${userId} (cache cleanup)`, this.logPrefix);
    }
  }

  /**
   * НОВОЕ: Загружает сессии из БД (telegram_sessions) при старте
   * Это делает БД source of truth для сессий
   */
  async loadSessionsFromDB(): Promise<void> {
    try {
      log('🔄 Loading sessions from database...', this.logPrefix);
      
      const { telegramSessionStorage } = await import('./telegram-session-storage');
      const sessions = await telegramSessionStorage.getAllSessions();
      
      let loadedCount = 0;
      for (const session of sessions) {
        // Пропускаем сессии без токена или refresh_token или user_id
        if (!session.user_id || !session.token || !session.refresh_token) {
          continue;
        }
        
        // Парсим дату истечения из JWT
        const expiresAt = this.parseTokenExpiry(session.token);
        
        if (!expiresAt || expiresAt <= Date.now()) {
          // Токен уже истёк - попытаемся обновить сразу
          log(`Session for user ${session.user_id} has expired token, will try to refresh`, this.logPrefix);
        }
        
        // Добавляем сессию в кэш
        this.sessionCache[session.user_id] = {
          userId: session.user_id,
          token: session.token,
          refreshToken: session.refresh_token,
          expiresAt: expiresAt || Date.now(),
          user: undefined // Заполним позже если потребуется
        };
        
        // КРИТИЧНО: Сбрасываем счётчики попыток для загруженных сессий
        // Это позволяет пользователям восстановить сессию после перезагрузки сервера
        delete this.refreshAttempts[session.user_id];
        delete this.lastRefreshAttemptTime[session.user_id];
        
        loadedCount++;
      }
      
      log(`✅ Loaded ${loadedCount} sessions from database`, this.logPrefix);
    } catch (error) {
      log(`⚠️ Failed to load sessions from database: ${(error as Error).message}`, this.logPrefix);
    }
  }

  /**
   * НОВОЕ: Получает ГАРАНТИРОВАННО свежий токен для пользователя
   * Блокирует выполнение до завершения refresh если токен истёк
   * 
   * @param userId ID пользователя
   * @returns Свежий токен или null если не удалось получить
   */
  async getValidToken(userId: string): Promise<string | null> {
    // Сначала проверяем кэш
    const session = this.sessionCache[userId];
    
    // Если сессии нет - пытаемся загрузить из БД
    if (!session) {
      log(`No cached session for user ${userId}, trying to load from DB`, this.logPrefix);
      
      try {
        const { telegramSessionStorage } = await import('./telegram-session-storage');
        const allSessions = await telegramSessionStorage.getAllSessions();
        
        // Ищем сессию по user_id
        const dbSession = allSessions.find(s => s.user_id === userId);
        
        if (dbSession && dbSession.token && dbSession.refresh_token) {
          const expiresAt = this.parseTokenExpiry(dbSession.token);
          
          // КРИТИЧНО: Добавляем сессию в кэш даже если токен истёк
          // refresh_token из БД позволит обновить access_token
          this.sessionCache[userId] = {
            userId,
            token: dbSession.token,
            refreshToken: dbSession.refresh_token,
            expiresAt: expiresAt || Date.now(),
            user: undefined
          };
          
          // Сбрасываем счётчик попыток для восстановленной сессии
          delete this.refreshAttempts[userId];
          delete this.lastRefreshAttemptTime[userId];
          
          // Проверяем не истёк ли токен
          if (expiresAt && expiresAt > Date.now() + (60 * 1000)) { // >1 минута до истечения
            log(`✅ Loaded valid token from DB for user ${userId}`, this.logPrefix);
            return dbSession.token;
          } else {
            log(`🔄 Token from DB expired for user ${userId}, will try refresh via refresh_token`, this.logPrefix);
            // Токен истёк, но есть refresh_token - продолжаем к refresh логике ниже
          }
        }
      } catch (error) {
        log(`Failed to load session from DB for user ${userId}: ${(error as Error).message}`, this.logPrefix);
      }
    }
    
    // Проверяем не истёк ли токен в кэше (с запасом 1 минута)
    const cachedSession = this.sessionCache[userId];
    if (cachedSession && cachedSession.expiresAt > Date.now() + (60 * 1000)) {
      return cachedSession.token;
    }
    
    // Токен истёк или скоро истечёт - нужен refresh
    log(`Token for user ${userId} expired or expiring soon, refreshing...`, this.logPrefix);
    
    // Если уже идёт refresh - ждём его завершения
    if (this.refreshingTokens.has(userId)) {
      log(`Refresh already in progress for user ${userId}, waiting...`, this.logPrefix);
      
      // Ждём до 10 секунд
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          log(`Refresh timeout for user ${userId}`, this.logPrefix);
          global.directusEventEmitter.off('token-refreshed', handler);
          resolve(null);
        }, 10000);
        
        const handler = (refreshedUserId: string, success: boolean, token: string) => {
          if (refreshedUserId === userId) {
            clearTimeout(timeout);
            global.directusEventEmitter.off('token-refreshed', handler);
            resolve(success ? this.sessionCache[userId]?.token || null : null);
          }
        };
        
        global.directusEventEmitter.on('token-refreshed', handler);
      });
    }
    
    // Запускаем refresh
    const refreshed = await this.refreshSession(userId);
    
    if (refreshed) {
      global.directusEventEmitter.emit('token-refreshed', userId, true, refreshed.token);
      return refreshed.token;
    }
    
    global.directusEventEmitter.emit('token-refreshed', userId, false, '');
    return null;
  }
}

// Экспортируем экземпляр менеджера для использования в приложении
export const directusAuthManager = new DirectusAuthManager();

// Graceful shutdown при завершении процесса
process.on('SIGTERM', () => directusAuthManager.shutdown());
process.on('SIGINT', () => directusAuthManager.shutdown());
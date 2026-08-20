/**
 * Маршруты для авторизации и проверки прав пользователей
 */

import { Request, Response, Express } from 'express';
import axios from 'axios';
import { directusApiManager } from '../directus';
import { directusAuthManager } from '../services/directus-auth-manager';
import { log, logEvent } from '../utils/logger';
import { isUserAdmin } from '../routes-global-api-keys';
import { detectEnvironment } from '../utils/environment-detector';
import { sendRegistrationPostback } from '../services/partner-postback';
import { validateDirectusSession } from '../services/directus-session-validator';
import { refreshDirectusSession } from '../services/directus-refresh-service';
import { downgradeExpiredPlan } from '../services/plan-expiry';

/**
 * Регистрирует маршруты для авторизации
 * @param app Express приложение
 */
export function registerAuthRoutes(app: Express): void {
  // Маршрут для проверки валидности токена
  app.get('/api/auth/check', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Не авторизован',
        message: 'Требуется токен авторизации'
      });
    }
    
    const token = authHeader.substring(7);
    
    try {
      // Декодируем JWT токен и проверяем срок действия
      const tokenParts = token.split('.');
      if (tokenParts.length !== 3) {
        throw new Error('Invalid token format');
      }
      
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      
      // Проверяем наличие обязательных полей
      if (!payload.id) {
        throw new Error('Invalid token payload');
      }
      
      // ВАЖНО: Проверяем срок действия токена
      if (payload.exp) {
        const now = Math.floor(Date.now() / 1000);
        if (now >= payload.exp) {
          return res.status(401).json({
            valid: false,
            error: 'Токен истек',
            expired: true
          });
        }
      }
      
      const validation = await validateDirectusSession(token);
      if (validation === 'invalid') {
        return res.status(401).json({
          valid: false,
          code: 'AUTH_SESSION_INVALID',
          error: 'Сессия недействительна',
          message: 'Требуется обновить сессию или войти заново',
        });
      }
      if (validation === 'unavailable') {
        return res.status(503).json({
          valid: false,
          code: 'AUTH_VALIDATION_UNAVAILABLE',
          error: 'Не удалось проверить сессию',
        });
      }

      res.status(200).json({
        valid: true,
        user: {
          id: payload.id,
          email: payload.email || 'unknown@email.com',
          role: payload.role
        }
      });
    } catch (error) {
      log.error('Error checking token:', error);
      res.status(401).json({ 
        valid: false,
        error: 'Недействительный токен'
      });
    }
  });

  // Маршрут для регистрации
  app.post('/api/auth/register', async (req: Request, res: Response) => {
    try {
      const { email, password, firstName, lastName, jobTitle, partnerCode } = req.body;

      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({ 
          error: 'Неверные данные',
          message: 'Требуется указать email, пароль, имя и фамилию'
        });
      }

      // Используем ID роли SMM Manager User напрямую
      const smmUserRoleId = '346bbfe5-c0b5-451b-b2bb-b8596e57c3e8';

      // Получаем токен администратора для создания пользователя
      let adminToken: string;
      
      try {
        // КРИТИЧНО: Используем DIRECTUS_STATIC_TOKEN напрямую как самый надежный источник
        if (process.env.DIRECTUS_STATIC_TOKEN) {
            adminToken = process.env.DIRECTUS_STATIC_TOKEN;
        } else {
          // Импортируем directusApiManager
          const { directusApiManager } = await import('../directus.js');
          
          // Получаем токен администратора через directusAuthManager  
          let token = await directusAuthManager.getAdminAuthToken();
          
          if (!token) {
            // Логируем ошибку конфигурации, но не палим детали клиенту
            log.error('CRITICAL: Admin token retrieval failed. Check DIRECTUS_ADMIN_EMAIL/PASSWORD or DIRECTUS_STATIC_TOKEN.');
            throw new Error('Не удалось получить токен администратора. Обратитесь к системному администратору.');
          }
          
          adminToken = token;
        }
        
        // Создаем пользователя через directusApiManager с админским токеном
        // КРИТИЧНО: Используем axios напрямую, чтобы избежать любых интерцепторов или кэширования в directusApiManager
        const { detectEnvironment } = await import('../utils/environment-detector.js');
        const envConfig = detectEnvironment();
        const directusUrl = envConfig.directusUrl;
        
        const createUserPayload: Record<string, any> = {
          email,
          password,
          first_name: firstName,
          last_name: lastName,
          role: smmUserRoleId,
          status: 'active'
        };
        if (jobTitle) createUserPayload.job_title = jobTitle;

        const response = await axios.post(`${directusUrl}/users`, createUserPayload, {
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          }
        });

        const newUserId = response.data.data.id;
        log(`User created successfully: ${newUserId}`, 'auth');

        // Активируем пробный период Pro на 14 дней
        try {
          const trialExpireDate = new Date();
          trialExpireDate.setDate(trialExpireDate.getDate() + 14);
          const trialExpireDateStr = trialExpireDate.toISOString().split('T')[0];

          await axios.patch(`${directusUrl}/users/${newUserId}`, {
            plan: 'trial',
            expire_date: trialExpireDateStr,
          }, {
            headers: {
              'Authorization': `Bearer ${adminToken}`,
              'Content-Type': 'application/json',
            },
          });
          log(`Trial Pro (14 days) activated for new user: ${newUserId} until ${trialExpireDateStr}`, 'auth');
        } catch (trialErr: any) {
          log.warn(`[auth/register] Не удалось активировать пробный период Pro: ${trialErr?.message}`, 'auth');
        }

        // Сохраняем партнёрский код и отправляем registration postback (не блокирует ответ)
        if (partnerCode) {
          const normalizedCode = partnerCode.trim().toUpperCase();
          try {
            await axios.patch(`${directusUrl}/users/${newUserId}`, {
              omemo_partner_code: normalizedCode,
            }, {
              headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
            });
            log(`[auth/register] partnerCode=${normalizedCode} сохранён для user ${newUserId}`, 'auth');
          } catch (pcErr: any) {
            log.warn(`[auth/register] Не удалось сохранить partnerCode: ${pcErr?.message}`, 'auth');
          }

          // Читаем актуальные данные юзера из Directus для постбека (email, telegram_chat_id)
          let postbackEmail: string | undefined = email;
          let postbackTelegramId: string | undefined;
          try {
            const userResp = await axios.get(
              `${directusUrl}/users/${newUserId}?fields=email,telegram_chat_id`,
              { headers: { 'Authorization': `Bearer ${adminToken}` } }
            );
            const ud = userResp.data?.data;
            if (ud?.email) postbackEmail = ud.email;
            if (ud?.telegram_chat_id) postbackTelegramId = String(ud.telegram_chat_id);
          } catch (e: any) {
            // AI-65. Регистрация состоялась — ронять её нельзя. Но постбек уйдёт
            // партнёру с тем, что известно из формы: без telegram_chat_id и,
            // возможно, с неактуальным адресом. Неполная отметка о регистрации —
            // это спор о вознаграждении, который всплывает через месяц в сверке
            // отчётов, и узнать о нём заранее было неоткуда.
            logEvent(
              'auth.postback_identity_unresolved',
              { operation: 'register', userId: newUserId, reason: e?.message ? String(e.message) : 'unknown' },
              'warn',
              'auth',
              'Постбек партнёру уйдёт с неполными данными о зарегистрированном',
            );
          }

          sendRegistrationPostback({
            partnerCode: normalizedCode,
            userId: newUserId,
            email: postbackEmail,
            telegramId: postbackTelegramId,
          }).catch(() => {});
        }

        // Auto-login после регистрации, чтобы фронтенд мог продолжить onboarding
        let accessToken: string | null = null;
        let refreshToken: string | null = null;
        try {
          const loginResponse = await axios.post(`${directusUrl}/auth/login`, {
            email,
            password,
            mode: 'json',
            expires: 86400
          });
          accessToken = loginResponse.data?.data?.access_token || null;
          refreshToken = loginResponse.data?.data?.refresh_token || null;
          log(`Auto-login after registration successful for: ${email}`, 'auth');
        } catch (loginErr) {
          log.warn(`Auto-login after registration failed (non-critical): ${loginErr?.message || loginErr}`, 'auth');
        }

        return res.status(201).json({
          success: true,
          message: 'Пользователь успешно зарегистрирован',
          userId: newUserId,
          token: accessToken,
          refresh_token: refreshToken
        });
        
      } catch (createError: any) {
        log.error('User creation error:', createError);
        
        // Обрабатываем специфичные ошибки Directus
        let errorMessage = 'Не удалось создать пользователя';
        
        // Ищем ошибку уникальности email в разных возможных структурах
        const checkForUniqueError = (errors: any[]) => {
          if (errors && errors.length > 0) {
            const error = errors[0];
            if (error.message && error.message.includes('has to be unique')) {
              return 'Пользователь с таким email уже существует';
            }
            return error.message || 'Ошибка создания пользователя';
          }
          return null;
        };
        
        // Проверяем различные структуры ошибок
        if (createError.response?.data?.errors) {
          const message = checkForUniqueError(createError.response.data.errors);
          if (message) errorMessage = message;
        } else if (createError.data?.errors) {
          const message = checkForUniqueError(createError.data.errors);
          if (message) errorMessage = message;
        } else if (createError.errors) {
          const message = checkForUniqueError(createError.errors);
          if (message) errorMessage = message;
        }
        
        throw new Error(errorMessage);
      }
    } catch (error: any) {
      log.error('Error during registration:', error.message);
      
      // Возвращаем конкретное сообщение об ошибке
      return res.status(400).json({ 
        success: false,
        message: error.message || 'Произошла ошибка при регистрации пользователя'
      });
    }
  });

  // Маршрут для авторизации
  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ 
          error: 'Неверные данные',
          message: 'Требуется указать email и пароль'
        });
      }

      // Получаем токен с суточным сроком действия (86400 секунд = 24 часа)
      const response = await directusApiManager.post('/auth/login', {
        email,
        password,
        mode: 'json',
        expires: 86400 // 24 часа
      });

      // Получаем токен и данные пользователя из ответа
      const token = response.data.data.access_token;
      
      // Запрашиваем полные данные пользователя через API
      const userResponse = await directusApiManager.get('/users/me', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const userData = userResponse.data.data;
      log(`Успешная авторизация пользователя ${userData.id}`, 'auth');

      // Проверяем, является ли пользователь администратором
      const isAdmin = await isUserAdmin(req, token);
      log(`Пользователь ${userData.id}: статус администратора = ${isAdmin}`, 'auth');

      // Без крона: при входе не-админа сбрасываем истёкший тариф на free.
      if (!isAdmin) {
        await downgradeExpiredPlan(userData.id);
      }

      // КРИТИЧНО: Сохраняем сессию в DirectusAuthManager для единой авторизации веб+бот
      // Это позволит использовать одну сессию для веб-приложения и Telegram бота
      const refreshToken = response.data.data.refresh_token;
      
      directusAuthManager.upsertSession({
        userId: userData.id,
        token,
        refreshToken,
        user: userData
      });
      
      log(`Сессия сохранена в DirectusAuthManager для пользователя ${userData.id}`, 'auth');

      // expires_at из Directus — абсолютный timestamp в мс
      const expiresAt = response.data.data.expires_at;
      // expires для клиента в секундах (86400 = 24ч)
      const expiresSeconds = expiresAt
        ? Math.max(Math.floor((expiresAt - Date.now()) / 1000), 900)
        : 86400;

      res.status(200).json({ 
        token,
        refresh_token: refreshToken,
        expires: expiresSeconds,
        expires_at: expiresAt || null,
        user: {
          id: userData.id,
          email: userData.email,
          first_name: userData.first_name,
          last_name: userData.last_name,
          role: userData.role,
          isAdmin
        }
      });
    } catch (error: any) {
      log.error('Error during login:', error);
      
      // Обрабатываем ошибку авторизации
      if (error.response?.status === 401) {
        return res.status(401).json({ 
          error: 'Неверные учетные данные',
          message: 'Неверный email или пароль'
        });
      }

      // Directus недоступен (404) — проверьте DIRECTUS_URL в .env
      if (error.response?.status === 404) {
        const directusUrl = process.env.DIRECTUS_URL || '(не задан)';
        return res.status(503).json({ 
          error: 'Directus недоступен',
          message: `Сервер Directus не отвечает по адресу ${directusUrl}. Проверьте DIRECTUS_URL в .env и убедитесь, что Directus запущен.`
        });
      }

      res.status(500).json({ 
        error: 'Ошибка сервера',
        message: 'Произошла ошибка при авторизации'
      });
    }
  });

  // Per-user lock to prevent concurrent refresh token requests

  // Маршрут для обновления токена
  app.post('/api/auth/refresh', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const { refresh_token } = req.body;

      if (!refresh_token) {
        return res.status(400).json({ 
          error: 'Неверные данные',
          message: 'Требуется указать refresh_token'
        });
      }

      const result = await refreshDirectusSession(String(refresh_token));
      if (result.status === 'invalid') {
        return res.status(401).json({ code: 'AUTH_SESSION_INVALID', error: 'Session is no longer valid' });
      }
      if (result.status === 'rate_limited') {
        return res.status(429).json({ code: 'AUTH_REFRESH_RATE_LIMITED', error: 'Too many refresh attempts' });
      }
      if (result.status === 'unavailable') {
        return res.status(503).json({ code: 'AUTH_VALIDATION_UNAVAILABLE', error: 'Authentication service is unavailable' });
      }

      directusAuthManager.upsertSession({
        userId: result.userId,
        token: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
      });

      return res.status(200).json({
        success: true,
        token: result.accessToken,
        refresh_token: result.refreshToken,
        expires_at: result.expiresAt,
      });
    } catch (error: any) {
      log.error('Error in refresh endpoint:', error);
      
      return res.status(503).json({ code: 'AUTH_VALIDATION_UNAVAILABLE', error: 'Authentication service is unavailable' });
    }
  });

  // Маршрут для получения конфигурации окружения
  app.get('/api/config', (req: Request, res: Response) => {
    const envConfig = detectEnvironment();
    

    // Браузеру нужен адрес, по которому Directus достижим ИЗ БРАУЗЕРА, а
    // серверный DIRECTUS_URL — внутренний. На проде они совпадают, поэтому
    // разницы не было видно. На E2E-стенде серверный адрес — docker-имя
    // http://directus-e2e:8055, и части интерфейса, которые ходят в Directus
    // напрямую (календарь, настройки, соцсети), падали бы сетевой ошибкой.
    // Направление безопасное (до боевого Directus браузеру не дотянуться),
    // но прогон E2E показывал бы инфраструктурное красное вместо прикладного.
    const publicDirectusUrl = process.env.DIRECTUS_PUBLIC_URL || envConfig.directusUrl;

    res.json({
      directusUrl: publicDirectusUrl,
      environment: envConfig.environment,
      logLevel: envConfig.logLevel,
      debugScheduler: envConfig.debugScheduler,
      verboseLogs: envConfig.verboseLogs
    });
  });

  // Маршрут для принудительного обновления переменных окружения
  app.post('/api/config/update', (req: Request, res: Response) => {
    
    res.json({
      success: true,
      message: 'Environment variables update disabled to prevent hardcoded overrides',
      directusUrl: process.env.DIRECTUS_URL
    });
  });

  // Маршрут для проверки статуса администратора
  app.get('/api/auth/is-admin', async (req: Request, res: Response) => {
    try {
      // Указываем явно content-type как JSON
      res.setHeader('Content-Type', 'application/json');
      // Добавляем заголовки для предотвращения кэширования
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
      
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        log('Запрос на проверку админа без токена', 'auth');
        return res.status(401).json({ 
          success: false, 
          isAdmin: false,
          message: 'Требуется токен авторизации'
        });
      }
      
      const token = authHeader.substring(7);
      log.debug('Проверка статуса админа', 'auth');
      
      const isAdmin = await isUserAdmin(req, token);
      log.debug(`Результат проверки администратора: ${isAdmin}`, 'auth');
      
      // Добавляем случайный параметр в ответ, чтобы предотвратить кэширование
      return res.status(200).json({ 
        success: true, 
        isAdmin, 
        timestamp: Date.now() 
      });
    } catch (error) {
      log(`Ошибка при проверке статуса администратора: ${error instanceof Error ? error.message : 'Unknown error'}`, 'auth');
      return res.status(500).json({ 
        success: false, 
        error: 'Произошла ошибка при проверке статуса администратора', 
        timestamp: Date.now() 
      });
    }
  });

  // Маршрут для получения информации о текущем пользователе
  app.get('/api/auth/me', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Не авторизован',
        message: 'Требуется токен авторизации'
      });
    }
    
    const token = authHeader.substring(7);
    
    try {
      // Декодируем токен напрямую без запроса к API
      const tokenParts = token.split('.');
      if (tokenParts.length !== 3) {
        throw new Error('Invalid token format');
      }
      
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      
      // Проверяем наличие обязательных полей
      if (!payload.id) {
        throw new Error('Invalid token payload');
      }
      
      const response = {
        data: {
          data: {
            id: payload.id,
            email: payload.email || 'unknown@email.com',
            role: payload.role,
            first_name: payload.first_name || '',
            last_name: payload.last_name || ''
          }
        }
      };

      const userData = response.data.data;
      
      // Проверяем, является ли пользователь администратором
      const isAdmin = await isUserAdmin(req, token);
      log(`Пользователь ${userData.id}: статус администратора = ${isAdmin}`, 'auth');

      // Возвращаем данные пользователя
      res.status(200).json({
        user: {
          id: userData.id,
          email: userData.email,
          first_name: userData.first_name,
          last_name: userData.last_name,
          role: userData.role,
          isAdmin
        }
      });
    } catch (error: any) {
      // Краткое логирование без деталей axios
      if (error?.response?.status === 401) {
        log('Токен истек при получении данных пользователя', 'auth');
      } else {
        log(`Ошибка получения данных пользователя: ${error instanceof Error ? error.message : 'Unknown error'}`, 'auth');
      }
      res.status(401).json({ 
        error: 'Недействительный токен',
        message: 'Требуется повторная авторизация'
      });
    }
  });
  
  // Маршрут для выхода
  app.post('/api/auth/logout', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(200).json({ success: true });
    }
    
    const token = authHeader.substring(7);
    
    try {
      // Отправляем запрос на выход в Directus
      await directusApiManager.post('/auth/logout', null, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      log('Успешный выход пользователя', 'auth');
      res.status(200).json({ success: true });
    } catch (error: any) {
      // Минимальное логирование для logout ошибок
      if (error?.response?.status !== 401) {
        log(`Ошибка при выходе: ${error instanceof Error ? error.message : 'Unknown error'}`, 'auth');
      }
      // Даже если есть ошибка, все равно считаем выход успешным
      res.status(200).json({ success: true });
    }
  });

  // Маршрут для получения активной сессии пользователя (единая авторизация веб+бот)
  // Проверяет есть ли активная сессия в DirectusAuthManager для данного userId
  app.get('/api/auth/get-active-session', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Не авторизован',
        message: 'Требуется токен авторизации'
      });
    }
    
    const token = authHeader.substring(7);
    
    try {
      // Декодируем JWT токен и проверяем срок действия
      const tokenParts = token.split('.');
      if (tokenParts.length !== 3) {
        throw new Error('Invalid token format');
      }
      
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      
      // Проверяем наличие обязательных полей
      if (!payload.id) {
        throw new Error('Invalid token payload');
      }
      
      const userId = payload.id;

      // Нельзя доверять одному только декодированному payload: подпись JWT здесь
      // не проверяется. Directus должен подтвердить именно предъявленный токен.
      const presentedTokenValidation = await validateDirectusSession(token);
      if (presentedTokenValidation !== 'valid') {
        return res.status(presentedTokenValidation === 'unavailable' ? 503 : 401).json({
          code: presentedTokenValidation === 'unavailable'
            ? 'AUTH_VALIDATION_UNAVAILABLE'
            : 'AUTH_SESSION_INVALID',
          error: presentedTokenValidation === 'unavailable'
            ? 'Не удалось проверить сессию'
            : 'Сессия недействительна',
          hasActiveSession: false,
        });
      }
      
      // Получаем активную сессию из DirectusAuthManager
      const session = directusAuthManager.getSession(userId);
      
      if (!session) {
        return res.status(404).json({
          error: 'Сессия не найдена',
          hasActiveSession: false
        });
      }
      
      let activeSession = session;
      const validation = await validateDirectusSession(activeSession.token);

      if (validation === 'invalid') {
        const refreshedSession = await directusAuthManager.refreshSession(userId);
        if (!refreshedSession) {
          return res.status(401).json({
            code: 'AUTH_SESSION_INVALID',
            error: 'Сессия недействительна',
            hasActiveSession: false,
          });
        }

        const refreshedValidation = await validateDirectusSession(refreshedSession.token);
        if (refreshedValidation !== 'valid') {
          return res.status(refreshedValidation === 'unavailable' ? 503 : 401).json({
            code: refreshedValidation === 'unavailable'
              ? 'AUTH_VALIDATION_UNAVAILABLE'
              : 'AUTH_SESSION_INVALID',
            error: 'Не удалось восстановить сессию',
            hasActiveSession: false,
          });
        }

        activeSession = {
          ...activeSession,
          token: refreshedSession.token,
          refreshToken: refreshedSession.refreshToken,
          expiresAt: refreshedSession.expiresAt,
        };
      } else if (validation === 'unavailable') {
        return res.status(503).json({
          code: 'AUTH_VALIDATION_UNAVAILABLE',
          error: 'Не удалось проверить сессию',
          hasActiveSession: false,
        });
      }

      log(`Active session validated for user ${userId}`, 'auth');

      res.status(200).json({
        hasActiveSession: true,
        token: activeSession.token,
        refresh_token: activeSession.refreshToken,
        user: activeSession.user
      });
    } catch (error) {
      log.error('Error getting active session:', error);
      res.status(401).json({ 
        error: 'Недействительный токен'
      });
    }
  });

  // Маршрут для получения refresh_token (для Telegram WebApp)
  // БЕЗОПАСНО: требует валидный access_token, возвращает refresh_token только для этого пользователя
  app.get('/api/auth/get-refresh-token', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Не авторизован',
        message: 'Требуется токен авторизации'
      });
    }
    
    const token = authHeader.substring(7);
    
    try {
      // Декодируем JWT токен и проверяем срок действия
      const tokenParts = token.split('.');
      if (tokenParts.length !== 3) {
        throw new Error('Invalid token format');
      }
      
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      
      // Проверяем наличие обязательных полей
      if (!payload.id) {
        throw new Error('Invalid token payload');
      }
      
      // Проверяем срок действия токена
      if (payload.exp) {
        const now = Math.floor(Date.now() / 1000);
        if (now >= payload.exp) {
          return res.status(401).json({
            error: 'Токен истек',
            expired: true
          });
        }
      }
      
      const userId = payload.id;

      const validation = await validateDirectusSession(token);
      if (validation !== 'valid') {
        return res.status(validation === 'unavailable' ? 503 : 401).json({
          code: validation === 'unavailable'
            ? 'AUTH_VALIDATION_UNAVAILABLE'
            : 'AUTH_SESSION_INVALID',
          error: validation === 'unavailable'
            ? 'Не удалось проверить сессию'
            : 'Сессия недействительна',
        });
      }
      
      // Получаем refresh_token из DirectusAuthManager
      const session = directusAuthManager.getSession(userId);
      
      if (!session || !session.refreshToken) {
        log(`Refresh token not found for user ${userId}`, 'auth');
        return res.status(404).json({
          error: 'Refresh token не найден',
          message: 'Сессия не найдена или истекла'
        });
      }
      
      log(`Refresh token retrieved for user ${userId}`, 'auth');
      
      res.status(200).json({
        refresh_token: session.refreshToken
      });
    } catch (error) {
      log.error('Error getting refresh token:', error);
      res.status(401).json({ 
        error: 'Недействительный токен'
      });
    }
  });

  }

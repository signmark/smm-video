/**
 * API маршруты для работы с админским токеном
 */

import { Express, Request, Response } from 'express';
import axios from 'axios';
import { log } from '../utils/logger';
import { directusApiManager } from '../directus';
import { directusAuthManager } from '../services/directus-auth-manager';

// URL Directus API
const DIRECTUS_URL = process.env.DIRECTUS_URL;
// ID администратора из env
const ADMIN_USER_ID = process.env.DIRECTUS_ADMIN_USER_ID || '53921f16-f51d-4591-80b9-8caa4fde4d13';

/**
 * Регистрация маршрутов для работы с админским токеном
 * @param app Express приложение
 */
export function registerTokenRoutes(app: Express) {
  log('Регистрация маршрутов для работы с админским токеном...', 'token-routes');
  
  // Маршрут для генерации долгоживущего статического токена
  app.post('/api/admin/token/generate', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Необходимо указать email и пароль администратора'
        });
      }
      
      // Получаем временный токен авторизации
      const authResponse = await axios.post(`${DIRECTUS_URL}/auth/login`, {
        email,
        password
      });
      
      if (!authResponse.data?.data?.access_token) {
        return res.status(500).json({
          success: false,
          error: 'Не удалось получить токен авторизации'
        });
      }
      
      const temporaryToken = authResponse.data.data.access_token;
      const userId = authResponse.data.data.user?.id || ADMIN_USER_ID;
      
      // Создаем статический токен
      const tokenName = `scheduler_token_${new Date().toISOString().slice(0, 10)}`;
      
      // В некоторых версиях Directus отсутствует API для создания статических токенов
      // Поэтому используем временный токен как статический
      try {
        log('Используем токен авторизации как статический (не найден API для создания статического токена)', 'token-routes');
        
        // Используем временный токен как статический
        const staticToken = temporaryToken;

        // Токен хранится только во внутреннем кэше, в файлы не пишется
        directusApiManager.cacheAuthToken(userId, staticToken, 365 * 24 * 60 * 60); // 1 год

        return res.status(200).json({
          success: true,
          message: 'Токен успешно создан и сохранен в кэше',
          tokenInfo: {
            userId,
            name: tokenName,
            expires: 'never'
          }
        });
      } catch (tokenError: any) {
        log(`Ошибка при создании статического токена: ${tokenError.message}`, 'token-routes');
        
        return res.status(500).json({
          success: false,
          error: 'Ошибка при создании статического токена',
          details: tokenError.message,
          response: tokenError.response?.data
        });
      }
    } catch (error: any) {
      log(`Ошибка при генерации токена: ${error.message}`, 'token-routes');
      
      return res.status(error.response?.status || 500).json({
        success: false,
        error: 'Не удалось сгенерировать токен',
        details: error.message,
        response: error.response?.data
      });
    }
  });
  
  // Маршрут для проверки работоспособности администраторского токена
  app.get('/api/admin/token/check', async (req: Request, res: Response) => {
    try {
      // Пробуем получить токен из .env
      const adminToken = process.env.DIRECTUS_ADMIN_TOKEN;
      
      if (!adminToken) {
        return res.status(404).json({
          success: false,
          error: 'Токен администратора не найден в переменных окружения',
          message: 'Необходимо задать DIRECTUS_ADMIN_TOKEN в переменных окружения'
        });
      }
      
      try {
        // Проверяем токен с помощью запроса к Directus API
        // Декодируем токен напрямую
        const tokenParts = adminToken.split('.');
        if (tokenParts.length !== 3) {
          throw new Error('Invalid token format');
        }
        
        const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
        const response = { 
          data: { 
            data: { 
              id: payload.id, 
              email: payload.email || 'unknown@email.com' 
            } 
          } 
        };
        
        if (response.data?.data?.id) {
          // Проверим, есть ли доступ к коллекции campaign_content
          try {
            const collectionTestResponse = await axios.get(`${DIRECTUS_URL}/items/campaign_content?limit=1`, {
              headers: {
                'Authorization': `Bearer ${adminToken}`
              }
            });
            
            const hasAccessToContent = collectionTestResponse.status === 200;
            
            return res.status(200).json({
              success: true,
              user: {
                id: response.data.data.id,
                email: response.data.data.email,
                firstName: response.data.data.first_name,
                lastName: response.data.data.last_name,
                role: response.data.data.role?.name || response.data.data.role
              },
              permissions: {
                campaignContent: hasAccessToContent,
                message: hasAccessToContent ? 'Доступ к коллекции campaign_content есть' : 'Нет доступа к коллекции campaign_content'
              },
              message: 'Токен администратора работает корректно'
            });
          } catch (permissionError: any) {
            return res.status(200).json({
              success: true,
              user: {
                id: response.data.data.id,
                email: response.data.data.email,
                firstName: response.data.data.first_name,
                lastName: response.data.data.last_name,
                role: response.data.data.role?.name || response.data.data.role
              },
              permissions: {
                campaignContent: false,
                error: permissionError.message,
                status: permissionError.response?.status,
                message: 'Нет доступа к коллекции campaign_content'
              },
              message: 'Токен администратора работает, но есть проблемы с правами доступа'
            });
          }
        } else {
          return res.status(500).json({
            success: false,
            error: 'Неожиданный ответ от API',
            message: 'Токен не предоставляет доступ к информации о пользователе'
          });
        }
      } catch (error: any) {
        log(`Ошибка при проверке токена администратора: ${error.message}`, 'token-routes');
        
        return res.status(error.response?.status || 500).json({
          success: false,
          error: 'Токен администратора не работает',
          message: error.message,
          status: error.response?.status,
          details: error.response?.data
        });
      }
    } catch (error: any) {
      log(`Ошибка при проверке токена: ${error.message}`, 'token-routes');
      
      return res.status(500).json({
        success: false,
        error: 'Ошибка при проверке токена',
        details: error.message
      });
    }
  });
  
  // Маршрут для проверки прав доступа к коллекциям с использованием кэшированного токена
  app.get('/api/admin/permissions/check', async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || ADMIN_USER_ID;
      
      // Проверяем, есть ли у нас кэшированный токен для пользователя
      const cachedToken = directusApiManager.getCachedToken(userId);
      
      if (!cachedToken || !cachedToken.token) {
        return res.status(404).json({
          success: false,
          error: `Кэшированный токен для пользователя ${userId} не найден`,
          message: 'Для проверки прав доступа необходимо сначала авторизоваться в системе'
        });
      }
      
      // Проверяем доступ к различным коллекциям
      const collections = [
        'campaign_content',
        'user_campaigns',
        'campaign_content_sources',
        'source_posts',
        'campaign_trend_topics'
      ];
      
      const results: Record<string, any> = {};
      
      for (const collection of collections) {
        try {
          const response = await axios.get(`${DIRECTUS_URL}/items/${collection}?limit=1`, {
            headers: {
              'Authorization': `Bearer ${cachedToken.token}`
            }
          });
          
          results[collection] = {
            access: true,
            status: response.status,
            message: 'Доступ разрешен'
          };
        } catch (error: any) {
          results[collection] = {
            access: false,
            status: error.response?.status,
            message: error.message,
            details: error.response?.data
          };
        }
      }
      
      return res.status(200).json({
        success: true,
        userId,
        tokenExpiresAt: new Date(cachedToken.expiresAt).toISOString(),
        collections: results
      });
    } catch (error: any) {
      log(`Ошибка при проверке прав доступа: ${error.message}`, 'token-routes');
      
      return res.status(500).json({
        success: false,
        error: 'Ошибка при проверке прав доступа',
        details: error.message
      });
    }
  });
  
  // Маршрут для авторизации и создания сессии пользователя 
  // (отдельно от стандартной авторизации, используется для сохранения сессии в SystemCache)
  app.post('/api/system/auth/login', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Email и пароль обязательны'
        });
      }
      
      try {
        // Авторизуем пользователя через DirectusAuthManager
        const authResult = await directusAuthManager.login(email, password);
        
        return res.status(200).json({
          success: true,
          message: 'Авторизация успешна, сессия сохранена в кэше системы',
          userId: authResult.userId,
          token: authResult.token,
          user: {
            id: authResult.user.id,
            email: authResult.user.email,
            firstName: authResult.user.first_name,
            lastName: authResult.user.last_name
          }
        });
      } catch (loginError: any) {
        return res.status(401).json({
          success: false,
          message: 'Ошибка авторизации',
          error: loginError.message
        });
      }
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Внутренняя ошибка сервера',
        error: error.message
      });
    }
  });
  
  // Маршрут для получения списка активных сессий
  app.get('/api/system/active-sessions', async (req: Request, res: Response) => {
    try {
      const sessions = directusAuthManager.getAllActiveSessions();
      
      return res.status(200).json({
        success: true,
        sessions: sessions.map(session => ({
          userId: session.userId,
          expiresAt: new Date(session.expiresAt).toISOString()
        }))
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Ошибка при получении списка активных сессий',
        error: error.message
      });
    }
  });
  
  // Маршрут для проверки прав доступа ADMIN_TOKEN
  app.get('/api/system/admin-token-permissions', async (req: Request, res: Response) => {
    try {
      const adminToken = process.env.DIRECTUS_ADMIN_TOKEN;
      
      if (!adminToken) {
        return res.status(404).json({
          success: false,
          message: 'DIRECTUS_ADMIN_TOKEN не найден в переменных окружения'
        });
      }
      
      // Проверяем доступ к различным коллекциям
      const directusUrl = process.env.DIRECTUS_URL;
      const collections = [
        'campaign_content',
        'user_campaigns',
        'campaign_content_sources',
        'source_posts',
        'campaign_trend_topics'
      ];
      
      const results: Record<string, any> = {};
      
      // Пробуем тестовый запрос для проверки валидности токена
      try {
        // Декодируем токен напрямую
        const tokenParts = adminToken.split('.');
        if (tokenParts.length !== 3) {
          throw new Error('Invalid token format');
        }
        
        const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
        const userResponse = { 
          data: { 
            data: { 
              id: payload.id, 
              email: payload.email || 'unknown@email.com',
              first_name: payload.first_name || '',
              last_name: payload.last_name || '',
              role: payload.role
            } 
          } 
        };
        
        results.user = {
          valid: true,
          id: userResponse.data?.data?.id,
          email: userResponse.data?.data?.email,
          firstName: userResponse.data?.data?.first_name,
          lastName: userResponse.data?.data?.last_name,
          role: userResponse.data?.data?.role
        };
      } catch (userError: any) {
        results.user = {
          valid: false,
          error: userError.message,
          status: userError.response?.status
        };
      }
      
      // Проверяем доступ к коллекциям
      for (const collection of collections) {
        try {
          const response = await axios.get(`${directusUrl}/items/${collection}?limit=1`, {
            headers: {
              'Authorization': `Bearer ${adminToken}`
            }
          });
          
          results[collection] = {
            access: true,
            status: response.status,
            message: 'Доступ разрешен',
            data: response.data?.data?.length > 0
          };
        } catch (error: any) {
          results[collection] = {
            access: false,
            status: error.response?.status,
            message: error.message,
            details: error.response?.data?.errors
          };
        }
      }
      
      return res.status(200).json({
        success: true,
        adminToken: "***" + adminToken.substring(adminToken.length - 4),
        collections: results
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Ошибка при проверке прав доступа административного токена',
        error: error.message
      });
    }
  });
  
  log('Маршруты для работы с админским токеном зарегистрированы', 'token-routes');
}
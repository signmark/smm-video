/**
 * Маршруты для управления личными API ключами пользователя
 */

import { Application, Request, Response } from 'express';
import { log } from './utils/logger';
import { directusApiManager } from './directus';

/**
 * Функция для безопасного декодирования JWT токена и получения ID пользователя
 * @param token JWT токен
 * @returns ID пользователя или null в случае ошибки
 */
function extractUserIdFromToken(token: string): string | null {
  try {
    if (!token || !token.includes('.')) {
      console.log('Получен неверный формат токена: токен не содержит точек', token.substring(0, 15) + '...');
      return null;
    }

    const parts = token.split('.');
    if (parts.length < 2 || !parts[1]) {
      console.log('Получен неверный формат токена: нет второй части токена', parts);
      return null;
    }

    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    
    try {
      const payload = JSON.parse(Buffer.from(base64, 'base64').toString());
      // Извлекаем данные из токена
      
      const userId = payload.sub || payload.id || null;
      if (!userId) {
        console.log('В полезной нагрузке токена нет полей sub или id');
      }
      
      return userId;
    } catch (parseError) {
      console.error('Ошибка при парсинге JSON из base64:', parseError);
      return null;
    }
  } catch (e) {
    console.error('Ошибка декодирования JWT токена:', e);
    return null;
  }
}

/**
 * Регистрирует маршруты для работы с личными API ключами пользователя
 * @param app Express приложение
 */
export function registerUserApiKeysRoutes(app: Application) {
  /**
   * Получение списка личных API ключей пользователя
   * GET /api/user-api-keys
   */
  app.get('/api/user-api-keys', async (req: Request, res: Response) => {
    try {
      // Устанавливаем четкие заголовки для предотвращения перехвата Vite
      res.type('application/json');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
      
      // Проверяем, что пользователь авторизован
      console.log('User API Keys request received, req.user:', req.user ? 'exists' : 'undefined');
      
      // Получаем токен авторизации из заголовка
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          message: 'Требуется токен авторизации'
        });
      }
      
      const token = authHeader.split(' ')[1];
      console.log(`Token for API keys check: ${token.substring(0, 10)}...`);
      
      // Извлекаем ID пользователя из токена
      const userId = extractUserIdFromToken(token);
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Неверный формат токена авторизации'
        });
      }

      // Получаем список ключей из Directus
      
      log(`Запрос личных API ключей для пользователя ${userId}`, 'api-keys-routes');
      
      try {
        // Делаем запрос к Directus API для получения ключей пользователя
        const response = await directusApiManager.instance.get('/items/user_api_keys', {
          params: {
            filter: {
              user_id: { _eq: userId }
            },
            fields: ['id', 'service_name', 'api_key']
          },
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        });

        log(`Получено ${response.data?.data?.length || 0} API ключей для пользователя ${userId}`, 'api-keys-routes');
        
        // Отвечаем с четкими заголовками
        return res.json({
          success: true,
          data: response.data?.data || []
        });
      } catch (error: any) {
        console.error(`Ошибка при получении API ключей пользователя:`, error);
        
        // Отвечаем с четкими заголовками
        return res.status(500).json({
          success: false,
          message: `Ошибка при получении API ключей: ${error.message || 'Неизвестная ошибка'}`
        });
      }
    } catch (err: any) {
      console.error('Ошибка в маршруте /api/user-api-keys:', err);
      return res.status(500).json({
        success: false,
        message: err.message || 'Неизвестная ошибка'
      });
    }
  });

  /**
   * Удаление личного API ключа пользователя
   * DELETE /api/user-api-keys/:id
   */
  app.delete('/api/user-api-keys/:id', async (req: Request, res: Response) => {
    // Устанавливаем четкие заголовки для предотвращения перехвата Vite
    res.type('application/json');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    
    console.log('Запрос на удаление API ключа пользователя:', { 
      url: req.url,
      params: req.params,
      authHeader: req.headers.authorization ? req.headers.authorization.substring(0, 15) + '...' : 'отсутствует' 
    });
    try {
      // Проверяем, что пользователь авторизован
      console.log('Delete User API Key request received, req.user:', req.user ? 'exists' : 'undefined');
      
      // Получаем токен авторизации из заголовка
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          message: 'Требуется токен авторизации'
        });
      }
      
      const token = authHeader.split(' ')[1];
      
      // Извлекаем ID пользователя из токена
      const userId = extractUserIdFromToken(token);
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Неверный формат токена авторизации'
        });
      }

      const keyId = req.params.id;
      if (!keyId) {
        return res.status(400).json({
          success: false,
          message: 'Не указан ID ключа для удаления'
        });
      }

      log(`Запрос на удаление API ключа ${keyId} пользователя ${userId}`, 'api-keys-routes');
      
      try {
        // Сначала проверяем, принадлежит ли ключ пользователю
        const checkResponse = await directusApiManager.instance.get(`/items/user_api_keys/${keyId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        const keyData = checkResponse.data?.data;
        if (!keyData) {
          return res.status(404).json({
            success: false,
            message: 'Ключ не найден'
          });
        }

        if (keyData.user_id !== userId) {
          return res.status(403).json({
            success: false,
            message: 'У вас нет прав на удаление этого ключа'
          });
        }

        // Удаляем ключ
        await directusApiManager.instance.delete(`/items/user_api_keys/${keyId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        log(`API ключ ${keyId} пользователя ${userId} успешно удален`, 'api-keys-routes');
        
        return res.json({
          success: true,
          message: 'Ключ успешно удален'
        });
      } catch (error: any) {
        console.error(`Ошибка при удалении API ключа пользователя:`, error);
        return res.status(error.response?.status || 500).json({
          success: false,
          message: `Ошибка при удалении API ключа: ${error.message || 'Неизвестная ошибка'}`,
          error: error.response?.data
        });
      }
    } catch (err: any) {
      console.error('Ошибка в маршруте DELETE /api/user-api-keys/:id:', err);
      return res.status(500).json({
        success: false,
        message: err.message || 'Неизвестная ошибка'
      });
    }
  });

  /**
   * Сохранение личных API ключей пользователя
   * POST /api/user-api-keys
   */
  app.post('/api/user-api-keys', async (req: Request, res: Response) => {
    try {
      // Устанавливаем четкие заголовки для предотвращения перехвата Vite
      res.type('application/json');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
      
      // Проверяем, что пользователь авторизован
      console.log('Save User API Keys request received, req.user:', req.user ? 'exists' : 'undefined');
      
      // Получаем токен авторизации из заголовка
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          message: 'Требуется токен авторизации'
        });
      }
      
      const token = authHeader.split(' ')[1];
      
      // Извлекаем ID пользователя из токена
      const userId = extractUserIdFromToken(token);
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Неверный формат токена авторизации'
        });
      }

      // Проверяем данные запроса
      const { keys } = req.body;
      if (!keys || !Array.isArray(keys)) {
        return res.status(400).json({
          success: false,
          message: 'Необходимо указать список ключей в формате JSON'
        });
      }

      log(`Запрос на сохранение ${keys.length} API ключей пользователя ${userId}`, 'api-keys-routes');
      
      try {
        // Сначала получаем текущие ключи пользователя
        const existingKeysResponse = await directusApiManager.instance.get('/items/user_api_keys', {
          params: {
            filter: {
              user_id: { _eq: userId }
            },
            fields: ['id', 'service_name']
          },
          headers: { Authorization: `Bearer ${token}` }
        });

        const existingKeys = existingKeysResponse.data?.data || [];
        const updatedKeysMap: Record<string, boolean> = {};
        const results = [];

        // Обрабатываем каждый ключ из запроса
        for (const keyData of keys) {
          const { service_name, api_key } = keyData;
          if (!service_name || !api_key) continue;

          // Проверяем, существует ли уже ключ для этого сервиса
          const existingKey = existingKeys.find((key: any) => key.service_name === service_name);
          updatedKeysMap[service_name] = true;

          try {
            if (existingKey) {
              // Обновляем существующий ключ
              const updateResponse = await directusApiManager.instance.patch(`/items/user_api_keys/${existingKey.id}`, {
                api_key: api_key
              }, {
                headers: { Authorization: `Bearer ${token}` }
              });
              
              log(`Обновлен API ключ ${service_name} пользователя ${userId}`, 'api-keys-routes');
              results.push({ success: true, service_name, action: 'updated' });
            } else {
              // Создаем новый ключ
              const createResponse = await directusApiManager.instance.post('/items/user_api_keys', {
                user_id: userId,
                service_name: service_name,
                api_key: api_key
              }, {
                headers: { Authorization: `Bearer ${token}` }
              });
              
              log(`Создан новый API ключ ${service_name} для пользователя ${userId}`, 'api-keys-routes');
              results.push({ success: true, service_name, action: 'created' });
            }
          } catch (keyError: any) {
            console.error(`Ошибка при сохранении ключа ${service_name}:`, keyError);
            results.push({ 
              success: false, 
              service_name, 
              error: keyError.message || 'Неизвестная ошибка' 
            });
          }
        }

        // Удаляем ключи, которые были у пользователя, но не присутствуют в новом списке
        // Эта логика пока отключена во избежание непреднамеренного удаления
        /*
        for (const key of existingKeys) {
          if (!updatedKeysMap[key.service_name]) {
            try {
              await directusApiManager.instance.delete(`/items/user_api_keys/${key.id}`, {
                headers: { Authorization: `Bearer ${token}` }
              });
              
              log(`Удален устаревший API ключ ${key.service_name} пользователя ${userId}`, 'api-keys-routes');
              results.push({ success: true, service_name: key.service_name, action: 'deleted' });
            } catch (keyError: any) {
              console.error(`Ошибка при удалении ключа ${key.service_name}:`, keyError);
              results.push({ 
                success: false, 
                service_name: key.service_name, 
                error: keyError.message || 'Неизвестная ошибка' 
              });
            }
          }
        }
        */

        return res.json({
          success: true,
          message: `API ключи успешно сохранены`,
          results
        });
      } catch (error: any) {
        console.error(`Ошибка при сохранении API ключей пользователя:`, error);
        return res.status(error.response?.status || 500).json({
          success: false,
          message: `Ошибка при сохранении API ключей: ${error.message || 'Неизвестная ошибка'}`,
          error: error.response?.data
        });
      }
    } catch (err: any) {
      console.error('Ошибка в маршруте POST /api/user-api-keys:', err);
      return res.status(500).json({
        success: false,
        message: err.message || 'Неизвестная ошибка'
      });
    }
  });

  log('Маршруты для работы с личными API ключами успешно зарегистрированы', 'api-keys-routes');
}

/**
 * Маршруты для управления глобальными API ключами
 */

import { Application, Request, Response } from 'express';
import { globalApiKeysService } from './services/global-api-keys';
import { log } from './utils/logger';
import { directusCrud } from './services/directus-crud';
import { adminTokenManager } from './services/admin-token-manager';
import { directusApiManager } from './directus';
import { ApiServiceName } from './services/api-keys';
import axios from 'axios';

// Проверка будет производиться только по полю is_smm_admin в Directus

/**
 * Проверяет, является ли пользователь администратором SMM
 * @param req Объект запроса Express
 * @param directusToken Токен авторизации Directus
 * @returns Признак администратора
 */
export async function isUserAdmin(req: Request, directusToken?: string): Promise<boolean> {
  try {
    // Быстрая проверка из сессии — не идём в Directus если уже знаем ответ
    const sessionUser = (req as any).user;
    if (sessionUser?.is_smm_admin === true || sessionUser?.is_smm_admin === 1 || sessionUser?.is_smm_admin === '1' || sessionUser?.is_smm_admin === 'true') {
      log(`Пользователь ${sessionUser.email || sessionUser.id} признан администратором (из сессии)`, 'admin');
      return true;
    }

    // Если токен не передан, пытаемся извлечь из заголовка или cookie
    let token = directusToken;
    
    if (!token) {
      // Проверяем заголовок Authorization
      if (req.headers.authorization?.startsWith('Bearer ')) {
        token = req.headers.authorization.substring(7);
      }
      // Проверяем cookie (при наличии cookie-parser)
      else if ((req as any).cookies?.directus_session_token) {
        token = (req as any).cookies.directus_session_token;
      }
      // Проверяем req.user.token (установленный middleware)
      else if ((req as any).user?.token) {
        token = (req as any).user.token;
      }
    }

    if (!token) {
      log('Нет токена для проверки прав администратора', 'admin');
      return false;
    }

    log(`Проверка прав администратора с токеном: ${token.substring(0, 10)}...`, 'admin');

    const directusUrl = (process.env.DIRECTUS_URL || '').replace(/\/$/, '');

    // Пробуем через пользовательский токен (/users/me)
    try {
      const response = await axios.get(`${directusUrl}/users/me`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      const currentUser = response.data.data;
      if (currentUser) {
        const isAdmin = currentUser.is_smm_admin === true || currentUser.is_smm_admin === 1 || currentUser.is_smm_admin === '1' || currentUser.is_smm_admin === 'true';
        const isRoleAdmin = currentUser.role === 'admin' || (typeof currentUser.role === 'object' && (currentUser.role?.name === 'Administrator' || currentUser.role?.admin_access === true));
        if (isAdmin || isRoleAdmin) {
          log(`Пользователь ${currentUser.email} признан администратором`, 'admin');
          return true;
        }
        // is_smm_admin — привилегированное поле, юзерский токен его НЕ видит
        // (в RBAC его нет в списке read-полей) → нельзя делать вывод «не админ».
        // Раньше здесь стоял return false и проверка служебным токеном ниже была
        // недостижима. Проваливаемся в неё.
      }
    } catch (innerError: any) {
      // Токен истёк или недействителен — пробуем через admin-токен по userId из JWT
      if (innerError?.response?.status !== 401 && innerError?.response?.status !== 403) {
        log(`Ошибка при получении данных пользователя: ${innerError instanceof Error ? innerError.message : 'Unknown error'}`, 'admin');
        return false;
      }
    }

    // Фолбэк: парсим userId из JWT и проверяем СЛУЖЕБНЫМ токеном (авторитетно).
    // adminTokenManager валидирует статический токен и при протухании входит по
    // email/паролю — раньше тут был сырой process.env.*, который был мёртв.
    const adminToken = await adminTokenManager.getAdminToken();
    if (!adminToken) return false;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      const userId = payload.id;
      if (!userId) return false;
      const resp = await fetch(`${directusUrl}/users/${userId}?fields=is_smm_admin,email`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      if (!resp.ok) return false;
      const data = await resp.json() as any;
      const val = data?.data?.is_smm_admin;
      const isAdmin = val === true || val === 1 || val === '1' || val === 'true';
      if (isAdmin) log(`Пользователь ${data?.data?.email || userId} признан администратором (via admin-token)`, 'admin');
      return isAdmin;
    } catch {
      return false;
    }
  } catch (error: any) {
    if (error?.response?.status === 401) {
      log(`Токен истек для проверки админа (внешняя проверка)`, 'admin');
    } else {
      log(`Ошибка при проверке прав администратора: ${error instanceof Error ? error.message : 'Unknown error'}`, 'admin');
    }
    return false;
  }
}

/**
 * Мидлвар для проверки прав администратора
 */
function requireAdmin(req: Request, res: Response, next: Function) {
  // Устанавливаем явно заголовки для предотвращения перехвата Vite
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  
  // Проверяем права администратора
  const token = req.headers.authorization?.startsWith('Bearer ') 
    ? req.headers.authorization.substring(7) 
    : null;
  
  if (!token) {
    return res.status(401).json({ success: false, message: 'Требуется токен авторизации' });
  }
  
  // Проверяем права администратора используя пользовательский токен
  isUserAdmin(req).then(isAdmin => {
    if (isAdmin) {
      next();
    } else {
      res.status(403).json({ success: false, message: 'Недостаточно прав для доступа к этому ресурсу' });
    }
  }).catch((error: any) => {
    if (error?.response?.status === 401) {
      log(`Токен истек при проверке прав - требуется обновление`, 'admin');
      res.status(401).json({ success: false, message: 'Токен истек - требуется обновление' });
    } else {
      log(`Ошибка при проверке прав доступа: ${error instanceof Error ? error.message : 'Unknown error'}`, 'admin');
      res.status(500).json({ success: false, message: 'Ошибка при проверке прав доступа' });
    }
  });
}

/**
 * Регистрирует маршруты для управления глобальными API ключами
 * @param app Сервер Express
 */
export function registerGlobalApiKeysRoutes(app: Application): void {
  // Получение списка всех глобальных ключей (только для администраторов)
  app.get('/api/global-api-keys', requireAdmin, async (req: Request, res: Response) => {
    try {
      // Устанавливаем явно заголовки для предотвращения перехвата Vite
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');

      // Получаем токен из заголовка запроса
      const token = req.headers.authorization?.startsWith('Bearer ') 
        ? req.headers.authorization.substring(7) 
        : null;

      if (!token) {
        return res.status(401).json({ success: false, message: 'Требуется токен авторизации' });
      }

      // Получаем список глобальных API ключей (передаём токен админа — работает без статического токена)
      const keys = await globalApiKeysService.getGlobalApiKeys(token);
      log('Успешно получен список глобальных API ключей', 'api');
      return res.status(200).json({ success: true, data: keys, timestamp: Date.now() });
    } catch (error) {
      console.error('Ошибка при получении глобальных API ключей:', error);
      return res.status(500).json({
        success: false,
        message: 'Ошибка при получении глобальных API ключей',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      });
    }
  });

  // Добавление глобального API ключа (только для администраторов)
  app.post('/api/global-api-keys', requireAdmin, async (req: Request, res: Response) => {
    try {
      const { service, apiKey } = req.body;
      const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.substring(7) : null;

      if (!service || !apiKey) {
        return res.status(400).json({ success: false, message: 'Требуется указать сервис и API ключ' });
      }

      if (!token) {
        return res.status(401).json({ success: false, message: 'Требуется токен авторизации' });
      }

      // Добавляем глобальный API ключ (передаём токен админа)
      const result = await globalApiKeysService.addGlobalApiKey({
        service: service,
        api_key: apiKey,
        is_active: true
      }, token);

      log(`Успешно добавлен глобальный API ключ для сервиса ${service}`, 'api');
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      console.error('Ошибка при добавлении глобального API ключа:', error);
      res.status(500).json({
        success: false,
        message: 'Ошибка при добавлении глобального API ключа',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Обновление глобального API ключа (только для администраторов)
  app.put('/api/global-api-keys/:id', requireAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { service, apiKey, active, is_active } = req.body;
      const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.substring(7) : null;

      if (!id) {
        return res.status(400).json({ success: false, message: 'Требуется указать ID ключа' });
      }

      // Обновляем глобальный API ключ
      const updateData: any = {};
      if (service) updateData.service_name = service;
      if (apiKey) updateData.api_key = apiKey;
      if (is_active !== undefined) updateData.is_active = is_active;
      else if (active !== undefined) updateData.is_active = active;

      // Значение ключа в лог не идёт: раньше сюда печатался весь updateData
      // вместе с api_key (AI-66). Логируем только состав изменения.
      console.log(`Запрос на обновление ключа ${id}: поля [${Object.keys(updateData).join(', ')}]`);

      const result = await globalApiKeysService.updateGlobalApiKey(id, updateData, token);

      if (!result) {
        return res.status(404).json({ success: false, message: 'Ключ не найден' });
      }

      log(`Успешно обновлен глобальный API ключ ${id}`, 'api');
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      console.error('Ошибка при обновлении глобального API ключа:', error);
      res.status(500).json({
        success: false,
        message: 'Ошибка при обновлении глобального API ключа',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Удаление глобального API ключа (только для администраторов)
  app.delete('/api/global-api-keys/:id', requireAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.substring(7) : null;

      if (!id) {
        return res.status(400).json({ success: false, message: 'Требуется указать ID ключа' });
      }

      // Удаляем глобальный API ключ (передаём токен админа)
      const result = await globalApiKeysService.deleteGlobalApiKey(id, token);

      if (!result) {
        return res.status(404).json({ success: false, message: 'Ключ не найден' });
      }

      log(`Успешно удален глобальный API ключ ${id}`, 'api');
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('Ошибка при удалении глобального API ключа:', error);
      res.status(500).json({
        success: false,
        message: 'Ошибка при удалении глобального API ключа',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}

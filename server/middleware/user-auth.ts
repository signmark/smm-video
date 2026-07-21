import { Request, Response, NextFunction } from 'express';
import { directusApiManager } from '../directus';
import { validateDirectusSession } from '../services/directus-session-validator';

const adminStatusCache = new Map<string, { is_smm_admin: boolean; cachedAt: number }>();
const ADMIN_CACHE_TTL = 30 * 1000;

async function fetchAdminStatus(userId: string): Promise<boolean> {
  const cached = adminStatusCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < ADMIN_CACHE_TTL) {
    return cached.is_smm_admin;
  }

  // Admin privilege is authoritative data. Never repopulate this cache from the
  // long-lived session snapshot because demotion must take effect within the TTL.
  try {
    const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN;
    if (!adminToken) {
      console.error('[user-auth] fetchAdminStatus: нет admin-токена в env');
      return false;
    }
    const directusUrl = (process.env.DIRECTUS_URL || '').replace(/\/$/, '');
    const url = `${directusUrl}/users/${userId}?fields=is_smm_admin`;
    console.log(`[user-auth] fetchAdminStatus: GET ${url}`);
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${adminToken}` },
      signal: AbortSignal.timeout(5_000),
    });
    console.log(`[user-auth] fetchAdminStatus: status=${resp.status}`);
    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[user-auth] fetchAdminStatus: ошибка ${resp.status}: ${errText}`);
      return false;
    }
    const data = await resp.json() as any;
    const val = data?.data?.is_smm_admin;
    console.log(`[user-auth] fetchAdminStatus: userId=${userId}, is_smm_admin=${val}`);
    const isAdmin = val === true || val === 1 || val === '1' || val === 'true';
    adminStatusCache.set(userId, { is_smm_admin: isAdmin, cachedAt: Date.now() });
    return isAdmin;
  } catch (e: any) {
    console.error('[user-auth] fetchAdminStatus: исключение:', e?.message);
    return false;
  }
}

export const authenticateUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    const cookieToken = req.cookies?.directus_session_token;

    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (cookieToken) {
      token = cookieToken;
    }

    if (!token) {
      return res.status(401).json({ error: 'Не авторизован: Отсутствует токен авторизации' });
    }

    try {
      if (token === process.env.DIRECTUS_STATIC_TOKEN || token === process.env.DIRECTUS_TOKEN || token === process.env.DIRECTUS_ADMIN_TOKEN) {
        const realAdminId = 'fcae6ef5-8a6d-4ffd-a39a-58c5bda176e4';
        req.user = {
          id: realAdminId,
          token: token,
          email: 'lbrspb@gmail.com',
          firstName: 'Admin',
          lastName: 'NPlanner',
          is_smm_admin: true
        };
        (req as any).userId = realAdminId;
        next();
        return;
      }

      if (!token.includes('.')) {
        return res.status(401).json({ error: 'Не авторизован: Неверный формат токена' });
      }

      const tokenParts = token.split('.');
      if (tokenParts.length !== 3) {
        return res.status(401).json({ error: 'Не авторизован: Неверный формат токена' });
      }

      try {
        const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
        const userId = payload.id;

        if (!userId) {
          return res.status(401).json({ error: 'Не авторизован: Отсутствует ID пользователя в токене' });
        }

        const currentTime = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp <= currentTime) {
          return res.status(401).json({
            code: 'AUTH_SESSION_INVALID',
            error: 'Сессия истекла',
            expired: true,
          });
        }

        const sessionValidation = await validateDirectusSession(token);
        if (sessionValidation === 'invalid') {
          return res.status(401).json({
            code: 'AUTH_SESSION_INVALID',
            error: 'Сессия недействительна',
          });
        }
        if (sessionValidation === 'unavailable') {
          return res.status(503).json({
            code: 'AUTH_VALIDATION_UNAVAILABLE',
            error: 'Не удалось проверить сессию',
          });
        }

        const isAdmin = await fetchAdminStatus(userId);
        req.user = {
          id: userId,
          token: token,
          email: payload.email || '',
          firstName: payload.first_name || '',
          lastName: payload.last_name || '',
          is_smm_admin: isAdmin
        };
        (req as any).userId = userId;

        const expiresAt = payload.exp ? payload.exp * 1000 : Date.now() + (15 * 60 * 1000);
        directusApiManager.cacheAuthToken(userId, token, Math.floor((expiresAt - Date.now()) / 1000));

        next();
      } catch (e) {
        console.error('[AUTH] Ошибка декодирования токена:', e);
        return res.status(401).json({ error: 'Не авторизован: Ошибка валидации токена' });
      }
    } catch (error) {
      console.error('[AUTH] Критическая ошибка middleware:', error);
      return res.status(500).json({ error: 'Внутренняя ошибка сервера при авторизации' });
    }
  } catch (globalError) {
    console.error('[AUTH] Глобальная ошибка middleware:', globalError);
    next(globalError);
  }
};

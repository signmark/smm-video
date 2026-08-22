import { Request, Response, NextFunction } from 'express';
import { getRequiredServiceUrl } from "../config/service-urls";
import { directusApiManager } from '../directus';
import { validateDirectusSession } from '../services/directus-session-validator';
import { adminTokenManager } from '../services/admin-token-manager';
import { log } from '../utils/logger';
import { enrichRequestContext } from '../utils/request-context';

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
    // Служебный токен через менеджер: он валидирует статический токен и при
    // протухании входит по email/паролю. Раньше здесь брался сырой
    // process.env.DIRECTUS_STATIC_TOKEN — когда он протух, is_smm_admin у ВСЕХ
    // приходил false, и админка (список пользователей и т.п.) отдавала 403.
    const adminToken = await adminTokenManager.getAdminToken();
    if (!adminToken) {
      log.error('[user-auth] fetchAdminStatus: не удалось получить служебный токен');
      return false;
    }
    const directusUrl = (getRequiredServiceUrl('DIRECTUS_URL')).replace(/\/$/, '');
    const url = `${directusUrl}/users/${userId}?fields=is_smm_admin`;
    log.debug(`[user-auth] fetchAdminStatus: GET ${url}`);
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${adminToken}` },
      signal: AbortSignal.timeout(5_000),
    });
    log.debug(`[user-auth] fetchAdminStatus: status=${resp.status}`);
    if (!resp.ok) {
      const errText = await resp.text();
      log.error(`[user-auth] fetchAdminStatus: ошибка ${resp.status}: ${errText}`);
      return false;
    }
    const data = await resp.json() as any;
    const val = data?.data?.is_smm_admin;
    log.debug(`[user-auth] fetchAdminStatus: userId=${userId}, is_smm_admin=${val}`);
    const isAdmin = val === true || val === 1 || val === '1' || val === 'true';
    adminStatusCache.set(userId, { is_smm_admin: isAdmin, cachedAt: Date.now() });
    return isAdmin;
  } catch (e: any) {
    log.error('[user-auth] fetchAdminStatus: исключение:', e?.message);
    return false;
  }
}

/**
 * Гейт для admin-only операций. Ставить ПОСЛЕ authenticateUser.
 * Источник истины — req.user.is_smm_admin, который authenticateUser
 * заполняет из Directus (fetchAdminStatus) или static-token пути.
 */
export const requireSmmAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.is_smm_admin === true) {
    return next();
  }
  return res.status(403).json({
    error: 'Доступ запрещён: требуются права администратора',
  });
};

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
      if (token === process.env.DIRECTUS_STATIC_TOKEN || token === process.env.DIRECTUS_STATIC_TOKEN || token === process.env.DIRECTUS_STATIC_TOKEN) {
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
        enrichRequestContext({ userId: realAdminId }); // AI-65: кто сделал запрос (наш санкционированный admin)
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
        enrichRequestContext({ userId }); // AI-65: в журнал идёт, чей это запрос (после успешной проверки сессии)

        const expiresAt = payload.exp ? payload.exp * 1000 : Date.now() + (15 * 60 * 1000);
        directusApiManager.cacheAuthToken(userId, token, Math.floor((expiresAt - Date.now()) / 1000));

        next();
      } catch (e) {
        log.error('[AUTH] Ошибка декодирования токена:', e);
        return res.status(401).json({ error: 'Не авторизован: Ошибка валидации токена' });
      }
    } catch (error) {
      log.error('[AUTH] Критическая ошибка middleware:', error);
      return res.status(500).json({ error: 'Внутренняя ошибка сервера при авторизации' });
    }
  } catch (globalError) {
    log.error('[AUTH] Глобальная ошибка middleware:', globalError);
    next(globalError);
  }
};

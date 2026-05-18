import { Request, Response, NextFunction } from 'express';
import { directusApi, directusApiManager } from '../directus';

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
          lastName: 'NPlanner'
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
        if (payload.exp && payload.exp < currentTime) {
          try {
            const { directusAuthManager } = await import('../services/directus-auth-manager');
            const refreshedSession = await directusAuthManager.refreshSession(userId);

            if (refreshedSession && refreshedSession.token) {
              req.user = {
                id: userId,
                token: refreshedSession.token,
                email: payload.email || '',
                firstName: payload.first_name || '',
                lastName: payload.last_name || ''
              };
              (req as any).userId = userId;
              next();
              return;
            }
          } catch (refreshError) {
            console.error('[AUTH] Ошибка обновления токена:', refreshError);
          }

          return res.status(401).json({ error: 'Не авторизован: Токен истек и требует обновления' });
        }

        req.user = {
          id: userId,
          token: token,
          email: payload.email || '',
          firstName: payload.first_name || '',
          lastName: payload.last_name || ''
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

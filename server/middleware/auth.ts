/**
 * Промежуточное ПО для аутентификации
 *
 * NOTE о JWT verify: токены выданы Directus. Секрет Directus недоступен в этом приложении —
 * полная верификация подписи происходит на стороне Directus при каждом API-запросе.
 * Здесь мы только извлекаем user ID из payload для маршрутизации запросов.
 * Критичные операции всегда проверяют токен через Directus API (getDirectusUser, getItems и т.п.).
 */
import { Request, Response, NextFunction } from 'express';
import { log } from '../utils/logger';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
    if (req.user) {
        return next();
    }

    const authHeader = req.headers['authorization'];

    if (!authHeader) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized: No authorization token provided'
        });
    }

    const token = authHeader.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized: Invalid token format'
        });
    }

    // Статический административный токен Directus
    if (token === process.env.DIRECTUS_TOKEN) {
        req.user = { id: 'admin-directus-token', token };
        return next();
    }

    try {
        if (!token.includes('.')) {
            throw new Error('Token is not a valid JWT format');
        }

        const base64Payload = token.split('.')[1];
        if (!base64Payload) {
            throw new Error('Invalid JWT structure - missing payload');
        }

        const payload = JSON.parse(Buffer.from(base64Payload, 'base64').toString());

        req.user = {
            id: payload.id || 'authenticated-user',
            token,
        };

        log(`User authenticated: ${req.user.id}`, 'auth-middleware');
        return next();
    } catch (error) {
        log(`Authentication error: ${(error as Error).message}`, 'auth-middleware');
        return res.status(401).json({
            success: false,
            error: 'Unauthorized: Invalid token'
        });
    }
}

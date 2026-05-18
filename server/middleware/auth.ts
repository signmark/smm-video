/**
 * Промежуточное ПО для аутентификации
 */
import { Request, Response, NextFunction } from 'express';
import { log } from '../utils/logger';

/**
 * Промежуточное ПО для проверки аутентификации запросов
 * @param req Express запрос
 * @param res Express ответ
 * @param next Функция для продолжения цепочки обработки запроса
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
    // Если есть объект пользователя в запросе, значит пользователь аутентифицирован
    if (req.user) {
        return next();
    }

    // Проверяем заголовок авторизации
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

    // Специальная обработка для DIRECTUS_TOKEN (статический админский токен)
    if (token === process.env.DIRECTUS_TOKEN) {
        req.user = {
            id: 'admin-directus-token',
            token: token
        };
        
        console.log('[DEV] [auth-middleware] Admin authenticated via DIRECTUS_TOKEN');
        return next();
    }

    try {
        // Декодируем JWT токен для получения реального user ID
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
            token: token
        };
        
        console.log('[DEV] [auth-middleware] User authenticated:', req.user.id);
        return next();
    } catch (error) {
        log(`Authentication error: ${(error as Error).message}`, 'auth-middleware');
        return res.status(401).json({ 
            success: false, 
            error: 'Unauthorized: Invalid token' 
        });
    }
}
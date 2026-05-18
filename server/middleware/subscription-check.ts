import { Request, Response, NextFunction } from 'express';
import { DirectusCrud } from '../services/directus-crud';

const directusCrud = new DirectusCrud();

interface AuthenticatedRequest extends Request {
  user?: any;
}

/**
 * Middleware для проверки статуса подписки пользователя
 * Блокирует доступ к функциям для пользователей с истекшей подпиской
 */
export const checkSubscription = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Не авторизован',
        message: 'Требуется токен авторизации'
      });
    }

    const token = authHeader.substring(7);
    
    // Получаем данные пользователя из Directus
    const userData = await directusCrud.getUserByToken(token);
    
    if (!userData) {
      return res.status(401).json({ 
        error: 'Недействительный токен',
        message: 'Требуется повторная авторизация'
      });
    }

    // Администраторы имеют безлимитный доступ
    if (userData.is_smm_admin) {
      req.user = userData;
      return next();
    }

    // Проверяем подписку
    if (userData.expire_date) {
      const now = new Date();
      const expireDate = new Date(userData.expire_date);
      
      if (expireDate <= now) {
        return res.status(403).json({
          error: 'Подписка истекла',
          message: 'Ваша подписка истекла. Обратитесь к администратору для продления.',
          expireDate: expireDate.toISOString(),
          subscriptionExpired: true
        });
      }
    }

    req.user = userData;
    next();
  } catch (error) {
    console.error('Ошибка при проверке подписки:', error);
    res.status(500).json({ 
      error: 'Внутренняя ошибка сервера',
      message: 'Не удалось проверить статус подписки'
    });
  }
};

/**
 * Middleware для проверки подписки с предупреждением
 * Позволяет доступ, но добавляет информацию о статусе подписки
 */
export const checkSubscriptionWithWarning = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.substring(7);
    const userData = await directusCrud.getUserByToken(token);
    
    if (userData && userData.expire_date && !userData.is_smm_admin) {
      const now = new Date();
      const expireDate = new Date(userData.expire_date);
      const timeDiff = expireDate.getTime() - now.getTime();
      const daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24));
      
      // Добавляем информацию о подписке в заголовки ответа
      res.set('X-Subscription-Status', daysLeft <= 0 ? 'expired' : 'active');
      res.set('X-Subscription-Days-Left', daysLeft.toString());
      res.set('X-Subscription-Expire-Date', expireDate.toISOString());
    }

    req.user = userData;
    next();
  } catch (error) {
    console.error('Ошибка при проверке подписки с предупреждением:', error);
    next();
  }
};
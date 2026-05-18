/**
 * Middleware для проверки администраторских прав
 */
import { Request, Response, NextFunction } from 'express';
import { isUserAdmin } from '../routes-global-api-keys';
import { log } from '../utils/logger';

/**
 * Middleware для проверки прав администратора SMM
 * Требует предварительной аутентификации через authMiddleware
 */
export async function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    // Проверяем что пользователь аутентифицирован
    if (!req.user?.token) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication required' 
      });
    }

    // Проверяем администраторские права
    const isAdmin = await isUserAdmin(req);
    
    if (!isAdmin) {
      log(`Access denied for user ${req.user.id} - not an admin`, 'admin-middleware');
      return res.status(403).json({ 
        success: false, 
        error: 'Admin privileges required' 
      });
    }

    log(`Admin access granted for user ${req.user.id}`, 'admin-middleware');
    next();
  } catch (error) {
    log(`Admin check error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'admin-middleware');
    return res.status(500).json({ 
      success: false, 
      error: 'Error checking admin privileges' 
    });
  }
}

/**
 * Middleware для проверки обычной аутентификации (для просмотра tutorials)
 * Любой аутентифицированный пользователь может просматривать
 */
export function authenticatedMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.token) {
    return res.status(401).json({ 
      success: false, 
      error: 'Authentication required' 
    });
  }
  
  next();
}
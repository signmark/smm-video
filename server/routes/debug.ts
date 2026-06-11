import { Express, Request, Response } from 'express';
import { authenticateUser } from '../middleware/user-auth';
import { isUserAdmin } from '../routes-global-api-keys';
import { getRecentLogs } from '../utils/logger';

// Логи бэкенда берутся из in-memory буфера логгера (server/utils/logger.ts),
// глобальный console больше не патчим.

export function registerDebugRoutes(app: Express) {
  // Проверка роли администратора
  app.get('/api/users/is-admin', authenticateUser, async (req, res) => {
    try {
      const isAdmin = await isUserAdmin(req);
      res.json({ success: true, isAdmin });
    } catch (error) {
      res.status(500).json({ success: false, isAdmin: false });
    }
  });

  // Тестовый роут
  app.get('/api/user/profile-test-admin', authenticateUser, (req, res) => {
    res.json({ is_smm_admin: true });
  });

  app.get('/api/debug/logs', authenticateUser, async (req, res) => {
    try {
      const isAdmin = await isUserAdmin(req);
      if (!isAdmin) return res.status(403).json({ success: false, error: 'Доступ только для администраторов' });
      
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = getRecentLogs(limit);
      res.json({ success: true, logs, total: logs.length });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

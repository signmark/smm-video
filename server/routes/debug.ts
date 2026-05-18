import { Express, Request, Response } from 'express';
import { authenticateUser } from '../middleware/user-auth';
import { isUserAdmin } from '../routes-global-api-keys';

// API для получения логов бэкенда (только для админов)
let backendLogs: string[] = [];
const MAX_LOGS = 100;

// Перехватываем console.log для сбора логов
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = function(...args) {
  const timestamp = new Date().toISOString().substring(11, 19);
  const logMessage = `[${timestamp}] ${args.join(' ')}`;
  backendLogs.push(logMessage);
  if (backendLogs.length > MAX_LOGS) backendLogs.shift();
  originalConsoleLog.apply(console, args);
};

console.error = function(...args) {
  const timestamp = new Date().toISOString().substring(11, 19);
  const logMessage = `[${timestamp}] ERROR: ${args.join(' ')}`;
  backendLogs.push(logMessage);
  if (backendLogs.length > MAX_LOGS) backendLogs.shift();
  originalConsoleError.apply(console, args);
};

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
      res.json({ success: true, logs: backendLogs.slice(-limit), total: backendLogs.length });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

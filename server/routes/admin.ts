import { Express, Request, Response } from 'express';
import { authenticateUser } from '../middleware/user-auth';
import { directusApi, directusApiManager } from '../directus';
import { isUserAdmin } from '../routes-global-api-keys';
import { directusAuthManager } from '../services/directus-auth-manager';

export function registerAdminRoutes(app: Express) {
  // Роут создания роли SMM Manager User
  app.post('/api/admin/create-smm-role', authenticateUser, async (req: Request, res: Response) => {
    try {
      console.log('[admin] Creating SMM Manager User role via Directus API...');
      
      const adminToken = await directusAuthManager.getValidAdminToken();
      if (!adminToken) {
        return res.status(500).json({ success: false, error: 'Не удалось получить токен администратора' });
      }

      const roleId = 'b3a6187c-8004-4d2c-91d7-417ecc0b113e';
      
      try {
        const existingRoleResponse = await directusApiManager.get(`/roles/${roleId}`, {
          headers: { Authorization: `Bearer ${adminToken}` }
        });
        return res.json({ success: true, message: 'Роль уже существует', role: existingRoleResponse.data.data });
      } catch (error: any) {
        if (error.response?.status !== 403 && error.response?.status !== 404) throw error;
      }

      const roleData = {
        id: roleId,
        name: 'SMM Manager User',
        description: 'Обычный пользователь SMM системы с базовыми правами',
        admin_access: false,
        app_access: true
      };

      const createRoleResponse = await directusApiManager.post('/roles', roleData, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });

      const permissions = [
        { collection: 'business_questionnaire', action: 'create' },
        { collection: 'business_questionnaire', action: 'read' },
        { collection: 'business_questionnaire', action: 'update' },
        { collection: 'business_questionnaire', action: 'delete' },
        { collection: 'campaign_content', action: 'create' },
        { collection: 'campaign_content', action: 'read' },
        { collection: 'campaign_content', action: 'update' },
        { collection: 'campaign_content', action: 'delete' },
        { collection: 'campaign_content_sources', action: 'create' },
        { collection: 'campaign_content_sources', action: 'read' },
        { collection: 'campaign_content_sources', action: 'update' },
        { collection: 'campaign_content_sources', action: 'delete' },
        { collection: 'campaign_keywords', action: 'create' },
        { collection: 'campaign_keywords', action: 'read' },
        { collection: 'campaign_keywords', action: 'update' },
        { collection: 'campaign_keywords', action: 'delete' },
        { collection: 'campaign_trend_topics', action: 'create' },
        { collection: 'campaign_trend_topics', action: 'read' },
        { collection: 'campaign_trend_topics', action: 'update' },
        { collection: 'campaign_trend_topics', action: 'delete' },
        { collection: 'directus_users', action: 'read' }
      ];

      for (const permission of permissions) {
        try {
          await directusApiManager.post('/permissions', { role: roleId, ...permission }, {
            headers: { Authorization: `Bearer ${adminToken}` }
          });
        } catch (permError: any) {
          console.log(`[admin] Warning: Failed to create permission ${permission.collection}:${permission.action}`);
        }
      }

      return res.json({ success: true, message: 'Роль создана успешно', role: createRoleResponse.data.data });
    } catch (error: any) {
      console.error('[admin] Error creating role:', error.response?.data || error.message);
      return res.status(500).json({ success: false, error: 'Ошибка при создании роли' });
    }
  });

  // API управления пользователями
  app.get('/api/admin/users', authenticateUser, async (req: Request, res: Response) => {
    try {
      if (!req.user?.is_smm_admin) {
        const isAdmin = await isUserAdmin(req);
        if (!isAdmin) return res.status(403).json({ error: 'Доступ запрещен' });
      }

      const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN;
      if (!adminToken) return res.status(500).json({ success: false, error: 'Ошибка конфигурации' });

      const response = await directusApi.get('/users', {
        params: {
          fields: 'id,email,first_name,last_name,is_smm_admin,expire_date,last_access,status,plan',
          sort: '-last_access',
          limit: 100
        },
        headers: { Authorization: `Bearer ${adminToken}` }
      });

      res.json({ success: true, data: response.data.data });
    } catch (error: any) {
      console.error('[admin-users] Error:', error.response?.data || error.message);
      res.status(500).json({ success: false, error: 'Ошибка получения пользователей' });
    }
  });

  app.patch('/api/admin/users/:userId', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { userId: targetUserId } = req.params;

      const isAdmin = await isUserAdmin(req);
      if (!isAdmin) return res.status(403).json({ error: 'Доступ запрещен' });

      const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN;
      if (!adminToken) return res.status(500).json({ error: 'Ошибка конфигурации' });

      const response = await directusApi.patch(`/users/${targetUserId}`, req.body, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });

      res.json({ success: true, data: response.data.data });
    } catch (error: any) {
      console.error('[admin-users] Error:', error.response?.data || error.message);
      res.status(500).json({ error: 'Ошибка обновления пользователя' });
    }
  });
}

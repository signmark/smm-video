import { Express, Request, Response } from 'express';
import { detectEnvironment } from '../utils/environment-detector';
import { authenticateUser } from '../middleware/user-auth';

export function registerUserRoutes(app: Express) {
  app.get('/api/user/profile', authenticateUser, async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Отсутствует ID пользователя' });
      }

      let userData: any = null;

      const profileFields = 'id,email,first_name,last_name,is_smm_admin,is_smm_super,plan,n';

      // Всегда используем admin-токен для получения полного профиля —
      // пользовательский токен Directus может возвращать пустые кастомные поля (plan, n)
      // из-за ограничений политики доступа роли.
      const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN;
      if (!adminToken) {
        return res.status(500).json({ error: 'Ошибка конфигурации сервера' });
      }

      try {
        const { directusUrl } = detectEnvironment();
        const url = `${directusUrl}/users/${userId}?fields=${profileFields}`;
        const adminResponse = await fetch(url, {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        if (!adminResponse.ok) {
          console.error(`[user/profile] Admin fetch failed for ${userId}: HTTP ${adminResponse.status}`);
        } else {
          const json = await adminResponse.json() as any;
          userData = json?.data;
        }
      } catch (adminErr: any) {
        console.error(`[user/profile] Admin fetch error for ${userId}:`, adminErr?.message);
      }

      if (!userData) {
        console.error(`[user/profile] userData null for ${userId}`);
        return res.status(404).json({ error: 'Пользователь не найден' });
      }

      const userProfile = {
        id: userData.id,
        email: userData.email || '',
        first_name: userData.first_name || '',
        last_name: userData.last_name || '',
        is_smm_admin: userData.is_smm_admin || userData.is_smm_super || false,
        plan: userData.plan || 'basic',
        expire_date: userData.n || null,
      };

      res.json(userProfile);

    } catch (error: any) {
      console.error('❌ Error getting user profile:', error?.response?.status, error?.message);
      if (error?.response?.status === 401) {
        res.status(401).json({ error: 'Неверный токен авторизации' });
      } else {
        res.status(500).json({ error: 'Ошибка получения профиля пользователя' });
      }
    }
  });

  app.put('/api/user/profile', authenticateUser, async (req: Request, res: Response) => {
    try {
      const token = req.user?.token;
      const userId = req.user?.id;
      if (!token || !userId) {
        return res.status(401).json({ error: 'Отсутствует токен авторизации' });
      }

      const updateData = req.body;

      if (!updateData.first_name || !updateData.email) {
        return res.status(400).json({ error: 'Имя и email обязательны для заполнения' });
      }

      const directusUpdateData: any = {
        first_name: updateData.first_name.trim(),
        last_name: updateData.last_name?.trim() || '',
        email: updateData.email.trim()
      };

      if (updateData.new_password && updateData.new_password.trim()) {
        if (updateData.new_password.length < 6) {
          return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
        }
        directusUpdateData.password = updateData.new_password;
      }

      // Пробуем обновить через пользовательский токен
      let userData: any = null;
      try {
        const userResponse = await directusApi.patch('/users/me', directusUpdateData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        userData = userResponse.data?.data;
      } catch (userErr: any) {
        // Fallback: admin токен
        const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN;
        if (adminToken) {
          const adminResponse = await directusApi.patch(`/users/${userId}`, directusUpdateData, {
            headers: { Authorization: `Bearer ${adminToken}` }
          });
          userData = adminResponse.data?.data;
        } else {
          throw userErr;
        }
      }

      const updatedProfile = {
        id: userData.id,
        email: userData.email || '',
        first_name: userData.first_name || '',
        last_name: userData.last_name || '',
        is_smm_admin: userData.is_smm_admin || userData.is_smm_super || false
      };

      res.json({ success: true, data: updatedProfile });

    } catch (error: any) {
      console.error('❌ Error updating user profile:', error?.response?.status, error?.message);
      if (error?.response?.status === 401) {
        res.status(401).json({ error: 'Неверный токен авторизации' });
      } else if (error?.response?.status === 400) {
        const errorMessage = error?.response?.data?.errors?.[0]?.message || 'Ошибка валидации данных';
        res.status(400).json({ error: errorMessage });
      } else {
        res.status(500).json({ error: 'Ошибка обновления профиля пользователя' });
      }
    }
  });
}

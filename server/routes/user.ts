import { Express, Request, Response } from 'express';
import { detectEnvironment } from '../utils/environment-detector';
import { authenticateUser } from '../middleware/user-auth';
import { getEffectivePlan } from '../services/plan-limits';
import { directusApi } from '../directus';
import { invalidateUserResetTokens } from '../utils/password-reset-tokens';
import { verifyCurrentPassword } from '../utils/verify-current-password';
import { requestEmailChange } from '../api/email-change';

export function registerUserRoutes(app: Express) {
  app.get('/api/user/profile', authenticateUser, async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Отсутствует ID пользователя' });
      }

      let userData: any = null;

      const profileFields = 'id,email,first_name,last_name,is_smm_admin,is_smm_super,plan,expire_date';

      // Всегда используем admin-токен для получения полного профиля —
      // пользовательский токен Directus может возвращать пустые кастомные поля (plan, expire_date)
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
        // Просроченная подписка → эффективный тариф free; админам оставляем как есть.
        plan: (userData.is_smm_admin || userData.is_smm_super)
          ? (userData.plan || 'basic')
          : getEffectivePlan(userData.plan, userData.expire_date),
        expire_date: userData.expire_date || null,
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

      const requestedEmail = String(updateData.email).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedEmail)) {
        return res.status(400).json({ error: 'Некорректный email' });
      }

      const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN;
      if (!adminToken) {
        return res.status(500).json({ error: 'Ошибка конфигурации сервера' });
      }

      // Текущий адрес читаем из Directus, а НЕ из тела запроса и не из JWT:
      // и то и другое подконтрольно вызывающему, а именно текущим адресом мы
      // проверяем пароль и на него же шлём предупреждение.
      const { directusUrl } = detectEnvironment();
      const currentResp = await fetch(`${directusUrl}/users/${userId}?fields=id,email,first_name`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (!currentResp.ok) {
        console.error(`[user/profile PUT] Не удалось прочитать текущий профиль ${userId}: HTTP ${currentResp.status}`);
        return res.status(500).json({ error: 'Ошибка обновления профиля пользователя' });
      }
      const currentUser = ((await currentResp.json()) as any)?.data;
      if (!currentUser?.email) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }
      const currentEmail = String(currentUser.email);

      const newPassword = typeof updateData.new_password === 'string' ? updateData.new_password.trim() : '';
      const wantsPasswordChange = newPassword.length > 0;
      const wantsEmailChange = requestedEmail.toLowerCase() !== currentEmail.toLowerCase();

      if (wantsPasswordChange && newPassword.length < 6) {
        return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
      }

      // ── Две самые чувствительные операции профиля требуют текущий пароль ──
      // Без этого одного украденного токена сессии хватало, чтобы забрать
      // аккаунт целиком: сменить пароль, не зная старого, и переписать почту
      // на свою. Законный владелец терял и вход, и восстановление.
      if (wantsPasswordChange || wantsEmailChange) {
        const currentPassword = typeof updateData.current_password === 'string' ? updateData.current_password : '';
        if (!currentPassword) {
          return res.status(400).json({
            code: 'CURRENT_PASSWORD_REQUIRED',
            error: 'Для смены пароля или почты введите текущий пароль',
          });
        }

        // verifyCurrentPassword бросает при недоступности Directus — это
        // осознанно: 500 лучше, чем «пароль неверный» или, тем более,
        // молчаливый пропуск.
        const passwordOk = await verifyCurrentPassword(currentEmail, currentPassword);
        if (!passwordOk) {
          // Именно 403 и НЕ код AUTH_SESSION_INVALID: на 401 клиентский
          // throwIfResNotOk делает forceLogout, и опечатка в текущем пароле
          // выкидывала бы пользователя из приложения.
          return res.status(403).json({
            code: 'CURRENT_PASSWORD_INVALID',
            error: 'Текущий пароль указан неверно',
          });
        }
      }

      // Строгий белый список полей. Раньше сюда же попадал email — теперь
      // почта меняется только через подтверждение по ссылке и в этот PATCH
      // не входит вообще.
      const directusUpdateData: any = {
        first_name: String(updateData.first_name).trim(),
        last_name: updateData.last_name?.trim() || '',
      };
      if (wantsPasswordChange) {
        directusUpdateData.password = newPassword;
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
        const adminResponse = await directusApi.patch(`/users/${userId}`, directusUpdateData, {
          headers: { Authorization: `Bearer ${adminToken}` }
        });
        userData = adminResponse.data?.data;
      }

      // Пароль сменили из профиля — ранее отправленные ссылки сброса обязаны
      // умереть, иначе старое письмо остаётся рабочим ключом к аккаунту.
      if (directusUpdateData.password) {
        invalidateUserResetTokens(userId);
      }

      // Почту не применяем — только выдаём ссылку подтверждения и шлём письма.
      let emailChangePending = false;
      if (wantsEmailChange) {
        await requestEmailChange({
          req,
          userId,
          oldEmail: currentEmail,
          newEmail: requestedEmail,
          firstName: userData?.first_name || currentUser.first_name,
        });
        emailChangePending = true;
      }

      const updatedProfile = {
        id: userData?.id || userId,
        // Адрес отдаём ТЕКУЩИЙ: до подтверждения он не менялся.
        email: currentEmail,
        first_name: userData?.first_name || '',
        last_name: userData?.last_name || '',
        is_smm_admin: userData?.is_smm_admin || userData?.is_smm_super || false
      };

      res.json({
        success: true,
        data: updatedProfile,
        email_change_pending: emailChangePending,
        pending_email: emailChangePending ? requestedEmail : null,
      });

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

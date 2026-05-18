import { Express, Request, Response } from 'express';
import crypto from 'crypto';
import { sendEmail } from '../services/email';

const RESET_TOKEN_TTL_SEC = 3600; // 1 час

function makeResetToken(userId: string, ts: number): string {
  const secret = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN || 'smm-reset-secret';
  return crypto.createHmac('sha256', secret).update(`${userId}:${ts}`).digest('hex').slice(0, 40);
}

function getBaseUrl(req: Request): string {
  const host = req.get('host') || '';
  if (host.includes('replit.dev')) return `https://${host}`;
  if (host.includes('roboflow.space')) return 'https://smm.roboflow.space';
  return 'https://smm.omemo.tech';
}

export function registerPasswordResetRoutes(app: Express) {

  // POST /api/auth/password-reset/request
  // Принимает email, ищет пользователя, отправляет письмо
  app.post('/api/auth/password-reset/request', async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Укажите email' });
    }

    try {
      const directusUrl = process.env.DIRECTUS_URL;
      const adminToken = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN;
      if (!adminToken) return res.status(500).json({ error: 'Ошибка конфигурации сервера' });

      // Ищем пользователя по email
      const usersResp = await fetch(
        `${directusUrl}/users?filter[email][_eq]=${encodeURIComponent(email)}&fields=id,email,first_name`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      if (!usersResp.ok) return res.status(500).json({ error: 'Ошибка сервера' });

      const usersData = await usersResp.json();
      const user = usersData.data?.[0];

      // Всегда отвечаем успехом — не раскрываем существование аккаунта
      if (!user) {
        return res.json({ success: true });
      }

      const ts = Math.floor(Date.now() / 1000);
      const token = makeResetToken(user.id, ts);
      const baseUrl = getBaseUrl(req);
      const resetUrl = `${baseUrl}/auth/reset-password?userId=${user.id}&ts=${ts}&token=${token}`;
      const firstName = user.first_name || 'пользователь';

      await sendEmail({
        to: email,
        subject: 'Сброс пароля — SMM Manager',
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 16px">
            <h2 style="margin:0 0 16px;color:#111">Сброс пароля</h2>
            <p style="color:#444;line-height:1.6">Здравствуйте, <b>${firstName}</b>!</p>
            <p style="color:#444;line-height:1.6">Мы получили запрос на сброс пароля для вашего аккаунта SMM Manager. Нажмите на кнопку ниже, чтобы задать новый пароль:</p>
            <p style="margin:24px 0">
              <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px">Сбросить пароль</a>
            </p>
            <p style="color:#888;font-size:13px;line-height:1.5">Ссылка действительна <b>1 час</b>. Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо.</p>
          </div>
        `,
      });

      return res.json({ success: true });
    } catch (err: any) {
      console.error('[password-reset/request]', err?.message);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // POST /api/auth/password-reset/confirm
  // Проверяет токен и меняет пароль
  app.post('/api/auth/password-reset/confirm', async (req: Request, res: Response) => {
    const { userId, ts, token, password } = req.body;

    if (!userId || !ts || !token || !password) {
      return res.status(400).json({ error: 'Отсутствуют обязательные параметры' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
    }

    const tsNum = parseInt(ts, 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - tsNum > RESET_TOKEN_TTL_SEC) {
      return res.status(400).json({ error: 'Срок действия ссылки истёк. Запросите сброс заново.' });
    }

    const expected = makeResetToken(userId, tsNum);
    if (token !== expected) {
      return res.status(400).json({ error: 'Недействительная ссылка для сброса пароля.' });
    }

    try {
      const directusUrl = process.env.DIRECTUS_URL;
      const adminToken = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN;
      if (!adminToken) return res.status(500).json({ error: 'Ошибка конфигурации сервера' });

      const updateResp = await fetch(`${directusUrl}/users/${userId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!updateResp.ok) {
        const errText = await updateResp.text();
        console.error('[password-reset/confirm] Directus error:', errText);
        return res.status(500).json({ error: 'Не удалось обновить пароль' });
      }

      return res.json({ success: true });
    } catch (err: any) {
      console.error('[password-reset/confirm]', err?.message);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
  });
}

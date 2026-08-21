import { Express, Request, Response } from 'express';
import crypto from 'crypto';
import { sendEmail } from '../services/email';
import { escapeHtml } from '../utils/html-escape';
import { getAppBaseUrl } from '../utils/app-base-url';
import {
  rememberResetToken,
  consumeResetToken,
  invalidateUserResetTokens,
} from '../utils/password-reset-tokens';
import { log, logEvent } from '../utils/logger';

const RESET_TOKEN_TTL_SEC = 3600; // 1 час

/**
 * Без фолбэка на публичную строку: ключ подписи, лежащий в репозитории, знает
 * кто угодно, и подделать ссылку сброса становится тривиально. Лучше явная
 * ошибка конфигурации, чем тихая подпись общеизвестным секретом.
 */
function makeResetToken(userId: string, ts: number): string {
  const secret = process.env.APP_SIGNING_SECRET;
  if (!secret) {
    throw new Error('Не настроен секрет для подписи ссылок сброса пароля');
  }
  return crypto.createHmac('sha256', secret).update(`${userId}:${ts}`).digest('hex').slice(0, 40);
}

/** Сравнение подписей за постоянное время: обычный !== течёт по префиксу. */
function tokensMatch(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(String(provided), 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  // timingSafeEqual бросает на разной длине, поэтому длину проверяем отдельно.
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
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
      const adminToken = process.env.DIRECTUS_STATIC_TOKEN;
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
      // Регистрируем ссылку как действующую; прежние ссылки этого пользователя
      // гасятся, чтобы рабочей оставалась только последняя запрошенная.
      rememberResetToken(token, user.id, RESET_TOKEN_TTL_SEC);
      const baseUrl = getAppBaseUrl(req);
      const resetUrl = `${baseUrl}/auth/reset-password?userId=${user.id}&ts=${ts}&token=${token}`;
      // Все подстановки экранируются: имя приходит из профиля пользователя,
      // а это интерполяция в разметку письма.
      const safeName = escapeHtml(user.first_name || 'пользователь');
      const safeAccount = escapeHtml(user.email || email);
      // Чужой сброс — реальный сценарий, поэтому в письме должно быть видно,
      // ДЛЯ КАКОГО аккаунта и КОГДА запрошен сброс: без этого получатель не
      // может понять, его это действие или нет.
      const requestedAt = escapeHtml(new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }));

      await sendEmail({
        to: email,
        subject: 'Сброс пароля — SMM Manager',
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 16px">
            <h2 style="margin:0 0 16px;color:#111">Сброс пароля</h2>
            <p style="color:#444;line-height:1.6">Здравствуйте, <b>${safeName}</b>!</p>
            <p style="color:#444;line-height:1.6">Мы получили запрос на сброс пароля для аккаунта SMM Manager <b>${safeAccount}</b>.</p>
            <p style="color:#444;line-height:1.6">Запрос сделан: <b>${requestedAt}</b> (МСК).</p>
            <p style="color:#444;line-height:1.6">Нажмите на кнопку ниже, чтобы задать новый пароль:</p>
            <p style="margin:24px 0">
              <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px">Сбросить пароль</a>
            </p>
            <p style="color:#888;font-size:13px;line-height:1.5">Ссылка действительна <b>1 час</b>. Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо, пароль останется прежним.</p>
          </div>
        `,
      });

      return res.json({ success: true });
    } catch (err: any) {
      log.error('[password-reset/request]', err?.message);
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

    let expected: string;
    try {
      expected = makeResetToken(userId, tsNum);
    } catch (configErr: any) {
      log.error('[password-reset/confirm]', configErr?.message);
      return res.status(500).json({ error: 'Ошибка конфигурации сервера' });
    }

    if (!tokensMatch(token, expected)) {
      return res.status(400).json({ error: 'Недействительная ссылка для сброса пароля.' });
    }

    // Подпись верна — но этого мало: она не знает, использовали ссылку или нет.
    // Гасим токен ДО смены пароля, поэтому повторный переход по той же ссылке
    // сюда уже не дойдёт.
    if (!consumeResetToken(token, userId)) {
      return res.status(400).json({
        error: 'Ссылка уже использована или недействительна. Запросите сброс заново.',
      });
    }

    try {
      const directusUrl = process.env.DIRECTUS_URL;
      const adminToken = process.env.DIRECTUS_STATIC_TOKEN;
      if (!adminToken) return res.status(500).json({ error: 'Ошибка конфигурации сервера' });

      const updateResp = await fetch(`${directusUrl}/users/${userId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!updateResp.ok) {
        const errText = await updateResp.text();
        log.error('[password-reset/confirm] Directus error:', errText);
        return res.status(500).json({ error: 'Не удалось обновить пароль' });
      }

      // Пароль сменился — гасим все остальные выданные ссылки пользователя.
      invalidateUserResetTokens(userId);

      // AI-65 срез B1: пароль использован для сброса — видно, когда доступ меняется.
      logEvent(
        'auth.password_reset_used',
        { userId },
        'info',
        'auth',
        'Пароль изменён через восстановление доступа',
      );

      // Уведомление о смене пароля: если сброс запросил не владелец аккаунта,
      // письмо — единственный сигнал, по которому он это заметит.
      // Отправка не должна ломать уже успешную смену пароля.
      try {
        const notifyResp = await fetch(
          `${directusUrl}/users/${userId}?fields=email,first_name`,
          { headers: { Authorization: `Bearer ${adminToken}` } },
        );
        if (notifyResp.ok) {
          const notifyData = await notifyResp.json();
          const changedUser = notifyData.data;
          if (changedUser?.email) {
            await sendEmail({
              to: changedUser.email,
              subject: 'Пароль изменён — SMM Manager',
              html: `
                <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 16px">
                  <h2 style="margin:0 0 16px;color:#111">Пароль изменён</h2>
                  <p style="color:#444;line-height:1.6">Здравствуйте, <b>${escapeHtml(changedUser.first_name || 'пользователь')}</b>!</p>
                  <p style="color:#444;line-height:1.6">Пароль от аккаунта SMM Manager <b>${escapeHtml(changedUser.email)}</b> был только что изменён через восстановление доступа (${escapeHtml(new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }))} МСК). Ссылка, по которой это сделали, больше не действует.</p>
                  <p style="color:#444;line-height:1.6">Если это были <b>не вы</b> — сразу запросите сброс пароля повторно и сообщите нам.</p>
                </div>
              `,
            });
          }
        }
      } catch (notifyErr: any) {
        log.error('[password-reset/confirm] Не удалось отправить уведомление:', notifyErr?.message);
      }

      return res.json({ success: true });
    } catch (err: any) {
      log.error('[password-reset/confirm]', err?.message);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
  });
}

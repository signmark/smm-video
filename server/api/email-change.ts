import { Express, Request, Response } from 'express';
import crypto from 'crypto';
import { sendEmail } from '../services/email';
import { escapeHtml } from '../utils/html-escape';
import { getAppBaseUrl } from '../utils/app-base-url';
import { invalidateUserResetTokens } from '../utils/password-reset-tokens';

/**
 * Смена почты в профиле — с подтверждением по ссылке.
 *
 * Раньше новый адрес из тела PUT /api/user/profile уезжал в Directus сразу:
 * смена мгновенная и необратимая, а законный владелец терял и вход, и
 * возможность восстановления. Теперь поле email переписывается только здесь —
 * после перехода по ссылке, отправленной на НОВЫЙ адрес; до этого момента
 * старый адрес продолжает работать.
 *
 * ── Почему тут нет хранилища выданных токенов ──
 *
 * Ссылки сброса пароля живут в Map в памяти процесса
 * (utils/password-reset-tokens.ts), и на проде это уже выстрелило: ссылку
 * отвергло через 19 минут при TTL 60, потому что контейнер пересобрали.
 * Деплои у владельца идут параллельно из нескольких сессий, рестарты частые
 * и непредсказуемые, так что для подтверждения почты хранилище в памяти —
 * гарантированная поломка, а не теоретический риск.
 *
 * Отдельной коллекции в Directus здесь тоже нет — и не нужно. Одноразовость
 * получается из состояния, которое Directus и так хранит долговечно: в
 * подпись входит СТАРЫЙ адрес аккаунта. Пока смена не применена, текущий
 * адрес равен старому и подпись сходится. Как только адрес сменился, текущий
 * адрес равен новому, пересчитанная подпись перестаёт совпадать, и повторный
 * переход по той же ссылке отклоняется. Ссылка гасится самим фактом
 * применения — без схемы, без прав роли, без миграции на прод и переживая
 * любой рестарт.
 *
 * Осознанные следствия:
 *  - Две подряд запрошенные смены (на A, потом на B) обе живут до TTL.
 *    Раньше вторая гасила первую. Обе выданы после ввода текущего пароля и
 *    на адреса, которые владелец сам ввёл; какая сработает первой — та и
 *    погасит вторую.
 *  - Смена пароля больше НЕ отменяет висящую заявку на смену почты: отменять
 *    нечего, состояния нет. Защита от этого сценария теперь стоит раньше —
 *    саму заявку невозможно создать, не зная текущего пароля.
 */

/** Срок жизни ссылки. Тот же час, что у сброса пароля. */
export const EMAIL_CHANGE_TOKEN_TTL_SEC = 3600;

/**
 * Подпись ссылки подтверждения.
 *
 * В подписываемую строку входят: домен подписи, пользователь, время выдачи,
 * СТАРЫЙ адрес и НОВЫЙ адрес.
 *  - домен 'email-change' — без него валидный токен сброса пароля (он
 *    подписан тем же ключом над `${userId}:${ts}`) стал бы валидным токеном
 *    смены почты;
 *  - старый адрес — источник одноразовости (см. комментарий к модулю);
 *  - новый адрес — привязка к адресу назначения, иначе ссылку можно было бы
 *    перенаправить на другую почту.
 */
function makeEmailChangeToken(userId: string, ts: number, oldEmail: string, newEmail: string): string {
  const secret = process.env.APP_SIGNING_SECRET;
  if (!secret) {
    throw new Error('Не настроен секрет для подписи ссылок подтверждения почты');
  }
  const message = `email-change:v1:${userId}:${ts}:${oldEmail.toLowerCase()}:${newEmail.toLowerCase()}`;
  return crypto.createHmac('sha256', secret).update(message).digest('hex').slice(0, 40);
}

/** Сравнение подписей за постоянное время: обычный !== течёт по префиксу. */
function tokensMatch(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(String(provided), 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  // timingSafeEqual бросает на разной длине, поэтому длину проверяем отдельно.
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

const mailShell = (title: string, body: string) => `
  <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 16px">
    <h2 style="margin:0 0 16px;color:#111">${title}</h2>
    ${body}
  </div>
`;

const moscowNow = () => new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

/**
 * Выдаёт ссылку подтверждения и рассылает письма.
 *
 * Писем два, и второе важнее первого: уведомление уходит на СТАРЫЙ адрес.
 * Если смену затеял не владелец, старый ящик — единственное место, где он
 * это увидит; отправлять только на новый адрес значит сообщать о краже
 * исключительно вору.
 */
export async function requestEmailChange(params: {
  req: Request;
  userId: string;
  oldEmail: string;
  newEmail: string;
  firstName?: string;
}): Promise<void> {
  const { req, userId, oldEmail, newEmail, firstName } = params;

  const ts = Math.floor(Date.now() / 1000);
  const token = makeEmailChangeToken(userId, ts, oldEmail, newEmail);

  const baseUrl = getAppBaseUrl(req);
  // Новый адрес едет в ссылке: хранилища нет, а подпись его покрывает,
  // поэтому подменить его в URL нельзя.
  const confirmUrl =
    `${baseUrl}/auth/confirm-email` +
    `?userId=${encodeURIComponent(userId)}` +
    `&ts=${ts}` +
    `&email=${encodeURIComponent(newEmail)}` +
    `&token=${token}`;

  const safeName = escapeHtml(firstName || 'пользователь');
  const safeNew = escapeHtml(newEmail);
  const safeOld = escapeHtml(oldEmail);
  const requestedAt = escapeHtml(moscowNow());

  // Письмо на НОВЫЙ адрес — со ссылкой подтверждения.
  await sendEmail({
    to: newEmail,
    subject: 'Подтвердите новый адрес — SMM Manager',
    html: mailShell(
      'Подтверждение адреса',
      `
        <p style="color:#444;line-height:1.6">Здравствуйте, <b>${safeName}</b>!</p>
        <p style="color:#444;line-height:1.6">Для аккаунта SMM Manager <b>${safeOld}</b> запрошена смена адреса на <b>${safeNew}</b>.</p>
        <p style="color:#444;line-height:1.6">Запрос сделан: <b>${requestedAt}</b> (МСК).</p>
        <p style="color:#444;line-height:1.6">Пока вы не нажмёте кнопку ниже, вход остаётся по старому адресу.</p>
        <p style="margin:24px 0">
          <a href="${confirmUrl}" style="display:inline-block;padding:12px 28px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px">Подтвердить адрес</a>
        </p>
        <p style="color:#888;font-size:13px;line-height:1.5">Ссылка действительна <b>1 час</b>. Если вы не запрашивали смену адреса — просто проигнорируйте это письмо.</p>
      `,
    ),
  });

  // Письмо на СТАРЫЙ адрес — предупреждение, без ссылки подтверждения.
  await sendEmail({
    to: oldEmail,
    subject: 'Запрошена смена адреса — SMM Manager',
    html: mailShell(
      'Запрошена смена адреса',
      `
        <p style="color:#444;line-height:1.6">Здравствуйте, <b>${safeName}</b>!</p>
        <p style="color:#444;line-height:1.6">Для вашего аккаунта SMM Manager <b>${safeOld}</b> запрошена смена адреса на <b>${safeNew}</b>.</p>
        <p style="color:#444;line-height:1.6">Запрос сделан: <b>${requestedAt}</b> (МСК).</p>
        <p style="color:#444;line-height:1.6">Смена <b>ещё не применена</b>: адрес поменяется только после подтверждения по ссылке, отправленной на новый адрес. До этого момента вход и восстановление доступа работают по текущему адресу.</p>
        <p style="color:#444;line-height:1.6">Если это были <b>не вы</b> — значит, кто-то знает ваш пароль: смените его немедленно.</p>
      `,
    ),
  });
}

export function registerEmailChangeRoutes(app: Express) {
  // POST /api/auth/email-change/confirm
  // Публичный: переход по ссылке из почты не обязан происходить в той же
  // сессии и в том же браузере, где смену запросили. Доступ даёт не сессия,
  // а подписанный токен — как в подтверждении сброса пароля.
  app.post('/api/auth/email-change/confirm', async (req: Request, res: Response) => {
    const { userId, ts, token, email } = req.body;

    if (!userId || !ts || !token || !email) {
      return res.status(400).json({ error: 'Отсутствуют обязательные параметры' });
    }

    const tsNum = parseInt(ts, 10);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(tsNum) || now - tsNum > EMAIL_CHANGE_TOKEN_TTL_SEC || tsNum > now + 60) {
      return res.status(400).json({ error: 'Срок действия ссылки истёк. Запросите смену адреса заново.' });
    }

    const newEmail = String(email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return res.status(400).json({ error: 'Недействительная ссылка подтверждения.' });
    }

    try {
      const directusUrl = process.env.DIRECTUS_URL;
      const adminToken = process.env.DIRECTUS_STATIC_TOKEN;
      if (!adminToken) return res.status(500).json({ error: 'Ошибка конфигурации сервера' });

      // Текущий адрес — источник истины и одновременно источник
      // одноразовости: подпись сойдётся только пока он равен старому.
      const currentResp = await fetch(`${directusUrl}/users/${userId}?fields=id,email,first_name`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (!currentResp.ok) {
        console.error(`[email-change/confirm] Чтение профиля ${userId}: HTTP ${currentResp.status}`);
        return res.status(500).json({ error: 'Ошибка сервера' });
      }
      const currentUser = ((await currentResp.json()) as any)?.data;
      const currentEmail = currentUser?.email ? String(currentUser.email) : '';
      if (!currentEmail) {
        return res.status(400).json({ error: 'Недействительная ссылка подтверждения.' });
      }

      let expected: string;
      try {
        expected = makeEmailChangeToken(String(userId), tsNum, currentEmail, newEmail);
      } catch (configErr: any) {
        console.error('[email-change/confirm]', configErr?.message);
        return res.status(500).json({ error: 'Ошибка конфигурации сервера' });
      }

      if (!tokensMatch(token, expected)) {
        // Сюда же попадает повторный переход по уже использованной ссылке:
        // адрес аккаунта уже новый, и подпись над старым больше не сходится.
        return res.status(400).json({
          error: 'Ссылка недействительна или уже использована. Запросите смену адреса заново.',
        });
      }

      const updateResp = await fetch(`${directusUrl}/users/${userId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail }),
      });

      if (!updateResp.ok) {
        const errText = await updateResp.text();
        console.error('[email-change/confirm] Directus error:', errText);
        return res.status(500).json({ error: 'Не удалось изменить адрес' });
      }

      // Адрес сменился — ранее выданные ссылки сброса пароля обязаны умереть:
      // старое письмо не должно остаться рабочим ключом к аккаунту с новой
      // почтой.
      invalidateUserResetTokens(String(userId));

      // Уведомление на СТАРЫЙ адрес: он только что перестал быть рабочим,
      // и это последняя возможность сообщить прежнему владельцу.
      // Отправка не должна ломать уже успешную смену.
      try {
        await sendEmail({
          to: currentEmail,
          subject: 'Адрес аккаунта изменён — SMM Manager',
          html: mailShell(
            'Адрес аккаунта изменён',
            `
              <p style="color:#444;line-height:1.6">Адрес вашего аккаунта SMM Manager изменён с <b>${escapeHtml(currentEmail)}</b> на <b>${escapeHtml(newEmail)}</b> (${escapeHtml(moscowNow())} МСК).</p>
              <p style="color:#444;line-height:1.6">Вход и восстановление доступа теперь работают по новому адресу.</p>
              <p style="color:#444;line-height:1.6">Если это были <b>не вы</b> — немедленно свяжитесь с нами.</p>
            `,
          ),
        });
      } catch (notifyErr: any) {
        console.error('[email-change/confirm] Не удалось отправить уведомление:', notifyErr?.message);
      }

      return res.json({ success: true, email: newEmail });
    } catch (err: any) {
      console.error('[email-change/confirm]', err?.message);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
  });
}

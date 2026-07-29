import { Router, Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { sendSubscriptionRequestEmail } from '../services/email';
import { getAppBaseUrl } from '../utils/app-base-url';
import { resolvePlanPrice } from '../services/plan-pricing';

// ─── Реестр обработанных заявок (in-memory, TTL 72ч) ───────────────────────
// Ключ — userId. Предотвращает повторное одобрение после отклонения и наоборот.
interface ProcessedEntry { action: 'approved' | 'rejected'; at: number }
const processedRequests = new Map<string, ProcessedEntry>();

setInterval(() => {
  const cutoff = Date.now() - 72 * 60 * 60 * 1000;
  for (const [k, v] of processedRequests) {
    if (v.at < cutoff) processedRequests.delete(k);
  }
}, 60 * 60 * 1000);

export function markSubscriptionProcessed(userId: string, action: 'approved' | 'rejected') {
  processedRequests.set(userId, { action, at: Date.now() });
}

export function getSubscriptionStatus(userId: string): ProcessedEntry | undefined {
  return processedRequests.get(userId);
}

const router = Router();

export const PLAN_DURATIONS: Record<string, number> = {
  'Базовый': 30,
  'Профессиональный': 30,
  'Корпоративный': 365,
};

// Метка цены для писем/уведомлений о заявке.
// Берём из того же источника, что и страница тарифов (/api/config/pricing):
// Directus global key → env → дефолт. Иначе метка в письме рассинхронизируется
// с ценой на сайте (см. баг с «100 ₽/мес» в письме при 670 ₽ на странице).
export async function resolvePlanPriceLabel(plan: string): Promise<string> {
  switch (plan) {
    case 'Профессиональный':
      return `${(await resolvePlanPrice('pro')).price} ₽/мес`;
    case 'Базовый':
      return `${(await resolvePlanPrice('basic')).price} ₽/мес`;
    case 'Корпоративный':
      return process.env.PLAN_PRICE_ENTERPRISE_LABEL ?? 'По договорённости';
    default:
      return plan;
  }
}

const PLAN_CODES: Record<string, string> = {
  'Базовый': 'b',
  'Профессиональный': 'p',
  'Корпоративный': 'c',
};

const PLAN_VALUES: Record<string, string> = {
  'Базовый': 'basic',
  'Профессиональный': 'pro',
  'Корпоративный': 'enterprise',
};

function makeActionToken(userId: string, plan: string, days: number): string {
  // Тот же секрет, что у ссылок сброса пароля и подтверждения почты.
  // Фолбэка на константу 'smm-secret-key' здесь больше нет: подписывать
  // общеизвестной строкой — значит позволить подделать ссылку активации
  // тарифа. Лучше явная ошибка конфигурации, чем тихая фальшивая подпись.
  const secret = process.env.APP_SIGNING_SECRET;
  if (!secret) {
    throw new Error('Не настроен APP_SIGNING_SECRET для подписи ссылок активации подписки');
  }
  return crypto.createHmac('sha256', secret).update(`${userId}:${plan}:${days}`).digest('hex').slice(0, 32);
}



export async function sendSubscriptionNotification(
  userId: string,
  userName: string,
  email: string,
  plan: string,
) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!botToken || !adminChatId) {
    console.log('[subscriptions] Telegram-уведомление не настроено (TELEGRAM_ADMIN_CHAT_ID не задан)');
    return;
  }

  const price = await resolvePlanPriceLabel(plan);
  const days = PLAN_DURATIONS[plan] || 30;
  const planCode = PLAN_CODES[plan] || 'b';
  const now = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

  const text =
    `🛒 <b>Новая заявка на подписку</b>\n\n` +
    `👤 Пользователь: <b>${userName}</b>\n` +
    `📧 Email: <code>${email}</code>\n` +
    `🆔 ID: <code>${userId}</code>\n` +
    `📦 Тариф: <b>${plan}</b> (${price})\n` +
    `🕐 Время: ${now}`;

  const reply_markup = {
    inline_keyboard: [[
      {
        text: `✅ Одобрить (${days} дней)`,
        callback_data: `sap:${userId}:${days}:${planCode}`,
      },
      {
        text: '❌ Отклонить',
        callback_data: `sar:${userId}`,
      },
    ]],
  };

  try {
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: adminChatId,
      text,
      parse_mode: 'HTML',
      reply_markup,
    });
    console.log('[subscriptions] Telegram-уведомление с кнопкой отправлено');
  } catch (err: any) {
    console.error('[subscriptions] Ошибка Telegram-уведомления:', err?.message);
  }
}

// GET /api/subscriptions/approve?userId=...&plan=...&days=...&token=...
router.get('/subscriptions/approve', async (req: Request, res: Response) => {
  const { userId, plan, days, token } = req.query as Record<string, string>;

  if (!userId || !plan || !days || !token) {
    return res.status(400).send(htmlPage('❌ Ошибка', 'Неверная ссылка — отсутствуют параметры.'));
  }

  const expected = makeActionToken(userId, plan, parseInt(days));
  if (token !== expected) {
    return res.status(403).send(htmlPage('❌ Ошибка', 'Недействительная ссылка или срок действия истёк.'));
  }

  // Проверяем, не была ли заявка уже обработана
  const existing = processedRequests.get(userId);
  if (existing) {
    if (existing.action === 'rejected') {
      console.warn(`[subscriptions/approve] Попытка одобрить уже ОТКЛОНЁННУЮ заявку: ${userId}`);
      return res.status(409).send(htmlPage('❌ Заявка уже отклонена', 'Эта заявка была ранее отклонена. Если нужно активировать подписку — попросите пользователя подать новую заявку.'));
    }
    if (existing.action === 'approved') {
      return res.send(htmlPage('✅ Уже активировано', 'Подписка по этой заявке уже была активирована ранее.'));
    }
  }

  try {
    const directusUrl = process.env.DIRECTUS_URL;
    const adminToken = process.env.DIRECTUS_STATIC_TOKEN;
    if (!adminToken) return res.status(500).send(htmlPage('❌ Ошибка', 'DIRECTUS_STATIC_TOKEN не настроен на сервере.'));

    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + parseInt(days));
    const expireDateStr = expireDate.toISOString().split('T')[0];
    const planValue = PLAN_VALUES[plan] || 'basic';

    const updateResp = await fetch(`${directusUrl}/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expire_date: expireDateStr, plan: planValue }),
    });

    if (!updateResp.ok) {
      const errText = await updateResp.text();
      console.error('[subscriptions/approve] Directus error:', errText);
      return res.status(500).send(htmlPage('❌ Ошибка', `Не удалось активировать подписку: ${updateResp.status}`));
    }

    console.log(`[subscriptions/approve] Подписка активирована: ${userId} → ${plan} (${days} дней)`);
    markSubscriptionProcessed(userId, 'approved');

    // Уведомляем пользователя в Telegram (если есть chat_id)
    try {
      const userResp = await fetch(`${directusUrl}/users/${userId}?fields=telegram_chat_id`, {
        headers: { 'Authorization': `Bearer ${adminToken}` },
      });
      if (userResp.ok) {
        const userJson = await userResp.json();
        const u = userJson.data;
        // Telegram пользователю (если есть chat_id)
        const userChatId = u?.telegram_chat_id;
        if (userChatId) {
          const botToken = process.env.TELEGRAM_BOT_TOKEN;
          if (botToken) {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: userChatId,
                text: `🎉 <b>Подписка активирована!</b>\n📦 Тариф: <b>${plan}</b>\n📅 До: <b>${expireDate.toLocaleDateString('ru-RU')}</b>`,
                parse_mode: 'HTML',
              }),
            }).catch(() => {});
          }
        }
      }
    } catch (_) {}

    return res.send(htmlPage('✅ Подписка активирована', `Тариф <b>${plan}</b> активирован до <b>${expireDate.toLocaleDateString('ru-RU')}</b>.`));
  } catch (err: any) {
    console.error('[subscriptions/approve] Ошибка:', err?.message);
    return res.status(500).send(htmlPage('❌ Ошибка', err?.message));
  }
});

// GET /api/subscriptions/reject?userId=...&plan=...&days=...&token=...
router.get('/subscriptions/reject', async (req: Request, res: Response) => {
  const { userId, plan, days, token } = req.query as Record<string, string>;

  if (!userId || !plan || !days || !token) {
    return res.status(400).send(htmlPage('❌ Ошибка', 'Неверная ссылка — отсутствуют параметры.'));
  }

  const expected = makeActionToken(userId, plan, parseInt(days));
  if (token !== expected) {
    return res.status(403).send(htmlPage('❌ Ошибка', 'Недействительная ссылка.'));
  }

  // Проверяем, не была ли заявка уже одобрена
  const existing = processedRequests.get(userId);
  if (existing?.action === 'approved') {
    console.warn(`[subscriptions/reject] Попытка отклонить уже ОДОБРЕННУЮ заявку: ${userId}`);
    return res.status(409).send(htmlPage('⚠️ Заявка уже одобрена', 'Эта заявка была уже одобрена и подписка активирована. Чтобы отменить — деактивируйте подписку вручную в панели.'));
  }

  markSubscriptionProcessed(userId, 'rejected');
  console.log(`[subscriptions/reject] Заявка отклонена: ${userId} → ${plan}`);
  return res.send(htmlPage('❌ Заявка отклонена', `Заявка на тариф <b>${plan}</b> отклонена. Ссылка одобрения из письма теперь недействительна.`));
});

router.post('/subscriptions/request', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }

    const token = authHeader.substring(7);

    const directusUrl = process.env.DIRECTUS_URL;
    const adminToken = process.env.DIRECTUS_STATIC_TOKEN;

    // Сначала получаем ID пользователя по его токену
    const meResponse = await fetch(`${directusUrl}/users/me?fields=id`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!meResponse.ok) {
      return res.status(401).json({ error: 'Не удалось получить данные пользователя' });
    }

    const meData = await meResponse.json();
    const userId = meData.data?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Не удалось определить пользователя' });
    }

    // Затем получаем полные данные через admin-токен (обходит ограничения ролей)
    let user: any = { id: userId, email: '', first_name: '', last_name: '' };
    if (adminToken) {
      const fullResp = await fetch(`${directusUrl}/users/${userId}?fields=id,email,first_name,last_name`, {
        headers: { 'Authorization': `Bearer ${adminToken}` },
      });
      if (fullResp.ok) {
        const fullData = await fullResp.json();
        user = { ...user, ...fullData.data };
      }
    }

    const { plan } = req.body;
    if (!plan) {
      return res.status(400).json({ error: 'Укажите план' });
    }

    const userName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
    const days = PLAN_DURATIONS[plan] || 30;
    const price = await resolvePlanPriceLabel(plan);
    const actionToken = makeActionToken(user.id, plan, days);
    const baseUrl = getAppBaseUrl(req);

    const approveUrl = `${baseUrl}/api/subscriptions/approve?userId=${user.id}&plan=${encodeURIComponent(plan)}&days=${days}&token=${actionToken}`;
    const rejectUrl = `${baseUrl}/api/subscriptions/reject?userId=${user.id}&plan=${encodeURIComponent(plan)}&days=${days}&token=${actionToken}`;

    console.log(`[subscriptions] Заявка: ${userName} (${user.email}) → ${plan}`);

    await sendSubscriptionNotification(user.id, userName, user.email, plan);

    sendSubscriptionRequestEmail(user.email, userName, plan, price, approveUrl, rejectUrl)
      .then(() => console.log(`[subscriptions] Email-уведомление отправлено: admin=${process.env.ADMIN_EMAIL}, user=${user.email}`))
      .catch((err) => console.error('[subscriptions] Ошибка email-уведомления:', err?.message, '| SMTP_HOST:', process.env.SMTP_HOST, '| SMTP_USER:', process.env.SMTP_USER));

    return res.json({
      success: true,
      message: 'Заявка принята. Администратор активирует подписку в течение рабочего дня.',
    });
  } catch (error: any) {
    console.error('[subscriptions] Ошибка обработки заявки:', error);
    return res.status(500).json({ error: 'Ошибка сервера', details: error?.message });
  }
});

function htmlPage(title: string, body: string): string {
  const isOk = title.includes('✅');
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb}
.card{background:#fff;border-radius:12px;padding:40px 48px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:400px}
h1{font-size:1.5rem;margin:16px 0 8px;color:${isOk ? '#16a34a' : '#dc2626'}}
p{color:#555;line-height:1.6}</style></head>
<body><div class="card"><div style="font-size:3rem">${isOk ? '✅' : '❌'}</div>
<h1>${title.replace(/^[✅❌]\s*/, '')}</h1><p>${body}</p></div></body></html>`;
}

export default router;

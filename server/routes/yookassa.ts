import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { sendPurchasePostback } from '../services/partner-postback';
import { resolvePlanPrice, PlanPriceKey } from '../services/plan-pricing';
import { validatePromoCode, applyPromoDiscount } from '../services/promo-validation';

const router = Router();

const SHOP_ID = process.env.YOOKASSA_SHOP_ID || '';
const SECRET_KEY = process.env.YOOKASSA_SECRET_KEY || '';
const DIRECTUS_URL = process.env.DIRECTUS_URL || '';
const ADMIN_TOKEN = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN || '';

const YOOKASSA_API = 'https://api.yookassa.ru/v3/payments';

/** Единственная поддерживаемая валюта. Платёж в любой другой к активации не принимается. */
const CURRENCY = 'RUB';

// Русское название тарифа → ключ для резолвера цены (pro/basic).
// Сумма платежа больше НЕ хардкодится здесь: базовую цену берём из resolvePlanPrice
// (Directus global_api_keys → env → fallback), чтобы списание совпадало с витриной.
const PLAN_KEYS: Record<string, PlanPriceKey> = {
  'Базовый': 'basic',
  'Профессиональный': 'pro',
};

const PLAN_DURATIONS: Record<string, number> = {
  'Базовый': 30,
  'Профессиональный': 30,
};

function getBaseUrl(req: Request): string {
  const host = req.get('host') || '';
  if (host.includes('replit.dev')) return `https://${host}`;
  if (host.includes('roboflow.space')) return 'https://smm.roboflow.space';
  return 'https://smm.omemo.tech';
}

export function isConfigured(): boolean {
  return !!(SHOP_ID && SECRET_KEY);
}

async function yookassaRequest(method: string, path: string, body?: object): Promise<any> {
  const credentials = Buffer.from(`${SHOP_ID}:${SECRET_KEY}`).toString('base64');
  const res = await fetch(`${YOOKASSA_API}${path}`, {
    method,
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Idempotence-Key': uuidv4(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YooKassa ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function activateSubscription(userId: string, plan: string): Promise<void> {
  const days = PLAN_DURATIONS[plan] || 30;
  const planKey = PLAN_KEYS[plan] || 'basic';
  const expireDate = new Date();
  expireDate.setDate(expireDate.getDate() + days);
  const expireDateStr = expireDate.toISOString().split('T')[0];

  const resp = await fetch(`${DIRECTUS_URL}/users/${userId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${ADMIN_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ plan: planKey, expire_date: expireDateStr }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Directus PATCH users/${userId}: ${resp.status} ${errText}`);
  }

  console.log(`[yookassa] Подписка активирована: userId=${userId} plan=${planKey} до ${expireDateStr}`);

  try {
    const userResp = await fetch(`${DIRECTUS_URL}/users/${userId}?fields=telegram_chat_id,first_name,last_name`, {
      headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` },
    });
    if (userResp.ok) {
      const { data } = await userResp.json();
      const chatId = data?.telegram_chat_id;
      const name = [data?.first_name, data?.last_name].filter(Boolean).join(' ') || 'Пользователь';
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (chatId && botToken) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🎉 <b>Оплата прошла!</b>\n\nПривет, ${name}!\nТариф <b>${plan}</b> активирован до <b>${expireDate.toLocaleDateString('ru-RU')}</b>.\n\nСпасибо за подписку! 🚀`,
            parse_mode: 'HTML',
          }),
        }).catch(() => {});
      }
    }
  } catch (_) {}
}

// POST /api/payments/create
// Body: { plan: 'Базовый' | 'Профессиональный' }
// Auth: Bearer <user_token>
router.post('/payments/create', async (req: Request, res: Response) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'Онлайн-оплата временно недоступна. Пожалуйста, отправьте заявку.' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  const userToken = authHeader.substring(7);

  // `amount` из тела запроса сознательно НЕ читается: сумма считается сервером.
  const { plan, promoCode } = req.body as { plan: string; promoCode?: string | null };
  if (!plan || !PLAN_KEYS[plan]) {
    return res.status(400).json({ error: 'Неверный тариф' });
  }

  try {
    const meResp = await fetch(`${DIRECTUS_URL}/users/me?fields=id`, {
      headers: { 'Authorization': `Bearer ${userToken}` },
    });
    if (!meResp.ok) {
      return res.status(401).json({ error: 'Не удалось определить пользователя' });
    }
    const { data: meData } = await meResp.json();
    const userId = meData?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Не удалось определить пользователя' });
    }

    const baseUrl = getBaseUrl(req);
    const returnUrl = `${baseUrl}/payment/success?plan=${encodeURIComponent(plan)}&userId=${userId}`;

    // Получаем email пользователя для чека (54-ФЗ)
    let userEmail = '';
    try {
      const emailResp = await fetch(`${DIRECTUS_URL}/users/${userId}?fields=email`, {
        headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` },
      });
      if (emailResp.ok) {
        const { data: emailData } = await emailResp.json();
        userEmail = emailData?.email || '';
      }
    } catch (_) {}

    // Цена — только серверная. Базовая из общего резолвера (та же, что на витрине),
    // скидка — только из промокода, перепроверенного здесь и сейчас. Сумма с фронта
    // не участвует в расчёте вообще: клиентская проверка не может быть границей
    // безопасности, иначе `amount: 1` покупает полный тариф.
    const baseAmount = (await resolvePlanPrice(PLAN_KEYS[plan])).price;

    let appliedPromo: { id: string; code: string; percent: number } | null = null;
    let finalAmount = baseAmount;

    if (promoCode) {
      const check = await validatePromoCode(String(promoCode), userId);
      if (!check.valid) {
        // Невалидный код не «просто не даёт скидку» молча: пользователь рассчитывал
        // на одну сумму, поэтому платёж не создаём и объясняем причину.
        return res.status(400).json({ error: check.message, promoRejected: true });
      }
      const priced = applyPromoDiscount(baseAmount, check.promo);
      finalAmount = priced.amount;
      if (priced.discountPercent > 0) {
        appliedPromo = { id: check.promo.id, code: check.promo.code, percent: priced.discountPercent };
      }
    }

    const amount = finalAmount.toFixed(2);

    const payment = await yookassaRequest('POST', '', {
      amount: { value: amount, currency: CURRENCY },
      capture: true,
      confirmation: {
        type: 'redirect',
        return_url: returnUrl,
      },
      description: `Подписка SMM Manager — ${plan}`,
      // Метаданные — это то, с чем платёж потом сверяется при активации: план, сумма,
      // валюта и промокод, зафиксированные сервером в момент создания. ЮКасса отдаёт
      // их обратно неизменными, подделать их, минуя эту ручку, нельзя.
      metadata: {
        user_id: userId,
        plan,
        amount,
        currency: CURRENCY,
        ...(appliedPromo ? { promo_code: appliedPromo.code, promo_id: appliedPromo.id } : {}),
      },
      receipt: {
        customer: { email: userEmail || 'noreply@smm.omemo.tech' },
        items: [
          {
            description: `Подписка SMM Manager — ${plan}`,
            quantity: '1.00',
            amount: { value: amount, currency: CURRENCY },
            vat_code: 1,
            payment_mode: 'full_payment',
            payment_subject: 'service',
          },
        ],
      },
    });

    console.log(
      `[yookassa] Платёж создан: id=${payment.id} userId=${userId} plan=${plan} `
      + `amount=${amount} ${CURRENCY} base=${baseAmount}`
      + (appliedPromo ? ` promo=${appliedPromo.code} -${appliedPromo.percent}%` : ''),
    );

    return res.json({
      paymentId: payment.id,
      confirmationUrl: payment.confirmation?.confirmation_url,
    });
  } catch (err: any) {
    console.error('[yookassa] Ошибка создания платежа:', err?.message);
    return res.status(500).json({ error: 'Не удалось создать платёж', details: err?.message });
  }
});

// POST /api/payments/:paymentId/activate — активация подписки после успешного платежа (резерв для webhook)
router.post('/payments/:paymentId/activate', async (req: Request, res: Response) => {
  if (!isConfigured()) return res.status(503).json({ error: 'ЮКасса не настроена' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Требуется авторизация' });

  const { paymentId } = req.params;
  if (!paymentId) return res.status(400).json({ error: 'paymentId обязателен' });

  try {
    const payment = await yookassaRequest('GET', `/${paymentId}`);
    if (payment.status !== 'succeeded' || !payment.paid) {
      return res.status(400).json({ error: 'Платёж не завершён', status: payment.status });
    }

    const metaUserId = payment.metadata?.user_id;
    const metaPlan = payment.metadata?.plan;
    if (!metaUserId || !metaPlan) {
      return res.status(400).json({ error: 'Нет данных пользователя в платеже' });
    }

    await activateSubscription(metaUserId, metaPlan);

    // Отправляем purchase postback если у пользователя есть партнёрский код
    try {
      const userResp2 = await fetch(`${DIRECTUS_URL}/users/${metaUserId}?fields=omemo_partner_code,email,telegram_chat_id`, {
        headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` },
      });
      if (userResp2.ok) {
        const { data: ud } = await userResp2.json();
        if (ud?.omemo_partner_code) {
          sendPurchasePostback({
            partnerCode: ud.omemo_partner_code,
            userId: metaUserId,
            paymentId,
            amount: parseFloat(payment.amount?.value || '0'),
            email: ud.email,
            telegramId: ud.telegram_chat_id,
          }).catch(() => {});
        }
      }
    } catch (_) {}

    return res.json({ ok: true, plan: metaPlan });
  } catch (err: any) {
    console.error('[yookassa/activate] Ошибка:', err?.message);
    return res.status(500).json({ error: err?.message });
  }
});

// GET /api/payments/:paymentId/status — проверка статуса (для success-страницы)
router.get('/payments/:paymentId/status', async (req: Request, res: Response) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'ЮКасса не настроена' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  const { paymentId } = req.params;
  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId обязателен' });
  }

  try {
    const payment = await yookassaRequest('GET', `/${paymentId}`);
    return res.json({
      status: payment.status,
      plan: payment.metadata?.plan,
      paid: payment.paid,
    });
  } catch (err: any) {
    console.error('[yookassa] Ошибка получения статуса:', err?.message);
    return res.status(500).json({ error: err?.message });
  }
});

// POST /api/yookassa/webhook — уведомления от ЮКасса
router.post('/yookassa/webhook', async (req: Request, res: Response) => {
  try {
    const event = req.body;
    const eventType = event?.event;
    const paymentObj = event?.object;

    console.log(`[yookassa/webhook] Событие: ${eventType} paymentId=${paymentObj?.id} status=${paymentObj?.status}`);

    if (eventType === 'payment.succeeded' && paymentObj?.paid === true) {
      const paymentId = paymentObj.id;
      const metaUserId = paymentObj.metadata?.user_id;
      const metaPlan = paymentObj.metadata?.plan;

      if (!metaUserId || !metaPlan) {
        console.warn('[yookassa/webhook] Нет metadata.user_id или metadata.plan');
        return res.json({ ok: true });
      }

      if (!isConfigured()) {
        console.warn('[yookassa/webhook] ЮКасса не настроена, пропускаем активацию');
        return res.json({ ok: true });
      }

      // Верифицируем платёж через API (защита от фейковых вебхуков)
      const verified = await yookassaRequest('GET', `/${paymentId}`);
      if (verified.status !== 'succeeded' || !verified.paid) {
        console.warn(`[yookassa/webhook] Платёж ${paymentId} не подтверждён (status=${verified.status})`);
        return res.json({ ok: true });
      }

      await activateSubscription(metaUserId, metaPlan);

      // Отправляем purchase postback если у пользователя есть партнёрский код
      try {
        const userResp2 = await fetch(`${DIRECTUS_URL}/users/${metaUserId}?fields=omemo_partner_code,email,telegram_chat_id`, {
          headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` },
        });
        if (userResp2.ok) {
          const { data: ud } = await userResp2.json();
          if (ud?.omemo_partner_code) {
            sendPurchasePostback({
              partnerCode: ud.omemo_partner_code,
              userId: metaUserId,
              paymentId,
              amount: parseFloat(paymentObj.amount?.value || '0'),
              email: ud.email,
              telegramId: ud.telegram_chat_id,
            }).catch(() => {});
          }
        }
      } catch (_) {}
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[yookassa/webhook] Ошибка:', err?.message);
    return res.status(500).json({ error: err?.message });
  }
});

// GET /api/payments/available — проверяет, настроена ли ЮКасса
router.get('/payments/available', (_req: Request, res: Response) => {
  res.json({ available: isConfigured() });
});

export default router;

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { sendPurchasePostback } from '../services/partner-postback';
import { getAppBaseUrl } from '../utils/app-base-url';
import { getPublicHost } from '../utils/public-url';
import { resolvePlanPrice, PlanPriceKey } from '../services/plan-pricing';
import { validatePromoCode, applyPromoDiscount } from '../services/promo-validation';
import {
  claimPaymentActivation,
  completePaymentActivation,
  releasePaymentActivation,
  isLedgerReady,
  LedgerUnavailableError,
} from '../services/payment-activation-ledger';
import {
  reservePromo,
  completePromoReservation,
  releasePromoReservation,
  attachPaymentId,
  getReservationByPayment,
  isReservationStoreReady,
  PromoReservationUnavailableError,
} from '../services/promo-reservation';

const router = Router();

const SHOP_ID = process.env.YOOKASSA_SHOP_ID || '';
const SECRET_KEY = process.env.YOOKASSA_SECRET_KEY || '';
const DIRECTUS_URL = process.env.DIRECTUS_URL || '';
const ADMIN_TOKEN = process.env.DIRECTUS_STATIC_TOKEN || '';

const YOOKASSA_API = 'https://api.yookassa.ru/v3/payments';

/** Единственная поддерживаемая валюта. Платёж в любой другой к активации не принимается. */
const CURRENCY = 'RUB';

/** Через сколько бронь без привязанного платежа считается брошенной. */
const ORPHAN_RESERVATION_MS = 30 * 60 * 1000;

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

/**
 * Держит ли слот промокода платёж, который уже точно не состоится.
 *
 * Освобождаем чужую бронь только по подтверждённому статусу от ЮКассы. Единственное
 * исключение — бронь, к которой так и не привязался платёж: значит процесс умер между
 * бронированием и созданием платежа, и висеть ей незачем.
 */
async function isSlotHolderDead(holder: { yookassa_payment_id?: string | null; reserved_at?: string | null }): Promise<boolean> {
  if (!holder.yookassa_payment_id) {
    const reservedAt = holder.reserved_at ? new Date(holder.reserved_at).getTime() : 0;
    return Number.isFinite(reservedAt) && Date.now() - reservedAt > ORPHAN_RESERVATION_MS;
  }
  try {
    const payment = await yookassaRequest('GET', `/${holder.yookassa_payment_id}`);
    return payment?.status === 'canceled' || payment?.status === 'expired';
  } catch {
    // Не смогли выяснить — считаем бронь живой. Ошибиться в эту сторону значит не дать
    // лишнюю скидку, в обратную — раздать её дважды.
    return false;
  }
}

/**
 * Пишет использование промокода в историю для админки и двигает счётчик показа.
 *
 * Источник истины по расходу кода — брони (`promo_reservations`), а не `used_count`:
 * счётчик читается-и-пишется, то есть на гонке теряет использования. Здесь он нужен
 * только для отображения в админке, поэтому ошибки не критичны.
 */
async function recordPromoUse(promoId: string, userId: string, paymentId: string, plan: string): Promise<void> {
  try {
    const existing = await fetch(
      `${DIRECTUS_URL}/items/promo_code_uses?filter[payment_id][_eq]=${encodeURIComponent(paymentId)}&limit=1`,
      { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } },
    );
    if (existing.ok) {
      const { data } = await existing.json();
      if (data?.length) return; // уже записано — повторный вызов ничего не добавляет
    }

    await fetch(`${DIRECTUS_URL}/items/promo_code_uses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        promo_code_id: promoId,
        user_id: userId,
        used_at: new Date().toISOString(),
        payment_id: paymentId,
        plan_before: plan,
      }),
    });

    const promoResp = await fetch(`${DIRECTUS_URL}/items/promo_codes/${promoId}?fields=used_count`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    if (promoResp.ok) {
      const { data } = await promoResp.json();
      await fetch(`${DIRECTUS_URL}/items/promo_codes/${promoId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ used_count: (data?.used_count || 0) + 1 }),
      });
    }
  } catch (err: any) {
    console.error('[yookassa] Не удалось записать использование промокода:', err?.message);
  }
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

  // Готовность журнала проверяем ДО обращения к ЮКассе. Создать платёж, зная, что
  // отметить его обработанным будет нечем, — значит взять деньги без защиты от
  // повторной активации.
  if (!(await isLedgerReady())) {
    return res.status(503).json({
      error: 'Онлайн-оплата временно недоступна. Пожалуйста, отправьте заявку.',
      reason: 'ledger-unavailable',
    });
  }

  // Виден и в catch: если платёж не создался, бронь надо снять.
  let createdOrderId: string | null = null;

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

    const baseUrl = getAppBaseUrl(req);
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

    // Собственный идентификатор заказа. Бронь промокода берётся ДО обращения к
    // ЮКассе, когда её payment_id ещё не существует, поэтому якорем служит order_id;
    // ЮКасса возвращает его в metadata неизменным.
    const orderId = uuidv4();

    if (promoCode) {
      const check = await validatePromoCode(String(promoCode), userId);
      if (!check.valid) {
        // Невалидный код не «просто не даёт скидку» молча: пользователь рассчитывал
        // на одну сумму, поэтому платёж не создаём и объясняем причину.
        return res.status(400).json({ error: check.message, promoRejected: true });
      }
      const priced = applyPromoDiscount(baseAmount, check.promo);

      if (priced.discountPercent > 0) {
        // Скидка выдаётся только под бронь. Без атомарного резервирования один код
        // давал бы неограниченную скидку: проверка без захвата — это гонка.
        if (!(await isReservationStoreReady())) {
          return res.status(503).json({
            error: 'Скидочные промокоды временно недоступны. Попробуйте позже или оплатите без кода.',
            reason: 'promo-store-unavailable',
          });
        }

        const reservation = await reservePromo({
          promo: check.promo,
          userId,
          paymentId: orderId,
          isSlotHolderDead,
        });
        if (!reservation.ok) {
          return res.status(400).json({ error: reservation.message, promoRejected: true });
        }

        createdOrderId = orderId;
        finalAmount = priced.amount;
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
        order_id: orderId,
        ...(appliedPromo ? { promo_code: appliedPromo.code, promo_id: appliedPromo.id } : {}),
      },
      receipt: {
        customer: { email: userEmail || `noreply@${getPublicHost()}` },
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

    if (appliedPromo) {
      // Теперь у брони есть с чем сверяться, если платёж бросят.
      try {
        await attachPaymentId(orderId, payment.id);
      } catch (attachErr: any) {
        // Платёж в ЮКассе уже создан — ронять запрос нельзя, пользователь должен
        // получить ссылку на оплату. Но и молчать нельзя: без yookassa_payment_id
        // бронь через 30 минут посчитают брошенной и отдадут скидку другому, пока
        // этот платёж живой. Оставляем след для ручной сверки.
        console.error(
          `[yookassa] СВЕРКА: не удалось привязать платёж ${payment.id} к брони промокода `
          + `order=${orderId} promo=${appliedPromo.code} userId=${userId}: ${attachErr?.message}`,
        );
      }
    }

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
    // Платёж не создался — бронь промокода держать незачем, иначе код сгорит впустую.
    if (createdOrderId) {
      await releasePromoReservation(createdOrderId, 'создание платежа не удалось').catch(() => {});
    }
    if (err instanceof PromoReservationUnavailableError) {
      console.error('[yookassa] Хранилище броней недоступно:', err?.message);
      return res.status(503).json({ error: 'Оплата временно недоступна, попробуйте позже', reason: 'promo-store-unavailable' });
    }
    console.error('[yookassa] Ошибка создания платежа:', err?.message);
    return res.status(500).json({ error: 'Не удалось создать платёж', details: err?.message });
  }
});

/**
 * Проверяет платёж, полученный из ЮКассы, перед выдачей подписки.
 *
 * Смотрим только на объект, повторно запрошенный у ЮКассы, — никогда на тело
 * входящего запроса. Сумма и валюта сверяются с тем, что сервер сам записал в
 * metadata при создании платежа: без этой сверки оплата «на рубль» по чужому
 * сценарию всё ещё давала бы полный тариф.
 */
function verifyPayment(payment: any): { ok: true } | { ok: false; status: number; error: string } {
  if (payment?.status !== 'succeeded' || payment?.paid !== true) {
    return { ok: false, status: 400, error: 'Платёж не завершён' };
  }

  const meta = payment.metadata || {};
  if (!meta.user_id || !meta.plan) {
    return { ok: false, status: 400, error: 'Нет данных пользователя в платеже' };
  }
  if (!PLAN_KEYS[meta.plan]) {
    return { ok: false, status: 400, error: 'Неизвестный тариф в платеже' };
  }

  // Платёж без зафиксированных сервером суммы и валюты автоматически не активируется.
  // Раньше это считалось «legacy-случаем» и проверка суммы пропускалась — то есть
  // дешёвые платежи, созданные до фикса подделки amount, оставались рабочими.
  // Легитимные старые платежи проводятся вручную (см. docs/prompts/), а не этой ручкой.
  if (!meta.amount || !meta.currency) {
    return { ok: false, status: 400, error: 'Платёж создан до фиксации суммы на сервере — требуется ручная сверка' };
  }

  const paidCurrency = payment.amount?.currency;
  if (paidCurrency !== meta.currency || paidCurrency !== CURRENCY) {
    return { ok: false, status: 400, error: 'Валюта платежа не совпадает' };
  }

  const paid = Number(payment.amount?.value);
  const expected = Number(meta.amount);
  if (!Number.isFinite(paid) || !Number.isFinite(expected) || Math.abs(paid - expected) > 0.01) {
    return { ok: false, status: 400, error: 'Сумма платежа не совпадает с заказанной' };
  }

  return { ok: true };
}

/**
 * Единственный путь выдачи подписки по платежу — и для `/activate`, и для webhook.
 * Захват платежа в журнале идёт ДО активации: повторный вызов не двигает expire_date,
 * не шлёт второе уведомление и не дублирует partner postback.
 */
async function activateVerifiedPayment(
  payment: any,
  source: 'activate' | 'webhook',
): Promise<{ status: number; body: Record<string, any> }> {
  const verdict = verifyPayment(payment);
  if (!verdict.ok) {
    return { status: verdict.status, body: { error: verdict.error, status: payment?.status } };
  }

  const meta = payment.metadata;
  const paymentId = payment.id;

  const claim = await claimPaymentActivation({
    paymentId,
    userId: meta.user_id,
    plan: meta.plan,
    amount: String(payment.amount?.value ?? ''),
    currency: String(payment.amount?.currency ?? CURRENCY),
    source,
  });

  if (!claim.claimed) {
    if (claim.reason === 'needs-reconciliation') {
      // Захват завис: активацию мог оборвать умерший инстанс. Автоматически не
      // перехватываем — без CAS два процесса выдали бы подписку дважды.
      console.warn(`[yookassa/${source}] Платёж ${paymentId} требует ручной сверки`);
      return { status: 409, body: { error: 'Платёж требует ручной сверки, обратитесь в поддержку', needsReconciliation: true } };
    }
    if (claim.reason === 'in-progress') {
      // Обработка идёт. Успехом отвечать нельзя: подписки может ещё не быть, а
      // клиент по alreadyProcessed прекращал поллинг и показывал «Тариф активирован».
      // Для вебхука 409 означает «повтори уведомление позже» — это и нужно.
      console.log(`[yookassa/${source}] Платёж ${paymentId} уже в обработке — просим повтор`);
      return { status: 409, body: { error: 'Платёж обрабатывается, повторите через минуту', inProgress: true, retryable: true } };
    }
    console.log(`[yookassa/${source}] Платёж ${paymentId} уже обработан — активация пропущена`);
    return { status: 200, body: { ok: true, plan: meta.plan, alreadyProcessed: true } };
  }

  // Скидочный платёж активируется только под существующую бронь. Нет брони — значит
  // скидка не была захвачена атомарно, и активировать такой платёж нельзя.
  if (meta.promo_id) {
    if (!meta.order_id) {
      await releasePaymentActivation(claim.recordId);
      return { status: 400, body: { error: 'Платёж со скидкой без привязки к брони — требуется ручная сверка' } };
    }
    const reservation = await getReservationByPayment(meta.order_id);
    if (!reservation || reservation.status === 'released') {
      await releasePaymentActivation(claim.recordId);
      return { status: 400, body: { error: 'Бронь промокода не найдена — требуется ручная сверка' } };
    }
  }

  try {
    await activateSubscription(meta.user_id, meta.plan);
  } catch (err) {
    // Подписку выдать не удалось — снимаем захват, иначе человек, который заплатил,
    // упрётся в «уже обработано» из-за нашей же ошибки.
    await releasePaymentActivation(claim.recordId);
    throw err;
  }

  await completePaymentActivation(claim.recordId);

  // Промокод расходуется ровно один раз: повторный вызов по уже погашенной броне
  // ничего не меняет, поэтому /activate и webhook друг друга не дублируют.
  if (meta.promo_id && meta.order_id) {
    try {
      const redeemed = await completePromoReservation(meta.order_id);
      if (redeemed.completed) {
        await recordPromoUse(meta.promo_id, meta.user_id, paymentId, meta.plan);
      }
    } catch (err: any) {
      console.error('[yookassa] Не удалось погасить бронь промокода:', err?.message);
    }
  }

  // Postback — после отметки об обработке: повторный запрос сюда уже не дойдёт.
  try {
    const userResp = await fetch(
      `${DIRECTUS_URL}/users/${meta.user_id}?fields=omemo_partner_code,email,telegram_chat_id`,
      { headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` } },
    );
    if (userResp.ok) {
      const { data: ud } = await userResp.json();
      if (ud?.omemo_partner_code) {
        sendPurchasePostback({
          partnerCode: ud.omemo_partner_code,
          userId: meta.user_id,
          paymentId,
          amount: parseFloat(payment.amount?.value || '0'),
          email: ud.email,
          telegramId: ud.telegram_chat_id,
        }).catch(() => {});
      }
    }
  } catch (_) {}

  return { status: 200, body: { ok: true, plan: meta.plan } };
}

// POST /api/payments/:paymentId/activate — активация подписки после успешного платежа
router.post('/payments/:paymentId/activate', async (req: Request, res: Response) => {
  if (!isConfigured()) return res.status(503).json({ error: 'ЮКасса не настроена' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Требуется авторизация' });

  const { paymentId } = req.params;
  if (!paymentId) return res.status(400).json({ error: 'paymentId обязателен' });

  try {
    const payment = await yookassaRequest('GET', `/${paymentId}`);
    const result = await activateVerifiedPayment(payment, 'activate');
    return res.status(result.status).json(result.body);
  } catch (err: any) {
    // Журнал недоступен — платёж уже оплачен, поэтому отвечаем повторяемой ошибкой:
    // клиент вправе попробовать снова, а мы не выдаём подписку без защиты.
    if (err instanceof LedgerUnavailableError || err instanceof PromoReservationUnavailableError) {
      console.error('[yookassa/activate] Защита недоступна:', err?.message);
      return res.status(503).json({
        error: 'Не удалось подтвердить платёж, попробуйте через минуту',
        retryable: true,
      });
    }
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

    if (eventType === 'payment.succeeded' && paymentObj?.id) {
      if (!isConfigured()) {
        console.warn('[yookassa/webhook] ЮКасса не настроена, пропускаем активацию');
        return res.json({ ok: true });
      }

      // Единственное, что берём из тела запроса, — идентификатор платежа. Всё
      // остальное (сумма, валюта, metadata, статус) читаем из объекта, повторно
      // запрошенного у ЮКассы: тело вебхука приходит извне и доверия не имеет.
      const verified = await yookassaRequest('GET', `/${paymentObj.id}`);
      const result = await activateVerifiedPayment(verified, 'webhook');
      if (result.status !== 200) {
        console.warn(`[yookassa/webhook] Платёж ${paymentObj.id} отклонён: ${result.body.error}`);
      }
    }

    // Отмена платежа освобождает бронь промокода СРАЗУ. Без этой ветки бронь висела
    // до реклейма следующим претендентом, а для кодов без max_uses — навсегда: сам
    // пользователь повторить попытку уже не мог (находка ревью 2026-07-28).
    if ((eventType === 'payment.canceled' || eventType === 'payment.expired') && paymentObj?.id) {
      if (!isConfigured()) {
        console.warn('[yookassa/webhook] ЮКасса не настроена, пропускаем освобождение брони');
        return res.json({ ok: true });
      }

      // Статус подтверждаем у ЮКассы: тело вебхука приходит извне, и по нему нельзя
      // освобождать бронь живого платежа.
      const verified = await yookassaRequest('GET', `/${paymentObj.id}`);
      const status = verified?.status;
      const orderId = verified?.metadata?.order_id;

      if (status !== 'canceled' && status !== 'expired') {
        console.warn(`[yookassa/webhook] Платёж ${paymentObj.id} не отменён (${status}) — бронь не трогаем`);
      } else if (!orderId) {
        console.warn(`[yookassa/webhook] У платежа ${paymentObj.id} нет order_id — бронь не находим`);
      } else {
        await releasePromoReservation(orderId, `платёж ${paymentObj.id} отменён (${status})`);
        console.log(`[yookassa/webhook] Бронь промокода по ${orderId} освобождена: платёж ${status}`);
      }
    }

    // 200 отдаём только когда платёж действительно обработан (или осознанно отклонён):
    // иначе ЮКасса будет ретраить уже проведённый платёж.
    return res.json({ ok: true });
  } catch (err: any) {
    // Захват не зафиксирован — успехом отвечать нельзя. 500 заставит ЮКассу повторить
    // уведомление позже, когда журнал вернётся.
    if (err instanceof LedgerUnavailableError || err instanceof PromoReservationUnavailableError) {
      console.error('[yookassa/webhook] Защита недоступна, просим повтор:', err?.message);
      return res.status(503).json({ error: 'Хранилище недоступно, повторите уведомление', retryable: true });
    }
    console.error('[yookassa/webhook] Ошибка:', err?.message);
    return res.status(500).json({ error: err?.message });
  }
});

// GET /api/payments/available — можно ли сейчас принимать онлайн-оплату
router.get('/payments/available', async (_req: Request, res: Response) => {
  // Не только «настроена ЮКасса», но и «есть чем защититься от повторной активации».
  // Без журнала оплата обязана быть выключена, а не работать без защиты.
  const ledgerReady = isConfigured() ? await isLedgerReady() : false;
  res.json({ available: isConfigured() && ledgerReady });
});

export default router;

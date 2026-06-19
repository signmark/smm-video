/**
 * Сервис отправки partner postback на Omemo Partner API.
 *
 * Env vars:
 *   OMEMO_POSTBACK_URL    — полный URL эндпоинта (по умолчанию https://omemo.tech/api/v1/postback)
 *   OMEMO_POSTBACK_SECRET — shared secret (Bearer + X-Omemo-Token)
 */

const POSTBACK_URL = process.env.OMEMO_POSTBACK_URL || 'https://omemo.tech/api/v1/postback';
const POSTBACK_SECRET = process.env.OMEMO_POSTBACK_SECRET || '';
const SOURCE_APP = 'smmhub';
const SCHEMA_VERSION = '1.0';

interface PostbackBase {
  partner_code: string;
  transaction_id: string;
  product_id?: number;
  buyer_user_id?: string;
  buyer_email?: string;
  buyer_telegram_id?: string;
}

interface RegistrationPostback extends PostbackBase {
  event_type: 'registration';
}

interface PurchasePostback extends PostbackBase {
  event_type: 'purchase';
  amount: number;
}

type PostbackPayload = RegistrationPostback | PurchasePostback;

async function send(payload: PostbackPayload): Promise<void> {
  if (!POSTBACK_SECRET) {
    console.warn('[partner-postback] OMEMO_POSTBACK_SECRET не задан — postback не отправлен');
    return;
  }
  if (!payload.partner_code) {
    return;
  }

  const body = JSON.stringify({
    ...payload,
    source_app: SOURCE_APP,
    schema_version: SCHEMA_VERSION,
  });

  try {
    const res = await fetch(POSTBACK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${POSTBACK_SECRET}`,
        'X-Omemo-Token': POSTBACK_SECRET,
      },
      body,
    });

    const text = await res.text().catch(() => '');
    if (res.ok) {
      console.log(`[partner-postback] ✅ ${payload.event_type} отправлен (partner=${payload.partner_code} tx=${payload.transaction_id})`);
    } else {
      console.warn(`[partner-postback] ⚠️ ${payload.event_type} → HTTP ${res.status}: ${text}`);
    }
  } catch (err: any) {
    console.error(`[partner-postback] ❌ Ошибка отправки ${payload.event_type}:`, err?.message);
  }
}

/**
 * Отправить postback о регистрации нового пользователя.
 */
export async function sendRegistrationPostback(opts: {
  partnerCode: string;
  userId: string;
  email?: string;
  telegramId?: string;
  productId?: number;
}): Promise<void> {
  await send({
    event_type: 'registration',
    partner_code: opts.partnerCode,
    transaction_id: `smmhub-registration-${opts.userId}`,
    product_id: opts.productId,
    buyer_user_id: opts.userId,
    buyer_email: opts.email,
    buyer_telegram_id: opts.telegramId,
  });
}

/**
 * Отправить postback о покупке подписки.
 */
export async function sendPurchasePostback(opts: {
  partnerCode: string;
  userId: string;
  paymentId: string;
  amount: number;
  email?: string;
  telegramId?: string;
  productId?: number;
}): Promise<void> {
  await send({
    event_type: 'purchase',
    partner_code: opts.partnerCode,
    transaction_id: `smmhub-purchase-${opts.paymentId}`,
    amount: opts.amount,
    product_id: opts.productId,
    buyer_user_id: opts.userId,
    buyer_email: opts.email,
    buyer_telegram_id: opts.telegramId,
  });
}

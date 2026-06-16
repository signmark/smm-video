const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.roboflow.space';
const ADMIN_TOKEN = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN || '';

interface OmemoConfig {
  secret: string;
  apiUrl: string;
  productIdDefault: string | null;
  productIdByPlan: Record<string, string>;
}

let cachedConfig: OmemoConfig | null = null;
let cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function loadConfig(): Promise<OmemoConfig | null> {
  const now = Date.now();
  if (cachedConfig && now - cacheTs < CACHE_TTL) return cachedConfig;

  try {
    const keysNeeded = [
      'POSTBACK_SHARED_SECRET',
      'OMEMO_API_URL',
      'OMEMO_PRODUCT_ID',
      'OMEMO_PRODUCT_ID_BASIC',
      'OMEMO_PRODUCT_ID_PRO',
      'OMEMO_PRODUCT_ID_BUSINESS',
    ];
    const filter = keysNeeded.map(k => `filter[service_name][_in][]=${k}`).join('&');
    const res = await fetch(
      `${DIRECTUS_URL}/items/global_api_keys?${filter}&fields=service_name,api_key`,
      { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const items: { service_name: string; api_key: string }[] = data.data || [];

    let secret = process.env.POSTBACK_SHARED_SECRET || '';
    let apiUrl = process.env.OMEMO_API_URL || 'https://omemo.tech';
    let productIdDefault: string | null = null;
    const productIdByPlan: Record<string, string> = {};

    for (const item of items) {
      switch (item.service_name) {
        case 'POSTBACK_SHARED_SECRET': secret = item.api_key; break;
        case 'OMEMO_API_URL': apiUrl = item.api_key; break;
        case 'OMEMO_PRODUCT_ID': productIdDefault = item.api_key; break;
        case 'OMEMO_PRODUCT_ID_BASIC': productIdByPlan['basic'] = item.api_key; break;
        case 'OMEMO_PRODUCT_ID_PRO': productIdByPlan['pro'] = item.api_key; break;
        case 'OMEMO_PRODUCT_ID_BUSINESS': productIdByPlan['business'] = item.api_key; break;
      }
    }

    if (!secret) {
      console.warn('[omemo-postback] POSTBACK_SHARED_SECRET не задан — postback отключён');
      return null;
    }

    cachedConfig = { secret, apiUrl, productIdDefault, productIdByPlan };
    cacheTs = now;
    return cachedConfig;
  } catch (err: any) {
    console.error('[omemo-postback] Ошибка загрузки конфига:', err.message);
    return null;
  }
}

export async function sendRegistrationPostback(partnerCode: string, userId: string): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg) return;

  const payload = {
    partner_code: partnerCode,
    event_type: 'registration',
    transaction_id: `registration-${userId}`,
  };

  try {
    const res = await fetch(`${cfg.apiUrl}/api/v1/postback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.secret}`,
        'X-Omemo-Token': cfg.secret,
      },
      body: JSON.stringify(payload),
    });
    const body = await res.text();
    console.log(`[omemo-postback] registration ${partnerCode} → ${res.status}: ${body}`);
  } catch (err: any) {
    console.error('[omemo-postback] Ошибка отправки registration postback:', err.message);
  }
}

export async function sendPurchasePostback(
  partnerCode: string,
  paymentId: string,
  amount: number,
  buyerTelegramId?: string | null,
  buyerEmail?: string | null,
  planKey?: string | null
): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg) return;

  const productId: string | null =
    (planKey && cfg.productIdByPlan[planKey]) || cfg.productIdDefault || null;

  const payload: Record<string, any> = {
    partner_code: partnerCode,
    event_type: 'purchase',
    transaction_id: paymentId,
    amount,
  };
  if (productId) payload.product_id = productId;
  if (buyerTelegramId) payload.buyer_telegram_id = String(buyerTelegramId);
  if (buyerEmail) payload.buyer_email = buyerEmail;

  try {
    const res = await fetch(`${cfg.apiUrl}/api/v1/postback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.secret}`,
        'X-Omemo-Token': cfg.secret,
      },
      body: JSON.stringify(payload),
    });
    const body = await res.text();
    console.log(`[omemo-postback] purchase ${partnerCode} amount=${amount} → ${res.status}: ${body}`);
  } catch (err: any) {
    console.error('[omemo-postback] Ошибка отправки purchase postback:', err.message);
  }
}

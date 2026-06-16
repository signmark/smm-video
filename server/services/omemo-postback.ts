const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.roboflow.space';
const ADMIN_TOKEN = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN || '';

let cachedSecret: string | null = null;
let cachedApiUrl: string | null = null;
let cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function loadConfig(): Promise<{ secret: string; apiUrl: string } | null> {
  const now = Date.now();
  if (cachedSecret && cachedApiUrl && now - cacheTs < CACHE_TTL) {
    return { secret: cachedSecret, apiUrl: cachedApiUrl };
  }

  try {
    const res = await fetch(
      `${DIRECTUS_URL}/items/global_api_keys?filter[service_name][_in]=POSTBACK_SHARED_SECRET,OMEMO_API_URL&fields=service_name,api_key`,
      { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const items: { service_name: string; api_key: string }[] = data.data || [];

    let secret = process.env.POSTBACK_SHARED_SECRET || '';
    let apiUrl = process.env.OMEMO_API_URL || 'https://omemo.tech';

    for (const item of items) {
      if (item.service_name === 'POSTBACK_SHARED_SECRET') secret = item.api_key;
      if (item.service_name === 'OMEMO_API_URL') apiUrl = item.api_key;
    }

    if (!secret) {
      console.warn('[omemo-postback] POSTBACK_SHARED_SECRET не задан — postback отключён');
      return null;
    }

    cachedSecret = secret;
    cachedApiUrl = apiUrl;
    cacheTs = now;
    return { secret, apiUrl };
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
  buyerTelegramId?: string | null
): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg) return;

  const payload: Record<string, any> = {
    partner_code: partnerCode,
    event_type: 'purchase',
    transaction_id: paymentId,
    amount,
  };
  if (buyerTelegramId) payload.buyer_telegram_id = String(buyerTelegramId);

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

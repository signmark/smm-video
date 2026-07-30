/**
 * POST /api/payments/create — сумма считается сервером, а не берётся из тела запроса.
 *
 * Регрессия на находку ревью: роут принимал `amount` от клиента, если она была
 * положительной и не выше базовой цены, и вообще не смотрел на `promoCode`. То есть
 * `{plan:'Профессиональный', amount:1}` создавал платёж на рубль, а `/activate` по нему
 * выдавал полный тариф на 30 дней. Клиентская проверка работала как security boundary.
 *
 * Здесь мокается только сеть (ЮКасса + Directus); логика цены и промокода — настоящая.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';

const BASE_PRICE = 670;

vi.mock('../services/plan-pricing', () => ({
  resolvePlanPrice: vi.fn(async () => ({ price: BASE_PRICE, original: 1990 })),
}));

vi.mock('../services/partner-postback', () => ({
  sendPurchasePostback: vi.fn().mockResolvedValue(undefined),
}));

const OLD_ENV = { ...process.env };
process.env.YOOKASSA_SHOP_ID = 'shop-test';
process.env.YOOKASSA_SECRET_KEY = 'secret-test';
process.env.DIRECTUS_URL = 'https://directus.test';
process.env.DIRECTUS_STATIC_TOKEN = 'admin-token-test';

/** Промокод, который вернёт мок Directus. null = «кода нет в базе». */
let promoRow: Record<string, any> | null = null;
/** Уже использованные этим пользователем коды. */
let promoUses: any[] = [];
/** Единственная бронь, созданная в ходе теста (см. фейк ниже). */
let promoReservation: Record<string, any> | null = null;
/** Тело, с которым ушёл запрос на создание платежа в ЮКассу. */
let yookassaCreateBody: any = null;

function jsonResponse(body: any, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as any);
}

const fetchMock = vi.fn((url: any, init?: any) => {
  const u = String(url);

  if (u.includes('api.yookassa.ru')) {
    yookassaCreateBody = init?.body ? JSON.parse(init.body) : null;
    return jsonResponse({
      id: 'pay-1',
      confirmation: { confirmation_url: 'https://yookassa.test/confirm' },
    });
  }
  if (u.includes('/users/me')) return jsonResponse({ data: { id: 'user-1' } });
  if (u.includes('/items/promo_codes')) return jsonResponse({ data: promoRow ? [promoRow] : [] });
  if (u.includes('/items/promo_code_uses')) return jsonResponse({ data: promoUses });

  // Брони: этот тест про цену, а не про них, но обойтись без них нельзя.
  // markPaymentAttempt/attachPaymentId больше не молчат при отсутствии строки
  // (AI-48 п.4), и заглушка `{data:{}}` здесь означала бы «бронь исчезла» —
  // оплата честно прерывалась бы с 503. Держим минимальную живую строку.
  if (u.includes('/items/promo_reservations')) {
    const method = init?.method || 'GET';
    if (method === 'POST') {
      promoReservation = { id: 'res-1', status: 'reserved', ...JSON.parse(init.body) };
      return jsonResponse({ data: promoReservation });
    }
    if (method === 'PATCH') {
      if (promoReservation) Object.assign(promoReservation, JSON.parse(init.body).data ?? JSON.parse(init.body));
      return jsonResponse({ data: promoReservation ? [promoReservation] : [] });
    }
    return jsonResponse({ data: promoReservation ? [promoReservation] : [] });
  }
  if (u.includes('/users/user-1')) return jsonResponse({ data: { email: 'u@test.local' } });

  return jsonResponse({ data: {} });
});

vi.stubGlobal('fetch', fetchMock);

async function buildApp() {
  const router = (await import('../routes/yookassa')).default;
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  return app;
}

function pay(app: express.Express, body: Record<string, any>) {
  return request(app)
    .post('/api/payments/create')
    .set('Authorization', 'Bearer user-token')
    .send(body);
}

/** Сумма, с которой роут реально пошёл в ЮКассу. */
function chargedAmount(): string {
  return yookassaCreateBody?.amount?.value;
}

describe('POST /api/payments/create — цена только серверная', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    promoRow = null;
    promoUses = [];
    promoReservation = null;
    yookassaCreateBody = null;
    app = await buildApp();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('amount: 1 без промокода не снижает стоимость — списывается базовая цена', async () => {
    const res = await pay(app, { plan: 'Профессиональный', amount: 1 });

    expect(res.status).toBe(200);
    expect(chargedAmount()).toBe('670.00');
  });

  it('поддельная сумма вместе с невалидным промокодом не принимается', async () => {
    promoRow = null; // код в базе не найден

    const res = await pay(app, { plan: 'Профессиональный', amount: 1, promoCode: 'FAKE100' });

    expect(res.status).toBe(400);
    expect(res.body.promoRejected).toBe(true);
    // Платёж вообще не создавался
    expect(yookassaCreateBody).toBeNull();
  });

  it('просроченный промокод скидки не даёт — платёж отклонён, а не создан со скидкой', async () => {
    promoRow = {
      id: 'promo-exp', code: 'EXPIRED', type: 'discount', value: 90,
      is_active: true, expires_at: '2020-01-01T00:00:00Z', max_uses: null, used_count: 0,
    };

    const res = await pay(app, { plan: 'Профессиональный', amount: 67, promoCode: 'EXPIRED' });

    expect(res.status).toBe(400);
    expect(yookassaCreateBody).toBeNull();
  });

  it('валидная скидка рассчитывается сервером, а не берётся из тела запроса', async () => {
    promoRow = {
      id: 'promo-50', code: 'HALF', type: 'discount', value: 50,
      is_active: true, expires_at: null, max_uses: null, used_count: 0,
    };

    // Клиент врёт про сумму: просит 1 ₽ при скидке 50%.
    const res = await pay(app, { plan: 'Профессиональный', amount: 1, promoCode: 'HALF' });

    expect(res.status).toBe(200);
    expect(chargedAmount()).toBe('335.00'); // 670 * 0.5, а не 1
  });

  it('план, сумма, валюта и промокод уезжают в metadata платежа', async () => {
    promoRow = {
      id: 'promo-50', code: 'HALF', type: 'discount', value: 50,
      is_active: true, expires_at: null, max_uses: null, used_count: 0,
    };

    await pay(app, { plan: 'Профессиональный', promoCode: 'HALF' });

    expect(yookassaCreateBody.metadata).toMatchObject({
      user_id: 'user-1',
      plan: 'Профессиональный',
      amount: '335.00',
      currency: 'RUB',
      promo_code: 'HALF',
      promo_id: 'promo-50',
    });
  });

  it('цена из resolvePlanPrice остаётся единым источником истины', async () => {
    const { resolvePlanPrice } = await import('../services/plan-pricing');
    (resolvePlanPrice as any).mockResolvedValueOnce({ price: 1234, original: 2000 });

    const res = await pay(app, { plan: 'Профессиональный', amount: 670 });

    expect(res.status).toBe(200);
    // Сумма поехала за резолвером, а не за «привычными» 670 из тела запроса
    expect(chargedAmount()).toBe('1234.00');
  });

  it('промокод, уже использованный этим пользователем, скидки не даёт', async () => {
    promoRow = {
      id: 'promo-50', code: 'HALF', type: 'discount', value: 50,
      is_active: true, expires_at: null, max_uses: null, used_count: 0,
    };
    promoUses = [{ id: 'use-1', promo_code_id: 'promo-50', user_id: 'user-1' }];

    const res = await pay(app, { plan: 'Профессиональный', promoCode: 'HALF' });

    expect(res.status).toBe(400);
    expect(yookassaCreateBody).toBeNull();
  });

  it('нескидочный промокод (extra_days) цену платежа не меняет', async () => {
    promoRow = {
      id: 'promo-days', code: 'PLUS30', type: 'extra_days', value: 30,
      is_active: true, expires_at: null, max_uses: null, used_count: 0,
    };

    const res = await pay(app, { plan: 'Профессиональный', promoCode: 'PLUS30' });

    expect(res.status).toBe(200);
    expect(chargedAmount()).toBe('670.00');
  });
});

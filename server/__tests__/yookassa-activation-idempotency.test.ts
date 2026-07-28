/**
 * Активация подписки идемпотентна: один succeeded-платёж выдаёт 30 дней ровно один раз.
 *
 * Регрессия на находку ревью: `/api/payments/:paymentId/activate` нигде не отмечал
 * платёж обработанным, поэтому один и тот же paymentId можно было предъявлять
 * сколько угодно раз. Каждый вызов двигал expire_date ещё на 30 дней от «сейчас»,
 * слал ещё одно Telegram-уведомление и ещё один partner postback. Webhook шёл тем же
 * путём и брал metadata из тела запроса, а не из проверенного платежа.
 *
 * Журнал платежей здесь — поверх фейкового Directus (объект в тесте), а не мок самого
 * ledger'а: проверяется в том числе то, что захват идёт до активации.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../services/plan-pricing', () => ({
  resolvePlanPrice: vi.fn(async () => ({ price: 670, original: 1990 })),
}));

const sendPurchasePostback = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/partner-postback', () => ({
  sendPurchasePostback: (...args: any[]) => sendPurchasePostback(...args),
}));

const OLD_ENV = { ...process.env };
process.env.YOOKASSA_SHOP_ID = 'shop-test';
process.env.YOOKASSA_SECRET_KEY = 'secret-test';
process.env.DIRECTUS_URL = 'https://directus.test';
process.env.DIRECTUS_STATIC_TOKEN = 'admin-token-test';
process.env.TELEGRAM_BOT_TOKEN = 'bot-token-test';

/** Фейковый Directus-журнал: строки + уникальность payment_id, как в настоящей коллекции. */
let ledgerRows: any[] = [];
let ledgerSeq = 0;

/** Все PATCH'и на /users/<id> — так видно, сколько раз двигали expire_date. */
let userPatches: any[] = [];
/** Сколько раз ушло Telegram-уведомление. */
let telegramSends = 0;

const PAYMENT = {
  id: 'pay-777',
  status: 'succeeded',
  paid: true,
  amount: { value: '670.00', currency: 'RUB' },
  metadata: { user_id: 'user-1', plan: 'Профессиональный', amount: '670.00', currency: 'RUB' },
};

/** Что вернёт GET к ЮКассе. Тесты подменяют для негативных сценариев. */
let yookassaPayment: any = PAYMENT;

function jsonResponse(body: any, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: async () => body, text: async () => JSON.stringify(body) } as any);
}

const fetchMock = vi.fn((url: any, init?: any) => {
  const u = String(url);
  const method = init?.method || 'GET';
  const body = init?.body ? JSON.parse(init.body) : null;

  if (u.includes('api.yookassa.ru')) return jsonResponse(yookassaPayment);
  if (u.includes('api.telegram.org')) { telegramSends++; return jsonResponse({ ok: true }); }

  // --- журнал активаций ---
  if (u.includes('/collections/payment_activations')) return jsonResponse({ data: {} });
  if (u.endsWith('/collections')) return jsonResponse({ data: {} });

  if (u.includes('/items/payment_activations')) {
    if (method === 'POST') {
      if (ledgerRows.some(r => r.payment_id === body.payment_id)) {
        // Ровно так Directus отвечает на нарушение уникального индекса.
        return jsonResponse(
          { errors: [{ message: 'Value has to be unique.', extensions: { code: 'RECORD_NOT_UNIQUE' } }] },
          false, 400,
        );
      }
      const row = { id: `led-${++ledgerSeq}`, ...body };
      ledgerRows.push(row);
      return jsonResponse({ data: row });
    }
    if (method === 'PATCH') {
      const id = u.split('/').pop()!.split('?')[0];
      const row = ledgerRows.find(r => r.id === id);
      if (row) Object.assign(row, body);
      return jsonResponse({ data: row });
    }
    if (method === 'DELETE') {
      const id = u.split('/').pop()!.split('?')[0];
      ledgerRows = ledgerRows.filter(r => r.id !== id);
      return jsonResponse({ data: null });
    }
    // GET по фильтру
    const m = u.match(/payment_id\]\[_eq\]=([^&]+)/);
    const found = m ? ledgerRows.filter(r => r.payment_id === decodeURIComponent(m[1])) : ledgerRows;
    return jsonResponse({ data: found });
  }

  // --- пользователи ---
  if (u.includes('/users/user-1')) {
    if (method === 'PATCH') { userPatches.push(body); return jsonResponse({ data: {} }); }
    return jsonResponse({
      data: {
        telegram_chat_id: 'chat-1',
        first_name: 'Иван',
        omemo_partner_code: 'PARTNER1',
        email: 'u@test.local',
      },
    });
  }
  if (u.includes('/users/me')) return jsonResponse({ data: { id: 'user-1' } });

  return jsonResponse({ data: {} });
});

vi.stubGlobal('fetch', fetchMock);

let app: express.Express;

async function buildApp() {
  const { resetLedgerCache } = await import('../services/payment-activation-ledger');
  resetLedgerCache();
  const router = (await import('../routes/yookassa')).default;
  const a = express();
  a.use(express.json());
  a.use('/api', router);
  return a;
}

function activate(paymentId = 'pay-777') {
  return request(app)
    .post(`/api/payments/${paymentId}/activate`)
    .set('Authorization', 'Bearer user-token')
    .send({});
}

function webhook(paymentId = 'pay-777', extra: Record<string, any> = {}) {
  return request(app)
    .post('/api/yookassa/webhook')
    .send({ event: 'payment.succeeded', object: { id: paymentId, ...extra } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  ledgerRows = [];
  ledgerSeq = 0;
  userPatches = [];
  telegramSends = 0;
  sendPurchasePostback.mockClear();
  yookassaPayment = PAYMENT;
  app = await buildApp();
});

afterAll(() => {
  process.env = OLD_ENV;
});

describe('POST /api/payments/:paymentId/activate — идемпотентность', () => {
  it('первая активация выдаёт подписку', async () => {
    const res = await activate();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(userPatches).toHaveLength(1);
    expect(userPatches[0]).toMatchObject({ plan: 'pro' });
  });

  it('повторный запрос не меняет expire_date, не шлёт уведомление и не дублирует postback', async () => {
    await activate();
    const expireAfterFirst = userPatches[0].expire_date;
    const telegramAfterFirst = telegramSends;

    const second = await activate();

    expect(second.status).toBe(200);
    expect(second.body.alreadyProcessed).toBe(true);
    // Второго PATCH'а по пользователю не было вообще
    expect(userPatches).toHaveLength(1);
    expect(userPatches[0].expire_date).toBe(expireAfterFirst);
    expect(telegramSends).toBe(telegramAfterFirst);
    expect(sendPurchasePostback).toHaveBeenCalledTimes(1);
  });

  it('третий и четвёртый запрос тоже ничего не меняют', async () => {
    await activate();
    await activate();
    await activate();
    await activate();

    expect(userPatches).toHaveLength(1);
    expect(sendPurchasePostback).toHaveBeenCalledTimes(1);
  });

  it('состояние обработки лежит в Directus, а не в памяти процесса — переживает рестарт', async () => {
    await activate();
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]).toMatchObject({ payment_id: 'pay-777', status: 'completed' });

    // Рестарт процесса: модули перезагружаются, вся память теряется. Журнал — нет.
    vi.resetModules();
    app = await buildApp();

    const afterRestart = await activate();

    expect(afterRestart.body.alreadyProcessed).toBe(true);
    expect(userPatches).toHaveLength(1);
  });

  it('незавершённый платёж подписку не выдаёт', async () => {
    yookassaPayment = { ...PAYMENT, status: 'pending', paid: false };

    const res = await activate();

    expect(res.status).toBe(400);
    expect(userPatches).toHaveLength(0);
    expect(ledgerRows).toHaveLength(0);
  });

  it('платёж, оплаченный меньше заказанной суммы, отклоняется', async () => {
    // Заказали тариф за 670, а оплачен рубль — metadata не сходится с amount.
    yookassaPayment = { ...PAYMENT, amount: { value: '1.00', currency: 'RUB' } };

    const res = await activate();

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Сумма/);
    expect(userPatches).toHaveLength(0);
  });

  it('платёж в чужой валюте отклоняется', async () => {
    yookassaPayment = {
      ...PAYMENT,
      amount: { value: '670.00', currency: 'USD' },
      metadata: { ...PAYMENT.metadata, currency: 'USD' },
    };

    const res = await activate();

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Валюта/);
    expect(userPatches).toHaveLength(0);
  });

  it('платёж без metadata.user_id отклоняется', async () => {
    yookassaPayment = { ...PAYMENT, metadata: { plan: 'Профессиональный' } };

    const res = await activate();

    expect(res.status).toBe(400);
    expect(userPatches).toHaveLength(0);
  });

  it('неизвестный тариф в metadata отклоняется', async () => {
    yookassaPayment = { ...PAYMENT, metadata: { ...PAYMENT.metadata, plan: 'Безлимитный-навсегда' } };

    const res = await activate();

    expect(res.status).toBe(400);
    expect(userPatches).toHaveLength(0);
  });
});

describe('POST /api/yookassa/webhook — тот же механизм идемпотентности', () => {
  it('повторный webhook по тому же платежу не выдаёт вторую подписку', async () => {
    await webhook();
    expect(userPatches).toHaveLength(1);

    await webhook();
    await webhook();

    expect(userPatches).toHaveLength(1);
    expect(sendPurchasePostback).toHaveBeenCalledTimes(1);
  });

  it('webhook после ручной активации того же платежа ничего не добавляет', async () => {
    await activate();
    await webhook();

    expect(userPatches).toHaveLength(1);
    expect(sendPurchasePostback).toHaveBeenCalledTimes(1);
  });

  it('метаданные берутся из проверенного платежа, а не из тела webhook', async () => {
    // Тело webhook подсовывает чужого пользователя и другой тариф.
    await webhook('pay-777', {
      paid: true,
      metadata: { user_id: 'attacker', plan: 'Профессиональный' },
      amount: { value: '99999.00', currency: 'RUB' },
    });

    // Подписка выдана владельцу платежа из verified-объекта, не «attacker»
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]).toMatchObject({ payment_id: 'pay-777', user_id: 'user-1', amount: '670.00' });
  });

  it('webhook по неоплаченному платежу подписку не выдаёт', async () => {
    yookassaPayment = { ...PAYMENT, status: 'canceled', paid: false };

    const res = await webhook();

    // ЮКассе отвечаем 200, чтобы она не ретраила, но активации нет
    expect(res.status).toBe(200);
    expect(userPatches).toHaveLength(0);
    expect(ledgerRows).toHaveLength(0);
  });
});

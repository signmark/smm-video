/**
 * Идемпотентность активации подписки — только durable-журнал.
 *
 * Находки ревью:
 *  (а) один succeeded-платёж можно было предъявлять `/activate` сколько угодно раз;
 *  (б) первая версия журнала при любой ошибке Directus падала на запасной журнал в
 *      памяти процесса. В проде коллекции не было, значит журнал был в памяти ВСЕГДА,
 *      и после каждого рестарта старый paymentId активировался заново.
 *
 * Поэтому здесь проверяется не только «повтор не проходит», но и то, что при
 * недоступном журнале оплата ВЫКЛЮЧАЕТСЯ, а не работает без защиты.
 *
 * Фейковый Directus — с уникальными индексами, как в настоящей коллекции: без них
 * захват платежа перестаёт быть атомарным.
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

/** Строки фейковых коллекций. */
let tables: Record<string, any[]> = {};
let seq = 0;
/** Какие коллекции «существуют». Пустой набор = журнала нет. */
let liveCollections = new Set(['payment_activations', 'promo_reservations', 'promo_code_uses', 'promo_codes']);
/** Уникальные поля — ровно те, что заводит миграционный скрипт. */
const UNIQUES: Record<string, string[]> = {
  payment_activations: ['payment_id'],
  promo_reservations: ['payment_id', 'user_lock', 'slot_lock'],
};

let userPatches: any[] = [];
let telegramSends = 0;

const PAYMENT = {
  id: 'pay-777',
  status: 'succeeded',
  paid: true,
  amount: { value: '670.00', currency: 'RUB' },
  metadata: { user_id: 'user-1', plan: 'Профессиональный', amount: '670.00', currency: 'RUB', order_id: 'order-777' },
};
let yookassaPayment: any = PAYMENT;

function jsonResponse(body: any, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: async () => body, text: async () => JSON.stringify(body) } as any);
}

function uniqueViolation() {
  return jsonResponse(
    { errors: [{ message: 'Value has to be unique.', extensions: { code: 'RECORD_NOT_UNIQUE' } }] },
    false, 400,
  );
}

/** Разбирает `?filter[field][_eq]=value` и `_in`. */
function matchRows(rows: any[], url: string): any[] {
  const conds = [...url.matchAll(/filter\[(\w+)\]\[_(eq|in)\]=([^&]+)/g)];
  return rows.filter(r => conds.every(([, field, op, raw]) => {
    const value = decodeURIComponent(raw);
    return op === 'eq' ? String(r[field]) === value : value.split(',').includes(String(r[field]));
  }));
}

const fetchMock = vi.fn((url: any, init?: any) => {
  const u = String(url);
  const method = init?.method || 'GET';
  const body = init?.body ? JSON.parse(init.body) : null;

  if (u.includes('api.yookassa.ru')) return jsonResponse(yookassaPayment);
  if (u.includes('api.telegram.org')) { telegramSends++; return jsonResponse({ ok: true }); }

  const itemsMatch = u.match(/\/items\/(\w+)/);
  if (itemsMatch) {
    const name = itemsMatch[1];
    if (!liveCollections.has(name)) {
      return jsonResponse({ errors: [{ message: "You don't have permission to access this." }] }, false, 403);
    }
    tables[name] = tables[name] || [];
    const rows = tables[name];

    if (method === 'POST') {
      for (const field of UNIQUES[name] || []) {
        if (body[field] != null && rows.some(r => r[field] === body[field])) return uniqueViolation();
      }
      const row = { id: `${name}-${++seq}`, ...body };
      rows.push(row);
      return jsonResponse({ data: row });
    }
    if (method === 'PATCH') {
      const id = u.split('/').pop()!.split('?')[0];
      const row = rows.find(r => r.id === id);
      if (row) Object.assign(row, body);
      return jsonResponse({ data: row });
    }
    if (method === 'DELETE') {
      const id = u.split('/').pop()!.split('?')[0];
      tables[name] = rows.filter(r => r.id !== id);
      return jsonResponse({ data: null });
    }
    return jsonResponse({ data: matchRows(rows, u) });
  }

  if (u.includes('/users/user-1')) {
    if (method === 'PATCH') { userPatches.push(body); return jsonResponse({ data: {} }); }
    return jsonResponse({ data: { telegram_chat_id: 'chat-1', first_name: 'Иван', omemo_partner_code: 'P1', email: 'u@t.local' } });
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

const activate = (id = 'pay-777') =>
  request(app).post(`/api/payments/${id}/activate`).set('Authorization', 'Bearer t').send({});
const webhook = (id = 'pay-777') =>
  request(app).post('/api/yookassa/webhook').send({ event: 'payment.succeeded', object: { id } });
const available = () => request(app).get('/api/payments/available');
const create = (body: Record<string, any> = { plan: 'Профессиональный' }) =>
  request(app).post('/api/payments/create').set('Authorization', 'Bearer t').send(body);

beforeEach(async () => {
  vi.clearAllMocks();
  tables = {};
  seq = 0;
  liveCollections = new Set(['payment_activations', 'promo_reservations', 'promo_code_uses', 'promo_codes']);
  userPatches = [];
  telegramSends = 0;
  sendPurchasePostback.mockClear();
  yookassaPayment = PAYMENT;
  app = await buildApp();
});

afterAll(() => { process.env = OLD_ENV; });

describe('повтор активации', () => {
  it('первая активация выдаёт подписку', async () => {
    const res = await activate();
    expect(res.status).toBe(200);
    expect(userPatches).toHaveLength(1);
  });

  it('повтор в одном процессе не меняет expire_date, не шлёт уведомление и не дублирует postback', async () => {
    await activate();
    const expireAfterFirst = userPatches[0].expire_date;
    const tgAfterFirst = telegramSends;

    const second = await activate();

    expect(second.status).toBe(200);
    expect(second.body.alreadyProcessed).toBe(true);
    expect(userPatches).toHaveLength(1);
    expect(userPatches[0].expire_date).toBe(expireAfterFirst);
    expect(telegramSends).toBe(tgAfterFirst);
    expect(sendPurchasePostback).toHaveBeenCalledTimes(1);
  });

  it('после «рестарта» процесса повтор всё равно не проходит — журнал переживает перезапуск', async () => {
    await activate();
    expect(userPatches).toHaveLength(1);

    // Рестарт: модули перезагружаются, любая память процесса теряется.
    vi.resetModules();
    app = await buildApp();

    const after = await activate();

    expect(after.body.alreadyProcessed).toBe(true);
    expect(userPatches).toHaveLength(1);
  });

  it('два конкурентных claim выдают подписку ровно один раз', async () => {
    const [a, b] = await Promise.all([activate(), activate()]);

    expect(userPatches).toHaveLength(1);
    expect(sendPurchasePostback).toHaveBeenCalledTimes(1);
    expect([a.body.alreadyProcessed, b.body.alreadyProcessed].filter(Boolean)).toHaveLength(1);
  });

  it('webhook и ручная активация одного платежа не складываются', async () => {
    await activate();
    await webhook();
    expect(userPatches).toHaveLength(1);
  });
});

describe('журнал недоступен — оплата выключается, а не работает без защиты', () => {
  beforeEach(async () => {
    liveCollections.delete('payment_activations');
    app = await buildApp();
  });

  it('/available отдаёт available:false', async () => {
    const res = await available();
    expect(res.body.available).toBe(false);
  });

  it('/create возвращает 503 и не создаёт платёж в ЮКассе', async () => {
    const res = await create();
    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('ledger-unavailable');
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('api.yookassa.ru'))).toBe(false);
  });

  it('уже оплаченный платёж получает повторяемую 503, а не подписку', async () => {
    const res = await activate();
    expect(res.status).toBe(503);
    expect(res.body.retryable).toBe(true);
    expect(userPatches).toHaveLength(0);
  });

  it('webhook не отвечает успехом, если захват не зафиксирован', async () => {
    const res = await webhook();
    expect(res.status).toBe(503);
    expect(userPatches).toHaveLength(0);
  });

  it('в память не деградирует: подписки нет ни при одной из попыток', async () => {
    await activate();
    await activate();
    await activate();
    expect(userPatches).toHaveLength(0);
  });
});

describe('зависший захват', () => {
  it('протухшая запись уходит на ручную сверку, а не перехватывается автоматически', async () => {
    tables.payment_activations = [{
      id: 'led-stale',
      payment_id: 'pay-777',
      status: 'processing',
      claimed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }];

    const res = await activate();

    expect(res.status).toBe(409);
    expect(res.body.needsReconciliation).toBe(true);
    expect(userPatches).toHaveLength(0);
    expect(tables.payment_activations[0].needs_reconciliation).toBe(true);
  });

  it('свежий параллельный захват второй подписки не выдаёт', async () => {
    tables.payment_activations = [{
      id: 'led-fresh',
      payment_id: 'pay-777',
      status: 'processing',
      claimed_at: new Date().toISOString(),
    }];

    const res = await activate();

    // 409 «идёт обработка», а НЕ 200 alreadyProcessed: свежая запись в processing
    // означает, что подписки может ещё не быть — например, POST журнала оборвался
    // по сети уже после коммита строки, и владельца у неё нет. Успех здесь врал
    // плательщику и гасил поллинг клиента (находка ревью 2026-07-28).
    expect(res.status).toBe(409);
    expect(res.body.inProgress).toBe(true);
    expect(res.body.alreadyProcessed).toBeUndefined();
    // Главный инвариант прежний: второй подписки не выдано.
    expect(userPatches).toHaveLength(0);
  });
});

describe('сбой между выдачей подписки и отметкой completed', () => {
  it('ошибка записи completed не выдаёт вторую подписку при повторе', async () => {
    // PATCH журнала падает — подписка уже выдана, отметка не поставлена.
    const realFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: any, init?: any) => {
      if (String(url).includes('/items/payment_activations/') && init?.method === 'PATCH'
          && JSON.parse(init.body).status === 'completed') {
        return jsonResponse({ errors: [{ message: 'boom' }] }, false, 500);
      }
      return realFetch(url, init);
    });

    const first = await activate();
    expect(first.status).toBe(503); // вызывающий узнаёт, что отметки нет
    expect(userPatches).toHaveLength(1); // подписка выдана

    fetchMock.mockImplementation(realFetch);
    const second = await activate();

    // Запись осталась в processing и свежая → повтор не выдаёт вторую подписку.
    // Ответ — «идёт обработка»: отметки completed нет, значит успех не подтверждён.
    expect(second.status).toBe(409);
    expect(second.body.inProgress).toBe(true);
    expect(userPatches).toHaveLength(1);
  });

  it('ошибка выдачи подписки снимает захват, чтобы оплативший мог повторить', async () => {
    const realFetch = fetchMock.getMockImplementation()!;
    let failUserPatch = true;
    fetchMock.mockImplementation((url: any, init?: any) => {
      if (String(url).includes('/users/user-1') && init?.method === 'PATCH' && failUserPatch) {
        return jsonResponse({ errors: [{ message: 'directus down' }] }, false, 500);
      }
      return realFetch(url, init);
    });

    const first = await activate();
    expect(first.status).toBe(500);
    expect(tables.payment_activations || []).toHaveLength(0); // захват снят

    failUserPatch = false;
    const second = await activate();

    expect(second.status).toBe(200);
    expect(userPatches).toHaveLength(1);
  });
});

describe('платежи без зафиксированной суммы (fail closed)', () => {
  it('платёж без metadata.amount не активируется автоматически', async () => {
    yookassaPayment = { ...PAYMENT, metadata: { user_id: 'user-1', plan: 'Профессиональный' } };

    const res = await activate();

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ручная сверка/);
    expect(userPatches).toHaveLength(0);
  });

  it('платёж без metadata.currency не активируется автоматически', async () => {
    yookassaPayment = { ...PAYMENT, metadata: { user_id: 'user-1', plan: 'Профессиональный', amount: '670.00' } };

    const res = await activate();

    expect(res.status).toBe(400);
    expect(userPatches).toHaveLength(0);
  });

  it('оплата меньше заказанной суммы отклоняется', async () => {
    yookassaPayment = { ...PAYMENT, amount: { value: '1.00', currency: 'RUB' } };

    const res = await activate();

    expect(res.status).toBe(400);
    expect(userPatches).toHaveLength(0);
  });
});

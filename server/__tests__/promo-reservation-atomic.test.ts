/**
 * Скидочные промокоды расходуются атомарно.
 *
 * Находка ревью: промокод только проверялся и записывался в metadata платежа. Ни
 * `promo_code_uses`, ни `used_count` в платёжном потоке не создавались — один
 * пользователь получал скидку сколько угодно раз, а `max_uses` не расходовался.
 *
 * Схема на трёх уникальных индексах: `payment_id` (одна бронь на заказ), `user_lock`
 * (один код одному пользователю) и `slot_lock` (n-е использование). Фейковый Directus
 * ниже эти индексы соблюдает — без них проверка выродилась бы в «проверка-и-гонка»,
 * то есть ровно в тот баг, который чинится.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../services/plan-pricing', () => ({
  resolvePlanPrice: vi.fn(async () => ({ price: 1000, original: 2000 })),
}));
vi.mock('../services/partner-postback', () => ({ sendPurchasePostback: vi.fn().mockResolvedValue(undefined) }));

const OLD_ENV = { ...process.env };
process.env.YOOKASSA_SHOP_ID = 'shop-test';
process.env.YOOKASSA_SECRET_KEY = 'secret-test';
process.env.DIRECTUS_URL = 'https://directus.test';
process.env.DIRECTUS_STATIC_TOKEN = 'admin-token-test';

const UNIQUES: Record<string, string[]> = {
  payment_activations: ['payment_id'],
  promo_reservations: ['payment_id', 'user_lock', 'slot_lock'],
};

let tables: Record<string, any[]> = {};
let seq = 0;
let promo: any = null;
/** id пользователя, которого вернёт /users/me. Меняется, чтобы играть за разных. */
let currentUser = 'user-1';
/** Созданные в ЮКассе платежи: order_id → объект платежа. */
let yookassaPayments: Record<string, any> = {};
let paymentSeq = 0;
/** Статусы, которые ЮКасса отдаёт по своим платежам. */
let paymentStatus: Record<string, string> = {};
let userPatches: any[] = [];

function jsonResponse(body: any, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: async () => body, text: async () => JSON.stringify(body) } as any);
}
const uniqueViolation = () => jsonResponse(
  { errors: [{ message: 'Value has to be unique.', extensions: { code: 'RECORD_NOT_UNIQUE' } }] }, false, 400);

function matchRows(rows: any[], url: string): any[] {
  const conds = [...url.matchAll(/filter\[(\w+)\]\[_(eq|in)\]=([^&]+)/g)];
  return rows.filter(r => conds.every(([, f, op, raw]) => {
    const v = decodeURIComponent(raw);
    return op === 'eq' ? String(r[f]) === v : v.split(',').includes(String(r[f]));
  }));
}

const fetchMock = vi.fn((url: any, init?: any) => {
  const u = String(url);
  const method = init?.method || 'GET';
  const body = init?.body ? JSON.parse(init.body) : null;

  if (u.includes('api.yookassa.ru')) {
    if (method === 'POST') {
      const id = `pay-${++paymentSeq}`;
      const payment = {
        id,
        status: 'pending',
        paid: false,
        amount: body.amount,
        metadata: body.metadata,
        confirmation: { confirmation_url: 'https://yookassa.test/c' },
      };
      yookassaPayments[body.metadata.order_id] = payment;
      return jsonResponse(payment);
    }
    const id = u.split('/').pop()!;
    const found: any = Object.values(yookassaPayments).find((p: any) => p.id === id);
    if (!found) return jsonResponse({ errors: [] }, false, 404);
    const status = paymentStatus[id] || found.status;
    return jsonResponse({ ...found, status, paid: status === 'succeeded' });
  }

  const m = u.match(/\/items\/(\w+)/);
  if (m) {
    const name = m[1];
    tables[name] = tables[name] || [];
    const rows = tables[name];
    if (name === 'promo_codes' && method === 'GET') {
      return jsonResponse({ data: promo ? [promo] : [] });
    }
    if (method === 'POST') {
      for (const f of UNIQUES[name] || []) {
        if (body[f] != null && rows.some(r => r[f] === body[f])) return uniqueViolation();
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
    return jsonResponse({ data: matchRows(rows, u) });
  }

  if (u.includes('/users/me')) return jsonResponse({ data: { id: currentUser } });
  if (u.match(/\/users\/[\w-]+/)) {
    if (method === 'PATCH') { userPatches.push(body); return jsonResponse({ data: {} }); }
    return jsonResponse({ data: { email: 'u@t.local' } });
  }
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

const create = (user = 'user-1', code = 'HALF') => {
  currentUser = user;
  return request(app).post('/api/payments/create').set('Authorization', 'Bearer t')
    .send({ plan: 'Профессиональный', promoCode: code });
};
const activate = (paymentId: string) =>
  request(app).post(`/api/payments/${paymentId}/activate`).set('Authorization', 'Bearer t').send({});
const webhookFor = (paymentId: string) =>
  request(app).post('/api/yookassa/webhook').send({ event: 'payment.succeeded', object: { id: paymentId } });

/** Доводит платёж по order_id до succeeded и возвращает его id. */
function markPaid(orderIndex = 0): string {
  const payment: any = Object.values(yookassaPayments)[orderIndex];
  paymentStatus[payment.id] = 'succeeded';
  return payment.id;
}

const reservations = () => tables.promo_reservations || [];

beforeEach(async () => {
  vi.clearAllMocks();
  tables = {};
  seq = 0;
  paymentSeq = 0;
  yookassaPayments = {};
  paymentStatus = {};
  userPatches = [];
  currentUser = 'user-1';
  promo = { id: 'promo-50', code: 'HALF', type: 'discount', value: 50, is_active: true, expires_at: null, max_uses: null, used_count: 0 };
  app = await buildApp();
});

afterAll(() => { process.env = OLD_ENV; });

describe('повторное использование одним пользователем', () => {
  it('второй платёж со скидкой тем же пользователем не создаётся', async () => {
    const first = await create('user-1');
    expect(first.status).toBe(200);
    expect(reservations()).toHaveLength(1);

    const second = await create('user-1');

    expect(second.status).toBe(400);
    expect(second.body.promoRejected).toBe(true);
    expect(second.body.error).toMatch(/уже использовали/);
  });

  it('другой пользователь тот же код взять может', async () => {
    await create('user-1');
    const other = await create('user-2');
    expect(other.status).toBe(200);
    expect(reservations()).toHaveLength(2);
  });

  it('скидка действительно применяется к сумме платежа', async () => {
    await create('user-1');
    const payment: any = Object.values(yookassaPayments)[0];
    expect(payment.amount.value).toBe('500.00'); // 1000 - 50%
  });
});

describe('max_uses при конкуренции', () => {
  it('последний слот достаётся ровно одному из двух одновременных запросов', async () => {
    promo.max_uses = 1;

    // Оба запроса стартуют, когда занятых слотов ещё нет.
    const [a, b] = await Promise.all([create('user-1'), create('user-2')]);

    const ok = [a, b].filter(r => r.status === 200);
    const rejected = [a, b].filter(r => r.status === 400);
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].body.error).toMatch(/исчерпал/);
    expect(reservations().filter(r => r.status === 'reserved')).toHaveLength(1);
  });

  it('исчерпанный код больше не выдаётся', async () => {
    promo.max_uses = 2;
    expect((await create('user-1')).status).toBe(200);
    expect((await create('user-2')).status).toBe(200);

    const third = await create('user-3');

    expect(third.status).toBe(400);
    expect(third.body.error).toMatch(/исчерпал/);
  });

  it('слоты нумеруются подряд, без дыр и повторов', async () => {
    promo.max_uses = 3;
    await create('user-1');
    await create('user-2');
    await create('user-3');

    expect(reservations().map(r => r.slot_index).sort()).toEqual([0, 1, 2]);
  });
});

describe('погашение при активации', () => {
  it('webhook и ручная активация гасят бронь ровно один раз', async () => {
    await create('user-1');
    const paymentId = markPaid();

    await activate(paymentId);
    await webhookFor(paymentId);
    await activate(paymentId);

    expect(reservations().filter(r => r.status === 'completed')).toHaveLength(1);
    // Использование записано в историю один раз
    expect((tables.promo_code_uses || [])).toHaveLength(1);
    // Подписка выдана один раз
    expect(userPatches.filter(p => p.expire_date)).toHaveLength(1);
  });

  it('после погашения тот же пользователь код повторно не возьмёт', async () => {
    await create('user-1');
    await activate(markPaid());

    const again = await create('user-1');

    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/уже использовали/);
  });
});

describe('отменённый платёж', () => {
  it('не сжигает промокод навсегда: слот освобождается и достаётся следующему', async () => {
    promo.max_uses = 1;
    await create('user-1');
    const payment: any = Object.values(yookassaPayments)[0];
    paymentStatus[payment.id] = 'canceled';

    // Слот занят брошенной бронью, но платёж отменён — второй пользователь его получает.
    const next = await create('user-2');

    expect(next.status).toBe(200);
    expect(reservations().find(r => r.user_id === 'user-1')?.status).toBe('released');
    expect(reservations().filter(r => r.status === 'reserved')).toHaveLength(1);
  });

  it('живой pending-платёж слот не отдаёт', async () => {
    promo.max_uses = 1;
    await create('user-1'); // остаётся pending

    const next = await create('user-2');

    expect(next.status).toBe(400);
    expect(next.body.error).toMatch(/исчерпал/);
  });

  it('освобождённая бронь снимает и замок пользователя', async () => {
    await create('user-1');
    const payment: any = Object.values(yookassaPayments)[0];
    paymentStatus[payment.id] = 'canceled';
    promo.max_uses = 1;

    await create('user-2'); // освобождает бронь user-1

    const row = reservations().find(r => r.user_id === 'user-1');
    expect(row.status).toBe('released');
    expect(row.user_lock).toBeNull();
    expect(row.slot_lock).toBeNull();
  });
});

describe('хранилище броней недоступно', () => {
  it('скидочный код не выдаётся без атомарной брони', async () => {
    const realFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: any, init?: any) => {
      if (String(url).includes('/items/promo_reservations')) {
        return jsonResponse({ errors: [{ message: 'no permission' }] }, false, 403);
      }
      return realFetch(url, init);
    });

    const res = await create('user-1');

    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('promo-store-unavailable');
    // Платёж со скидкой не создан
    expect(Object.keys(yookassaPayments)).toHaveLength(0);
  });
});

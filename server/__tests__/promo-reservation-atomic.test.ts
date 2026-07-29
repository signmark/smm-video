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
/** true → ЮКасса не подтверждает отмену платежа. */
let cancelFails = false;

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
    // Отмена платежа: POST /payments/{id}/cancel
    const cancelMatch = u.match(/payments\/([^/]+)\/cancel$/);
    if (cancelMatch) {
      const cancelId = cancelMatch[1];
      if (cancelFails) return jsonResponse({ errors: [] }, false, 500);
      paymentStatus[cancelId] = 'canceled';
      return jsonResponse({ id: cancelId, status: 'canceled' });
    }

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
      // Update-by-query: PATCH /items/<коллекция> с {query:{filter}, data}.
      // Именно на нём держится CAS-переход состояния брони: условие проверяется
      // той же операцией, что и запись, поэтому гонку выигрывает ровно один.
      if (body && body.query && body.data) {
        const filter = body.query.filter || {};
        const matched = rows.filter(r =>
          Object.entries(filter).every(([field, cond]: [string, any]) => {
            const expected = cond?._eq;
            return expected === undefined || String(r[field]) === String(expected);
          }),
        );
        for (const row of matched) {
          for (const f of UNIQUES[name] || []) {
            // Обнуление замка конфликтом не считается.
            if (body.data[f] != null && rows.some(o => o !== row && o[f] === body.data[f])) {
              return uniqueViolation();
            }
          }
          Object.assign(row, body.data);
        }
        return jsonResponse({ data: matched });
      }

      const id = u.split('/').pop()!.split('?')[0];
      const row = rows.find(r => r.id === id);
      if (row) Object.assign(row, body);
      return jsonResponse({ data: row });
    }
    return jsonResponse({ data: matchRows(rows, u) });
  }

  if (u.includes('/users/me')) {
    // Пользователя берём из токена запроса, а не из общей переменной: при
    // Promise.all все параллельные вызовы иначе видели бы последнего.
    const auth = String(init?.headers?.Authorization || init?.headers?.authorization || '');
    const fromToken = auth.startsWith('Bearer user-') ? auth.slice('Bearer '.length) : null;
    return jsonResponse({ data: { id: fromToken || currentUser } });
  }
  if (u.match(/\/users\/[\w-]+/)) {
    if (method === 'PATCH') { userPatches.push(body); return jsonResponse({ data: {} }); }
    return jsonResponse({ data: { email: 'u@t.local' } });
  }
  return jsonResponse({ data: {} });
});

vi.stubGlobal('fetch', fetchMock);

/**
 * Эталонная реализация мока. Тесты, которые ломают отдельные запросы, подменяют
 * реализацию — и если такой тест падает, подмена утекала во все следующие, и они
 * краснели по чужой причине. Восстанавливаем её централизованно в beforeEach.
 */
const PRISTINE_FETCH = fetchMock.getMockImplementation()!;

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
  // Токен несёт имя пользователя — так параллельные запросы не путаются.
  return request(app).post('/api/payments/create').set('Authorization', `Bearer ${user}`)
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
  fetchMock.mockImplementation(PRISTINE_FETCH);
  tables = {};
  seq = 0;
  paymentSeq = 0;
  yookassaPayments = {};
  paymentStatus = {};
  userPatches = [];
  cancelFails = false;
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

    // Реализацию надо вернуть руками: vi.clearAllMocks() в beforeEach чистит
    // вызовы, но не mockImplementation — иначе «недоступное хранилище» протекает
    // во все следующие тесты файла и они зеленеют/краснеют по чужой причине.
  });
});

/**
 * Освобождение брони — вторая волна ревью (2026-07-28).
 *
 * Механизм захвата был атомарным, а пути освобождения — неполными:
 *  - конфликт по user_lock отвечал «вы уже использовали» не проверяя, жив ли
 *    держатель, поэтому брошенная оплата запирала код за пользователем навсегда;
 *  - претендент стартовал с количества занятых слотов и двигался только вверх,
 *    поэтому освобождённый слот ниже верхней границы не пробовался никогда;
 *  - `payment.canceled` не обрабатывался вовсе.
 */
describe('брошенный платёж не сжигает промокод', () => {
  it('после отмены платежа тот же пользователь берёт код снова', async () => {
    const first = await create('user-1');
    expect(first.status).toBe(200);

    // Платёж отменён в ЮКассе.
    const payment: any = Object.values(yookassaPayments)[0];
    paymentStatus[payment.id] = 'canceled';

    const second = await create('user-1');

    expect(second.status).toBe(200);
    expect(second.body.confirmationUrl).toBeTruthy();
  });

  it('живой платёж по-прежнему держит код за пользователем', async () => {
    await create('user-1');
    // Платёж в pending — держатель жив, освобождать нечего.
    const second = await create('user-1');

    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/уже использовали/);
  });

  it('вебхук payment.canceled освобождает бронь сразу', async () => {
    await create('user-1');
    const payment: any = Object.values(yookassaPayments)[0];
    paymentStatus[payment.id] = 'canceled';

    const hook = await request(app)
      .post('/api/yookassa/webhook')
      .send({ event: 'payment.canceled', object: { id: payment.id } });

    expect(hook.status).toBe(200);
    expect(reservations()[0].status).toBe('released');
    expect(reservations()[0].user_lock).toBeNull();
    expect(reservations()[0].slot_lock).toBeNull();
  });

  it('вебхук не освобождает бронь живого платежа', async () => {
    await create('user-1');
    const payment: any = Object.values(yookassaPayments)[0];
    // Статус в ЮКассе — pending, что бы ни было написано в теле вебхука.
    const hook = await request(app)
      .post('/api/yookassa/webhook')
      .send({ event: 'payment.canceled', object: { id: payment.id } });

    expect(hook.status).toBe(200);
    expect(reservations()[0].status).toBe('reserved');
  });
});

describe('дыры в нумерации слотов переиспользуются', () => {
  it('освобождённый слот в середине не съедает ёмкость max_uses', async () => {
    promo.max_uses = 3;

    await create('user-1');
    await create('user-2');
    await create('user-3');
    expect(reservations()).toHaveLength(3);

    // Средний платёж отменён — слот #1 освобождается.
    const second: any = Object.values(yookassaPayments)[1];
    paymentStatus[second.id] = 'canceled';

    const fourth = await create('user-4');

    // Раньше: занято 2 из 3, но претендент стартовал с 2 и шёл вверх, поэтому
    // упирался в max_uses и получал «исчерпан».
    expect(fourth.status).toBe(200);
    const active = reservations().filter(r => r.status === 'reserved');
    expect(active).toHaveLength(3);
    expect(active.map(r => r.slot_index).sort()).toEqual([0, 1, 2]);
  });

  it('когда свободных слотов действительно нет — код исчерпан', async () => {
    promo.max_uses = 2;

    await create('user-1');
    await create('user-2');
    const third = await create('user-3');

    expect(third.status).toBe(400);
    expect(third.body.error).toMatch(/исчерпал/);
  });
});

describe('привязка платежа к брони', () => {
  /** Ломает PATCH, который проставляет броне yookassa_payment_id. */
  const breakAttach = () => {
    const realFetch = PRISTINE_FETCH;
    fetchMock.mockImplementation((url: any, init?: any) => {
      if (String(url).includes('/items/promo_reservations/') && init?.method === 'PATCH'
          && JSON.parse(init.body).yookassa_payment_id) {
        return jsonResponse({ errors: [{ message: 'boom' }] }, false, 500);
      }
      return realFetch(url, init);
    });
    return realFetch;
  };

  it('сбой привязки → ссылка на оплату НЕ выдаётся', async () => {
    // Иначе пользователь платит по платежу, о котором приложение не знает:
    // бронь без yookassa_payment_id через 30 минут посчитают брошенной.
    breakAttach();

    const res = await create('user-1');

    expect(res.status).toBe(503);
    expect(res.body.confirmationUrl).toBeUndefined();
    expect(res.body.retryable).toBe(true);
    // Наружу не должно уезжать ничего про устройство внутренностей.
    expect(JSON.stringify(res.body)).not.toMatch(/directus|promo_reservations|boom/i);

  });

  it('подтверждённая отмена в ЮКассе освобождает бронь', async () => {
    breakAttach();

    await create('user-1');

    const row = reservations()[0];
    expect(row.status).toBe('released');
    expect(row.user_lock).toBeNull();
    expect(row.slot_lock).toBeNull();

  });

  it('неподтверждённая отмена оставляет бронь занятой и помечает на разбор', async () => {
    // Платёж, возможно, жив. Освободить слот значило бы выдать скидку дважды.
    cancelFails = true;
    breakAttach();

    const res = await create('user-1');

    expect(res.status).toBe(503);
    const row = reservations()[0];
    expect(row.status).toBe('reserved');
    expect(row.user_lock).not.toBeNull();
    expect(row.needs_reconciliation).toBe(true);
    expect(String(row.last_error)).toMatch(/отмена не подтверждена/);

  });
});

describe('переходы состояния брони атомарны', () => {
  it('одновременные погашение и освобождение — побеждает ровно один', async () => {
    await create('user-1');
    const payment: any = Object.values(yookassaPayments)[0];
    paymentStatus[payment.id] = 'succeeded';

    const { completePromoReservation, releasePromoReservation } = await import('../services/promo-reservation');
    const orderId = reservations()[0].payment_id;

    const [completed] = await Promise.all([
      completePromoReservation(orderId),
      releasePromoReservation(orderId, 'гонка реклеймера'),
    ]);

    const row = reservations()[0];
    // Оба перехода из reserved: выиграть может только один, статус однозначен.
    expect(['completed', 'released']).toContain(row.status);
    if (row.status === 'completed') {
      expect(completed.completed).toBe(true);
      // Погашенная бронь замки не теряет — иначе слот выглядел бы свободным.
      expect(row.user_lock).not.toBeNull();
    }
  });

  it('погашенную бронь освободить нельзя', async () => {
    await create('user-1');
    const orderId = reservations()[0].payment_id;

    const { completePromoReservation, releasePromoReservation } = await import('../services/promo-reservation');
    await completePromoReservation(orderId);
    await releasePromoReservation(orderId, 'поздний реклеймер');

    const row = reservations()[0];
    expect(row.status).toBe('completed');
    expect(row.user_lock).not.toBeNull();
    expect(row.slot_lock).not.toBeNull();
  });

  it('гонка: чтение увидело reserved, а к записи бронь уже погашена', async () => {
    // Настоящий TOCTOU. Раньше release читал статус, а потом писал безусловно —
    // между этими шагами вебхук успевал погасить бронь, и оплаченная скидка
    // обнулялась. Здесь чтение намеренно врёт «reserved», а в таблице уже
    // completed: спасти может только условие внутри самой операции записи.
    await create('user-1');
    const orderId = reservations()[0].payment_id;
    reservations()[0].status = 'completed';

    const realFetch = PRISTINE_FETCH;
    fetchMock.mockImplementation((url: any, init?: any) => {
      const u = String(url);
      const isReadOfThisRow = u.includes('/items/promo_reservations?')
        && u.includes(encodeURIComponent(orderId))
        && (init?.method || 'GET') === 'GET';
      if (isReadOfThisRow) {
        return jsonResponse({ data: [{ ...reservations()[0], status: 'reserved' }] });
      }
      return realFetch(url, init);
    });

    const { releasePromoReservation } = await import('../services/promo-reservation');
    await releasePromoReservation(orderId, 'реклеймер по устаревшему чтению');

    const row = reservations()[0];
    expect(row.status).toBe('completed');
    expect(row.user_lock).not.toBeNull();
    expect(row.slot_lock).not.toBeNull();
  });

  it('повторное погашение подписку второй раз не выдаёт', async () => {
    await create('user-1');
    const paymentId = markPaid();

    const first = await activate(paymentId);
    expect(first.status).toBe(200);
    const afterFirst = userPatches.length;

    const second = await webhookFor(paymentId);
    expect(second.status).toBe(200);

    expect(userPatches).toHaveLength(afterFirst);
    expect(reservations()[0].status).toBe('completed');
  });

  it('повтор доводит погашение, если первый проход его не завершил', async () => {
    await create('user-1');
    const paymentId = markPaid();

    // Первый проход: выдаём подписку, но погашение брони падает.
    const realFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: any, init?: any) => {
      const b = init?.body ? JSON.parse(init.body) : null;
      if (String(url).includes('/items/promo_reservations') && init?.method === 'PATCH'
          && b?.data?.status === 'completed') {
        return jsonResponse({ errors: [{ message: 'boom' }] }, false, 500);
      }
      return realFetch(url, init);
    });

    const first = await activate(paymentId);
    expect(first.status).toBe(200);
    expect(reservations()[0].status).toBe('reserved');
    const afterFirst = userPatches.length;

    // Повтор по тому же платежу: подписка уже выдана, а бронь догашается.
    fetchMock.mockImplementation(realFetch);
    const second = await webhookFor(paymentId);

    expect(second.status).toBe(200);
    expect(reservations()[0].status).toBe('completed');
    expect(userPatches).toHaveLength(afterFirst);
  });
});

describe('конкурентные резервирования', () => {
  it('50 параллельных запросов по коду без лимита — все получают слот', async () => {
    promo.max_uses = null;

    const users = Array.from({ length: 50 }, (_, i) => `user-c${i}`);
    const results = await Promise.all(users.map(u => create(u)));

    const ok = results.filter(r => r.status === 200);
    // Раньше жёсткие 25 попыток давали ложный отказ на 26-м и далее.
    expect(ok).toHaveLength(50);

    const slots = reservations().map(r => r.slot_index);
    expect(new Set(slots).size).toBe(slots.length); // ни одного повтора номера
  }, 30_000);

  it('max_uses не превышается при гонке', async () => {
    promo.max_uses = 5;

    const users = Array.from({ length: 30 }, (_, i) => `user-m${i}`);
    const results = await Promise.all(users.map(u => create(u)));

    const ok = results.filter(r => r.status === 200);
    expect(ok).toHaveLength(5);

    const active = reservations().filter(r => r.status === 'reserved');
    expect(active).toHaveLength(5);
    expect(active.every(r => r.slot_index < 5)).toBe(true);
  }, 30_000);

  it('один пользователь не получает скидку дважды при параллельных запросах', async () => {
    promo.max_uses = null;

    const results = await Promise.all([create('user-1'), create('user-1'), create('user-1')]);

    const ok = results.filter(r => r.status === 200);
    expect(ok).toHaveLength(1);
    expect(reservations().filter(r => r.status === 'reserved')).toHaveLength(1);
  }, 30_000);
});

/**
 * Бронь на ручном разборе не освобождается автоматикой.
 *
 * Находка ревью 2026-07-29 (денежная). Цепочка была такая: платёж создан →
 * attachPaymentId не смог записать yookassa_payment_id → отмену подтвердить не
 * удалось → бронь помечена needs_reconciliation и НАМЕРЕННО оставлена занятой.
 * Через 30 минут isSlotHolderDead видел пустой yookassa_payment_id, объявлял
 * бронь сиротой, а reclaimDeadReservations освобождал её, не глядя на пометку.
 *
 * Цена ошибки: человек платит по живому платежу, а слот скидки уже отдан
 * другому — активация упирается в released-бронь, и чинится это только руками.
 */
describe('needs_reconciliation не реклеймится по таймауту', () => {
  /**
   * Ломает PATCH привязки yookassa_payment_id — как в блоке выше.
   *
   * Именно ВСЕ попытки, а не первую: attachPaymentId ретраит трижды, и «сломать
   * один раз» означало бы, что привязка со второго захода проходит и сценарий
   * вообще не воспроизводится.
   */
  const breakAttach = () => {
    const realFetch = PRISTINE_FETCH;
    fetchMock.mockImplementation((url: any, init?: any) => {
      if (String(url).includes('/items/promo_reservations/') && init?.method === 'PATCH'
          && JSON.parse(init.body).yookassa_payment_id) {
        return jsonResponse({ errors: [{ message: 'boom' }] }, false, 500);
      }
      return realFetch(url, init);
    });
  };

  /** Отматывает бронь в прошлое: как будто она висит дольше таймаута сироты. */
  const ageReservations = (minutes = 45) => {
    for (const row of reservations()) {
      row.reserved_at = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    }
  };

  it('неподтверждённая отмена + 45 минут + новый покупатель → бронь НЕ освобождается', async () => {
    promo = { ...promo, max_uses: 1 };
    cancelFails = true;
    breakAttach();

    // Первый покупатель: платёж создан, привязка сорвалась, отмена не подтверждена.
    const first = await create('user-1');
    expect(first.status).toBe(503);
    const held = reservations()[0];
    expect(held.status).toBe('reserved');
    expect(held.needs_reconciliation).toBe(true);

    ageReservations();
    fetchMock.mockImplementation(PRISTINE_FETCH);
    cancelFails = false;

    // Второй покупатель приходит за единственным слотом.
    const second = await create('user-2');

    // Слот занят живым (возможно) платежом — отдавать его нельзя.
    expect(reservations()[0].status).toBe('reserved');
    expect(reservations()[0].needs_reconciliation).toBe(true);
    expect(second.body.confirmationUrl).toBeUndefined();
  });

  it('бронь без yookassa_payment_id, но с начатой оплатой, сиротой не считается', async () => {
    // Именно этот случай automatic reclaim и путал: «пусто, значит процесс умер
    // до создания платежа». Умер он или платёж всё-таки создан — по одному
    // пустому полю неотличимо, поэтому решает маркер попытки оплаты.
    promo = { ...promo, max_uses: 1 };
    cancelFails = true;
    breakAttach();

    await create('user-1');
    const row = reservations()[0];
    expect(row.payment_attempt_at).toBeTruthy();
    expect(row.yookassa_payment_id).toBeFalsy();

    ageReservations();
    fetchMock.mockImplementation(PRISTINE_FETCH);
    cancelFails = false;

    await create('user-2');

    expect(reservations()[0].status).toBe('reserved');
  });

  it('подтверждённая отмена после сбоя привязки слот всё-таки освобождает', async () => {
    // Обратная сторона инварианта: держать слот вечно тоже нельзя. Разница —
    // в ПОДТВЕРЖДЕНИИ: ЮКасса сказала canceled, значит платёж мёртв.
    promo = { ...promo, max_uses: 1 };
    breakAttach();          // cancelFails остаётся false → отмена подтвердится

    const first = await create('user-1');
    expect(first.status).toBe(503);
    expect(reservations()[0].status).toBe('released');

    fetchMock.mockImplementation(PRISTINE_FETCH);
    const second = await create('user-2');

    expect(second.status).toBe(200);
    expect(second.body.confirmationUrl).toBeTruthy();
  });

  it('подтверждённые canceled и expired реклеймятся штатно', async () => {
    promo = { ...promo, max_uses: 1 };

    await create('user-1');
    const payment: any = Object.values(yookassaPayments)[0];

    // Явный, подтверждённый статус — не догадка.
    paymentStatus[payment.id] = 'expired';
    ageReservations();

    const second = await create('user-2');

    expect(second.status).toBe(200);
    expect(second.body.confirmationUrl).toBeTruthy();
  });

  it('неизвестный статус платежа мёртвым не считается', async () => {
    promo = { ...promo, max_uses: 1 };
    await create('user-1');

    ageReservations();
    // ЮКасса недоступна: GET по платежу падает.
    const realFetch = PRISTINE_FETCH;
    fetchMock.mockImplementation((url: any, init?: any) => {
      if (String(url).includes('api.yookassa.ru') && (init?.method || 'GET') === 'GET') {
        return Promise.reject(new Error('network down'));
      }
      return realFetch(url, init);
    });

    const second = await create('user-2');

    expect(reservations()[0].status).toBe('reserved');
    expect(second.body.confirmationUrl).toBeUndefined();
  });

  it('успешный платёж не теряет бронь на гонке с реклеймером', async () => {
    promo = { ...promo, max_uses: 1 };
    await create('user-1');
    const paid = markPaid(0);

    ageReservations();
    await webhookFor(paid);

    // Бронь погашена, а не освобождена: released означал бы, что оплаченная
    // скидка ушла в никуда.
    expect(reservations()[0].status).toBe('completed');

    const second = await create('user-2');
    expect(second.body.confirmationUrl).toBeUndefined();
  });
});

/**
 * Маркер ручного разбора не может отчитаться об успехе после HTTP 500.
 *
 * flagReservationReconciliation глушила ошибку записи целиком и писала
 * «бронь помечена на разбор» независимо от ответа Directus. Расхождение
 * оставалось невидимым ровно тогда, когда оно и возникало.
 */
describe('пометка на ручной разбор честна к ошибкам', () => {
  it('провал записи маркера не считается успехом, но слот всё равно удержан', async () => {
    promo = { ...promo, max_uses: 1 };
    cancelFails = true;

    const realFetch = PRISTINE_FETCH;
    fetchMock.mockImplementation((url: any, init?: any) => {
      const u = String(url);
      if (u.includes('/items/promo_reservations/') && init?.method === 'PATCH') {
        const patch = JSON.parse(init.body);
        // Ломаем И привязку платежа, И запись маркера разбора.
        if (patch.yookassa_payment_id || patch.needs_reconciliation) {
          return jsonResponse({ errors: [{ message: 'boom' }] }, false, 500);
        }
      }
      return realFetch(url, init);
    });

    const res = await create('user-1');
    expect(res.status).toBe(503);

    // Маркер записать не удалось — но денежный инвариант держится не на нём:
    // бронь остаётся reserved и не реклеймится, потому что попытка оплаты
    // зафиксирована ДО обращения к ЮКассе.
    const row = reservations()[0];
    expect(row.status).toBe('reserved');
    expect(row.needs_reconciliation).toBeFalsy();
    expect(row.payment_attempt_at).toBeTruthy();

    for (const r of reservations()) {
      r.reserved_at = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    }
    fetchMock.mockImplementation(PRISTINE_FETCH);
    cancelFails = false;

    const second = await create('user-2');
    expect(reservations()[0].status).toBe('reserved');
    expect(second.body.confirmationUrl).toBeUndefined();
  });
});

/**
 * TOCTOU: победитель успел освободить слот до того, как проигравший перечитал состояние.
 *
 * Находка ревью 2026-07-29. После unique-конфликта код перечитывал occupiedSlots,
 * но потом БЕЗУСЛОВНО делал occupied.add(slot). Если между конфликтом и
 * перечитыванием держатель слот освободил, фактически он свободен — а искусственная
 * пометка снова объявляла его занятым. При max_uses=1 свободных номеров больше нет,
 * и второй запрос получал «промокод исчерпан» на пустом коде.
 */
describe('TOCTOU: освобождённый между конфликтом и перечитыванием слот', () => {
  it('max_uses=1 — проигравший гонку берёт освободившийся слот, а не «исчерпан»', async () => {
    promo = { ...promo, max_uses: 1 };

    // Победитель занимает единственный слот.
    const first = await create('user-1');
    expect(first.status).toBe(200);
    const winnerRow = reservations()[0];
    expect(winnerRow.slot_index).toBe(0);

    // Детерминированно воспроизводим гонку тремя шагами.
    //
    //  1. Первое чтение занятых слотов у второго покупателя отдаёт ПУСТО —
    //     это момент, когда бронь победителя ещё не видна. Претендент выбирает
    //     слот 0.
    //  2. Его вставка упирается в реальный уникальный индекс: победитель слот
    //     уже держит. Ровно в этот момент победитель бронь освобождает.
    //  3. Претендент перечитывает состояние — и слот 0 фактически свободен.
    //
    // Старый код на третьем шаге всё равно делал occupied.add(slot), свободных
    // номеров при max_uses=1 не оставалось, и второй покупатель получал
    // «промокод исчерпан» на пустом коде.
    const realFetch = PRISTINE_FETCH;
    let firstOccupancyRead = true;
    fetchMock.mockImplementation((url: any, init?: any) => {
      const u = String(url);
      const method = init?.method || 'GET';

      if (firstOccupancyRead && method === 'GET' && u.includes('/items/promo_reservations')
          && u.includes('filter[status][_in]=reserved,completed')) {
        firstOccupancyRead = false;
        return jsonResponse({ data: [] });
      }

      if (method === 'POST' && u.endsWith('/items/promo_reservations')) {
        const result = realFetch(url, init);
        return Promise.resolve(result).then((res: any) => {
          if (!res.ok) {
            // Конфликт случился — победитель освобождает бронь ровно сейчас.
            winnerRow.status = 'released';
            winnerRow.user_lock = null;
            winnerRow.slot_lock = null;
          }
          return res;
        });
      }

      return realFetch(url, init);
    });

    const second = await create('user-2');

    expect(second.status).toBe(200);
    expect(second.body.confirmationUrl).toBeTruthy();
    const loserRow = reservations().find((r: any) => r.user_id === 'user-2');
    expect(loserRow.status).toBe('reserved');
    // Тот же самый номер, а не следующий: ёмкость кода не съедена впустую.
    expect(loserRow.slot_index).toBe(0);
  });

  it('живой держатель слота по-прежнему считается занятым', async () => {
    // Обратная сторона: перечитанное состояние — источник истины в ОБЕ стороны.
    promo = { ...promo, max_uses: 1 };

    await create('user-1');
    const second = await create('user-2');

    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/исчерпал/);
  });
});

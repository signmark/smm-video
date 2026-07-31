/**
 * Fail-closed гейт подписки (AI-39, security-backlog §6).
 *
 * До этой правки гейт пропускал изменяющий запрос всякий раз, когда право на
 * действие подтвердить не удавалось: нет токена — `next()`, Directus упал —
 * `next()`. То есть платные функции открывались ровно в момент недоступности
 * проверки. Этот файл держит инвариант «непроверяемая mutation не
 * исполняется» и одновременно стережёт исключения, которые ломать нельзя:
 * чтение, пути продления и публичные вебхуки.
 *
 * Ключевой признак во всех негативных случаях — `handler` не вызван ни разу.
 * Проверять только код ответа недостаточно: 503 после отработавшего handler'а
 * означал бы, что побочный эффект уже случился.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

import { directusApi } from '../directus';
import { requireActiveSubscription } from '../middleware/require-active-subscription';

vi.mock('../directus', () => ({
  directusApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  directusApiManager: {
    request: vi.fn(),
    cacheAuthToken: vi.fn(),
    instance: { interceptors: { response: { use: vi.fn() } } },
  },
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockGet = directusApi.get as unknown as ReturnType<typeof vi.fn>;

/** Ответ Directus на GET /users/me. */
const userResponse = (fields: Record<string, unknown>) => ({ data: { data: fields } });

/** Ошибка axios с HTTP-статусом (Directus ответил по существу). */
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), {
  response: { status },
});

/** Directus не ответил вовсе: сеть/таймаут. */
const networkError = () => Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });

const makeApp = () => {
  const handler = vi.fn((_req: any, res: any) => res.json({ reached: true }));

  const app = express();
  app.use(express.json());
  app.use(requireActiveSubscription);
  app.all('/api/*', handler);

  return { app, handler };
};

/**
 * Токены уникальны на тест: кеш статуса живёт в модуле и не экспортирует
 * сброс, а заводить экспорт только ради тестов — расширять production-API.
 */
let tokenSeq = 0;
const freshToken = () => `token-${Date.now()}-${++tokenSeq}`;

const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

beforeEach(() => {
  mockGet.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('чтение и явные исключения не ломаются', () => {
  it('GET без токена проходит и Directus не дёргается', async () => {
    const { app, handler } = makeApp();

    const res = await request(app).get('/api/campaigns');

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it.each(['/api/auth/login', '/api/payments/create', '/api/subscriptions', '/api/promo/activate'])(
    'mutation по пути продления проходит гейт подписки: %s',
    async (path) => {
      const { app, handler } = makeApp();

      const res = await request(app).post(path).send({});

      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(mockGet).not.toHaveBeenCalled();
    },
  );

  it('публичные POST-вебхуки без токена проходят', async () => {
    const { app, handler } = makeApp();

    for (const path of ['/api/yookassa/webhook', '/api/threads/deauth']) {
      handler.mockClear();
      const res = await request(app).post(path).send({});

      expect(res.status, path).toBe(200);
      expect(handler, path).toHaveBeenCalledTimes(1);
    }
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('похожий, но чужой путь публичным не считается', async () => {
    const { app, handler } = makeApp();

    for (const path of [
      '/api/yookassa/webhook/replay',
      '/api/yookassa/refund',
      '/api/threads/deauth-all',
      '/api/threads/publish',
    ]) {
      handler.mockClear();
      const res = await request(app).post(path).send({});

      expect(res.status, path).toBe(401);
      expect(handler, path).not.toHaveBeenCalled();
    }
  });

  it('_publicOauthBypass пропускает callback провайдера', async () => {
    const handler = vi.fn((_req: any, res: any) => res.json({ reached: true }));
    const app = express();
    app.use((req, _res, nextFn) => {
      (req as any)._publicOauthBypass = true;
      nextFn();
    });
    app.use(requireActiveSubscription);
    app.all('/api/*', handler);

    const res = await request(app).post('/api/google/auth/callback').send({});

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('mutation без подтверждённой личности не исполняется', () => {
  it('защищённый POST без токена → 401 и handler не вызван', async () => {
    const { app, handler } = makeApp();

    const res = await request(app).post('/api/campaigns').send({ name: 'x' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SUBSCRIPTION_IDENTITY_REQUIRED');
    expect(handler).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it.each(['PUT', 'PATCH', 'DELETE'])('%s без токена тоже закрыт', async (method) => {
    const { app, handler } = makeApp();

    const res = await (request(app) as any)[method.toLowerCase()]('/api/campaigns/1').send({});

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('подтверждённый статус', () => {
  it('активная подписка → handler', async () => {
    const { app, handler } = makeApp();
    mockGet.mockResolvedValue(userResponse({ expire_date: FUTURE }));

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${freshToken()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('админ проходит даже с истёкшей датой', async () => {
    const { app, handler } = makeApp();
    mockGet.mockResolvedValue(userResponse({ expire_date: PAST, is_smm_admin: true }));

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${freshToken()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('истёкшая подписка → 403 subscriptionExpired', async () => {
    const { app, handler } = makeApp();
    mockGet.mockResolvedValue(userResponse({ expire_date: PAST }));

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${freshToken()}`)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.subscriptionExpired).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });

  it('токен из cookie работает наравне с Bearer', async () => {
    const { app, handler } = makeApp();
    mockGet.mockResolvedValue(userResponse({ expire_date: PAST }));
    const appWithCookies = express();
    appWithCookies.use((req, _res, nextFn) => {
      (req as any).cookies = { directus_session_token: freshToken() };
      nextFn();
    });
    appWithCookies.use(requireActiveSubscription);
    appWithCookies.all('/api/*', handler);

    const res = await request(appWithCookies).post('/api/campaigns').send({});

    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('невозможность подтвердить право → отказ, а не пропуск', () => {
  it('сетевая ошибка Directus → 503 и handler не вызван', async () => {
    const { app, handler } = makeApp();
    mockGet.mockRejectedValue(networkError());

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${freshToken()}`)
      .send({});

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SUBSCRIPTION_VALIDATION_UNAVAILABLE');
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([429, 500, 502, 503])('Directus %i → 503 и handler не вызван', async (status) => {
    const { app, handler } = makeApp();
    mockGet.mockRejectedValue(httpError(status));

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${freshToken()}`)
      .send({});

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SUBSCRIPTION_VALIDATION_UNAVAILABLE');
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([401, 403])('Directus %i → 401: сессия недействительна', async (status) => {
    const { app, handler } = makeApp();
    mockGet.mockRejectedValue(httpError(status));

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${freshToken()}`)
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SUBSCRIPTION_SESSION_INVALID');
    expect(handler).not.toHaveBeenCalled();
  });

  it('ответ без объекта пользователя → 503, а не «полей нет, значит бессрочно»', async () => {
    const { app, handler } = makeApp();
    mockGet.mockResolvedValue({ data: null });

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${freshToken()}`)
      .send({});

    expect(res.status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
  });

  it('наружу не утекают детали upstream', async () => {
    const { app } = makeApp();
    mockGet.mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED 10.0.0.7:8055'), {
        response: { status: 500, data: { errors: [{ message: 'internal directus trace' }] } },
      }),
    );

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${freshToken()}`)
      .send({});

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('ECONNREFUSED');
    expect(body).not.toContain('10.0.0.7');
    expect(body).not.toContain('directus');
  });
});

describe('кеш смягчает краткий простой, но не заменяет проверку', () => {
  it('свежий успешный кеш переживает простой, после TTL тот же простой → 503', async () => {
    const { app, handler } = makeApp();
    const token = freshToken();
    mockGet.mockResolvedValue(userResponse({ expire_date: FUTURE }));

    const first = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(first.status).toBe(200);

    // Directus падает; запись в кеше ещё свежая — платящий не замечает простоя.
    mockGet.mockRejectedValue(networkError());
    const duringOutage = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(duringOutage.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(2);

    // TTL истёк — простой обязан закрыть доступ, иначе это отложенный fail-open.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 61 * 1000));
    const afterTtl = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(afterTtl.status).toBe(503);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('кеш не продлевает уже наступившую expire_date', async () => {
    const { app, handler } = makeApp();
    const token = freshToken();
    // Подписка истекает через 5 секунд — на момент первого запроса ещё активна.
    mockGet.mockResolvedValue(
      userResponse({ expire_date: new Date(Date.now() + 5 * 1000).toISOString() }),
    );

    const before = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(before.status).toBe(200);

    // Прошло 10 секунд: запись в кеше ещё свежая (TTL 60 s), но срок уже вышел.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 10 * 1000));
    mockGet.mockClear();

    const after = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(after.status).toBe(403);
    expect(after.body.subscriptionExpired).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    // Именно кеш, а не повторный поход в Directus.
    expect(mockGet).not.toHaveBeenCalled();
  });
});

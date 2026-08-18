/**
 * AI-65: отказ гейта подписки обязан оставлять след со стабильной причиной.
 *
 * ЧТО БЫЛО. Гейт отказывает в пяти случаях: не предъявлен вход, сессия
 * недействительна, проверку не удалось довести до ответа, подписка истекла,
 * сломался сам гейт. Ни один из них не писал в журнал ничего. Снаружи 401 от
 * «нет входа» и 401 от «сессия отозвана» неразличимы, а чинятся по-разному;
 * 503 от недоступного Directus и 503 от собственной аварии гейта — тем более.
 * На вопрос «почему у человека не сработала кнопка» ответа в логах не было.
 *
 * ЧТО ПРОВЕРЯЕТСЯ. Поведение целиком: настоящий HTTP-запрос проходит через
 * настоящий гейт, а событие ловится на границе логгера. Это не сканер
 * исходника — тест видит ровно то, что увидит человек в журнале прода.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

import { directusApi } from '../directus';
import { logEvent } from '../utils/logger';
import { requireActiveSubscription, routeTemplate } from '../middleware/require-active-subscription';

vi.mock('../directus', () => ({
  directusApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  directusApiManager: {
    request: vi.fn(),
    cacheAuthToken: vi.fn(),
    instance: { interceptors: { response: { use: vi.fn() } } },
  },
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../utils/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/logger')>();
  return { ...actual, logEvent: vi.fn() };
});

const mockGet = directusApi.get as unknown as ReturnType<typeof vi.fn>;
const mockLogEvent = logEvent as unknown as ReturnType<typeof vi.fn>;

const userResponse = (fields: Record<string, unknown>) => ({ data: { data: fields } });
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), {
  response: { status },
});
const networkError = () => Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });

const makeApp = () => {
  const handler = vi.fn((_req: any, res: any) => res.json({ reached: true }));
  const app = express();
  app.use(express.json());
  app.use(requireActiveSubscription);
  app.all('/api/*', handler);
  return { app, handler };
};

/** Кеш статуса живёт в модуле и сброса не экспортирует — токен уникален на тест. */
let tokenSeq = 0;
const freshToken = () => `token-${Date.now()}-${++tokenSeq}`;

const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

const CAMPAIGN = '3a24994a-4519-46bd-9d5b-3e4f9dfc5df7';

/** Все события отказа гейта, записанные за тест. */
function denials(): Array<Record<string, any>> {
  return mockLogEvent.mock.calls
    .filter((call) => call[0] === 'gate.denied')
    .map((call) => call[1] as Record<string, any>);
}

beforeEach(() => {
  mockGet.mockReset();
  mockLogEvent.mockReset();
});

describe('AI-65: у каждого отказа гейта своя машинная причина', () => {
  it('вход не предъявлен', async () => {
    const { app, handler } = makeApp();

    const res = await request(app).post(`/api/campaigns/${CAMPAIGN}`).send({ name: 'x' });

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(denials()).toHaveLength(1);
    expect(denials()[0]).toMatchObject({
      reason: 'identity_missing',
      status: 401,
      method: 'POST',
    });
  });

  it('сессия недействительна — это не то же самое, что «нет входа»', async () => {
    const { app } = makeApp();
    mockGet.mockRejectedValueOnce(httpError(401));

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${freshToken()}`)
      .send({});

    expect(res.status).toBe(401);
    expect(denials()[0]).toMatchObject({ reason: 'session_invalid', status: 401 });
  });

  it('проверку не удалось довести до ответа', async () => {
    const { app } = makeApp();
    mockGet.mockRejectedValueOnce(networkError());

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${freshToken()}`)
      .send({});

    expect(res.status).toBe(503);
    expect(denials()[0]).toMatchObject({ reason: 'validation_unavailable', status: 503 });
  });

  it('подписка истекла — и видно, у кого именно', async () => {
    const { app } = makeApp();
    mockGet.mockResolvedValueOnce(userResponse({
      id: 'user-42',
      expire_date: PAST,
      is_smm_admin: false,
      is_smm_super: false,
    }));

    const res = await request(app)
      .patch(`/api/campaigns/${CAMPAIGN}`)
      .set('Authorization', `Bearer ${freshToken()}`)
      .send({});

    expect(res.status).toBe(403);
    expect(denials()[0]).toMatchObject({
      reason: 'subscription_expired',
      status: 403,
      method: 'PATCH',
      // Без этого поля отказ виден, но не связывается с остальным путём
      // запросов того же человека.
      userId: 'user-42',
    });
  });
});

describe('AI-65: журнал не шумит и не выносит чужие идентификаторы', () => {
  it('пропущенный запрос не пишет ничего', async () => {
    const { app, handler } = makeApp();
    mockGet.mockResolvedValueOnce(userResponse({
      id: 'user-7',
      expire_date: FUTURE,
      is_smm_admin: false,
      is_smm_super: false,
    }));

    await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${freshToken()}`)
      .send({});

    expect(handler).toHaveBeenCalledTimes(1);
    // Успешный проход — самый частый случай. Событие на нём превратило бы
    // журнал в поток строк, в котором отказы уже не найти.
    expect(denials()).toHaveLength(0);
  });

  it('в маршруте вместо идентификатора кампании стоит шаблон', async () => {
    const { app } = makeApp();

    await request(app).delete(`/api/campaigns/${CAMPAIGN}/posts/17`).send();

    const event = denials()[0];
    expect(event.route).toBe('/api/campaigns/:id/posts/:id');
    expect(event.route).not.toContain(CAMPAIGN);
  });

  it('предъявленный токен в событие не попадает', async () => {
    const { app } = makeApp();
    const token = freshToken();
    mockGet.mockRejectedValueOnce(httpError(403));

    await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const dumped = JSON.stringify(denials());
    expect(dumped).not.toContain(token);
  });
});

describe('AI-65: шаблон маршрута', () => {
  it('заменяет то, что похоже на идентификатор, и оставляет остальное', () => {
    expect(routeTemplate(`/api/campaigns/${CAMPAIGN}`)).toBe('/api/campaigns/:id');
    expect(routeTemplate('/api/posts/12345')).toBe('/api/posts/:id');
    expect(routeTemplate('/api/campaigns')).toBe('/api/campaigns');
    // Имя маршрута не должно случайно превратиться в :id — иначе по журналу
    // нельзя будет понять, куда вообще стучались.
    expect(routeTemplate('/api/subscriptions/request')).toBe('/api/subscriptions/request');
  });
});

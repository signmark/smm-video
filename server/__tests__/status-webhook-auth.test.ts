/**
 * Вебхуки смены статуса закрыты секретом.
 *
 * Находка ревью 2026-07-28 (P0): `POST /update-status` и
 * `POST /update-status/:platform` смонтированы в корень — вне `/api`, мимо гейта
 * авторизации, — и правят `campaign_content` по произвольному `id` служебным
 * доступом. Аноним мог переписать статус, `postUrl` и `published_at` чужого
 * контента, а через `req.body.token` — ещё и подсунуть свой токен Directus.
 *
 * Проверяем ровно то, что должно быть невозможно: любое обращение к Directus без
 * корректного секрета.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => ({
  axiosGet: vi.fn(async () => ({ data: { data: { id: 'c-1', campaign_id: 'camp-1', social_platforms: {} } } })),
  axiosPatch: vi.fn(async () => ({ data: { data: {} } })),
  getAdminToken: vi.fn(() => 'admin-token'),
  updatePublicationStatus: vi.fn(async () => ({ id: 'c-1' })),
}));

vi.mock('axios', () => {
  const instance = {
    get: H.axiosGet,
    patch: H.axiosPatch,
    post: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  };
  return {
    default: { get: H.axiosGet, patch: H.axiosPatch, post: vi.fn(), create: () => instance },
    create: () => instance,
  };
});

vi.mock('../utils/logger', () => {
  const log: any = vi.fn();
  log.debug = vi.fn(); log.info = vi.fn(); log.warn = vi.fn(); log.error = vi.fn();
  return { log, default: log };
});

vi.mock('../services/directus-auth-manager', () => ({
  DirectusAuthManager: { getAdminToken: H.getAdminToken },
  directusAuthManager: { getValidToken: vi.fn(async () => 'admin-token') },
}));

vi.mock('../services/social-platforms/facebook-service', () => ({
  facebookService: { updatePublicationStatus: H.updatePublicationStatus },
}));

vi.mock('../middleware/user-auth', () => ({
  authenticateUser: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../services/campaign-access', () => ({ authorizeCampaignAccess: vi.fn() }));
vi.mock('../services/content-access', () => ({ assertContentBelongsToRequester: vi.fn() }));
vi.mock('../services/campaign-token-resolver', () => ({ resolvePlatformToken: vi.fn() }));

import statusWebhookRouter from '../api/social-platform-status-webhook';
import facebookWebhookRouter from '../api/facebook-webhook-unified';

const SECRET = 's3cret-from-env';
const originalSecret = process.env.STATUS_WEBHOOK_SECRET;

const makeApp = (router: any) => {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
};

/** Ни одной записи и ни одного чтения в Directus не произошло. */
const expectNoDirectusTraffic = () => {
  expect(H.axiosPatch).not.toHaveBeenCalled();
  expect(H.axiosGet).not.toHaveBeenCalled();
  expect(H.updatePublicationStatus).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STATUS_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.STATUS_WEBHOOK_SECRET;
  else process.env.STATUS_WEBHOOK_SECRET = originalSecret;
});

describe('POST /update-status/:platform — универсальный вебхук статусов', () => {
  const body = { contentId: 'c-1', status: 'published', postUrl: 'https://t.me/c/1' };

  it('аноним без секрета получает 401 и ничего не меняет', async () => {
    const res = await request(makeApp(statusWebhookRouter))
      .post('/update-status/telegram')
      .send(body);

    expect(res.status).toBe(401);
    expectNoDirectusTraffic();
  });

  it('неверный секрет — тоже 401', async () => {
    const res = await request(makeApp(statusWebhookRouter))
      .post('/update-status/telegram')
      .set('x-webhook-secret', 'wrong')
      .send(body);

    expect(res.status).toBe(401);
    expectNoDirectusTraffic();
  });

  it('префикс верного секрета не проходит', async () => {
    const res = await request(makeApp(statusWebhookRouter))
      .post('/update-status/telegram')
      .set('x-webhook-secret', SECRET.slice(0, -1))
      .send(body);

    expect(res.status).toBe(401);
    expectNoDirectusTraffic();
  });

  it('токен в теле запроса больше не даёт доступа', async () => {
    // Раньше `req.body.token` использовался как токен Directus вместо админского.
    const res = await request(makeApp(statusWebhookRouter))
      .post('/update-status/telegram')
      .send({ ...body, token: 'подсунутый-токен' });

    expect(res.status).toBe(401);
    expectNoDirectusTraffic();
  });

  it('с верным секретом запрос доходит до Directus', async () => {
    const res = await request(makeApp(statusWebhookRouter))
      .post('/update-status/telegram')
      .set('x-webhook-secret', SECRET)
      .send(body);

    expect(res.status).toBe(200);
    expect(H.axiosPatch).toHaveBeenCalled();
  });

  it('секрет принимается и как Bearer', async () => {
    const res = await request(makeApp(statusWebhookRouter))
      .post('/update-status/telegram')
      .set('Authorization', `Bearer ${SECRET}`)
      .send(body);

    expect(res.status).toBe(200);
  });

  it('без STATUS_WEBHOOK_SECRET вебхук закрыт (503), а не открыт', async () => {
    delete process.env.STATUS_WEBHOOK_SECRET;

    const res = await request(makeApp(statusWebhookRouter))
      .post('/update-status/telegram')
      .set('x-webhook-secret', 'anything')
      .send(body);

    expect(res.status).toBe(503);
    expectNoDirectusTraffic();
  });

  it('чужая кампания в теле — 404, статус не меняется', async () => {
    const res = await request(makeApp(statusWebhookRouter))
      .post('/update-status/telegram')
      .set('x-webhook-secret', SECRET)
      .send({ ...body, campaignId: 'camp-другая' });

    expect(res.status).toBe(404);
    expect(H.axiosPatch).not.toHaveBeenCalled();
  });

  it('своя кампания в теле — запрос проходит', async () => {
    const res = await request(makeApp(statusWebhookRouter))
      .post('/update-status/telegram')
      .set('x-webhook-secret', SECRET)
      .send({ ...body, campaignId: 'camp-1' });

    expect(res.status).toBe(200);
    expect(H.axiosPatch).toHaveBeenCalled();
  });
});

describe('POST /update-status — вебхук Facebook', () => {
  const body = { contentId: 'c-1', status: 'published', postUrl: 'https://fb.test/1' };

  it('аноним получает 401 и статус не обновляется', async () => {
    const res = await request(makeApp(facebookWebhookRouter))
      .post('/update-status')
      .send(body);

    expect(res.status).toBe(401);
    expect(H.updatePublicationStatus).not.toHaveBeenCalled();
  });

  it('с верным секретом статус обновляется', async () => {
    const res = await request(makeApp(facebookWebhookRouter))
      .post('/update-status')
      .set('x-webhook-secret', SECRET)
      .send(body);

    expect(res.status).toBe(200);
    expect(H.updatePublicationStatus).toHaveBeenCalledWith('c-1', 'facebook', expect.any(Object));
  });

  it('без секрета в окружении — 503', async () => {
    delete process.env.STATUS_WEBHOOK_SECRET;

    const res = await request(makeApp(facebookWebhookRouter))
      .post('/update-status')
      .set('x-webhook-secret', SECRET)
      .send(body);

    expect(res.status).toBe(503);
    expect(H.updatePublicationStatus).not.toHaveBeenCalled();
  });
});

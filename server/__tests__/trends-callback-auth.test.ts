/**
 * Публичные колбэки трендов больше не анонимны.
 *
 * Находка ревью 2026-07-29: шесть внешних callback/webhook-ручек в
 * `server/api/trends-routes.ts` не проверяли вообще ничего. Аноним мог слать
 * туда произвольные «результаты сбора» — они сохранялись в тренды кампаний
 * служебным токеном, а `tg-webhook` при этом отвечает 200 ДО обработки, то есть
 * даже не сигналил об отказе.
 *
 * Тесты монтируют НАСТОЯЩИЙ роутер. Проверяется не только код ответа, но и то,
 * что при отказе обработка тела не начиналась.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => ({
  saveTrendPosts: vi.fn(async () => undefined),
  crudList: vi.fn(async () => [] as any[]),
  crudCreate: vi.fn(async () => ({ id: 'new' })),
  crudUpdate: vi.fn(async () => ({})),
  crudGetById: vi.fn(async () => null as any),
  axiosGet: vi.fn(async () => ({ data: { data: [] } })),
  axiosPost: vi.fn(async () => ({ data: {} })),
}));

vi.mock('../services/trend-collector', () => ({
  getPublicBaseUrl: () => 'https://smm.example.test',
  SCRAPER_BASE: 'https://scraper.example.test',
  getScraperApiKey: vi.fn(async () => 'scraper-key'),
  saveTrendPosts: H.saveTrendPosts,
  pendingTgTasks: new Map(),
  pendingVkTasks: new Map(),
}));

vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    list: H.crudList, create: H.crudCreate, update: H.crudUpdate,
    getById: H.crudGetById, delete: vi.fn(), getAdminTokenPublic: vi.fn(async () => 'admin-token'),
  },
}));

vi.mock('../directus', () => ({
  directusApi: { get: H.axiosGet, post: H.axiosPost, patch: vi.fn(), delete: vi.fn() },
  directusApiManager: {
    request: vi.fn(), cacheAuthToken: vi.fn(), get: H.axiosGet, post: H.axiosPost,
    instance: { interceptors: { response: { use: vi.fn() } } },
  },
  default: { get: H.axiosGet, post: H.axiosPost, patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('axios', () => {
  const interceptors = { request: { use: vi.fn() }, response: { use: vi.fn() } };
  const instance: any = { get: H.axiosGet, post: H.axiosPost, patch: vi.fn(), delete: vi.fn(), put: vi.fn(), interceptors };
  const create = () => instance;
  return { default: { get: H.axiosGet, post: H.axiosPost, patch: vi.fn(), delete: vi.fn(), put: vi.fn(), create, interceptors }, create, interceptors };
});

vi.mock('../services/campaign-access', () => {
  class CampaignAccessError extends Error {
    constructor(public readonly status: 404 | 503, public readonly code: string) { super(code); }
  }
  return {
    CampaignAccessError,
    authorizeCampaignAccess: vi.fn(async () => { throw new CampaignAccessError(404, 'X'); }),
    listAccessibleCampaignIds: vi.fn(async () => []),
  };
});
vi.mock('../services/gemini-direct', () => ({ geminiDirect: { generateContent: vi.fn() } }));
vi.mock('../services/deepseek', () => ({ DeepSeekService: class { analyze = vi.fn(); generateContent = vi.fn(); } }));
vi.mock('../services/api-keys', () => ({
  apiKeyService: { getApiKey: vi.fn(async () => 'key') },
  ApiServiceName: new Proxy({}, { get: (_t, p) => String(p) }),
}));
vi.mock('../services/global-api-keys', () => ({ globalApiKeysService: { getGlobalApiKey: vi.fn(async () => 'key') } }));
vi.mock('../utils/public-url', () => ({
  getPublicOrigin: () => 'https://smm.example.test',
  getPublicHost: () => 'smm.example.test',
  publicUrl: (p = '') => `https://smm.example.test${p}`,
}));
vi.mock('../services/admin-token-manager', () => ({ adminTokenManager: { getAdminToken: vi.fn(async () => 'admin-token') } }));
vi.mock('../utils/logger', () => {
  const logFn: any = vi.fn();
  logFn.info = vi.fn(); logFn.warn = vi.fn(); logFn.error = vi.fn(); logFn.debug = vi.fn();
  return { log: logFn, default: logFn, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
});

import { registerTrendsRoutes } from '../api/trends-routes';
import { trendsCallbackToken, trendsCallbackUrl } from '../middleware/webhook-auth';

const SECRET = 'trends-secret-value';

const app = express();
app.use(express.json());
registerTrendsRoutes(app);

/** Все шесть публичных колбэков и их метки. */
const CALLBACKS: Array<{ path: string; label: string }> = [
  { path: '/api/trends/tg-webhook', label: 'tg-webhook' },
  { path: '/api/trends/vk-webhook', label: 'vk-webhook' },
  { path: '/api/trends/collect-trends-callback', label: 'collect-trends-callback' },
  { path: '/api/trends/tg-find-groups-webhook', label: 'tg-find-groups-webhook' },
  { path: '/api/trends/vk-find-groups-webhook', label: 'vk-find-groups-webhook' },
  { path: '/api/trends/collect-comments-callback', label: 'collect-comments-callback' },
];

const BODY = { task_id: 'task-1', status: 'success', result: { posts: [{ id: 'p1', text: 'x' }] } };

beforeEach(() => {
  vi.resetAllMocks();
  H.saveTrendPosts.mockImplementation(async () => undefined);
  H.crudList.mockImplementation(async () => []);
  H.crudGetById.mockImplementation(async () => null);
  process.env.TRENDS_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.TRENDS_WEBHOOK_SECRET;
});

describe.each(CALLBACKS)('$path', ({ path, label }) => {
  it('без секрета → 401, тело не обрабатывается', async () => {
    const res = await request(app).post(path).send(BODY);

    expect(res.status).toBe(401);
    expect(H.saveTrendPosts).not.toHaveBeenCalled();
  });

  it('неверный секрет → 401', async () => {
    const res = await request(app).post(path).set('x-webhook-secret', 'wrong').send(BODY);

    expect(res.status).toBe(401);
    expect(H.saveTrendPosts).not.toHaveBeenCalled();
  });

  it('пустой секрет в заголовке → 401', async () => {
    const res = await request(app).post(path).set('x-webhook-secret', '').send(BODY);

    expect(res.status).toBe(401);
    expect(H.saveTrendPosts).not.toHaveBeenCalled();
  });

  it('правильный секрет → не 401 и не 503', async () => {
    const res = await request(app).post(path).set('x-webhook-secret', SECRET).send(BODY);

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(503);
  });

  it('заголовок в другом регистре тоже принимается', async () => {
    const res = await request(app).post(path).set('X-Webhook-Secret', SECRET).send(BODY);

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(503);
  });

  it('Authorization: Bearer с тем же секретом принимается', async () => {
    const res = await request(app).post(path).set('Authorization', `Bearer ${SECRET}`).send(BODY);

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(503);
  });

  it('токен в пути (форма для внешнего скрейпера) принимается', async () => {
    const token = trendsCallbackToken(label);
    const res = await request(app).post(`${path}/${token}`).send(BODY);

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(503);
  });

  it('чужой токен в пути (от другого колбэка) не подходит', async () => {
    const otherLabel = CALLBACKS.find((c) => c.label !== label)!.label;
    const res = await request(app).post(`${path}/${trendsCallbackToken(otherLabel)}`).send(BODY);

    expect(res.status).toBe(401);
    expect(H.saveTrendPosts).not.toHaveBeenCalled();
  });

  it('нет серверного секрета → 503 fail-closed, эндпоинт НЕ открыт', async () => {
    delete process.env.TRENDS_WEBHOOK_SECRET;

    const res = await request(app).post(path).send(BODY);

    expect(res.status).toBe(503);
    expect(H.saveTrendPosts).not.toHaveBeenCalled();
  });

  it('пустая строка в серверном секрете → 503, а не «пустой совпал с пустым»', async () => {
    process.env.TRENDS_WEBHOOK_SECRET = '';

    const res = await request(app).post(path).set('x-webhook-secret', '').send(BODY);

    expect(res.status).toBe(503);
    expect(H.saveTrendPosts).not.toHaveBeenCalled();
  });
});

describe('trendsCallbackUrl', () => {
  it('вшивает токен сегментом пути, а не query — query протекает в Referer и логи', () => {
    const url = trendsCallbackUrl('https://smm.example.test', '/api/trends/tg-webhook', 'tg-webhook');

    expect(url).toBe(`https://smm.example.test/api/trends/tg-webhook/${trendsCallbackToken('tg-webhook')}`);
    expect(url).not.toContain('?');
    expect(url).not.toContain('=');
  });

  it('без серверного секрета токен не выдумывается — URL остаётся голым, эндпоинт закрыт', () => {
    delete process.env.TRENDS_WEBHOOK_SECRET;

    expect(trendsCallbackUrl('https://smm.example.test', '/api/trends/tg-webhook', 'tg-webhook'))
      .toBe('https://smm.example.test/api/trends/tg-webhook');
  });

  it('токены разных колбэков различаются', () => {
    expect(trendsCallbackToken('tg-webhook')).not.toBe(trendsCallbackToken('vk-webhook'));
  });
});

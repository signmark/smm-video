/**
 * GET /api/keywords/search не должен отдавать 500.
 *
 * search и analyze-website — POST-роуты (routes/ai.ts). GET по тем же путям
 * проваливался в параметрический "/api/keywords/:campaignId" (routes/campaigns.ts)
 * с campaignId="search": имя действия уходило в Directus как id кампании и
 * возвращалось 500 «Не удалось загрузить ключевые слова». Пользователей это не
 * задевает, но шумит в мониторинге и маскирует настоящие сбои.
 *
 * Гоняется РЕАЛЬНЫЙ registerCampaignRoutes в мини-Express; на границах моками
 * закрыты Directus и проверка доступа к кампании.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => {
  class CampaignAccessError extends Error {
    constructor(public readonly status: 404 | 503, public readonly code: string) {
      super(code);
    }
  }
  return {
    CampaignAccessError,
    authorizeCampaignAccess: vi.fn(async () => ({ id: 'camp-1' })),
    directusGet: vi.fn(async () => ({ data: { data: [] } })),
    directusDelete: vi.fn(async () => ({ data: {} })),
  };
});

vi.mock('../services/campaign-access', () => ({
  authorizeCampaignAccess: H.authorizeCampaignAccess,
  listAccessibleCampaignIds: vi.fn(async () => []),
  CampaignAccessError: H.CampaignAccessError,
}));

vi.mock('../directus', () => ({
  directusApi: { get: H.directusGet, post: vi.fn(), patch: vi.fn(), delete: H.directusDelete },
  directusApiManager: {
    request: vi.fn(),
    cacheAuthToken: vi.fn(),
    instance: { interceptors: { response: { use: vi.fn() } } },
  },
  default: { get: H.directusGet, post: vi.fn(), patch: vi.fn(), delete: H.directusDelete },
}));

vi.mock('axios', () => {
  const interceptors = { request: { use: vi.fn() }, response: { use: vi.fn() } };
  const instance: any = {
    get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn(), interceptors,
  };
  return { default: { get: vi.fn(), post: vi.fn(), create: () => instance, interceptors }, create: () => instance, interceptors };
});

// Тяжёлые зависимости campaigns.ts, не нужные на этом пути.
vi.mock('../routes-global-api-keys', () => ({ isUserAdmin: vi.fn(async () => false) }));
vi.mock('../services/web-crawler-agent', () => ({ webCrawlerAgent: {} }));
vi.mock('../utils/ai-helpers', () => ({ extractFullSiteContent: vi.fn() }));
vi.mock('../services/ai-service', () => ({ aiService: {} }));
vi.mock('../services/admin-token-manager', () => ({ adminTokenManager: { getToken: vi.fn(async () => 'admin-token') } }));
vi.mock('../services/plan-limits', () => ({
  getPlanLimits: vi.fn(() => ({})),
  getEffectivePlan: vi.fn(() => 'free'),
}));
vi.mock('../services/directus-crud', () => ({
  directusCrud: { list: vi.fn(async () => []), update: vi.fn(), createItem: vi.fn() },
}));
vi.mock('../services/oauth-response-sanitizer', () => ({
  mergeOAuthSettings: vi.fn((a: any) => a),
  sanitizeOAuthSecrets: vi.fn((a: any) => a),
}));
vi.mock('../utils/text', () => ({ cleanupText: vi.fn((t: string) => t) }));
vi.mock('../utils/logger', () => {
  const logFn: any = vi.fn();
  logFn.info = vi.fn(); logFn.warn = vi.fn(); logFn.error = vi.fn(); logFn.debug = vi.fn();
  return { log: logFn, default: logFn };
});

import { registerCampaignRoutes } from '../routes/campaigns';

const app = express();
app.use(express.json());
registerCampaignRoutes(app);

const createMockToken = (payload: object) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  return `${header}.${body}.signature`;
};
const TOKEN = createMockToken({ id: 'user-1', email: 'u@x.io' });
const authed = (r: request.Test) => r.set('Authorization', `Bearer ${TOKEN}`);

beforeEach(() => {
  vi.clearAllMocks();
  H.authorizeCampaignAccess.mockResolvedValue({ id: 'camp-1' });
  H.directusGet.mockResolvedValue({ data: { data: [] } });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: 'user-1', is_smm_admin: false } }),
      text: async () => '',
      clone() { return this; },
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/keywords/<POST-действие>', () => {
  for (const action of ['search', 'analyze-website']) {
    it(`GET /api/keywords/${action} → 405, а не 500`, async () => {
      const res = await authed(request(app).get(`/api/keywords/${action}`));

      expect(res.status).toBe(405);
      expect(res.status).not.toBe(500);
      expect(res.headers.allow).toBe('POST');
    });

    it(`GET /api/keywords/${action} не ходит в Directus за кампанией`, async () => {
      await authed(request(app).get(`/api/keywords/${action}`));

      // Имя действия не должно уезжать в Directus как id кампании.
      expect(H.authorizeCampaignAccess).not.toHaveBeenCalled();
      expect(H.directusGet).not.toHaveBeenCalled();
    });
  }

  it('405 отдаётся и без авторизации (роут не должен зависеть от сессии)', async () => {
    const res = await request(app).get('/api/keywords/search');
    expect(res.status).toBe(405);
  });

  it('DELETE по тем же путям тоже не 500', async () => {
    const res = await authed(request(app).delete('/api/keywords/search'));
    expect(res.status).toBe(405);
    expect(H.directusDelete).not.toHaveBeenCalled();
  });

  it('настоящий campaignId по-прежнему обслуживается', async () => {
    H.directusGet.mockResolvedValue({ data: { data: [{ id: 'kw-1', keyword: 'кофе' }] } });

    const res = await authed(request(app).get('/api/keywords/2f8a1c34-0000-4000-8000-000000000001'));

    expect(res.status).toBe(200);
    expect(H.authorizeCampaignAccess).toHaveBeenCalled();
    expect(res.body).toEqual([{ id: 'kw-1', keyword: 'кофе' }]);
  });
});

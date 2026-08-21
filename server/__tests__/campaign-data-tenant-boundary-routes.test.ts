/**
 * Граница арендатора для данных кампании: источники, тренды, ключевые слова.
 *
 * Инцидент: свежий аккаунт без своих кампаний читал чужие данные. `GET /api/sources`
 * без параметров уходил в Directus вообще без фильтра по пользователю и отдавал
 * 1000 строк из чужих кампаний вместе с их campaign_id, а по этому id открывались
 * /api/campaign-trends и /api/keywords. Роль в Directus читает эти коллекции
 * целиком, поэтому единственная граница — проверка в коде.
 *
 * Тесты монтируют НАСТОЯЩИЕ роутеры в мини-Express и мокают только границы.
 * Mutation-proof: убрать authorizeCampaignAccess / listAccessibleCampaignIds из
 * любого хендлера → соответствующий тест краснеет, потому что проверяется не
 * только код ответа, но и то, что привилегированные чтение/запись не выполнены.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

/** Narrow structural types matching production response shapes. */
type DirectusListResp = { data: { data: Record<string, unknown>[] | Record<string, unknown> | null } };
type DirectusItemResp = { data: { data: Record<string, unknown> } };
type DirectusDeleteResp = { data: Record<string, unknown> };
type CampaignResult = { id: string; [key: string]: unknown };
type AxiosListResp = { data: { data: Record<string, unknown>[] | Record<string, unknown> | null } };
type AxiosPatchResp = { data: { data: Record<string, unknown> } };
/** Config shape matching AxiosRequestConfig.params */
type MockConfig = { params?: Record<string, unknown>; headers?: Record<string, string> };

const H = vi.hoisted(() => {
  class CampaignAccessError extends Error {
    constructor(public readonly status: 404 | 503, public readonly code: string) {
      super(code);
    }
  }
  return {
    CampaignAccessError,
    authorizeCampaignAccess: vi.fn(async (): Promise<CampaignResult> => { throw new CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND'); }),
    listAccessibleCampaignIds: vi.fn(async (): Promise<string[]> => []),
    directusGet: vi.fn(async (_url?: string, _config?: MockConfig): Promise<DirectusListResp> => ({ data: { data: [] } })),
    directusPost: vi.fn(async (_url?: string, _data?: unknown): Promise<DirectusItemResp> => ({ data: { data: { id: 'new' } } })),
    directusPatch: vi.fn(async (_url?: string, _data?: unknown): Promise<DirectusItemResp> => ({ data: { data: {} } })),
    directusDelete: vi.fn(async (_url?: string): Promise<DirectusDeleteResp> => ({ data: {} })),
    axiosGet: vi.fn(async (_url?: string, _config?: MockConfig): Promise<AxiosListResp> => ({ data: { data: [] } })),
    axiosPatch: vi.fn(async (_url?: string, _data?: unknown): Promise<AxiosPatchResp> => ({ data: { data: {} } })),
    getAdminTokenPublic: vi.fn(async (): Promise<string> => 'admin-token'),
    analyzeWebsiteKeywords: vi.fn(async (): Promise<Array<{ keyword: string }>> => [{ keyword: 'k' }]),
  };
});

vi.mock('../services/campaign-access', () => ({
  authorizeCampaignAccess: H.authorizeCampaignAccess,
  listAccessibleCampaignIds: H.listAccessibleCampaignIds,
  CampaignAccessError: H.CampaignAccessError,
}));

vi.mock('../directus', () => ({
  directusApi: { get: H.directusGet, post: H.directusPost, patch: H.directusPatch, delete: H.directusDelete },
  directusApiManager: {
    request: vi.fn(), cacheAuthToken: vi.fn(), get: H.directusGet, post: H.directusPost,
    instance: { interceptors: { response: { use: vi.fn() } } },
  },
  default: { get: H.directusGet, post: H.directusPost, patch: H.directusPatch, delete: H.directusDelete },
}));

vi.mock('axios', () => {
  const interceptors = { request: { use: vi.fn() }, response: { use: vi.fn() } };
  const instance: any = { get: H.axiosGet, post: vi.fn(), patch: H.axiosPatch, delete: vi.fn(), put: vi.fn(), interceptors };
  const create = () => instance;
  return { default: { get: H.axiosGet, post: vi.fn(), patch: H.axiosPatch, delete: vi.fn(), put: vi.fn(), create, interceptors }, create, interceptors };
});

vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    getAdminTokenPublic: H.getAdminTokenPublic,
    list: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), delete: vi.fn(), getById: vi.fn(),
  },
}));

vi.mock('../services/directus-auth-manager', () => ({ directusAuthManager: { getAdminToken: vi.fn(), getValidAdminToken: vi.fn() } }));
vi.mock('../services/admin-token-manager', () => ({ adminTokenManager: { getAdminToken: vi.fn(async () => 'admin-token') } }));
vi.mock('../services/gemini-direct', () => ({ geminiDirect: { generateContent: vi.fn() } }));
vi.mock('../services/analytics-service', () => ({ AnalyticsService: { refreshCampaignAnalytics: vi.fn(), getCampaignAnalytics: vi.fn() } }));
vi.mock('../services/oauth-response-sanitizer', () => ({ sanitizeOAuthSecrets: (v: any) => v, mergeOAuthSettings: (v: any) => v }));
vi.mock('../routes-global-api-keys', () => ({ isUserAdmin: vi.fn(async () => false) }));
vi.mock('../services/ai-service', () => ({ aiService: { analyzeWebsiteKeywords: H.analyzeWebsiteKeywords } }));
vi.mock('../services/web-crawler-agent', () => ({ webCrawlerAgent: { crawl: vi.fn() } }));
vi.mock('../utils/ai-helpers', () => ({ extractFullSiteContent: vi.fn() }));
vi.mock('../services/plan-limits', () => ({
  getPlanLimits: vi.fn(() => ({ campaigns: 100 })),
  getEffectivePlan: vi.fn(async () => 'free'),
}));
vi.mock('../utils/logger', () => {
  const logFn: any = vi.fn();
  logFn.info = vi.fn(); logFn.warn = vi.fn(); logFn.error = vi.fn(); logFn.debug = vi.fn();
  return { log: logFn, default: logFn, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
});

// Роутеры импортируем ПОСЛЕ моков.
import { registerAnalyticsRoutes } from '../routes/analytics';
import { registerCampaignRoutes } from '../routes/campaigns';

const analyticsApp = express();
analyticsApp.use(express.json());
registerAnalyticsRoutes(analyticsApp);

const campaignsApp = express();
campaignsApp.use(express.json());
registerCampaignRoutes(campaignsApp);

const createMockToken = (payload: object) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${body}.signature`;
};
const STRANGER = createMockToken({ id: 'user-stranger', email: 's@x.io' });
const authed = (r: request.Test) => r.set('Authorization', `Bearer ${STRANGER}`);

const FOREIGN = 'campaign-of-another-tenant';

/** Фильтр, с которым хендлер реально пошёл в Directus. */
const lastDirectusFilter = () => {
  const call = H.directusGet.mock.calls.at(-1);
  return call?.[1]?.params?.filter;
};

beforeEach(() => {
  // Именно reset, а не clear: он же чистит очередь mockResolvedValueOnce. Иначе
  // непотреблённое «одноразовое» значение из предыдущего теста утекает в следующий
  // и тесты перестают быть независимыми (а при снятой проверке доступа — ещё и
  // зеленеют по чужой причине).
  vi.resetAllMocks();
  // resetAllMocks снёс реализации — возвращаем «всё чужое» по умолчанию.
  H.authorizeCampaignAccess.mockImplementation(async () => {
    throw new H.CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');
  });
  H.listAccessibleCampaignIds.mockImplementation(async () => []);
  H.directusGet.mockImplementation(async () => ({ data: { data: [] } }));
  H.directusPost.mockImplementation(async () => ({ data: { data: { id: 'new' } } }));
  H.directusDelete.mockImplementation(async () => ({ data: {} }));
  H.axiosGet.mockImplementation(async () => ({ data: { data: [] } }));
  H.axiosPatch.mockImplementation(async () => ({ data: { data: {} } }));
  H.getAdminTokenPublic.mockImplementation(async () => 'admin-token');
  H.analyzeWebsiteKeywords.mockImplementation(async () => [{ keyword: 'k' }]);
  // Валидная сессия для настоящего authenticateUser.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { id: 'user-stranger', is_smm_admin: false } }),
    text: async () => '',
    clone() { return this; },
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/sources — точка входа инцидента', () => {
  it('без токена → 401, в Directus не ходим', async () => {
    const res = await request(analyticsApp).get('/api/sources');
    expect(res.status).toBe(401);
    expect(H.directusGet).not.toHaveBeenCalled();
  });

  it('без campaignId у пользователя без кампаний → пустая выдача, а не чужие источники', async () => {
    const res = await authed(request(analyticsApp).get('/api/sources'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
    expect(H.listAccessibleCampaignIds).toHaveBeenCalled();
    // Главное: запрос без фильтра по арендатору не ушёл вовсе.
    expect(H.directusGet).not.toHaveBeenCalled();
  });

  it('без campaignId выборка ограничена кампаниями пользователя', async () => {
    H.listAccessibleCampaignIds.mockResolvedValueOnce(['own-1', 'own-2']);
    H.directusGet.mockResolvedValueOnce({ data: { data: [{ id: 's1' }] } });

    const res = await authed(request(analyticsApp).get('/api/sources'));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 's1' }]);
    expect(lastDirectusFilter()).toEqual({ campaign_id: { _in: ['own-1', 'own-2'] } });
  });

  it('с чужим campaignId → 404, чтение из Directus не выполняется', async () => {
    const res = await authed(request(analyticsApp).get('/api/sources').query({ campaignId: FOREIGN }));

    expect(res.status).toBe(404);
    expect(H.authorizeCampaignAccess).toHaveBeenCalledWith(FOREIGN, 'user-stranger', expect.any(String), false);
    expect(H.directusGet).not.toHaveBeenCalled();
  });

  it('со своим campaignId данные отдаются', async () => {
    H.authorizeCampaignAccess.mockResolvedValueOnce({ id: 'own-1' });
    H.directusGet.mockResolvedValueOnce({ data: { data: [{ id: 's1' }] } });

    const res = await authed(request(analyticsApp).get('/api/sources').query({ campaignId: 'own-1' }));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 's1' }]);
    expect(lastDirectusFilter()).toEqual({ campaign_id: { _eq: 'own-1' } });
  });
});

describe('POST /api/sources — запись в чужую кампанию', () => {
  it('чужой campaignId → 404, источник не создаётся', async () => {
    const res = await authed(request(analyticsApp).post('/api/sources'))
      .send({ name: 'x', url: 'https://x.io', type: 'telegram', campaignId: FOREIGN });

    expect(res.status).toBe(404);
    expect(H.authorizeCampaignAccess).toHaveBeenCalled();
    expect(H.directusPost).not.toHaveBeenCalled();
  });

  it('без campaignId → 400, источник не создаётся', async () => {
    const res = await authed(request(analyticsApp).post('/api/sources'))
      .send({ name: 'x', url: 'https://x.io', type: 'telegram' });

    expect(res.status).toBe(400);
    expect(H.directusPost).not.toHaveBeenCalled();
  });

  it('своя кампания — источник создаётся', async () => {
    H.authorizeCampaignAccess.mockResolvedValueOnce({ id: 'own-1' });

    const res = await authed(request(analyticsApp).post('/api/sources'))
      .send({ name: 'x', url: 'https://x.io', type: 'telegram', campaignId: 'own-1' });

    expect(res.status).toBe(201);
    expect(H.directusPost).toHaveBeenCalledWith(
      '/items/campaign_content_sources',
      expect.objectContaining({ campaign_id: 'own-1' }),
      expect.anything(),
    );
  });
});

describe('GET /api/trends — тот же шаблон, что у /api/sources', () => {
  it('без campaignId у пользователя без кампаний → пусто, запрос без фильтра не уходит', async () => {
    const res = await authed(request(analyticsApp).get('/api/trends'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
    expect(H.directusGet).not.toHaveBeenCalled();
  });

  it('без campaignId выборка ограничена кампаниями пользователя', async () => {
    H.listAccessibleCampaignIds.mockResolvedValueOnce(['own-1']);
    H.directusGet.mockResolvedValueOnce({ data: { data: [{ id: 't1' }] } });

    const res = await authed(request(analyticsApp).get('/api/trends'));

    expect(res.status).toBe(200);
    expect(lastDirectusFilter()).toEqual({ campaign_id: { _in: ['own-1'] } });
  });

  it('с чужим campaignId → 404, чтение из Directus не выполняется', async () => {
    const res = await authed(request(analyticsApp).get('/api/trends').query({ campaignId: FOREIGN }));

    expect(res.status).toBe(404);
    expect(H.directusGet).not.toHaveBeenCalled();
  });
});

describe('GET /api/campaign-trends — ходит админским токеном', () => {
  it('чужой campaignId → 404, админский токен даже не запрашивается', async () => {
    const res = await authed(request(analyticsApp).get('/api/campaign-trends').query({ campaignId: FOREIGN }));

    expect(res.status).toBe(404);
    expect(H.authorizeCampaignAccess).toHaveBeenCalledWith(FOREIGN, 'user-stranger', expect.any(String), false);
    // Прав пользователя в Directus тут нет вообще — важно, что привилегированный
    // запрос не выполнился.
    expect(H.getAdminTokenPublic).not.toHaveBeenCalled();
    expect(H.axiosGet).not.toHaveBeenCalled();
  });

  it('своя кампания — тренды отдаются', async () => {
    H.authorizeCampaignAccess.mockResolvedValueOnce({ id: 'own-1' });
    H.axiosGet.mockResolvedValueOnce({ data: { data: [{ id: 't1', title: 't' }] } });

    const res = await authed(request(analyticsApp).get('/api/campaign-trends').query({ campaignId: 'own-1' }));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(H.axiosGet).toHaveBeenCalled();
  });
});

/**
 * SM-10: закладка тренда.
 *
 * Ручки не существовало вовсе — страница слала сюда PATCH и получала 404 от
 * Express, пользователь видел «Ошибка при добавлении тренда в закладки».
 * Добавляя её, сразу закрываем и границу арендатора: тренд правится админским
 * токеном, поэтому доступ к кампании обязан проверяться в коде.
 */
describe('PATCH /api/campaign-trends/:id/bookmark', () => {
  const bookmark = (id: string, body: any = { isBookmarked: true }) =>
    authed(request(analyticsApp).patch(`/api/campaign-trends/${id}/bookmark`)).send(body);

  it('тренд чужой кампании → 404, запись не выполняется', async () => {
    H.axiosGet.mockResolvedValueOnce({ data: { data: { id: 'tr-1', campaign_id: FOREIGN } } });

    const res = await bookmark('tr-1');

    expect(res.status).toBe(404);
    expect(H.axiosPatch).not.toHaveBeenCalled();
  });

  it('свой тренд — закладка сохраняется', async () => {
    H.axiosGet.mockResolvedValueOnce({ data: { data: { id: 'tr-1', campaign_id: 'own-1' } } });
    H.authorizeCampaignAccess.mockResolvedValueOnce({ id: 'own-1' });

    const res = await bookmark('tr-1');

    expect(res.status).toBe(200);
    expect(res.body.data.isBookmarked).toBe(true);
    const patchCall1 = H.axiosPatch.mock.calls.at(-1);
    expect(patchCall1?.[1]).toEqual({ is_bookmarked: true });
  });

  it('снятие закладки тоже проходит', async () => {
    H.axiosGet.mockResolvedValueOnce({ data: { data: { id: 'tr-1', campaign_id: 'own-1' } } });
    H.authorizeCampaignAccess.mockResolvedValueOnce({ id: 'own-1' });

    const res = await bookmark('tr-1', { isBookmarked: false });

    expect(res.status).toBe(200);
    const patchCall2 = H.axiosPatch.mock.calls.at(-1);
    expect(patchCall2?.[1]).toEqual({ is_bookmarked: false });
  });

  it('без поля isBookmarked → 400, запись не выполняется', async () => {
    const res = await bookmark('tr-1', {});

    expect(res.status).toBe(400);
    expect(H.axiosPatch).not.toHaveBeenCalled();
  });

  it('несуществующий тренд → 404', async () => {
    H.axiosGet.mockResolvedValueOnce({ data: { data: null } });

    const res = await bookmark('нет-такого');

    expect(res.status).toBe(404);
    expect(H.axiosPatch).not.toHaveBeenCalled();
  });
});

describe('Ключевые слова', () => {
  it('GET /api/keywords?campaignId=чужой → 404, чтение не выполняется', async () => {
    const res = await authed(request(campaignsApp).get('/api/keywords').query({ campaignId: FOREIGN }));

    expect(res.status).toBe(404);
    expect(H.authorizeCampaignAccess).toHaveBeenCalledWith(FOREIGN, 'user-stranger', expect.any(String), false);
    expect(H.directusGet).not.toHaveBeenCalled();
  });

  it('GET /api/keywords/:campaignId с чужим id → 404, чтение не выполняется', async () => {
    const res = await authed(request(campaignsApp).get(`/api/keywords/${FOREIGN}`));

    expect(res.status).toBe(404);
    expect(H.authorizeCampaignAccess).toHaveBeenCalledWith(FOREIGN, 'user-stranger', expect.any(String), false);
    expect(H.directusGet).not.toHaveBeenCalled();
  });

  it('GET /api/keywords/:campaignId со своей кампанией отдаёт голый массив', async () => {
    H.authorizeCampaignAccess.mockResolvedValueOnce({ id: 'own-1' });
    H.directusGet.mockResolvedValueOnce({ data: { data: [{ id: 'k1', keyword: 'кофе' }] } });

    const res = await authed(request(campaignsApp).get('/api/keywords/own-1'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'k1', keyword: 'кофе' }]);
  });

  it('DELETE /api/keywords/:id для чужого слова → 404, удаление не выполняется', async () => {
    // Слово существует и принадлежит чужой кампании.
    H.directusGet.mockResolvedValueOnce({ data: { data: { id: 'kw-1', campaign_id: FOREIGN } } });

    const res = await authed(request(campaignsApp).delete('/api/keywords/kw-1'));

    expect(res.status).toBe(404);
    expect(H.authorizeCampaignAccess).toHaveBeenCalledWith(FOREIGN, 'user-stranger', expect.any(String), false);
    expect(H.directusDelete).not.toHaveBeenCalled();
  });

  it('DELETE /api/keywords/:id для своего слова — удаление выполняется', async () => {
    H.directusGet.mockResolvedValueOnce({ data: { data: { id: 'kw-1', campaign_id: 'own-1' } } });
    H.authorizeCampaignAccess.mockResolvedValueOnce({ id: 'own-1' });

    const res = await authed(request(campaignsApp).delete('/api/keywords/kw-1'));

    expect(res.status).toBe(204);
    expect(H.directusDelete).toHaveBeenCalledWith('/items/campaign_keywords/kw-1', expect.anything());
  });

  it('POST /api/campaigns/:campaignId/keywords в чужую кампанию → 404, подбор не запускается', async () => {
    const res = await authed(request(campaignsApp).post(`/api/campaigns/${FOREIGN}/keywords`))
      .send({ url: 'https://x.io' });

    expect(res.status).toBe(404);
    expect(H.authorizeCampaignAccess).toHaveBeenCalledWith(FOREIGN, 'user-stranger', expect.any(String), false);
    expect(H.analyzeWebsiteKeywords).not.toHaveBeenCalled();
  });

  it('POST /api/campaigns/:campaignId/keywords в свою кампанию работает', async () => {
    H.authorizeCampaignAccess.mockResolvedValueOnce({ id: 'own-1' });

    const res = await authed(request(campaignsApp).post('/api/campaigns/own-1/keywords'))
      .send({ url: 'https://x.io' });

    expect(res.status).toBe(200);
    expect(H.analyzeWebsiteKeywords).toHaveBeenCalled();
  });
});

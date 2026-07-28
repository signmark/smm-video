/**
 * Граница арендатора для мутаций и служебных ручек.
 *
 * Находки ревью 2026-07-28 (P1, cross-tenant):
 *  - PATCH/PUT/DELETE /api/campaign-content/:id правили чужую запись (у соседнего
 *    GET проверка владения есть — значит права Directus коллекцию не закрывают);
 *  - DELETE /api/content/:id и POST /api/content/:id/unpublish работали с чужим
 *    контентом, причём unpublish РЕАЛЬНО удаляет посты в соцсетях;
 *  - /api/proxy/* брал userId из заголовка x-user-id, не сверяя его с токеном;
 *  - /api/autonomous/* позволял стартовать и останавливать автономный режим в
 *    чужой кампании и показывал статусы всех кампаний;
 *  - GET /server-api/analytics отдавал контент любой кампании по её id.
 *
 * Тесты монтируют НАСТОЯЩИЕ роутеры и настоящий authenticateUser, мокая только
 * границы. Mutation-proof: снять проверку доступа в любом хендлере → тест
 * краснеет, потому что проверяется не только код ответа, но и то, что
 * привилегированная операция не выполнена.
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
    authorizeCampaignAccess: vi.fn(async () => { throw new CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND'); }),
    listAccessibleCampaignIds: vi.fn(async () => [] as string[]),
    directusGet: vi.fn(async () => ({ data: { data: null } })),
    directusPost: vi.fn(async () => ({ data: { data: { id: 'new' } } })),
    directusPatch: vi.fn(async () => ({ data: { data: {} } })),
    directusDelete: vi.fn(async () => ({ data: {} })),
    axiosGet: vi.fn(async () => ({ data: { data: {} } })),
    axiosDelete: vi.fn(async () => ({ data: {} })),
    axiosPatch: vi.fn(async () => ({ data: { data: {} } })),
    getSourcePosts: vi.fn(async () => []),
    startAutonomous: vi.fn(async () => ({ ok: true })),
    stopAutonomous: vi.fn(() => ({ ok: true })),
    getStatus: vi.fn(() => ({ running: true })),
    getAllStatuses: vi.fn(() => ({ 'campaign-mine': { running: true }, 'campaign-foreign': { running: true } })),
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
  const api: any = {
    get: H.axiosGet, post: vi.fn(), patch: H.axiosPatch, delete: H.axiosDelete, put: vi.fn(), interceptors,
  };
  const create = () => api;
  return { default: { ...api, create }, create, interceptors };
});

vi.mock('../services/directus-proxy', () => ({
  directusProxy: {
    getSourcePosts: H.getSourcePosts,
    getCampaignKeywords: vi.fn(async () => []),
    getCampaignSources: vi.fn(async () => []),
  },
}));

vi.mock('../services/autonomous-ai', () => ({
  startAutonomousExternal: H.startAutonomous,
  stopAutonomousExternal: H.stopAutonomous,
  getAutonomousStatusExternal: H.getStatus,
  getAllAutonomousStatuses: H.getAllStatuses,
  getActiveAutonomousCampaignIds: vi.fn(() => []),
  approvePipelinePlan: vi.fn(() => ({ ok: true })),
  rejectPipelinePlan: vi.fn(() => ({ ok: true })),
}));

vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    list: vi.fn(async () => [{ campaign_id: 'campaign-foreign' }]),
    create: vi.fn(), update: vi.fn(), delete: vi.fn(), getById: vi.fn(),
    getAdminTokenPublic: vi.fn(async () => 'admin-token'),
  },
}));

vi.mock('../services/social-publishing', () => ({ socialPublishingService: { publish: vi.fn() } }));
vi.mock('../services/publish-scheduler', () => ({ getPublishScheduler: () => ({}) }));
vi.mock('../services/ai-service', () => ({ aiService: {} }));
vi.mock('../storage', () => ({ storage: {} }));
vi.mock('../utils/content-cache', () => ({
  buildCacheKey: () => 'k', getFromCache: () => null, setToCache: vi.fn(),
  invalidateContentCache: vi.fn(), clearContentCache: vi.fn(),
}));
vi.mock('../utils/logger', () => {
  const logFn: any = vi.fn();
  logFn.info = vi.fn(); logFn.warn = vi.fn(); logFn.error = vi.fn(); logFn.debug = vi.fn();
  return { log: logFn, default: logFn, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
});

// Роутеры импортируем ПОСЛЕ моков.
import { registerContentRoutes } from '../routes/content';
import { proxyRouter } from '../api/proxy-routes';
import autonomousRouter from '../routes/autonomous';
import deleteContentRouter from '../routes/delete-content';
import unpublishContentRouter from '../routes/unpublish-content';
import { registerSimpleAnalyticsAPI } from '../simple-analytics-api';

const contentApp = express();
contentApp.use(express.json());
registerContentRoutes(contentApp);

const proxyApp = express();
proxyApp.use(express.json());
proxyApp.use('/api/proxy', proxyRouter);

const autonomousApp = express();
autonomousApp.use(express.json());
autonomousApp.use('/api/autonomous', autonomousRouter);

const contentOpsApp = express();
contentOpsApp.use(express.json());
contentOpsApp.use('/api', deleteContentRouter);
contentOpsApp.use('/api', unpublishContentRouter);

const analyticsApp = express();
analyticsApp.use(express.json());
registerSimpleAnalyticsAPI(analyticsApp);

const createMockToken = (payload: object) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${body}.signature`;
};
const STRANGER = createMockToken({ id: 'user-stranger', email: 's@x.io' });
const authed = (r: request.Test) => r.set('Authorization', `Bearer ${STRANGER}`);

const FOREIGN_CONTENT = 'content-of-another-tenant';
const FOREIGN_CAMPAIGN = 'campaign-foreign';

beforeEach(() => {
  vi.resetAllMocks();

  H.authorizeCampaignAccess.mockImplementation(async () => {
    throw new H.CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');
  });
  H.listAccessibleCampaignIds.mockImplementation(async () => []);
  // Directus охотно отдаёт чужую запись — граница только в нашем коде.
  H.directusGet.mockImplementation(async () => ({
    data: { data: { id: FOREIGN_CONTENT, user_id: 'user-owner', campaign_id: FOREIGN_CAMPAIGN } },
  }));
  H.directusPatch.mockImplementation(async () => ({ data: { data: {} } }));
  H.directusDelete.mockImplementation(async () => ({ data: {} }));
  H.axiosGet.mockImplementation(async () => ({
    data: { data: { id: FOREIGN_CONTENT, campaign_id: FOREIGN_CAMPAIGN, socialPlatforms: {} } },
  }));
  H.axiosDelete.mockImplementation(async () => ({ data: {} }));
  H.getSourcePosts.mockImplementation(async () => []);
  H.startAutonomous.mockImplementation(async () => ({ ok: true }));
  H.stopAutonomous.mockImplementation(() => ({ ok: true }));
  H.getStatus.mockImplementation(() => ({ running: true }));
  H.getAllStatuses.mockImplementation(() => ({
    'campaign-mine': { running: true },
    [FOREIGN_CAMPAIGN]: { running: true },
  }));

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

describe('мутации /api/campaign-content/:id', () => {
  it('PATCH чужой записи → 404, PATCH в Directus не уходит', async () => {
    const res = await authed(request(contentApp).patch(`/api/campaign-content/${FOREIGN_CONTENT}`))
      .send({ title: 'подмена' });

    expect(res.status).toBe(404);
    expect(H.directusPatch).not.toHaveBeenCalled();
  });

  it('PUT чужой записи → 404, PATCH в Directus не уходит', async () => {
    const res = await authed(request(contentApp).put(`/api/campaign-content/${FOREIGN_CONTENT}`))
      .send({ title: 'подмена' });

    expect(res.status).toBe(404);
    expect(H.directusPatch).not.toHaveBeenCalled();
  });

  it('DELETE чужой записи → 404, удаления в Directus нет', async () => {
    const res = await authed(request(contentApp).delete(`/api/campaign-content/${FOREIGN_CONTENT}`));

    expect(res.status).toBe(404);
    expect(H.directusDelete).not.toHaveBeenCalled();
  });

  it('своя запись правится как раньше', async () => {
    H.directusGet.mockImplementation(async () => ({
      data: { data: { id: 'c-mine', user_id: 'user-stranger' } },
    }));

    const res = await authed(request(contentApp).patch('/api/campaign-content/c-mine'))
      .send({ title: 'ok' });

    expect(res.status).toBe(200);
    expect(H.directusPatch).toHaveBeenCalled();
  });

  it('сбой Directus на проверке → 503, а не молчаливая правка', async () => {
    H.directusGet.mockImplementation(async () => { throw Object.assign(new Error('down'), { response: { status: 500 } }); });

    const res = await authed(request(contentApp).patch(`/api/campaign-content/${FOREIGN_CONTENT}`))
      .send({ title: 'подмена' });

    expect(res.status).toBe(503);
    expect(H.directusPatch).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/content/:id и POST /api/content/:id/unpublish', () => {
  it('удаление чужого контента → 404, DELETE в Directus не уходит', async () => {
    const res = await authed(request(contentOpsApp).delete(`/api/content/${FOREIGN_CONTENT}`));

    expect(res.status).toBe(404);
    expect(H.axiosDelete).not.toHaveBeenCalled();
  });

  it('снятие публикации чужого контента → 404, посты в соцсетях не трогаем', async () => {
    const res = await authed(request(contentOpsApp).post(`/api/content/${FOREIGN_CONTENT}/unpublish`)).send({});

    expect(res.status).toBe(404);
    // Ни удаления в соцсетях, ни чтения токенов кампании.
    expect(H.axiosDelete).not.toHaveBeenCalled();
    expect(H.axiosPatch).not.toHaveBeenCalled();
  });
});

describe('/api/proxy/* — userId из сессии, а не из заголовка', () => {
  it('x-user-id игнорируется: в Directus уходит id владельца токена', async () => {
    H.authorizeCampaignAccess.mockImplementation(async () => ({ id: 'campaign-mine' }));

    await authed(request(proxyApp).get('/api/proxy/trends').query({ campaign_id: 'campaign-mine' }))
      .set('x-user-id', 'user-victim');

    const call = H.getSourcePosts.mock.calls.at(-1)?.[0] as any;
    expect(call?.userId).toBe('user-stranger');
    expect(call?.userId).not.toBe('user-victim');
  });

  it('без сессии — 401, даже если x-user-id задан', async () => {
    const res = await request(proxyApp)
      .get('/api/proxy/trends')
      .query({ campaign_id: 'campaign-mine' })
      .set('x-user-id', 'user-victim');

    expect(res.status).toBe(401);
    expect(H.getSourcePosts).not.toHaveBeenCalled();
  });
});

describe('/api/autonomous/*', () => {
  it('старт в чужой кампании → 404, сервис не вызван', async () => {
    const res = await authed(request(autonomousApp).post('/api/autonomous/start'))
      .send({ campaignId: FOREIGN_CAMPAIGN, userId: 'user-owner' });

    expect(res.status).toBe(404);
    expect(H.startAutonomous).not.toHaveBeenCalled();
  });

  it('остановка чужой кампании → 404, сервис не вызван', async () => {
    const res = await authed(request(autonomousApp).post('/api/autonomous/stop'))
      .send({ campaignId: FOREIGN_CAMPAIGN });

    expect(res.status).toBe(404);
    expect(H.stopAutonomous).not.toHaveBeenCalled();
  });

  it('статус чужой кампании → 404', async () => {
    const res = await authed(request(autonomousApp).get(`/api/autonomous/status/${FOREIGN_CAMPAIGN}`));

    expect(res.status).toBe(404);
    expect(H.getStatus).not.toHaveBeenCalled();
  });

  it('userId берётся из сессии, а не из тела запроса', async () => {
    H.authorizeCampaignAccess.mockImplementation(async () => ({ id: 'campaign-mine' }));

    await authed(request(autonomousApp).post('/api/autonomous/start'))
      .send({ campaignId: 'campaign-mine', userId: 'user-victim' });

    const call = H.startAutonomous.mock.calls.at(-1)?.[0] as any;
    expect(call?.userId).toBe('user-stranger');
  });

  it('/all отдаёт только доступные кампании', async () => {
    H.listAccessibleCampaignIds.mockImplementation(async () => ['campaign-mine']);

    const res = await authed(request(autonomousApp).get('/api/autonomous/all'));

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['campaign-mine']);
  });

  it('/active-ids не раскрывает id чужих кампаний', async () => {
    H.listAccessibleCampaignIds.mockImplementation(async () => ['campaign-mine']);

    const res = await authed(request(autonomousApp).get('/api/autonomous/active-ids'));

    expect(res.status).toBe(200);
    expect(res.body.ids).not.toContain(FOREIGN_CAMPAIGN);
  });

  it('без сессии — 401', async () => {
    const res = await request(autonomousApp).post('/api/autonomous/stop').send({ campaignId: 'campaign-mine' });
    expect(res.status).toBe(401);
    expect(H.stopAutonomous).not.toHaveBeenCalled();
  });
});

describe('GET /server-api/analytics', () => {
  it('чужая кампания → 404, в Directus за контентом не ходим', async () => {
    const res = await authed(request(analyticsApp).get('/server-api/analytics'))
      .query({ campaignId: FOREIGN_CAMPAIGN });

    expect(res.status).toBe(404);
    expect(H.axiosGet).not.toHaveBeenCalled();
  });

  it('без сессии → 401', async () => {
    const res = await request(analyticsApp).get('/server-api/analytics').query({ campaignId: 'campaign-mine' });

    expect(res.status).toBe(401);
    expect(H.axiosGet).not.toHaveBeenCalled();
  });
});

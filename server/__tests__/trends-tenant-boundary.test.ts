/**
 * Граница арендатора в ручках трендов: проверяется загруженная запись, а не тело запроса.
 *
 * Находка ревью 2026-07-29. `ensureTrendsCampaignAccess` проверял `campaignId`
 * ИЗ ТЕЛА, после чего `trendId`/`trendIds` читались и правились служебным токеном
 * безо всякой связи с проверенной кампанией. Достаточно было передать свою
 * кампанию и чужой тренд: проверка пропускала, чужой тренд анализировался и
 * перезаписывался. Три ручки (`trend-comments`, `trend-sentiment`,
 * `sources/:id/analyze`) не имели проверки вовсе.
 *
 * Тесты монтируют НАСТОЯЩИЙ роутер в мини-Express и мокают только границы.
 * Mutation-proof: убрать guard из любого хендлера → тест краснеет, потому что
 * проверяется не только код ответа, но и то, что привилегированные чтение,
 * запись, AI-вызов и внешний скрейпер НЕ выполнены.
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
    crudList: vi.fn(async () => [] as any[]),
    crudGetById: vi.fn(async () => null as any),
    crudUpdate: vi.fn(async () => ({})),
    crudCreate: vi.fn(async () => ({ id: 'new' })),
    crudDelete: vi.fn(async () => undefined),
    axiosGet: vi.fn(async () => ({ data: { data: [] } })),
    axiosPost: vi.fn(async () => ({ data: {} })),
    axiosPatch: vi.fn(async () => ({ data: { data: {} } })),
    geminiGenerate: vi.fn(async () => '{"sentiment":"neutral"}'),
    deepseekAnalyze: vi.fn(async () => ({ sentiment: 'neutral' })),
    getScraperApiKey: vi.fn(async () => 'scraper-key'),
  };
});

vi.mock('../services/campaign-access', () => ({
  authorizeCampaignAccess: H.authorizeCampaignAccess,
  listAccessibleCampaignIds: H.listAccessibleCampaignIds,
  CampaignAccessError: H.CampaignAccessError,
}));

vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    list: H.crudList,
    getById: H.crudGetById,
    update: H.crudUpdate,
    create: H.crudCreate,
    delete: H.crudDelete,
    getAdminTokenPublic: vi.fn(async () => 'admin-token'),
  },
}));

vi.mock('../directus', () => ({
  directusApi: { get: H.axiosGet, post: H.axiosPost, patch: H.axiosPatch, delete: vi.fn() },
  directusApiManager: {
    request: vi.fn(), cacheAuthToken: vi.fn(), get: H.axiosGet, post: H.axiosPost,
    instance: { interceptors: { response: { use: vi.fn() } } },
  },
  default: { get: H.axiosGet, post: H.axiosPost, patch: H.axiosPatch, delete: vi.fn() },
}));

vi.mock('axios', () => {
  const interceptors = { request: { use: vi.fn() }, response: { use: vi.fn() } };
  const instance: any = {
    get: H.axiosGet, post: H.axiosPost, patch: H.axiosPatch,
    delete: vi.fn(), put: vi.fn(), interceptors,
  };
  const create = () => instance;
  return {
    default: { get: H.axiosGet, post: H.axiosPost, patch: H.axiosPatch, delete: vi.fn(), put: vi.fn(), create, interceptors },
    create, interceptors,
  };
});

vi.mock('../services/trend-collector', () => ({
  getPublicBaseUrl: () => 'https://smm.example.test',
  SCRAPER_BASE: 'https://scraper.example.test',
  getScraperApiKey: H.getScraperApiKey,
}));

vi.mock('../services/gemini-direct', () => ({ geminiDirect: { generateContent: H.geminiGenerate } }));
vi.mock('../services/deepseek', () => ({
  DeepSeekService: class { analyze = H.deepseekAnalyze; generateContent = H.deepseekAnalyze; },
}));
vi.mock('../services/api-keys', () => ({
  apiKeyService: { getApiKey: vi.fn(async () => 'key') },
  ApiServiceName: new Proxy({}, { get: (_t, p) => String(p) }),
}));
vi.mock('../services/global-api-keys', () => ({
  globalApiKeysService: { getGlobalApiKey: vi.fn(async () => 'key') },
}));
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

// Роутер импортируем ПОСЛЕ моков.
import { registerTrendsRoutes } from '../api/trends-routes';

const app = express();
app.use(express.json());
registerTrendsRoutes(app);

const createMockToken = (payload: object) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${body}.signature`;
};
const STRANGER = createMockToken({ id: 'user-stranger', email: 's@x.io' });
const authed = (r: request.Test) => r.set('Authorization', `Bearer ${STRANGER}`);

const OWN = 'campaign-own';
const FOREIGN = 'campaign-of-another-tenant';

/** Доступ есть только к OWN, всё остальное — 404. */
function accessOnlyToOwn() {
  H.authorizeCampaignAccess.mockImplementation(async (campaignId: any) => {
    if (campaignId === OWN) return { id: OWN } as any;
    throw new H.CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');
  });
}

/** Записи по id: тренды и источники с их канонической принадлежностью. */
function records(map: Record<string, { campaign_id: string | null; [k: string]: any }>) {
  H.crudGetById.mockImplementation(async (_collection: any, id: any) => map[String(id)] ?? null);
}

beforeEach(() => {
  vi.resetAllMocks();
  accessOnlyToOwn();
  H.listAccessibleCampaignIds.mockImplementation(async () => [OWN]);
  H.crudList.mockImplementation(async () => []);
  H.crudGetById.mockImplementation(async () => null);
  H.crudUpdate.mockImplementation(async () => ({}));
  H.axiosGet.mockImplementation(async () => ({ data: { data: [] } }));
  H.axiosPost.mockImplementation(async () => ({ data: {} }));
  H.geminiGenerate.mockImplementation(async () => '{"sentiment":"neutral"}');
  H.getScraperApiKey.mockImplementation(async () => 'scraper-key');
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

/** Ни одна привилегированная операция не выполнена. */
function expectNoPrivilegedWork() {
  expect(H.crudList).not.toHaveBeenCalled();
  expect(H.crudUpdate).not.toHaveBeenCalled();
  expect(H.geminiGenerate).not.toHaveBeenCalled();
  expect(H.getScraperApiKey).not.toHaveBeenCalled();
}

describe('POST /api/trends/collect-comments — массив трендов', () => {
  const collect = (body: any) => authed(request(app).post('/api/trends/collect-comments')).send(body);

  it('своя кампания + ЧУЖОЙ trendId → 404, скрейпер не запускается', async () => {
    records({ 'trend-foreign': { campaign_id: FOREIGN } });

    const res = await collect({ campaignId: OWN, trendIds: ['trend-foreign'] });

    expect(res.status).toBe(404);
    expectNoPrivilegedWork();
  });

  it('смешанный набор (свой + чужой) отклоняется ЦЕЛИКОМ', async () => {
    records({
      'trend-own': { campaign_id: OWN, urlPost: 'https://t.me/a/1' },
      'trend-foreign': { campaign_id: FOREIGN, urlPost: 'https://t.me/b/2' },
    });

    const res = await collect({ campaignId: OWN, trendIds: ['trend-own', 'trend-foreign'] });

    expect(res.status).toBe(404);
    // Ключевое: свой тренд тоже не собрался — набор отклонён целиком.
    expectNoPrivilegedWork();
  });

  it('несуществующий trendId → 404 без oracle', async () => {
    records({});

    const res = await collect({ campaignId: OWN, trendIds: ['нет-такого'] });

    expect(res.status).toBe(404);
    expectNoPrivilegedWork();
  });

  it('свои тренды — сбор запускается', async () => {
    records({
      'trend-own': { campaign_id: OWN, urlPost: 'https://t.me/a/1' },
      'trend-own-2': { campaign_id: OWN, urlPost: 'https://vk.com/wall-1_2' },
    });

    const res = await collect({ campaignId: OWN, trendIds: ['trend-own', 'trend-own-2'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ telegram: 1, vk: 1 });
  });

  it('недоступный Directus → 503 fail-closed, а не 404 и не работа', async () => {
    H.crudGetById.mockRejectedValue(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }));

    const res = await collect({ campaignId: OWN, trendIds: ['trend-own'] });

    expect(res.status).toBe(503);
    expectNoPrivilegedWork();
  });
});

describe('POST /api/trends/collect-comments-single', () => {
  const collect = (body: any) => authed(request(app).post('/api/trends/collect-comments-single')).send(body);

  it('своя кампания + чужой trendId → 404', async () => {
    records({ 'trend-foreign': { campaign_id: FOREIGN, urlPost: 'https://t.me/b/2' } });

    const res = await collect({ campaignId: OWN, trendId: 'trend-foreign' });

    expect(res.status).toBe(404);
    expectNoPrivilegedWork();
  });

  it('campaignId не совпадает с campaign_id записи → 404, даже если обе кампании свои', async () => {
    // Доступ есть к обеим, но пара из запроса не соответствует канонической записи.
    H.authorizeCampaignAccess.mockImplementation(async () => ({ id: 'any' }) as any);
    records({ 'trend-x': { campaign_id: 'campaign-b', urlPost: 'https://t.me/b/2' } });

    const res = await collect({ campaignId: 'campaign-a', trendId: 'trend-x' });

    expect(res.status).toBe(404);
    expectNoPrivilegedWork();
  });

  it('свой тренд — сбор запускается', async () => {
    records({ 'trend-own': { campaign_id: OWN, urlPost: 'https://t.me/a/1' } });

    const res = await collect({ campaignId: OWN, trendId: 'trend-own' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/trend-comments/:trendId — проверки не было вовсе', () => {
  it('чужой тренд → 404, комментарии не читаются', async () => {
    records({ 'trend-foreign': { campaign_id: FOREIGN } });

    const res = await authed(request(app).get('/api/trend-comments/trend-foreign'));

    expect(res.status).toBe(404);
    expect(H.crudList).not.toHaveBeenCalled();
  });

  it('свой тренд — комментарии отдаются', async () => {
    records({ 'trend-own': { campaign_id: OWN } });
    H.crudList.mockResolvedValue([{ id: 'c1', text: 'ок' }]);

    const res = await authed(request(app).get('/api/trend-comments/trend-own'));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 'c1', text: 'ок' }]);
  });

  it('недоступный Directus → 503', async () => {
    H.crudGetById.mockRejectedValue(new Error('boom'));

    const res = await authed(request(app).get('/api/trend-comments/trend-own'));

    expect(res.status).toBe(503);
    expect(H.crudList).not.toHaveBeenCalled();
  });
});

describe('POST /api/trend-sentiment/:trendId — проверки не было вовсе', () => {
  it('чужой тренд → 404, AI не вызван и запись не выполнена', async () => {
    records({ 'trend-foreign': { campaign_id: FOREIGN } });

    const res = await authed(request(app).post('/api/trend-sentiment/trend-foreign')).send({});

    expect(res.status).toBe(404);
    expect(H.crudList).not.toHaveBeenCalled();
    expect(H.geminiGenerate).not.toHaveBeenCalled();
    expect(H.crudUpdate).not.toHaveBeenCalled();
  });

  it('свой тренд — анализ выполняется', async () => {
    records({ 'trend-own': { campaign_id: OWN } });
    H.crudList.mockResolvedValue([{ id: 'c1', text: 'отлично' }]);

    const res = await authed(request(app).post('/api/trend-sentiment/trend-own')).send({});

    expect(res.status).toBe(200);
    expect(H.crudUpdate).toHaveBeenCalledWith(
      'campaign_trend_topics', 'trend-own', expect.objectContaining({ sentiment_analysis: expect.anything() }),
      expect.anything(),
    );
  });
});

describe('POST /api/analyze-comments', () => {
  const analyze = (body: any) => authed(request(app).post('/api/analyze-comments')).send(body);

  it('своя кампания + чужой trendId → 404, AI не вызван', async () => {
    records({ 'trend-foreign': { campaign_id: FOREIGN } });

    const res = await analyze({ campaignId: OWN, trendId: 'trend-foreign', level: 'basic' });

    expect(res.status).toBe(404);
    expect(H.crudList).not.toHaveBeenCalled();
    expect(H.geminiGenerate).not.toHaveBeenCalled();
  });

  it('свой тренд — анализ идёт', async () => {
    records({ 'trend-own': { campaign_id: OWN } });
    H.crudList.mockResolvedValue([{ id: 'c1', text: 'норм' }]);

    const res = await analyze({ campaignId: OWN, trendId: 'trend-own', level: 'trend' });

    expect(res.status).toBe(200);
  });

  /**
   * Pivot через trend.source_id (находка ревью 2026-07-29): свой тренд мог
   * ссылаться на ЧУЖОЙ источник, и level=source читал все тренды этого
   * источника и перезаписывал его sentiment_analysis служебным токеном.
   */
  describe('level=source: source_id тренда — данные, а не доверенный факт', () => {
    const OWN_TREND_FOREIGN_SOURCE = {
      'trend-own': { id: 'trend-own', campaign_id: OWN, source_id: 'source-foreign' },
      'source-foreign': { id: 'source-foreign', campaign_id: FOREIGN },
    };

    /** post_comment пуст, трендовый refetch отдаёт запись из records(). */
    function listReturnsTrendRow(map: Record<string, any>) {
      H.crudList.mockImplementation(async (collection: any, opts: any) => {
        if (collection === 'campaign_trend_topics' && opts?.filter?.id?._eq) {
          const row = map[String(opts.filter.id._eq)];
          return row ? [row] : [];
        }
        return [];
      });
    }

    it('свой тренд + ЧУЖОЙ source_id → 404, тренды источника не читаются, источник не перезаписывается', async () => {
      records(OWN_TREND_FOREIGN_SOURCE);
      listReturnsTrendRow(OWN_TREND_FOREIGN_SOURCE);

      const res = await analyze({ campaignId: OWN, trendId: 'trend-own', level: 'source' });

      expect(res.status).toBe(404);
      // Чтения по source_id (агрегация чужих трендов) не было.
      const sourceReads = H.crudList.mock.calls.filter(([, opts]: any[]) => opts?.filter?.source_id);
      expect(sourceReads).toHaveLength(0);
      // Admin-запись в чужой источник не выполнена.
      expect(H.crudUpdate).not.toHaveBeenCalledWith('campaign_content_sources', expect.anything(), expect.anything(), expect.anything());
    });

    it('битая ссылка: source_id указывает на несуществующий источник → 404 без записи', async () => {
      const map = { 'trend-own': { id: 'trend-own', campaign_id: OWN, source_id: 'source-ghost' } };
      records(map);
      listReturnsTrendRow(map);

      const res = await analyze({ campaignId: OWN, trendId: 'trend-own', level: 'source' });

      expect(res.status).toBe(404);
      expect(H.crudUpdate).not.toHaveBeenCalled();
    });

    it('валидная связь внутри одной кампании — анализ идёт, выборка ограничена кампанией', async () => {
      const map = {
        'trend-own': { id: 'trend-own', campaign_id: OWN, source_id: 'source-own' },
        'source-own': { id: 'source-own', campaign_id: OWN },
      };
      records(map);
      listReturnsTrendRow(map);

      const res = await analyze({ campaignId: OWN, trendId: 'trend-own', level: 'source' });

      expect(res.status).toBe(200);
      // Агрегирующая выборка по source_id дополнительно зажата подтверждённой кампанией.
      const sourceReads = H.crudList.mock.calls.filter(([, opts]: any[]) => opts?.filter?.source_id);
      expect(sourceReads.length).toBeGreaterThan(0);
      for (const [, opts] of sourceReads) {
        expect(opts.filter.campaign_id).toEqual({ _eq: OWN });
      }
      expect(H.crudUpdate).toHaveBeenCalledWith(
        'campaign_content_sources', 'source-own', expect.anything(), expect.anything(),
      );
    });
  });
});

describe('POST /api/sources/:sourceId/analyze — проверки не было вовсе', () => {
  it('чужой источник → 404, тренды не читаются и не правятся', async () => {
    records({ 'source-foreign': { campaign_id: FOREIGN } });

    const res = await authed(request(app).post('/api/sources/source-foreign/analyze')).send({});

    expect(res.status).toBe(404);
    expect(H.crudList).not.toHaveBeenCalled();
    expect(H.crudUpdate).not.toHaveBeenCalled();
    expect(H.geminiGenerate).not.toHaveBeenCalled();
  });

  it('несуществующий источник → 404', async () => {
    records({});

    const res = await authed(request(app).post('/api/sources/нет-такого/analyze')).send({});

    expect(res.status).toBe(404);
    expect(H.crudList).not.toHaveBeenCalled();
  });

  it('недоступный Directus → 503, анализ не стартует', async () => {
    H.crudGetById.mockRejectedValue(new Error('boom'));

    const res = await authed(request(app).post('/api/sources/source-own/analyze')).send({});

    expect(res.status).toBe(503);
    expect(H.crudList).not.toHaveBeenCalled();
  });

  it('свой источник — анализ выполняется', async () => {
    records({ 'source-own': { campaign_id: OWN } });
    H.crudList.mockResolvedValue([]);

    const res = await authed(request(app).post('/api/sources/source-own/analyze')).send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

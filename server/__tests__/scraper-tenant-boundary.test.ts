/**
 * Граница арендатора в ручках скрейпера (`/api/scraper/...`) и `collect-direct`.
 *
 * Находка ревью 2026-07-30. Все эти ручки стояли за `authenticateUser` и на
 * этом останавливались:
 *
 *  - `POST /api/trends/collect-direct` запускал сбор трендов в кампанию из тела
 *    запроса служебным токеном — любой залогиненный наполнял чужую кампанию;
 *  - `GET /api/scraper/monitoring/channels` без `campaignId` отдавал каналы
 *    мониторинга ВСЕХ арендаторов одним списком;
 *  - `DELETE`, `force-parse`, `parse-status`, `overview`, `analytics` брали
 *    `channelId` из пути и шли в скрейпер без единой проверки владения;
 *  - `POST /api/scraper/monitoring/sync-campaign` читал чужую кампанию
 *    служебным токеном и регистрировал её каналы.
 *
 * У канала нет собственного арендатора в Directus: связь выводится через
 * `social_media_settings` кампаний. Поэтому проверка идёт цепочкой
 * channelId → platform_channel_id → кампании запросившего.
 *
 * Mutation-proof: убрать guard из любого хендлера — тест краснеет, потому что
 * проверяются не только коды ответов, но и то, что во внешний скрейпер и в
 * привилегированную запись НЕ ушло ни одного вызова.
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
    crudGetById: vi.fn(async () => null as any),
    crudList: vi.fn(async () => [] as any[]),
    crudUpdate: vi.fn(async () => ({})),
    getAllMonitoredChannels: vi.fn(async () => ({ items: [] as any[], total: 0, page: 1, page_size: 0 })),
    getMonitoredChannels: vi.fn(async () => ({ items: [] as any[], total: 0, page: 1, page_size: 0 })),
    deleteMonitoringChannel: vi.fn(async () => true),
    forceParseChannel: vi.fn(async () => ({ ok: true })),
    getChannelParseStatus: vi.fn(async () => ({ status: 'idle' })),
    getChannelOverview: vi.fn(async () => ({ posts: 1 })),
    getChannelAnalytics: vi.fn(async () => ({ points: [] })),
    ensureChannelsRegistered: vi.fn(async () => undefined),
    collectTrendsForCampaign: vi.fn(async () => ({ collected: 0 })),
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
    create: vi.fn(async () => ({ id: 'new' })),
    delete: vi.fn(),
    getAdminTokenPublic: vi.fn(async () => 'admin-token'),
  },
}));

vi.mock('../services/scraper-analytics', () => ({
  getAllMonitoredChannels: H.getAllMonitoredChannels,
  getMonitoredChannels: H.getMonitoredChannels,
  deleteMonitoringChannel: H.deleteMonitoringChannel,
  forceParseChannel: H.forceParseChannel,
  getChannelParseStatus: H.getChannelParseStatus,
  getChannelOverview: H.getChannelOverview,
  getChannelAnalytics: H.getChannelAnalytics,
  ensureChannelsRegistered: H.ensureChannelsRegistered,
  createMonitoringChannel: vi.fn(async () => ({ id: 'ch' })),
  // Настоящая логика: канал кампании — telegram username и vk groupId.
  getScraperCampaignChannels: (settings: any) => {
    const out: any[] = [];
    const tg = String(settings?.telegram?.username ?? '').replace(/^@/, '').trim();
    if (tg) out.push({ platform: 'telegram', id: tg });
    const vk = String(settings?.vk?.groupId ?? '').trim();
    if (vk) out.push({ platform: 'vk', id: vk });
    return out;
  },
}));

vi.mock('../services/trend-collector', () => ({
  getPublicBaseUrl: () => 'https://smm.example.test',
  SCRAPER_BASE: 'https://scraper.example.test',
  getScraperApiKey: H.getScraperApiKey,
  collectTrendsForCampaign: H.collectTrendsForCampaign,
}));

vi.mock('../directus', () => ({
  directusApi: { get: vi.fn(async () => ({ data: { data: [] } })), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  directusApiManager: {
    request: vi.fn(), cacheAuthToken: vi.fn(),
    instance: { interceptors: { response: { use: vi.fn() } } },
  },
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('axios', () => {
  const interceptors = { request: { use: vi.fn() }, response: { use: vi.fn() } };
  const instance: any = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn(), interceptors };
  const create = () => instance;
  return { default: { ...instance, create }, create, interceptors };
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

const app = express();
app.use(express.json());
registerTrendsRoutes(app);

const createMockToken = (payload: object) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${body}.signature`;
};
const ATTACKER = createMockToken({ id: 'user-attacker', email: 'a@x.io' });
const authed = (r: request.Test) => r.set('Authorization', `Bearer ${ATTACKER}`);

const OWN = 'campaign-own';
const VICTIM = 'campaign-of-victim';

/** Канал атакующего и канал жертвы в общем списке скрейпера. */
const OWN_CHANNEL = { id: 'ch-own', platform: 'telegram', platform_channel_id: 'own_channel' };
const VICTIM_CHANNEL = { id: 'ch-victim', platform: 'telegram', platform_channel_id: 'victim_channel' };

beforeEach(() => {
  vi.resetAllMocks();

  // Доступ есть только к своей кампании.
  H.authorizeCampaignAccess.mockImplementation(async (campaignId: any) => {
    if (campaignId === OWN) return { id: OWN } as any;
    throw new H.CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');
  });
  H.listAccessibleCampaignIds.mockImplementation(async () => [OWN]);

  H.crudGetById.mockImplementation(async (_collection: any, id: any) => {
    if (id === OWN) return { id: OWN, name: 'Своя', social_media_settings: { telegram: { username: 'own_channel' } } };
    if (id === VICTIM) return { id: VICTIM, name: 'Чужая', social_media_settings: { telegram: { username: 'victim_channel' } } };
    return null;
  });

  // Скрейпер честно отдаёт оба канала — изоляция обязана стоять в приложении.
  H.getAllMonitoredChannels.mockImplementation(async () => ({
    items: [OWN_CHANNEL, VICTIM_CHANNEL], total: 2, page: 1, page_size: 2,
  }));
  H.getMonitoredChannels.mockImplementation(async () => ({
    items: [OWN_CHANNEL, VICTIM_CHANNEL], total: 2, page: 1, page_size: 2,
  }));

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { id: 'user-attacker', is_smm_admin: false } }),
    text: async () => '',
    clone() { return this; },
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Ни одна операция над чужим каналом не ушла в скрейпер. */
function expectScraperUntouched() {
  expect(H.deleteMonitoringChannel).not.toHaveBeenCalled();
  expect(H.forceParseChannel).not.toHaveBeenCalled();
  expect(H.getChannelParseStatus).not.toHaveBeenCalled();
  expect(H.getChannelOverview).not.toHaveBeenCalled();
  expect(H.getChannelAnalytics).not.toHaveBeenCalled();
  expect(H.ensureChannelsRegistered).not.toHaveBeenCalled();
}

describe('collect-direct: сбор только в свою кампанию', () => {
  it('чужая кампания — 404 и сбор не запущен', async () => {
    const res = await authed(request(app).post('/api/trends/collect-direct')).send({ campaignId: VICTIM });
    expect(res.status).toBe(404);
    expect(H.collectTrendsForCampaign).not.toHaveBeenCalled();
  });

  it('своя кампания — сбор запускается', async () => {
    const res = await authed(request(app).post('/api/trends/collect-direct')).send({ campaignId: OWN });
    expect(res.status).toBe(200);
  });
});

describe('sync-campaign: регистрация каналов только своей кампании', () => {
  it('чужая кампания — 404, каналы не регистрируются', async () => {
    const res = await authed(request(app).post('/api/scraper/monitoring/sync-campaign')).send({ campaignId: VICTIM });
    expect(res.status).toBe(404);
    expectScraperUntouched();
  });

  it('своя кампания — регистрация проходит', async () => {
    const res = await authed(request(app).post('/api/scraper/monitoring/sync-campaign')).send({ campaignId: OWN });
    expect(res.status).toBe(200);
  });
});

describe('monitoring/channels: список без campaignId запрещён', () => {
  it('без campaignId — 400, чужие каналы не утекают', async () => {
    const res = await authed(request(app).get('/api/scraper/monitoring/channels'));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('victim_channel');
  });

  it('чужой campaignId — 404', async () => {
    const res = await authed(request(app).get(`/api/scraper/monitoring/channels?campaignId=${VICTIM}`));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('victim_channel');
  });

  it('свой campaignId — только свои каналы', async () => {
    const res = await authed(request(app).get(`/api/scraper/monitoring/channels?campaignId=${OWN}`));
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).toContain('own_channel');
    expect(body).not.toContain('victim_channel');
  });
});

describe('операции по channelId: чужой канал недоступен', () => {
  const table: Array<{ name: string; call: () => request.Test }> = [
    { name: 'DELETE канала', call: () => authed(request(app).delete(`/api/scraper/monitoring/channels/${VICTIM_CHANNEL.id}`)) },
    { name: 'force-parse', call: () => authed(request(app).post(`/api/scraper/monitoring/channels/${VICTIM_CHANNEL.id}/force-parse`)) },
    { name: 'parse-status', call: () => authed(request(app).get(`/api/scraper/monitoring/channels/${VICTIM_CHANNEL.id}/parse-status`)) },
    { name: 'overview', call: () => authed(request(app).get(`/api/scraper/channels/${VICTIM_CHANNEL.id}/overview`)) },
    { name: 'analytics', call: () => authed(request(app).get(`/api/scraper/channels/${VICTIM_CHANNEL.id}/analytics`)) },
  ];

  for (const { name, call } of table) {
    it(`${name} по чужому каналу — 404 и скрейпер не тронут`, async () => {
      const res = await call();
      expect(res.status).toBe(404);
      expectScraperUntouched();
    });
  }

  it('свой канал по-прежнему обслуживается', async () => {
    const res = await authed(request(app).get(`/api/scraper/monitoring/channels/${OWN_CHANNEL.id}/parse-status`));
    expect(res.status).toBe(200);
    expect(H.getChannelParseStatus).toHaveBeenCalledWith(OWN_CHANNEL.id);
  });

  it('несуществующий канал — 404, а не проход к скрейперу', async () => {
    const res = await authed(request(app).delete('/api/scraper/monitoring/channels/ch-nonexistent'));
    expect(res.status).toBe(404);
    expectScraperUntouched();
  });
});

describe('fail-closed при недоступности', () => {
  it('скрейпер не ответил — 503, операция не выполнена', async () => {
    H.getAllMonitoredChannels.mockRejectedValueOnce(new Error('scraper down'));
    const res = await authed(request(app).delete(`/api/scraper/monitoring/channels/${OWN_CHANNEL.id}`));
    expect(res.status).toBe(503);
    expect(H.deleteMonitoringChannel).not.toHaveBeenCalled();
  });

  it('проверка кампаний недоступна — 503, операция не выполнена', async () => {
    H.listAccessibleCampaignIds.mockRejectedValueOnce(new Error('directus down'));
    const res = await authed(request(app).post(`/api/scraper/monitoring/channels/${OWN_CHANNEL.id}/force-parse`));
    expect(res.status).toBe(503);
    expect(H.forceParseChannel).not.toHaveBeenCalled();
  });
});

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
    createMonitoringChannel: vi.fn(async () => ({ id: 'ch-new' })),
    getChannelPosts: vi.fn(async () => ({ items: [], total: 0, page: 1, has_next_page: false })),
    getChannelBestTimes: vi.fn(async () => ({ by_day: [], by_hour: [] })),
    getChannelPostsDynamics: vi.fn(async () => ({ points: [] })),
    getTrendingPosts: vi.fn(async () => [{ id: 'post-1' }]),
    getEngagementComparison: vi.fn(async () => ({ channels: [], best_performer: null })),
    refreshChannelMetrics: vi.fn(async () => ({ refreshed: 1 })),
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

// Сетевые функции скрейпера мокаются, а вот РАЗБОР настроек кампании и ключ
// сравнения берутся настоящие (`importActual`). Прежняя версия теста подменяла
// getScraperCampaignChannels упрощённым mock'ом, который срезал `@` у телеграм-
// имени, — то есть проверяла нормализацию, которой в бою нет (находка приёмки
// 30.07.2026). Теперь расхождение нормализаций тест обязан заметить.
vi.mock('../services/scraper-analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/scraper-analytics')>();
  return {
    ...actual,
    getScraperCampaignChannels: actual.getScraperCampaignChannels,
    scraperChannelKey: actual.scraperChannelKey,
    getAllMonitoredChannels: H.getAllMonitoredChannels,
    getMonitoredChannels: H.getMonitoredChannels,
    deleteMonitoringChannel: H.deleteMonitoringChannel,
    forceParseChannel: H.forceParseChannel,
    getChannelParseStatus: H.getChannelParseStatus,
    getChannelOverview: H.getChannelOverview,
    getChannelAnalytics: H.getChannelAnalytics,
    getChannelPosts: H.getChannelPosts,
    getChannelBestTimes: H.getChannelBestTimes,
    getChannelPostsDynamics: H.getChannelPostsDynamics,
    getTrendingPosts: H.getTrendingPosts,
    getEngagementComparison: H.getEngagementComparison,
    refreshChannelMetrics: H.refreshChannelMetrics,
    ensureChannelsRegistered: H.ensureChannelsRegistered,
    createMonitoringChannel: H.createMonitoringChannel,
  };
});

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
/** VK-группа своей кампании: в настройках `-777`, у скрейпера `777`. */
const OWN_VK_CHANNEL = { id: 'ch-own-vk', platform: 'vk', platform_channel_id: '777' };
/**
 * Чужой канал, чей id СОВПАДАЕТ со своим телеграм-именем, но на другой
 * платформе. Ловит сравнение по голому id без платформы.
 */
const CROSS_PLATFORM_TRAP = { id: 'ch-trap', platform: 'vk', platform_channel_id: 'own_channel' };

beforeEach(() => {
  vi.resetAllMocks();

  // Доступ есть только к своей кампании.
  H.authorizeCampaignAccess.mockImplementation(async (campaignId: any) => {
    if (campaignId === OWN) return { id: OWN } as any;
    throw new H.CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');
  });
  H.listAccessibleCampaignIds.mockImplementation(async () => [OWN]);

  // Настройки кампании — в том же виде, в каком их пишет UI: телеграм с `@`,
  // VK числом. Настоящий getScraperCampaignChannels отдаст `@own_channel`, а
  // скрейпер знает канал как `own_channel` — расхождение, которое обязан
  // сглаживать общий scraperChannelKey, а не тестовый mock.
  H.crudGetById.mockImplementation(async (_collection: any, id: any) => {
    if (id === OWN) {
      return {
        id: OWN, name: 'Своя',
        social_media_settings: { telegram: { username: '@own_channel' }, vk: { groupId: '-777' } },
      };
    }
    if (id === VICTIM) {
      return {
        id: VICTIM, name: 'Чужая',
        social_media_settings: { telegram: { username: '@victim_channel' } },
      };
    }
    return null;
  });

  // Скрейпер честно отдаёт оба канала — изоляция обязана стоять в приложении.
  H.getAllMonitoredChannels.mockImplementation(async () => ({
    items: [OWN_CHANNEL, OWN_VK_CHANNEL, VICTIM_CHANNEL, CROSS_PLATFORM_TRAP],
    total: 4, page: 1, page_size: 4,
  }));
  H.getMonitoredChannels.mockImplementation(async () => ({
    items: [OWN_CHANNEL, OWN_VK_CHANNEL, VICTIM_CHANNEL, CROSS_PLATFORM_TRAP],
    total: 4, page: 1, page_size: 4,
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
  expect(H.getChannelPosts).not.toHaveBeenCalled();
  expect(H.getChannelBestTimes).not.toHaveBeenCalled();
  expect(H.getChannelPostsDynamics).not.toHaveBeenCalled();
  expect(H.getTrendingPosts).not.toHaveBeenCalled();
  expect(H.getEngagementComparison).not.toHaveBeenCalled();
  expect(H.refreshChannelMetrics).not.toHaveBeenCalled();
  expect(H.createMonitoringChannel).not.toHaveBeenCalled();
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
    { name: 'posts', call: () => authed(request(app).get(`/api/scraper/channels/${VICTIM_CHANNEL.id}/posts`)) },
    { name: 'best-times', call: () => authed(request(app).get(`/api/scraper/channels/${VICTIM_CHANNEL.id}/best-times`)) },
    { name: 'posts/dynamics', call: () => authed(request(app).get(`/api/scraper/channels/${VICTIM_CHANNEL.id}/posts/dynamics`)) },
    // Ловушка на сравнение без платформы: id совпадает со СВОИМ телеграм-именем,
    // но канал VK и своей кампании не принадлежит.
    { name: 'кросс-платформенная ловушка', call: () => authed(request(app).get(`/api/scraper/channels/${CROSS_PLATFORM_TRAP.id}/posts`)) },
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

describe('нормализация: свой канал остаётся своим', () => {
  it('телеграм с @ в настройках и без @ у скрейпера — это один канал', async () => {
    const res = await authed(request(app).get(`/api/scraper/channels/${OWN_CHANNEL.id}/posts`));
    expect(res.status).toBe(200);
    expect(H.getChannelPosts).toHaveBeenCalled();
  });

  it('VK-группа -777 в настройках и 777 у скрейпера — это один канал', async () => {
    const res = await authed(request(app).get(`/api/scraper/channels/${OWN_VK_CHANNEL.id}/best-times`));
    expect(res.status).toBe(200);
    expect(H.getChannelBestTimes).toHaveBeenCalled();
  });

  it('список каналов кампании отдаёт оба своих и ни одного чужого', async () => {
    const res = await authed(request(app).get(`/api/scraper/monitoring/channels?campaignId=${OWN}`));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((ch: any) => ch.id).sort();
    expect(ids).toEqual([OWN_VK_CHANNEL.id, OWN_CHANNEL.id].sort());
  });
});

describe('агрегаты не отдают чужое', () => {
  it('trends/posts без campaignId — 400, скрейпер не тронут', async () => {
    const res = await authed(request(app).get('/api/scraper/trends/posts'));
    expect(res.status).toBe(400);
    expect(H.getTrendingPosts).not.toHaveBeenCalled();
  });

  it('trends/posts с чужим campaignId — 404', async () => {
    const res = await authed(request(app).get(`/api/scraper/trends/posts?campaignId=${VICTIM}`));
    expect(res.status).toBe(404);
    expect(H.getTrendingPosts).not.toHaveBeenCalled();
  });

  it('trends/posts со своим campaignId: набор каналов выводит сервер, а не клиент', async () => {
    const res = await authed(request(app).get(
      `/api/scraper/trends/posts?campaignId=${OWN}&channel_ids=${VICTIM_CHANNEL.id}`,
    ));
    expect(res.status).toBe(200);
    const passed = H.getTrendingPosts.mock.calls[0][0].channel_ids;
    expect(passed.sort()).toEqual([OWN_CHANNEL.id, OWN_VK_CHANNEL.id].sort());
    expect(passed).not.toContain(VICTIM_CHANNEL.id);
  });

  it('analytics/engagement так же игнорирует присланный channel_ids', async () => {
    const res = await authed(request(app).get(
      `/api/scraper/analytics/engagement?campaignId=${OWN}&channel_ids=${VICTIM_CHANNEL.id}`,
    ));
    expect(res.status).toBe(200);
    const passed = H.getEngagementComparison.mock.calls[0][0].channel_ids;
    expect(passed).not.toContain(VICTIM_CHANNEL.id);
  });

  it('trends/hashtags отключена fail-closed: upstream не умеет ограничивать набор', async () => {
    const res = await authed(request(app).get('/api/scraper/trends/hashtags'));
    expect(res.status).toBe(501);
  });
});

describe('операции со списком каналов проверяют каждый элемент', () => {
  it('metrics-refresh с чужим каналом в списке отклоняется целиком', async () => {
    const res = await authed(request(app).post('/api/scraper/monitoring/scheduler/metrics-refresh')).send({
      channels: [
        { id: OWN_CHANNEL.id, platform: 'telegram', platform_channel_id: 'own_channel' },
        { id: VICTIM_CHANNEL.id, platform: 'telegram', platform_channel_id: 'victim_channel' },
      ],
    });
    expect(res.status).toBe(404);
    expect(H.refreshChannelMetrics, 'частичный запуск недопустим').not.toHaveBeenCalled();
  });

  /**
   * Подмена внутреннего id под видом своей внешней пары.
   *
   * Первая версия guard'а проверяла `platform + platform_channel_id`, а наверх
   * отправляла присланный `channels[].id` — поля друг с другом не связаны.
   * Атакующий прикрывал чужой внутренний id парой СВОЕГО канала: проверка
   * проходила, метрики обновлялись у чужого (находка повторной приёмки).
   */
  it('чужой id под своей парой platform/channel_id не проходит наверх', async () => {
    const res = await authed(request(app).post('/api/scraper/monitoring/scheduler/metrics-refresh')).send({
      channels: [{
        id: VICTIM_CHANNEL.id,               // чужой внутренний id
        platform: 'telegram',
        platform_channel_id: '@own_channel', // но пара — своя
      }],
    });

    expect(res.status).toBe(200);
    // Ключевое: наверх ушёл id СВОЕГО канала, а не присланный.
    const sent = H.refreshChannelMetrics.mock.calls[0][0].channels;
    expect(sent).toHaveLength(1);
    expect(sent[0].id, 'id обязан быть выведен сервером').toBe(OWN_CHANNEL.id);
    expect(JSON.stringify(sent)).not.toContain(VICTIM_CHANNEL.id);
  });

  it('metrics-refresh только по своим каналам проходит', async () => {
    const res = await authed(request(app).post('/api/scraper/monitoring/scheduler/metrics-refresh')).send({
      channels: [{ id: OWN_CHANNEL.id, platform: 'telegram', platform_channel_id: '@own_channel' }],
    });
    expect(res.status).toBe(200);
    expect(H.refreshChannelMetrics).toHaveBeenCalled();
  });

  it('регистрация чужого канала запрещена', async () => {
    const res = await authed(request(app).post('/api/scraper/monitoring/channels')).send({
      platform: 'telegram', platform_channel_id: 'victim_channel',
    });
    expect(res.status).toBe(404);
    expect(H.createMonitoringChannel).not.toHaveBeenCalled();
  });

  it('регистрация своего канала разрешена', async () => {
    const res = await authed(request(app).post('/api/scraper/monitoring/channels')).send({
      platform: 'telegram', platform_channel_id: '@own_channel',
    });
    expect(res.status).toBe(200);
    expect(H.createMonitoringChannel).toHaveBeenCalled();
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

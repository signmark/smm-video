/**
 * Route-level граница арендатора.
 *
 * publish-tenant-boundary.test.ts проверяет саму функцию-guard. Здесь мы
 * доказываем, что КОНКРЕТНЫЕ маршруты действительно её вызывают и НЕ выполняют
 * привилегированную работу при отказе. Раньше удаление guard из хендлера
 * оставляло тесты зелёными — эти тесты это ловят (mutation-proof: снять вызов
 * guard из любого хендлера → соответствующий тест краснеет).
 *
 * Настоящие роутеры монтируются в мини-Express; зависимости мокаются на границах.
 * Авторизация — НЕ мок: реальный authenticateUser + фейковый JWT + стаб fetch
 * (как в auth_flow.test.ts), поэтому «без токена → 401» тоже под проверкой.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// vi.mock хойстится выше объявлений — все спаи и классы создаём в vi.hoisted,
// иначе фабрики моков обращаются к ним до инициализации.
const H = vi.hoisted(() => {
  class CampaignAccessError extends Error {
    constructor(public readonly status: 404 | 503, public readonly code: string) {
      super(code);
    }
  }
  const axiosGet = vi.fn(async () => ({ data: { data: {} } }));
  const axiosPost = vi.fn(async () => ({ data: { data: {} } }));
  const axiosPatch = vi.fn(async () => ({ data: { data: {} } }));
  return {
    CampaignAccessError,
    assertContentBelongsToRequester: vi.fn((_id: string, _req: any, res: any) => {
      res.status(404).json({ success: false, error: 'Контент не найден' });
      return false;
    }),
    authorizeCampaignAccess: vi.fn(async () => { throw new CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND'); }),
    resolvePublishingToken: vi.fn(async () => 'service-token'),
    publishToFacebook: vi.fn(async () => ({ status: 'published', postUrl: 'u', postId: 'p' })),
    updatePublicationStatus: vi.fn(async () => ({})),
    convertForInstagramStories: vi.fn(async () => ({ success: true, convertedUrl: 'c' })),
    updateContentVideoUrl: vi.fn(async () => true),
    publishInstagramStory: vi.fn(async () => ({ success: true })),
    schedulerCheck: vi.fn(async () => {}),
    directusGet: vi.fn(async () => ({ data: { data: {} } })),
    directusPost: vi.fn(async () => ({ data: { data: { id: 'new' } } })),
    directusPatch: vi.fn(async () => ({ data: { data: {} } })),
    axiosGet, axiosPost, axiosPatch,
  };
});
const {
  CampaignAccessError, assertContentBelongsToRequester, authorizeCampaignAccess,
  resolvePublishingToken, publishToFacebook, convertForInstagramStories,
  publishInstagramStory, schedulerCheck, directusPost, directusPatch,
  axiosGet, axiosPatch,
} = H;

vi.mock('../services/admin-token-manager', () => ({
  adminTokenManager: { getAdminToken: vi.fn(async () => 'test-service-token'), clearToken: vi.fn() },
}));
vi.mock('../services/content-access', () => ({ assertContentBelongsToRequester: H.assertContentBelongsToRequester }));
vi.mock('../services/campaign-access', () => ({ authorizeCampaignAccess: H.authorizeCampaignAccess, CampaignAccessError: H.CampaignAccessError }));
vi.mock('../services/publishing-token', () => ({ resolvePublishingToken: H.resolvePublishingToken, getServiceTokenFromEnv: vi.fn(() => 'service-token') }));
vi.mock('../services/social-platforms/facebook-service', () => ({ facebookService: { publishToFacebook: H.publishToFacebook, updatePublicationStatus: H.updatePublicationStatus } }));
vi.mock('../services/real-video-converter', () => ({ realVideoConverter: { convertForInstagramStories: H.convertForInstagramStories, updateContentVideoUrl: H.updateContentVideoUrl } }));
vi.mock('../services/social-platforms/instagram-stories-service', () => ({ publishInstagramStory: H.publishInstagramStory }));
vi.mock('../services/publish-scheduler', () => ({ getPublishScheduler: () => ({ checkScheduledContent: H.schedulerCheck }) }));
vi.mock('../directus', () => ({
  directusApi: { get: H.directusGet, post: H.directusPost, patch: H.directusPatch, delete: vi.fn() },
  directusApiManager: { request: vi.fn(), cacheAuthToken: vi.fn(), instance: { interceptors: { response: { use: vi.fn() } } } },
  default: { get: H.directusGet, post: H.directusPost, patch: H.directusPatch, delete: vi.fn() },
}));
vi.mock('axios', () => {
  const interceptors = { request: { use: vi.fn() }, response: { use: vi.fn() } };
  const instance: any = { get: H.axiosGet, post: H.axiosPost, patch: H.axiosPatch, delete: vi.fn(), put: vi.fn(), interceptors };
  const create = () => instance;
  return { default: { get: H.axiosGet, post: H.axiosPost, patch: H.axiosPatch, delete: vi.fn(), put: vi.fn(), create, interceptors }, create, interceptors };
});

// --- Тяжёлые импорты stories, не нужные на deny-путях: глушим на границе ---
vi.mock('../services/vk-stories-service', () => ({}));
vi.mock('../services/social-platforms/vk-stories-service', () => ({ vkStoriesService: {} }));
vi.mock('../services/social-platforms/vk-clips-service', () => ({ vkClipsService: {} }));
vi.mock('../services/social-platforms/youtube-service', () => ({ YouTubeService: class {} }));
vi.mock('../services/social', () => ({ socialPublishingService: {} }));
vi.mock('../services/stories-image-generator', () => ({ generateStoriesImageServer: vi.fn() }));
vi.mock('../services/beget-s3-storage-aws', () => ({ BegetS3StorageAws: class {} }));
vi.mock('../services/beget-s3-video-service', () => ({ begetS3VideoService: {} }));
vi.mock('../services/stories-media-service', () => ({ default: class {} }));
vi.mock('fluent-ffmpeg', () => ({ default: () => ({}) }));
vi.mock('../utils/logger', () => ({ log: vi.fn(), default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

// Роутеры импортируем ПОСЛЕ моков.
import facebookRouter from '../api/facebook-webhook-unified';
import socialPublishingRouter from '../api/social-publishing-router';
import storiesRouter from '../routes/stories';
import { registerSocialRoutes } from '../routes/social';

const fbApp = express();
fbApp.use(express.json());
fbApp.use('/', facebookRouter);

const pubApp = express();
pubApp.use(express.json());
pubApp.use('/api', socialPublishingRouter);

const storiesApp = express();
storiesApp.use(express.json());
storiesApp.use('/api/stories', storiesRouter);

const socialApp = express();
socialApp.use(express.json());
registerSocialRoutes(socialApp);

const createMockToken = (payload: object) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${body}.signature`;
};
const STRANGER = createMockToken({ id: 'user-stranger', email: 's@x.io' });
const authed = (r: request.Test) => r.set('Authorization', `Bearer ${STRANGER}`);

beforeEach(() => {
  vi.clearAllMocks();
  // guard снова денай (clearAllMocks сбросил реализацию).
  assertContentBelongsToRequester.mockImplementation((_id: string, _req: any, res: any) => {
    res.status(404).json({ success: false, error: 'Контент не найден' });
    return false;
  });
  authorizeCampaignAccess.mockImplementation(async () => {
    throw new CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');
  });
  resolvePublishingToken.mockResolvedValue('service-token');
  // Валидная сессия для authenticateUser (как в auth_flow.test.ts).
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

describe('Route-level граница арендатора', () => {
  it('facebook-webhook POST / без auth → 401, публикация не вызвана', async () => {
    const res = await request(fbApp).post('/').send({ contentId: 'foreign' });
    expect(res.status).toBe(401);
    expect(publishToFacebook).not.toHaveBeenCalled();
  });

  it('facebook-webhook POST / с чужим contentId → 404, публикация не вызвана', async () => {
    const res = await authed(request(fbApp).post('/')).send({ contentId: 'foreign' });
    expect(res.status).toBe(404);
    expect(assertContentBelongsToRequester).toHaveBeenCalledWith('foreign', expect.anything(), expect.anything());
    expect(publishToFacebook).not.toHaveBeenCalled();
  });

  it('stories publish-video/:id с чужим ID → 404, конвертация/публикация не вызваны', async () => {
    const res = await authed(request(storiesApp).post('/api/stories/publish-video/foreign')).send({});
    expect(res.status).toBe(404);
    expect(assertContentBelongsToRequester).toHaveBeenCalledWith('foreign', expect.anything(), expect.anything());
    expect(convertForInstagramStories).not.toHaveBeenCalled();
    expect(publishInstagramStory).not.toHaveBeenCalled();
  });

  it('stories convert-and-publish с чужим campaignId → 404, конвертация/создание/публикация не вызваны', async () => {
    const res = await authed(request(storiesApp).post('/api/stories/convert-and-publish'))
      .send({ videoUrl: 'v', campaignId: 'foreign-campaign' });
    expect(res.status).toBe(404);
    expect(authorizeCampaignAccess).toHaveBeenCalled();
    expect(convertForInstagramStories).not.toHaveBeenCalled();
    expect(directusPost).not.toHaveBeenCalled();
    expect(publishInstagramStory).not.toHaveBeenCalled();
  });

  it('stories POST / без campaignId → 400, дефолт не подставляется и запись не создаётся', async () => {
    const res = await authed(request(storiesApp).post('/api/stories')).send({ title: 'x' });
    expect(res.status).toBe(400);
    expect(authorizeCampaignAccess).not.toHaveBeenCalled();
    expect(directusPost).not.toHaveBeenCalled();
  });

  it('stories POST / с чужим campaignId → 403, запись не создаётся', async () => {
    const res = await authed(request(storiesApp).post('/api/stories'))
      .send({ title: 'x', campaignId: 'foreign-campaign' });
    expect(res.status).toBe(403);
    expect(authorizeCampaignAccess).toHaveBeenCalled();
    expect(directusPost).not.toHaveBeenCalled();
  });

  it('stories POST /simple с чужим campaignId → 403, запись не создаётся', async () => {
    const res = await authed(request(storiesApp).post('/api/stories/simple'))
      .send({ title: 'x', campaignId: 'foreign-campaign' });
    expect(res.status).toBe(403);
    expect(authorizeCampaignAccess).toHaveBeenCalled();
    expect(directusPost).not.toHaveBeenCalled();
  });

  it('stories GET /?campaignId=чужой → 403, чтение из Directus не выполняется', async () => {
    const res = await authed(request(storiesApp).get('/api/stories').query({ campaignId: 'foreign-campaign' }));
    expect(res.status).toBe(403);
    expect(authorizeCampaignAccess).toHaveBeenCalled();
    expect(H.directusGet).not.toHaveBeenCalled();
  });

  it('social POST /api/content/:id/publish с чужим ID → 404, PATCH/scheduler не вызваны', async () => {
    const res = await authed(request(socialApp).post('/api/content/foreign/publish'))
      .send({ socialPlatforms: {}, status: 'scheduled' });
    expect(res.status).toBe(404);
    expect(assertContentBelongsToRequester).toHaveBeenCalledWith('foreign', expect.anything(), expect.anything());
    expect(directusPatch).not.toHaveBeenCalled();
    expect(schedulerCheck).not.toHaveBeenCalled();
  });

  it('publish/now с чужим ID → 404, публикация не запущена', async () => {
    const res = await authed(request(pubApp).post('/api/publish/now'))
      .send({ contentId: 'foreign', platforms: ['telegram'] });
    expect(res.status).toBe(404);
    expect(assertContentBelongsToRequester).toHaveBeenCalledWith('foreign', expect.anything(), expect.anything());
    expect(resolvePublishingToken).not.toHaveBeenCalled();
  });

  it('retry-platform с чужим ID → 404, привилегированные чтение/запись не вызваны', async () => {
    const res = await authed(request(pubApp).post('/api/retry-platform'))
      .send({ contentId: 'foreign', platform: 'telegram' });
    expect(res.status).toBe(404);
    expect(assertContentBelongsToRequester).toHaveBeenCalledWith('foreign', expect.anything(), expect.anything());
    // полный privileged GET контента и PATCH — только после guard, значит не должны сработать
    expect(axiosGet).not.toHaveBeenCalled();
    expect(axiosPatch).not.toHaveBeenCalled();
  });
});

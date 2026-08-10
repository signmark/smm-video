/**
 * SM-15 / AI-85: маршрут /api/publish/now Threads — route-level тест.
 *
 * ДЕФЕКТ. До AI-85 post-publish `axios.patch` в Directus в `social-publishing-router.ts`
 * шёл без своего try/catch. Если Directus сбоил, пост реально уходил в Threads, а в БД
 * оставалось `status=draft, social_platforms={}`. Тестировщик видел пост в канале, но
 * не видел в приложении (фильтр по `status=published`), публиковал руками — получал
 * дубль.
 *
 * ФИКС. Хелпер `confirmPublishRecord` в `server/services/publish-record-confirm.ts`
 * делает две попытки записи: 'published', затем 'publish_succeeded_record_failed'
 * с доказательствами публикации. Маршрут использует helper вместо inline patch'а.
 *
 * Этот тест проверяет, что **маршрут** действительно использует helper и отдаёт
 * правильную форму ответа при `record-failed`. Подход — по шаблону AI-88
 * (`instagram-setup-wizard-routes.test.ts`): поднимаем настоящий роутер через
 * supertest, мокаем зависимости, дёргаем запрос, проверяем ответ.
 *
 * RED-BEFORE (по §1). Этот тест красный на ДО-фикса коде (Threads без helper'а):
 * при сбое `axios.patch` маршрут вылетал в общий catch с 500, а не отдавал
 * `{success: true, published: true, recordSaved: false, guidance: 'do_not_republish'}`.
 *
 * MUTATION-PROOF. Если закомментировать вызов helper'а в маршруте и вернуть inline
 * `axios.patch`, тест красный: helper не вызван, ответ — 500 (или вовсе нет
 * `recordFailedResponse` в ответе).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// vi.mock хойстится выше объявлений — все спаи и классы создаём в vi.hoisted.
const H = vi.hoisted(() => ({
  assertContentBelongsToRequester: vi.fn(async () => true),
  resolvePublishingToken: vi.fn(async () => 'service-token'),
  publicationLockAcquire: vi.fn(async () => true),
  publicationLockRelease: vi.fn(async () => undefined),
  helperConfirmPublishRecord: vi.fn(),
  helperRecordFailedResponse: vi.fn(),
  threadsPublishPost: vi.fn(),
  axiosGet: vi.fn(),
  axiosPatch: vi.fn(),
  extractPlatformNames: vi.fn((platforms: any) => {
    // Простейшая реализация: для объекта — keys(true), для массива — массив
    if (Array.isArray(platforms)) return platforms;
    if (typeof platforms === 'object' && platforms !== null) {
      return Object.keys(platforms).filter(k => platforms[k]);
    }
    return [];
  }),
  normalizePlatforms: vi.fn((platforms: any) => platforms),
  createPendingStatuses: vi.fn(() => ({})),
  resolvePublishFinalization: vi.fn(async () => ({})),
}));

// Моки модулей
vi.mock('../services/content-access', () => ({
  assertContentBelongsToRequester: H.assertContentBelongsToRequester,
}));

vi.mock('../services/publishing-token', () => ({
  resolvePublishingToken: H.resolvePublishingToken,
}));

vi.mock('../services/publication-lock-manager', () => ({
  publicationLockManager: {
    acquireLock: H.publicationLockAcquire,
    releaseLock: H.publicationLockRelease,
  },
}));

vi.mock('../utils/platforms-helper', () => ({
  normalizePlatforms: H.normalizePlatforms,
  createPendingStatuses: H.createPendingStatuses,
  extractPlatformNames: H.extractPlatformNames,
}));

vi.mock('@shared/schedule-time', () => ({
  resolvePublishFinalization: H.resolvePublishFinalization,
}));

// Mock helper — это ключ к проверке поведения маршрута
vi.mock('../services/publish-record-confirm', () => ({
  confirmPublishRecord: H.helperConfirmPublishRecord,
  recordFailedResponse: H.helperRecordFailedResponse,
}));

// Mock платформенного сервиса Threads
vi.mock('../services/social-platforms/threads-service', () => ({
  threadsService: {
    publishPost: H.threadsPublishPost,
  },
}));

// Mock directus.ts чтобы избежать интерцепторов на axios
vi.mock('../directus', () => ({
  directusApi: {
    get: H.axiosGet,
    post: vi.fn().mockResolvedValue({ data: { data: {} } }),
    patch: H.axiosPatch,
    delete: vi.fn(),
  },
  directusApiManager: {
    request: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  getAdminToken: vi.fn(async () => 'admin-token'),
}));

vi.mock('axios', () => {
  return {
    default: {
      get: H.axiosGet,
      post: vi.fn(),
      patch: H.axiosPatch,
      delete: vi.fn(),
      create: () => ({ get: H.axiosGet, post: vi.fn(), patch: H.axiosPatch }),
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    },
  };
});

// Storage mock — не критичен для этих сценариев, но маршрут его импортирует.
vi.mock('../storage', () => ({
  storage: {
    updateCampaignContent: vi.fn(async () => true),
  },
}));

// Auth middleware mock — обходим настоящую аутентификацию.
vi.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', token: 'user-token' };
    next();
  },
}));

async function makeApp(): Promise<express.Express> {
  vi.resetModules();
  const router = (await import('../api/social-publishing-router')).default;
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  return app;
}

const CONTENT_ITEM = {
  id: 'content-1',
  campaign_id: 'campaign-1',
  text_content: 'Test post',
  content: 'Test post',
  title: 'Test post',
  social_platforms: { telegram: { status: 'published' } },
};

beforeEach(() => {
  process.env.DIRECTUS_URL = 'https://directus.test';
  process.env.DIRECTUS_STATIC_TOKEN = 'test-token';
  process.env.NODE_ENV = 'production';

  H.assertContentBelongsToRequester.mockReset().mockResolvedValue(true);
  H.resolvePublishingToken.mockReset().mockResolvedValue('service-token');
  H.publicationLockAcquire.mockReset().mockResolvedValue(true);
  H.publicationLockRelease.mockReset().mockResolvedValue(undefined);

  // Threads publish mock — success by default
  H.threadsPublishPost.mockReset().mockResolvedValue({
    success: true,
    postId: 'threads-post-1',
    postUrl: 'https://threads.net/@user/post/1',
  });

  // Directus GET (content fetch) — returns our test content
  H.axiosGet.mockReset().mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.includes('/items/campaign_content/')) {
      return { data: { data: CONTENT_ITEM } };
    }
    if (typeof url === 'string' && url.includes('/items/user_campaigns/')) {
      return {
        data: {
          data: {
            social_media_settings: {
              threads: {
                accessToken: 'thread-token',
                threadsUserId: 'thread-user-id',
              },
            },
          },
        },
      };
    }
    return { data: { data: {} } };
  });

  H.axiosPatch.mockReset().mockResolvedValue({ data: { data: {} } });

  // Helper mock — по умолчанию success
  H.helperConfirmPublishRecord.mockReset().mockResolvedValue({ kind: 'success' });
  H.helperRecordFailedResponse.mockReset().mockImplementation((args: any) => ({
    success: true,
    published: true,
    recordSaved: false,
    guidance: 'do_not_republish',
    platform: args.platform,
    postId: args.published.postId,
    postUrl: args.published.postUrl,
    publishedAt: args.published.publishedAt,
    recordError: args.outcome.originalError,
    markerSaved: args.outcome.markerSaved,
  }));
});

describe('AI-85: /api/publish/now Threads — поведение при сбое записи', () => {
  it('при kind=record-failed ответ содержит published/recordSaved/guidance (НЕ 5xx)', async () => {
    // Arrange: helper говорит, что Directus запись провалилась
    H.helperConfirmPublishRecord.mockResolvedValue({
      kind: 'record-failed',
      originalError: 'Directus 503',
      markerSaved: false,
    });

    const app = await makeApp();
    const res = await request(app)
      .post('/api/publish/now')
      .send({ contentId: 'content-1', platforms: { threads: true } });

    // CRITICAL: НЕ 5xx. Иначе пользователь видит «не опубликовано» и
    // републикует руками → дубль.
    expect(res.status).toBe(200);

    const result = res.body.results?.[0] ?? res.body;
    expect(result.published).toBe(true);
    expect(result.recordSaved).toBe(false);
    expect(result.guidance).toBe('do_not_republish');
    expect(result.platform).toBe('threads');
    expect(result.postId).toBe('threads-post-1');
    expect(result.recordError).toContain('Directus 503');
  });

  it('helper confirmPublishRecord вызывается после успешной внешней публикации', async () => {
    H.helperConfirmPublishRecord.mockResolvedValue({ kind: 'success' });

    const app = await makeApp();
    await request(app)
      .post('/api/publish/now')
      .send({ contentId: 'content-1', platforms: { threads: true } });

    expect(H.helperConfirmPublishRecord).toHaveBeenCalled();
    const callArgs = H.helperConfirmPublishRecord.mock.calls[0][0];
    expect(callArgs.contentId).toBe('content-1');
    expect(callArgs.platform).toBe('threads');
    expect(callArgs.published.status).toBe('published');
  });

  it('при kind=success recordFailedResponse НЕ вызывается', async () => {
    H.helperConfirmPublishRecord.mockResolvedValue({ kind: 'success' });

    const app = await makeApp();
    await request(app)
      .post('/api/publish/now')
      .send({ contentId: 'content-1', platforms: { threads: true } });

    expect(H.helperConfirmPublishRecord).toHaveBeenCalled();
    expect(H.helperRecordFailedResponse).not.toHaveBeenCalled();
  });

  it('при kind=record-failed recordFailedResponse вызывается с правильными аргументами', async () => {
    H.helperConfirmPublishRecord.mockResolvedValue({
      kind: 'record-failed',
      originalError: 'Directus 503',
      markerSaved: false,
    });

    const app = await makeApp();
    await request(app)
      .post('/api/publish/now')
      .send({ contentId: 'content-1', platforms: { threads: true } });

    expect(H.helperRecordFailedResponse).toHaveBeenCalled();
    const callArgs = H.helperRecordFailedResponse.mock.calls[0][0];
    expect(callArgs.platform).toBe('threads');
    expect(callArgs.outcome.originalError).toContain('Directus 503');
  });
});
/**
 * Инвариант: контент со статусом 'published' ОБЯЗАН иметь непустой published_at.
 *
 * Откуда взялась дыра: платформа считается опубликованной по postId/postUrl даже
 * без publishedAt (isConfirmedPublishedPlatform), а дата контента собиралась
 * только из publishedAt платформ (getContentAggregateTimes). На этой развилке
 * контент получал status='published' с published_at = null и молча выпадал из
 * всех разрезов по времени (график активности, экспорт отчётов).
 *
 * Покрываем три пути записи:
 *  1. PublishScheduler.updateContentStatus — основной путь планировщика
 *  2. POST /api/publish/mark-as-published/:contentId — ручная пометка
 *  3. вебхук статусов платформ — подстраховочное обновление общего статуса
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ─── Моки границ ──────────────────────────────────────────────────────────────

/** Narrow structural types for mock return values. */
type ContentRecord = { id?: string; status?: string; publishedAt?: string | Date | null; [k: string]: unknown };
type DirectusItemResp = { data: { data: Record<string, unknown> } };

const H = vi.hoisted(() => ({
  crudList: vi.fn(async (): Promise<ContentRecord[]> => []),
  crudUpdate: vi.fn(async (_collection: string, _id: string, _data: ContentRecord): Promise<DirectusItemResp> => ({ data: { data: {} } })),
  axiosGet: vi.fn(async (_url: string, _config?: Record<string, unknown>): Promise<DirectusItemResp> => ({ data: { data: {} } })),
  axiosPatch: vi.fn(async (_url: string, _data?: ContentRecord): Promise<DirectusItemResp> => ({ data: { data: {} } })),
  axiosPost: vi.fn(async (_url: string, _data?: ContentRecord): Promise<{ data: unknown }> => ({ data: {} })),
  storageGetById: vi.fn(async (_id: string): Promise<ContentRecord | null> => null),
  storageUpdate: vi.fn(async (_id: string, _data: ContentRecord): Promise<ContentRecord> => ({})),
  getAdminAuthToken: vi.fn(async (): Promise<string> => 'admin-token'),
}));

vi.mock('axios', () => {
  const instance = {
    get: H.axiosGet,
    post: H.axiosPost,
    patch: H.axiosPatch,
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  };
  return {
    default: { get: H.axiosGet, post: H.axiosPost, patch: H.axiosPatch, create: () => instance },
    create: () => instance,
  };
});

vi.mock('../utils/logger', () => {
  const log: any = vi.fn();
  log.debug = vi.fn(); log.info = vi.fn(); log.warn = vi.fn(); log.error = vi.fn();
  return { log, default: log };
});

vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    list: H.crudList,
    update: H.crudUpdate,
    getById: vi.fn(),
    readMany: vi.fn(),
    createItem: vi.fn(),
    updateItem: vi.fn(),
  },
}));

vi.mock('../storage', () => ({
  storage: {
    getCampaignContentById: H.storageGetById,
    updateCampaignContent: H.storageUpdate,
  },
}));

vi.mock('../services/directus-auth-manager', () => ({
  DirectusAuthManager: { getAdminToken: H.getAdminToken },
  directusAuthManager: {
    getValidToken: vi.fn(async () => 'admin-token'),
    getAdminAuthToken: H.getAdminAuthToken,
    getAllActiveSessions: vi.fn(() => []),
  },
}));

// Границы, которые планировщик тянет статически, но в этом тесте не использует.
vi.mock('../services/ai-service', () => ({ aiService: { generateContent: vi.fn() } }));
vi.mock('../services/publication-lock-manager', () => ({
  publicationLockManager: {
    isLocked: vi.fn(() => false),
    acquireLock: vi.fn(async () => true),
    releaseLock: vi.fn(async () => undefined),
  },
}));
vi.mock('../services/publication-tracking', () => ({
  publicationTracker: { canPublish: vi.fn(async () => true), markAsProcessed: vi.fn() },
}));
vi.mock('../services/social/index', () => ({
  socialPublishingService: { publishToPlatform: vi.fn() },
}));
vi.mock('../services/admin-token-manager', () => ({
  adminTokenManager: { getToken: vi.fn(async () => 'admin-token') },
}));
vi.mock('../index', () => ({ broadcastNotification: vi.fn() }));

// Аутентификация: пропускаем как владельца.
vi.mock('../middleware/user-auth', () => ({
  authenticateUser: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', token: 'user-token' };
    next();
  },
  requireSmmAdmin: (_req: any, _res: any, next: any) => next(),
}));

import { PublishScheduler } from '../services/publish-scheduler';
import { registerPublishingRoutes } from '../api/publishing-routes';
import statusWebhookRouter from '../api/social-platform-status-webhook';

// ─── Хелперы ─────────────────────────────────────────────────────────────────

/** Платформа, опубликованная БЕЗ publishedAt — ровно тот случай из-за которого
 * и заведён этот набор. */
const publishedNoDate = (postUrl: string) => ({
  status: 'published',
  selected: true,
  postId: '42',
  postUrl,
});

const publishedWithDate = (postUrl: string, publishedAt: string) => ({
  ...publishedNoDate(postUrl),
  publishedAt,
});

/** Прогоняет приватный updateContentStatus планировщика на заданном состоянии. */
async function runSchedulerSync(freshContent: ContentRecord) {
  H.crudList.mockResolvedValue([freshContent]);
  const scheduler = new PublishScheduler();
  await (scheduler as any).updateContentStatus(freshContent.id);
  return H.crudUpdate.mock.calls[0]?.[2] as ContentRecord | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  H.crudUpdate.mockResolvedValue({ data: { data: {} } });
  H.axiosPatch.mockResolvedValue({ data: { data: {} } });
  H.getAdminAuthToken.mockResolvedValue('admin-token');
  process.env.DIRECTUS_URL = 'http://directus.test';
});

// ─── 1. Планировщик ───────────────────────────────────────────────────────────

describe('PublishScheduler.updateContentStatus — published_at не теряется', () => {
  it('ставит published_at, когда платформы опубликованы без собственного publishedAt', async () => {
    const before = Date.now();
    const updateData = await runSchedulerSync({
      id: 'content-1',
      status: 'scheduled',
      published_at: null,
      scheduled_at: null,
      social_platforms: {
        telegram: publishedNoDate('https://t.me/c/1'),
        vk: publishedNoDate('https://vk.com/wall-1_2'),
      },
    });

    expect(updateData?.status).toBe('published');
    // Ключевое: дата обязана быть, иначе запись выпадает из разрезов по времени.
    expect(updateData?.published_at).toBeTruthy();
    const written = new Date(String(updateData!.published_at)).getTime();
    expect(Number.isFinite(written)).toBe(true);
    expect(written).toBeGreaterThanOrEqual(before);
  });

  it('никогда не оставляет status=published с пустым published_at', async () => {
    const updateData = await runSchedulerSync({
      id: 'content-2',
      status: 'scheduled',
      published_at: null,
      scheduled_at: null,
      social_platforms: { telegram: publishedNoDate('https://t.me/c/2') },
    });

    expect(updateData?.status).toBe('published');
    // Ни null, ни undefined: контент, помеченный published, обязан унести дату
    // в тот же патч, иначе она не появится уже никогда.
    expect(updateData?.published_at).toBeTruthy();
  });

  it('уважает реальную дату платформы, когда она есть (без подмены на now)', async () => {
    const real = '2026-07-01T10:00:00.000Z';
    const updateData = await runSchedulerSync({
      id: 'content-3',
      status: 'scheduled',
      published_at: null,
      scheduled_at: null,
      social_platforms: {
        telegram: publishedWithDate('https://t.me/c/3', real),
      },
    });

    expect(updateData?.status).toBe('published');
    expect(new Date(String(updateData!.published_at)).toISOString()).toBe(real);
  });

  it('берёт самую позднюю дату среди платформ', async () => {
    const early = '2026-07-01T10:00:00.000Z';
    const late = '2026-07-02T12:30:00.000Z';
    const updateData = await runSchedulerSync({
      id: 'content-4',
      status: 'scheduled',
      published_at: null,
      scheduled_at: null,
      social_platforms: {
        telegram: publishedWithDate('https://t.me/c/4', early),
        vk: publishedWithDate('https://vk.com/wall-4_5', late),
      },
    });

    expect(new Date(String(updateData!.published_at)).toISOString()).toBe(late);
  });

  it('частично опубликованный контент дату НЕ получает', async () => {
    const updateData = await runSchedulerSync({
      id: 'content-5',
      status: 'scheduled',
      published_at: null,
      scheduled_at: null,
      social_platforms: {
        telegram: publishedNoDate('https://t.me/c/5'),
        vk: { status: 'pending', selected: true },
      },
    });

    expect(updateData?.status).not.toBe('published');
    expect(updateData?.published_at ?? null).toBeNull();
  });

  it('уже проставленную дату не перетирает', async () => {
    const existing = '2026-06-15T08:00:00.000Z';
    const updateData = await runSchedulerSync({
      id: 'content-6',
      status: 'published',
      published_at: existing,
      scheduled_at: null,
      social_platforms: { telegram: publishedNoDate('https://t.me/c/6') },
    });

    expect(updateData?.published_at).toBeUndefined();
  });
});

// ─── 2. Ручная пометка ────────────────────────────────────────────────────────

describe('POST /api/publish/mark-as-published — статус и дата одним запросом', () => {
  const makeApp = () => {
    const app = express();
    app.use(express.json());
    registerPublishingRoutes(app as any);
    return app;
  };

  it('пишет status и publishedAt в одном вызове storage', async () => {
    H.storageGetById.mockResolvedValue({ id: 'c-1', status: 'draft', publishedAt: null });

    const res = await request(makeApp())
      .post('/api/publish/mark-as-published/c-1')
      .send({});

    expect(res.status).toBe(200);
    expect(H.storageUpdate).toHaveBeenCalledTimes(1);
    const [, updates] = H.storageUpdate.mock.calls[0];
    expect(updates.status).toBe('published');
    // Раньше дата ставилась отдельным axios-патчем под токеном случайной сессии,
    // и при её отсутствии контент оставался published без даты.
    expect(updates.publishedAt).toBeTruthy();
    expect(Number.isFinite(new Date(String(updates.publishedAt)).getTime())).toBe(true);
  });

  it('не сдвигает уже существующую дату публикации', async () => {
    const existing = new Date('2026-05-01T00:00:00.000Z');
    H.storageGetById.mockResolvedValue({ id: 'c-2', status: 'published', publishedAt: existing });

    await request(makeApp()).post('/api/publish/mark-as-published/c-2').send({});

    const [, updates] = H.storageUpdate.mock.calls[0];
    expect(new Date(String(updates.publishedAt)).toISOString()).toBe(existing.toISOString());
  });

  it('не зависит от наличия активных сессий Directus', async () => {
    H.storageGetById.mockResolvedValue({ id: 'c-3', status: 'draft', publishedAt: null });

    await request(makeApp()).post('/api/publish/mark-as-published/c-3').send({});

    const [, updates] = H.storageUpdate.mock.calls[0];
    expect(updates.publishedAt).toBeTruthy();
  });
});

// ─── 3. Вебхук статусов платформ ──────────────────────────────────────────────

describe('вебхук статусов платформ — общий статус пишется snake_case', () => {
  // Вебхук закрыт секретом (см. status-webhook-auth.test.ts); здесь он нужен
  // лишь чтобы дойти до проверяемой логики.
  const WEBHOOK_SECRET = 'test-webhook-secret';

  beforeEach(() => {
    process.env.STATUS_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  const makeApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/social', statusWebhookRouter);
    return app;
  };

  it('подстраховочный апдейт шлёт published_at, а не publishedAt', async () => {
    // Платформа приходит published с postUrl; в Directus контент ещё не published,
    // но обе платформы уже опубликованы → срабатывает подстраховочная ветка.
    const stored = {
      id: 'c-1',
      status: 'scheduled',
      social_platforms: { telegram: { status: 'published', postUrl: 'https://t.me/c/1' } },
    };
    H.axiosGet.mockResolvedValue({ data: { data: stored } });

    await request(makeApp())
      .post('/api/social/update-status/telegram')
      .set('x-webhook-secret', WEBHOOK_SECRET)
      .send({ contentId: 'c-1', status: 'published', postUrl: 'https://t.me/c/1' });

    const publishedPatches = H.axiosPatch.mock.calls
      .map(([, body]) => body)
      .filter((body): body is ContentRecord => !!body && body.status === 'published');

    expect(publishedPatches.length).toBeGreaterThan(0);
    for (const body of publishedPatches) {
      // camelCase-поля в campaign_content нет: Directus отбил бы весь патч.
      expect(body).not.toHaveProperty('publishedAt');
      expect(body.published_at).toBeTruthy();
    }
  });
});

/**
 * SM-45: планировщик реально двигает lastSuccessfulPassAt на успешном (в т.ч.
 * пустом) проходе — и НЕ двигает на зависшем/упавшем. Это машинная замена
 * AI-65 info-heartbeat «крон замолчал»: живость читается из timestamp, а не из
 * наличия info-строки в журнале.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: {
    post: vi.fn(), get: vi.fn(), patch: vi.fn(),
    create: vi.fn().mockReturnValue({
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    }),
  },
}));
vi.mock('../utils/content-cache', () => ({ invalidateContentCache: vi.fn() }));
vi.mock('../services/directus-crud', () => ({
  directusCrud: { list: vi.fn(), update: vi.fn(), getById: vi.fn(), create: vi.fn() },
}));
vi.mock('../services/publication-lock-manager', () => ({
  publicationLockManager: {
    isLocked: vi.fn().mockResolvedValue(false),
    acquireLock: vi.fn().mockResolvedValue(true),
    releaseLock: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock('../services/publication-tracking', () => ({
  publicationTracker: {
    canPublish: vi.fn().mockResolvedValue(true),
    markAsProcessed: vi.fn().mockResolvedValue(true),
    releasePublication: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock('../index', () => ({ broadcastNotification: vi.fn() }));
vi.mock('../services/admin-token-manager', () => ({
  adminTokenManager: { getAdminToken: vi.fn().mockResolvedValue('tok'), clearToken: vi.fn() },
}));
vi.mock('../utils/environment-detector', () => ({
  detectEnvironment: vi.fn().mockReturnValue({
    environment: 'production',
    verboseLogs: false,
    debugScheduler: false,
    logLevel: 'info',
    directusUrl: 'http://directus.test',
  }),
}));

import { getPublishScheduler } from '../services/publish-scheduler';
import { directusCrud } from '../services/directus-crud';
import { refreshEnvironmentConfig } from '../utils/logger';

const scheduler = getPublishScheduler();

beforeEach(() => {
  vi.clearAllMocks();
  refreshEnvironmentConfig();
  process.env.DIRECTUS_URL = 'http://directus.test';
  // @ts-ignore
  scheduler.processedContentCache.clear();
  // @ts-ignore
  scheduler.isProcessing = false;
});

describe('SM-45: lastSuccessfulPassAt двигает только успешный проход', () => {
  it('пустой успешный проход двигает timestamp (idle тоже success)', async () => {
    // @ts-ignore до первого прохода null
    scheduler.lastSuccessfulPassAt = null;
    vi.mocked(directusCrud.list).mockResolvedValue([] as any);

    await scheduler.checkScheduledContent();

    // @ts-ignore
    const snap = scheduler.getLivenessSnapshot();
    expect(snap.lastSuccessfulPassAt).not.toBeNull();
    expect(typeof snap.lastSuccessfulPassAt).toBe('number');
  });

  it('проход с контентом (но без публикаций сейчас) тоже двигает timestamp', async () => {
    // @ts-ignore
    scheduler.lastSuccessfulPassAt = null;
    vi.mocked(directusCrud.list).mockResolvedValue([
      {
        id: 'future-1', status: 'scheduled', user_id: 'u-1', campaign_id: 'camp-1',
        scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
        social_platforms: { telegram: { status: 'pending', scheduledAt: new Date(Date.now() + 3600_000).toISOString() } },
      },
    ] as any);

    await scheduler.checkScheduledContent();

    // @ts-ignore
    expect(scheduler.getLivenessSnapshot().lastSuccessfulPassAt).not.toBeNull();
  });

  it('упавший проход НЕ двигает timestamp (stale остаётся stale)', async () => {
    const before = 1000; // фиксируем старый success давно
    // @ts-ignore
    scheduler.lastSuccessfulPassAt = before;
    // list кидает — цикл не завершается успехом (отказ ловится внутренним
    // catch), поэтому timestamp не двигается.
    vi.mocked(directusCrud.list).mockRejectedValue(new Error('db down'));

    await scheduler.checkScheduledContent();

    // @ts-ignore
    expect(scheduler.getLivenessSnapshot().lastSuccessfulPassAt).toBe(before);
  });

  it('зависший цикл (isProcessing=true) не входит и не двигает timestamp', async () => {
    const before = 2000;
    // @ts-ignore
    scheduler.lastSuccessfulPassAt = before;
    // @ts-ignore симулируем незавершённый цикл
    scheduler.isProcessing = true;

    await scheduler.checkScheduledContent();

    // @ts-ignore ранний выход — timestamp не тронут
    expect(scheduler.getLivenessSnapshot().lastSuccessfulPassAt).toBe(before);
  });
});

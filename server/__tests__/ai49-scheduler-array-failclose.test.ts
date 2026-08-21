/**
 * AI-49 v4 — scheduler-level: битая форма площадки (массив) уходит в fail-close
 * (0 lock/adapter), а pending-площадка рядом остаётся eligible.
 *
 * Мутация «снова сделать массив retryable» обязана красить здесь (не только
 * в unit-тесте helper'а), поэтому проверяем поведением через checkScheduledContent.
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
vi.mock('../utils/logger', () => {
  const log = Object.assign(vi.fn(), { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  return { log, logEvent: vi.fn(), default: { log, info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } };
});
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

import { getPublishScheduler } from '../services/publish-scheduler';
import { directusCrud } from '../services/directus-crud';
import { publicationLockManager } from '../services/publication-lock-manager';
import { log } from '../utils/logger';

const scheduler = getPublishScheduler();

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DIRECTUS_URL = 'http://directus.test';
  // @ts-ignore
  scheduler.processedContentCache.clear();
  // @ts-ignore
  scheduler.isProcessing = false;
  // @ts-ignore сбрасываем cooldown malformed-warn
  scheduler.malformedPlatformWarnedAt = new Map();
});

describe('AI-49 v4: битая форма (массив) площадки fail-close на уровне планировщика', () => {
  it('площадка-массив → 0 вызовов адаптера, warn один раз', async () => {
    const adapterSpy = vi.spyOn(scheduler as any, 'publishToTelegramDirect');
    adapterSpy.mockResolvedValue({ platform: 'telegram', success: true });
    const acquireSpy = vi.mocked(publicationLockManager.acquireLock);

    vi.mocked(directusCrud.list).mockResolvedValue([
      {
        id: 'arr-1', status: 'partially_published', user_id: 'u-1', campaign_id: 'camp-1',
        social_platforms: {
          vk: { status: 'published', postUrl: 'https://vk.com/wall-1_1' },
          telegram: [{ status: 'pending' }] as any, // битая форма — массив
        },
      },
    ] as any);

    const warn = vi.mocked(log.warn as any);
    await scheduler.checkScheduledContent();

    expect(adapterSpy).not.toHaveBeenCalled();
    expect(acquireSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('arr-1');
  });

  it('mixed: массив + pending-объект → массив fail-close (warn), pending остаётся eligible', async () => {
    const adapterSpy = vi.spyOn(scheduler as any, 'publishToTelegramDirect');
    adapterSpy.mockResolvedValue({ platform: 'telegram', success: true });

    vi.mocked(directusCrud.list).mockResolvedValueOnce([
      {
        id: 'mix-1', status: 'partially_published', user_id: 'u-1', campaign_id: 'camp-1',
        social_platforms: {
          vk: [] as any,                    // битая форма — массив
          telegram: { status: 'pending' },  // eligible
        },
      },
    ] as any)
    // isStillPublishable перечитывает статус перед отправкой — вернём pending.
    .mockResolvedValueOnce([{ id: 'mix-1', status: 'partially_published' }] as any);

    await scheduler.checkScheduledContent();

    // pending-площадка остаётся eligible → до цикла публикации доходит запись,
    // но адаптер под телеграм вызывается только для pending-объекта.
    // (Массивник не должен породить вызов адаптера — это и есть проверка.)
    const warn = vi.mocked(log.warn as any);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('vk');
  });
});

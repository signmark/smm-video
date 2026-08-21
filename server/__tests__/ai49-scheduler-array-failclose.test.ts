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
  // @ts-ignore сбрасываем cooldown (reused shouldLogTerminalError/terminalErrorLoggedAt)
  scheduler.terminalErrorLoggedAt = new Map();
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

  it('mixed: массив + pending-объект → массив fail-close (warn), адаптер получает ровно pending', async () => {
    const publishSpy = vi.spyOn(scheduler as any, 'publishContentToPlatforms');
    publishSpy.mockResolvedValue(undefined);
    const acquireSpy = vi.mocked(publicationLockManager.acquireLock);

    vi.mocked(directusCrud.list).mockResolvedValueOnce([
      {
        id: 'mix-1', status: 'partially_published', user_id: 'u-1', campaign_id: 'camp-1',
        social_platforms: {
          vk: [] as any,                    // битая форма — массив
          telegram: { status: 'pending' },  // eligible
        },
      },
    ] as any)
    // isStillPublishable перечитывает статус перед отправкой.
    .mockResolvedValueOnce([{ id: 'mix-1', status: 'partially_published' }] as any);

    await scheduler.checkScheduledContent();

    // Битую vk предупредили, но в адаптер она НЕ попала — ровно pending telegram.
    const warn = vi.mocked(log.warn as any);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('vk');
    expect(publishSpy).toHaveBeenCalled();
    const publishedPlatforms = publishSpy.mock.calls[0][1] as string[];
    expect(publishedPlatforms).toEqual(['telegram']);
    expect(publishedPlatforms).not.toContain('vk');
  });

  it('запись с null-площадкой не роняет проход: следующая запись обрабатывается, heartbeat движется', async () => {
    const publishSpy = vi.spyOn(scheduler as any, 'publishContentToPlatforms');
    publishSpy.mockResolvedValue(undefined);

    // Первая запись — битая (vk: null бросает до guard, если guard ниже).
    // Вторая — валидный pending, чтобы по ней адаптер реально вызвался.
    vi.mocked(directusCrud.list).mockResolvedValueOnce([
      {
        id: 'null-1', status: 'partially_published', user_id: 'u-1', campaign_id: 'camp-1',
        social_platforms: { vk: null as any, telegram: { status: 'pending' } },
      },
      { id: 'valid-2', status: 'partially_published', user_id: 'u-1', campaign_id: 'camp-1', social_platforms: { telegram: { status: 'pending' } } },
    ] as any)
    .mockResolvedValueOnce([{ id: 'null-1', status: 'partially_published' }] as any)
    .mockResolvedValueOnce([{ id: 'valid-2', status: 'partially_published' }] as any);

    // @ts-ignore сброс heartbeat
    scheduler.lastSuccessfulPassAt = null;
    await scheduler.checkScheduledContent();

    // Проход не упал: heartbeat обновился (успешный проход зафиксирован).
    // @ts-ignore
    expect(scheduler.getLivenessSnapshot().lastSuccessfulPassAt).not.toBeNull();
    // Валидная следующая запись реально дошла до адаптера (не потеряна из-за null).
    expect(publishSpy).toHaveBeenCalled();
  });

  it('mixed guard: scalar и null — 0 acquireLock для malformed, адаптер ровно pending', async () => {
    for (const [label, malformed] of [['scalar', 'str'], ['null', null]] as const) {
      const publishSpy = vi.spyOn(scheduler as any, 'publishContentToPlatforms');
      publishSpy.mockResolvedValue(undefined);
      const acquireSpy = vi.mocked(publicationLockManager.acquireLock);
      const warn = vi.mocked(log.warn as any);
      warn.mockClear();
      acquireSpy.mockClear();

      vi.mocked(directusCrud.list)
        .mockResolvedValueOnce([{
          id: `shape-${label}`, status: 'partially_published', user_id: 'u-1', campaign_id: 'camp-1',
          social_platforms: { vk: malformed as any, telegram: { status: 'pending' } },
        }] as any)
        .mockResolvedValueOnce([{ id: `shape-${label}`, status: 'partially_published' }] as any);

      await scheduler.checkScheduledContent();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('vk');
      expect(acquireSpy.mock.calls.some((c) => c[1] === 'vk')).toBe(false);
      const platforms = publishSpy.mock.calls[0][1] as string[];
      expect(platforms).toEqual(['telegram']);
    }
  });

  it('scheduler-level cooldown: same content+platform в пределах часа → один warn', async () => {
    const publishSpy = vi.spyOn(scheduler as any, 'publishContentToPlatforms');
    publishSpy.mockResolvedValue(undefined);
    const warn = vi.mocked(log.warn as any);

    const rows = [{
      id: 'cd-1', status: 'partially_published', user_id: 'u-1', campaign_id: 'camp-1',
      social_platforms: { vk: [] as any, telegram: { status: 'pending' } },
    }] as any;

    // Два прохода одной записи в пределах часа.
    vi.mocked(directusCrud.list)
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([{ id: 'cd-1', status: 'partially_published' }] as any)
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([{ id: 'cd-1', status: 'partially_published' }] as any);

    await scheduler.checkScheduledContent();
    const warnAfterFirst = warn.mock.calls.length;
    await scheduler.checkScheduledContent();

    expect(warnAfterFirst).toBe(1);
    expect(warn.mock.calls.length).toBe(1); // второй проход в cooldown'е — молчит
  });
});

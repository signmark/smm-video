/**
 * AI-49 v7 — scheduler-level cooldown: подавление, истечение часа, независимость
 * ключей (content/platform). Детерминированный P5-подход: часы не трогаем, сдвигаем
 * метки в terminalErrorLoggedAt назад на 61 мин (для shouldLogTerminalError это
 * равно ожиданию часа). Никаких fake-timers и Date.now spy.
 *
 * Каждый проход checkScheduledContent делает ДВА directusCrud.list вызова
 * (основная выборка + isStillPublishable перечитку), поэтому используется
 * mockImplementation (постоянная заглушка) + mockImplementationOnce для основной
 * выборки, а НЕ очередь mockResolvedValueOnce — чтобы тест не зависел от порядка
 * тестов в файле.
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
import { log } from '../utils/logger';

const scheduler = getPublishScheduler();

function rowsFor(id: string, platforms: Record<string, any>) {
  return [{
    id, status: 'partially_published', user_id: 'u-1', campaign_id: 'camp-1',
    social_platforms: platforms,
  }];
}

/** Основная выборка — rows, перечитку статуса (isStillPublishable) — по filter.id. */
function serve(rows: any[]) {
  const id = rows[0].id;
  vi.mocked(directusCrud.list).mockReset();
  vi.mocked(directusCrud.list).mockImplementation((_col: string, args: any = {}) => {
    const filter = args?.filter || {};
    if (filter.id && filter.id._eq) {
      return Promise.resolve([{ id, status: 'partially_published' }]); // isStillPublishable перечитка
    }
    return Promise.resolve(rows); // основная выборка контента
  });
}

function pretendHourPassed() {
  const cache = (scheduler as any).terminalErrorLoggedAt as Map<string, number>;
  for (const [k, ts] of cache) cache.set(k, ts - 61 * 60 * 1000);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DIRECTUS_URL = 'http://directus.test';
  // @ts-ignore
  scheduler.processedContentCache.clear();
  // @ts-ignore
  scheduler.isProcessing = false;
  // @ts-ignore
  scheduler.terminalErrorLoggedAt = new Map();
  vi.spyOn(scheduler as any, 'publishContentToPlatforms').mockResolvedValue(undefined);
});

describe('AI-49 v7: scheduler-level cooldown', () => {
  it('подавление, истечение часа и независимость ключей — пять проходов', async () => {
    const warn = vi.mocked(log.warn as any);

    serve(rowsFor('s1', { vk: [] as any, telegram: { status: 'pending' } }));
    await scheduler.checkScheduledContent();
    expect(warn.mock.calls.length).toBe(1); // печатает

    await scheduler.checkScheduledContent();
    expect(warn.mock.calls.length).toBe(1); // внутри часа молчит

    pretendHourPassed();
    await scheduler.checkScheduledContent();
    expect(warn.mock.calls.length).toBe(2); // час прошёл — печатает снова

    serve(rowsFor('s2', { vk: [] as any, telegram: { status: 'pending' } }));
    await scheduler.checkScheduledContent();
    expect(warn.mock.calls.length).toBe(3); // другая запись — свой ключ

    serve(rowsFor('s1', { instagram: 'битая строка' as any, telegram: { status: 'pending' } }));
    await scheduler.checkScheduledContent();
    expect(warn.mock.calls.length).toBe(4); // другая площадка — свой ключ
  });

  it('обход cooldown (always-true shouldLogTerminalError) даёт два warn за два прохода — красит', async () => {
    const warn = vi.mocked(log.warn as any);
    // Подменяем cooldown-узел на «всегда печатать».
    vi.spyOn(scheduler as any, 'shouldLogTerminalError').mockReturnValue(true);

    serve(rowsFor('c1', { vk: [] as any, telegram: { status: 'pending' } }));
    await scheduler.checkScheduledContent();
    expect(warn.mock.calls.length).toBe(1);

    await scheduler.checkScheduledContent();
    expect(warn.mock.calls.length).toBe(2); // без cooldown — снова печатает
  });
});

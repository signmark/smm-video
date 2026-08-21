import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AI-65 срез B2 (task #65): наблюдение не должно ронять проход. Поведенческий тест:
 * подставляем запись события (emitCronStarted/emitPublishScheduled) функцией, которая
 * БРОСАЕТ исключение, прогоняем проход планировщика и убеждаемся, что он дошёл до конца
 * и сделал свою работу (предупреждение о терминальном отказе всё равно записалось).
 * Краснел бы вчера, когда неполный мок обрывал проход до warn; source-guard не покраснел бы.
 */

vi.mock('axios', () => ({
  default: { post: vi.fn(), get: vi.fn(), patch: vi.fn(), create: vi.fn().mockReturnValue({ interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } }) },
}));
let emitThrowCount = 0;
vi.mock('../utils/logger', async (importOriginal) => {
  const log = Object.assign(vi.fn(), { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  return {
    log,
    logEvent: vi.fn(),
    // Запись события у нас «сломана»: бросает исключение каждый раз.
    emitCronStarted: vi.fn(() => { emitThrowCount++; throw new Error('logger down'); }),
    emitPublishScheduled: vi.fn(() => { emitThrowCount++; throw new Error('logger down'); }),
    default: { log, info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
});
vi.mock('../utils/content-cache', () => ({ invalidateContentCache: vi.fn() }));
vi.mock('../services/directus-crud', () => ({ directusCrud: { list: vi.fn(), update: vi.fn(), getById: vi.fn(), create: vi.fn() } }));
vi.mock('../services/publication-lock-manager', () => ({ publicationLockManager: { withLock: vi.fn((_a,_b,fn)=>fn()) } }));
vi.mock('../services/publication-tracking', () => ({ publicationTracker: { releasePublication: vi.fn() } }));
vi.mock('../index', () => ({ broadcastNotification: vi.fn() }));

import { getPublishScheduler } from '../services/publish-scheduler';
import { directusCrud } from '../services/directus-crud';
import { log } from '../utils/logger';

const scheduler = getPublishScheduler();

describe('AI-65 срез B2: проход планировщика переживает падающее журналирование (behavioral)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIRECTUS_URL = 'http://directus.test';
    // @ts-ignore
    scheduler.processedContentCache.clear();
    // @ts-ignore
    scheduler.isProcessing = false;
    // @ts-ignore
    scheduler.terminalErrorLoggedAt = new Map();
    // Публикацию не выполняем — проверяем только, что проход дошёл до конца и warn-путь сработал.
    vi.spyOn(scheduler as any, 'publishContentToPlatforms').mockResolvedValue(undefined);
    vi.spyOn(scheduler as any, 'shouldLogTerminalError').mockReturnValue(true); // печатает всегда
  });

  it('emitCronStarted/emitPublishScheduled бросают, но проход всё равно печатает терминальный warn и завершается', async () => {
    // Кампания с такой соц-платформой, что шудлер дойдёт до терминального warn (как в AI-49).
    const rows = [{
      id: 'c1', status: 'partially_published', user_id: 'u-1', campaign_id: 'camp-1',
      social_platforms: { vk: [] as any, telegram: { status: 'pending' } },
    }];
    vi.mocked(directusCrud.list).mockReset();
    vi.mocked(directusCrud.list).mockImplementation((_col: string, args: any = {}) => {
      const f = args?.filter || {};
      if (f.id && f.id._eq) return Promise.resolve([{ id: 'c1', status: 'partially_published' }]);
      return Promise.resolve(rows);
    });

    const warn = vi.mocked(log.warn as any);
    await scheduler.checkScheduledContent();

    // Запись события падала (emit сработал и бросил — не важно сколько раз), но:
    expect(emitThrowCount).toBeGreaterThan(0); // журналирование реально падало
    expect(warn.mock.calls.length).toBeGreaterThan(0); // проход дошёл до конца и сделал свою работу
  });
});

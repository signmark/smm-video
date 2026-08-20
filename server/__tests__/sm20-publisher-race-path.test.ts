/**
 * SM-20, фаза 2 (B). Исполнимая проверка: после снятия с очереди публикация
 * недостижима.
 *
 * Здесь исполняется реальный `PublishScheduler.runPublicationJob` — тот самый
 * код, который рабочий цикл планировщика вызывает для каждой отобранной
 * публикации. Проверяется не «правильный список статусов», а факт: отправка
 * не происходит и все три удержания отпущены.
 *
 * Почему это важно именно так. Пачка отбирается раньше, чем отправляется.
 * Между отбором и отправкой человек нажимает паузу, и пауза переводит свои
 * публикации в черновик. Если перед отправкой не перечитать статус, пост
 * всё равно выйдет — ровно то, о чём писал тестировщик.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger', () => {
  const log: any = vi.fn();
  log.info = vi.fn();
  log.warn = vi.fn();
  log.error = vi.fn();
  log.debug = vi.fn();
  return { log, logEvent: vi.fn(), default: log };
});

vi.mock('../storage', () => ({ storage: {} }));
vi.mock('../services/ai-service', () => ({ aiService: {} }));

const list = vi.fn();
vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    list: (collection: any, query?: any) => list(collection, query),
    update: vi.fn(),
    getById: vi.fn(),
  },
}));

const releaseLock = vi.fn(async (_contentId: string, _platform: string) => true);
vi.mock('../services/publication-lock-manager', () => ({
  publicationLockManager: {
    acquireLock: vi.fn(async () => true),
    releaseLock: (contentId: any, platform: any) => releaseLock(contentId, platform),
    isLocked: vi.fn(async () => false),
  },
}));

const releasePublication = vi.fn();
vi.mock('../services/publication-tracking', () => ({
  publicationTracker: {
    canPublish: vi.fn(async () => true),
    markAsProcessed: vi.fn(),
    releasePublication: (contentId: any, platform: any) => releasePublication(contentId, platform),
  },
}));

import { PublishScheduler, PUBLISHABLE_STATUSES } from '../services/publish-scheduler';

const CONTENT_ID = 'c0ffee00-0000-4000-8000-000000000001';
const PLATFORMS = ['telegram', 'vk'];

function makeScheduler() {
  const scheduler = new PublishScheduler();
  const publish = vi
    .spyOn(scheduler as any, 'publishContentToPlatforms')
    .mockResolvedValue(undefined);
  const releaseCache = vi.spyOn(scheduler as any, 'releasePlatformCache');
  return { scheduler, publish, releaseCache };
}

function statusOnce(status: string | null) {
  list.mockResolvedValueOnce(status === null ? [] : [{ id: CONTENT_ID, status }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  releaseLock.mockResolvedValue(true);
});

describe('SM-20: снятая с очереди публикация не уходит в платформы', () => {
  it('статус стал черновиком между отбором и отправкой — не публикуем', async () => {
    const { scheduler, publish, releaseCache } = makeScheduler();
    statusOnce('draft'); // ровно то, во что пауза переводит свои публикации

    const published = await (scheduler as any).runPublicationJob({ id: CONTENT_ID }, PLATFORMS);

    expect(published).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    // Удержания отпущены, иначе пост повиснет до истечения блокировки.
    expect(releaseCache).toHaveBeenCalledTimes(PLATFORMS.length);
    expect(releasePublication).toHaveBeenCalledTimes(PLATFORMS.length);
    expect(releaseLock).toHaveBeenCalledTimes(PLATFORMS.length);
    for (const platform of PLATFORMS) {
      expect(releaseLock).toHaveBeenCalledWith(CONTENT_ID, platform);
    }
  });

  it('перечитывается именно свежая строка этой публикации', async () => {
    const { scheduler } = makeScheduler();
    statusOnce('draft');

    await (scheduler as any).runPublicationJob({ id: CONTENT_ID }, PLATFORMS);

    expect(list).toHaveBeenCalledTimes(1);
    const [collection, query] = list.mock.calls[0];
    expect(collection).toBe('campaign_content');
    expect(query.filter).toEqual({ id: { _eq: CONTENT_ID } });
    // Отбор пачки уже позади: сейчас читаем из базы, а не из того, что отобрали.
    expect(query.limit).toBe(1);
  });

  it('запись удалена — не публикуем', async () => {
    const { scheduler, publish } = makeScheduler();
    statusOnce(null);

    const published = await (scheduler as any).runPublicationJob({ id: CONTENT_ID }, PLATFORMS);

    expect(published).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalledTimes(PLATFORMS.length);
  });

  it('статус перечитать не удалось — считаем «нельзя», а не «можно»', async () => {
    const { scheduler, publish } = makeScheduler();
    list.mockRejectedValueOnce(new Error('directus недоступен'));

    const published = await (scheduler as any).runPublicationJob({ id: CONTENT_ID }, PLATFORMS);

    // Пропущенная публикация выйдет следующим проходом. Лишняя — это пост,
    // который человек уже снял; вернуть его назад невозможно.
    expect(published).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalledTimes(PLATFORMS.length);
  });

  it('обычная публикация в очереди уходит как прежде', async () => {
    const { scheduler, publish, releaseCache } = makeScheduler();
    statusOnce('scheduled');

    const published = await (scheduler as any).runPublicationJob({ id: CONTENT_ID }, PLATFORMS);

    expect(published).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({ id: CONTENT_ID }, PLATFORMS);
    // Успешная отправка сама распоряжается удержаниями — цикл их не трогает.
    expect(releaseCache).not.toHaveBeenCalled();
    expect(releaseLock).not.toHaveBeenCalled();
  });

  it('каждый публикуемый статус по-прежнему публикуется', async () => {
    for (const status of PUBLISHABLE_STATUSES) {
      vi.clearAllMocks();
      const { scheduler, publish } = makeScheduler();
      statusOnce(status);

      const published = await (scheduler as any).runPublicationJob({ id: CONTENT_ID }, PLATFORMS);

      expect(published, `статус ${status} должен публиковаться`).toBe(true);
      expect(publish).toHaveBeenCalledTimes(1);
    }
  });

  it('падение самой отправки по-прежнему отпускает удержания', async () => {
    // Регрессия на прежнее поведение: обработка ошибки переехала в тот же метод.
    const { scheduler, publish, releaseCache } = makeScheduler();
    statusOnce('scheduled');
    publish.mockRejectedValueOnce(new Error('telegram 500'));

    const published = await (scheduler as any).runPublicationJob({ id: CONTENT_ID }, PLATFORMS);

    expect(published).toBe(false);
    expect(releaseCache).toHaveBeenCalledTimes(PLATFORMS.length);
    expect(releasePublication).toHaveBeenCalledTimes(PLATFORMS.length);
    expect(releaseLock).toHaveBeenCalledTimes(PLATFORMS.length);
  });
});

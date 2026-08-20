/**
 * AI-65, этап 4: доменные события публикации и цикла планировщика.
 *
 * ЗАЧЕМ ОНИ. По стабильным именам потом строятся оповещения: «публикация упала
 * чаще N раз за четверть часа», «крон замолчал». Искать по тексту сообщения
 * нельзя — текст переписывают при первой правке формулировки, и все сохранённые
 * запросы молча перестают находить.
 *
 * ГДЕ ОНИ СТОЯТ. Событие ставится в единственной точке записи статуса площадки,
 * а не в каждом из десятка методов публикации: иначе новая площадка появится
 * без события, и никто этого не заметит. Тест это и проверяет — не наличие
 * вызова в исходнике, а то, что событие приходит по итогу публикации.
 *
 * ОТДЕЛЬНО про publish.record_failed. Это состояние, когда пост уже ушёл на
 * площадку, а записать это в базу не удалось. Снаружи оно выглядит как
 * неопубликованный пост, и именно поэтому опаснее обычного отказа: повторная
 * отправка даст дубль у живых людей. Его нельзя сваливать ни в успех, ни в
 * отказ — это третий исход.
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
vi.mock('../utils/environment-detector', () => ({
  detectEnvironment: vi.fn().mockReturnValue({
    environment: 'production',
    verboseLogs: false,
    debugScheduler: false,
    logLevel: 'info',
    directusUrl: 'http://directus.test',
  }),
}));

import {
  getPublishScheduler,
  publishOutcomeEvent,
  classifyPublishFailure,
} from '../services/publish-scheduler';
import { directusCrud } from '../services/directus-crud';
import { refreshEnvironmentConfig } from '../utils/logger';

const scheduler = getPublishScheduler();

beforeEach(() => {
  vi.clearAllMocks();
  refreshEnvironmentConfig();
  process.env.DIRECTUS_URL = 'http://directus.test';
  // @ts-ignore приватный кэш прошлых прогонов
  scheduler.processedContentCache.clear();
  // @ts-ignore планировщик мог остаться «занят» после упавшего теста
  scheduler.isProcessing = false;
});

/** Все события, ушедшие в лог за время работы fn. */
async function captureEvents(fn: () => Promise<void>): Promise<any[]> {
  const lines: string[] = [];
  const push = (...args: any[]) => { lines.push(String(args[0])); };
  const spies = [
    vi.spyOn(console, 'log').mockImplementation(push),
    vi.spyOn(console, 'warn').mockImplementation(push),
    vi.spyOn(console, 'error').mockImplementation(push),
  ];

  try {
    await fn();
  } finally {
    spies.forEach((s) => s.mockRestore());
  }

  return lines
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((o) => o && o.event);
}

describe('AI-65: исход публикации — чистая функция', () => {
  it('три исхода различаются, промежуточные состояния события не дают', () => {
    expect(publishOutcomeEvent('published')).toBe('publish.succeeded');
    expect(publishOutcomeEvent('failed')).toBe('publish.failed');
    expect(publishOutcomeEvent('publish_succeeded_record_failed')).toBe('publish.record_failed');

    for (const intermediate of ['publishing', 'pending', 'quota_exceeded', undefined, null, '']) {
      expect(publishOutcomeEvent(intermediate)).toBeNull();
    }
  });

  it('запись не удалась — это НЕ успех и НЕ отказ', () => {
    // Свалить его в успех значит потерять из виду; свалить в отказ значит
    // спровоцировать повтор и дубль у живых людей.
    const e = publishOutcomeEvent('publish_succeeded_record_failed');
    expect(e).not.toBe('publish.succeeded');
    expect(e).not.toBe('publish.failed');
  });
});

describe('AI-65: причина отказа приводится к машинному виду', () => {
  it('род неприятности определяется по тексту площадки', () => {
    expect(classifyPublishFailure('Invalid access token provided')).toBe('token_expired');
    expect(classifyPublishFailure('Application does not have permission')).toBe('forbidden');
    expect(classifyPublishFailure('Bad Request: chat not found')).toBe('not_found');
    expect(classifyPublishFailure('quota exceeded for today')).toBe('rate_limit');
    expect(classifyPublishFailure('TikTok временно отключён')).toBe('platform_disabled');
    expect(classifyPublishFailure('connect ETIMEDOUT 1.2.3.4:443')).toBe('timeout');
  });

  it('незнакомый текст не превращается в выдуманную причину', () => {
    expect(classifyPublishFailure('что-то совсем новое')).toBe('platform_error');
    expect(classifyPublishFailure(undefined)).toBe('unknown');
    expect(classifyPublishFailure({ message: 'объект' })).toBe('unknown');
  });
});

describe('AI-65: события приходят по итогу публикации', () => {
  /** Прямой вызов точки записи статуса — так же, как это делают все площадки. */
  async function saveStatus(platform: string, data: Record<string, any>) {
    vi.mocked(directusCrud.list).mockResolvedValue([{ id: 'c-1', social_platforms: {} }] as any);
    vi.mocked(directusCrud.update).mockResolvedValue({} as any);

    const content = { id: 'c-1', campaign_id: 'camp-1', user_id: 'u-1', social_platforms: {} };
    // @ts-ignore приватный метод: публичного входа в эту точку нет
    const publish = scheduler.publishContentToPlatforms.bind(scheduler);

    // Подменяем отправку: интересен только путь записи статуса.
    // @ts-ignore приватный метод
    vi.spyOn(scheduler as any, 'publishToTelegramDirect').mockImplementation(
      async (_c: any, save: any) => { await save(platform, data); },
    );

    await publish(content, ['telegram']);
  }

  it('успешная публикация даёт publish.succeeded с площадкой и кампанией', async () => {
    const events = await captureEvents(() => saveStatus('telegram', {
      status: 'published', postUrl: 'https://t.me/x/1',
    }));

    const published = events.filter((e) => e.event === 'publish.succeeded');
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ platform: 'telegram', contentId: 'c-1', campaignId: 'camp-1' });
    expect(published[0].level).toBe('info');
  });

  it('отказ даёт publish.failed с машинной причиной, но без текста площадки', async () => {
    const events = await captureEvents(() => saveStatus('telegram', {
      status: 'failed',
      error: 'Forbidden: bot was blocked by the user, chat 123456789',
    }));

    const failed = events.filter((e) => e.event === 'publish.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBe('forbidden');
    expect(failed[0].level).toBe('error');
    // Текст площадки в событие не уезжает: в нём идентификаторы чата и куски запроса.
    expect(JSON.stringify(failed[0])).not.toContain('123456789');
  });

  it('промежуточный статус события не порождает', async () => {
    const events = await captureEvents(() => saveStatus('telegram', { status: 'publishing' }));
    expect(events.filter((e) => String(e.event).startsWith('publish.'))).toHaveLength(0);
  });

  it('успех не тащит за собой поле причины', async () => {
    const events = await captureEvents(() => saveStatus('telegram', { status: 'published' }));
    const published = events.find((e) => e.event === 'publish.succeeded');
    expect(published.reason).toBeUndefined();
  });
});

describe('AI-65: цикл планировщика отчитывается о себе', () => {
  it('пустой проход не пишет info-шум, но двигает машинный признак жизни', async () => {
    // SM-44 ч.3 + SM-45: idle-проход больше не порождает info cron.finished
    // (журнал молчит), но timestamp последнего УСПЕШНОГО прохода двигается —
    // это и есть новая машинная замена «крон замолчал».
    vi.mocked(directusCrud.list).mockResolvedValue([] as any);
    // @ts-ignore сбрасываем к начальному «проходов ещё не было»
    scheduler.lastSuccessfulPassAt = null;

    const events = await captureEvents(async () => {
      await scheduler.checkScheduledContent();
    });

    // Idle — это завершённый проход: info-шума быть не должно.
    expect(events.filter((e) => e.event === 'cron.finished')).toHaveLength(0);
    expect(events.filter((e) => e.event === 'cron.failed')).toHaveLength(0);
    // А машинный признак жизни — обновился.
    // @ts-ignore
    expect(scheduler.getLivenessSnapshot().lastSuccessfulPassAt).not.toBeNull();
  });

  it('цикл с контентом без публикаций сейчас — тоже отчитывается только признаком жизни', async () => {
    vi.mocked(directusCrud.list).mockResolvedValue([
      {
        id: 'future-1', status: 'scheduled', user_id: 'u-1', campaign_id: 'camp-1',
        scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
        social_platforms: { telegram: { status: 'pending', scheduledAt: new Date(Date.now() + 3600_000).toISOString() } },
      },
    ] as any);
    // @ts-ignore
    scheduler.lastSuccessfulPassAt = null;

    const events = await captureEvents(async () => {
      await scheduler.checkScheduledContent();
    });

    // publishedCount=0 → cron.finished уходит в debug, на info его нет.
    expect(events.filter((e) => e.event === 'cron.finished')).toHaveLength(0);
    expect(events.filter((e) => e.event === 'cron.failed')).toHaveLength(0);
    // @ts-ignore
    expect(scheduler.getLivenessSnapshot().lastSuccessfulPassAt).not.toBeNull();
  });
});

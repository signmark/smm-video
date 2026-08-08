import { describe, it, expect, vi } from 'vitest';

// Extensive mocks needed because importing from '../services/autonomous-ai'
// pulls in the whole dependency chain (axios, directus, gemini, etc.)

function createAxiosInstance() {
  return Object.assign(vi.fn().mockResolvedValue({ data: {} }), {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    interceptors: {
      request: { use: vi.fn(), eject: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn() },
    },
  });
}

vi.mock('axios', () => {
  const instance = createAxiosInstance();
  const defaultFn = Object.assign(vi.fn().mockResolvedValue({ data: {} }), {
    create: vi.fn().mockReturnValue(instance),
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  });
  return { default: defaultFn };
});

vi.mock('../directus-crud', () => ({
  directusCrud: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateItem: vi.fn(),
    getById: vi.fn(),
    getAdminTokenPublic: vi.fn(),
  },
}));

vi.mock('../gemini-direct', () => ({
  geminiDirect: { generateContent: vi.fn() },
}));

vi.mock('../services/ai-service', () => ({
  aiService: {
    generateContent: vi.fn(),
    generateContentWithFallback: vi.fn(),
  },
}));

vi.mock('../services/web-crawler-agent', () => ({
  webCrawlerAgent: { intelligentCrawl: vi.fn(), analyzePageContent: vi.fn() },
}));

vi.mock('../services/gemini-image', () => ({
  createGeminiImageService: vi.fn().mockReturnValue({ generateImage: vi.fn() }),
}));

vi.mock('../load-env', () => ({ loadEnv: vi.fn() }));

// Import helpers after mocks
import {
  sanitizeContentPlanItems,
  sanitizeRefinedContentPlan,
  generateContentPlan,
} from '../services/autonomous-ai';
// SM-18: канонический helper (один источник правды) тестируем напрямую.
import {
  substituteSocialNetworks,
  normalizePlatformMentionsToPlaceholder,
  migrateLegacyGlobalPrompt,
} from '../services/social-prompt';
import type { ContentPlanItem } from '../services/autonomous-ai';
import { aiService } from '../services/ai-service';

function mkItem(partial: Partial<ContentPlanItem> = {}): ContentPlanItem {
  return {
    id: '1',
    topic: 'Тема',
    contentType: 'обучающий',
    platform: 'telegram',
    rationale: 'Причина',
    approved: true,
    ...partial,
  };
}

describe('substituteSocialNetworks', () => {
  it('заменяет [socialNetworks] на подключённые платформы', () => {
    const text = 'Аудитория — пользователи [socialNetworks]';
    const result = substituteSocialNetworks(text, ['telegram', 'vk']);
    expect(result).toBe('Аудитория — пользователи Telegram, ВКонтакте');
  });

  it('заменяет несколько вхождений плейсхолдера', () => {
    const text = '1: [socialNetworks], 2: [socialNetworks]';
    const result = substituteSocialNetworks(text, ['telegram']);
    expect(result).toBe('1: Telegram, 2: Telegram');
  });

  it('использует «социальных сетей кампании» если платформ нет', () => {
    const text = 'Опиши аудиторию [socialNetworks]';
    const result = substituteSocialNetworks(text, []);
    expect(result).toBe('Опиши аудиторию социальных сетей кампании');
  });

  it('не трогает текст без [socialNetworks]', () => {
    const text = 'Обычный текст без переменных';
    const result = substituteSocialNetworks(text, ['telegram']);
    expect(result).toBe(text);
  });

  // SM-18 review (@Codex_HM): runtime (substituteSocialNetworks) СТРОГО заменяет
  // только плейсхолдер [socialNetworks] и НЕ трогает произвольный пользовательский
  // текст. Литеральные названия сетей сохраняются дословно — legacy решается
  // отдельной миграцией, а не скрытым runtime-rewrite.
  it('runtime сохраняет literal названия сетей дословно', () => {
    const text = 'Ты — SMM-менеджер. Целевая аудитория — пользователи Facebook.';
    const result = substituteSocialNetworks(text, ['telegram']);
    // Не заменяем literal Facebook на Telegram (это портило бы текст).
    expect(result).toBe(text);
    expect(result).toContain('Facebook');
  });

  it('runtime сохраняет сравнение «Facebook с Telegram» дословно', () => {
    const text = 'Сравни возможности Facebook с Telegram';
    const result = substituteSocialNetworks(text, ['telegram']);
    expect(result).toBe('Сравни возможности Facebook с Telegram');
  });

  it('runtime НЕ инвертирует отрицание «Не используй Facebook»', () => {
    const text = 'Не используй Facebook; пиши только для Telegram';
    const result = substituteSocialNetworks(text, ['telegram']);
    expect(result).toBe('Не используй Facebook; пиши только для Telegram');
  });

  it('runtime раскрывает плейсхолдер в уже сохранённом тексте', () => {
    const text = 'Пиши для [socialNetworks]';
    const result = substituteSocialNetworks(text, ['telegram', 'vk']);
    expect(result).toBe('Пиши для Telegram, ВКонтакте');
  });
});

describe('normalizePlatformMentionsToPlaceholder (граница генератора)', () => {
  // SM-18 review (@Codex_HM): генератор обязан вернуть ПЕРЕМЕННУЮ, даже если
  // mock-модель вернула literal названия сети (подключённой или нет).
  it('сводит literal Facebook к [socialNetworks]', () => {
    const text = 'Целевая аудитория — пользователи Facebook.';
    const result = normalizePlatformMentionsToPlaceholder(text);
    expect(result).toContain('[socialNetworks]');
    expect(result).not.toContain('Facebook');
  });

  it('сводит literal подключённого Telegram к [socialNetworks]', () => {
    const text = 'Аудитория — пользователи Telegram';
    const result = normalizePlatformMentionsToPlaceholder(text);
    // На границе генератора подключённая сеть тоже нормализуется в переменную.
    expect(result).toContain('[socialNetworks]');
    expect(result).not.toContain('Telegram');
  });

  it('сохраняет отрицание «не использовать Facebook» без инверсии', () => {
    const text = 'Не использовать Facebook; пиши для [socialNetworks]';
    const result = normalizePlatformMentionsToPlaceholder(text);
    expect(result).toContain('Не использовать Facebook');
    expect(result).toContain('[socialNetworks]');
  });
});

describe('migrateLegacyGlobalPrompt (NARROW миграция, rev @Codex_HM)', () => {
  it('сводит аудиторную фразу «пользователи Facebook» к [socialNetworks]', () => {
    const text = 'Ты — SMM-менеджер. Целевая аудитория — широкая и разнородная группа пользователей Facebook.';
    const result = migrateLegacyGlobalPrompt(text);
    expect(result).toContain('[socialNetworks]');
    expect(result).not.toContain('Facebook');
  });

  it('сводит перечисление сетей после «пользователи»', () => {
    const text = 'Аудитория — пользователи Facebook, Instagram и VK.';
    const result = migrateLegacyGlobalPrompt(text);
    expect(result).toBe('Аудитория — пользователи [socialNetworks], [socialNetworks] и [socialNetworks].');
  });

  // rev @Codex_HM: сравнение/ручной промт НЕ должен становиться кандидатом.
  it('НЕ трогает сравнение «Сравни Facebook с Telegram»', () => {
    const text = 'Сравни Facebook с Telegram';
    const result = migrateLegacyGlobalPrompt(text);
    expect(result).toBe(text);
  });

  it('НЕ трогает инструкцию «Пиши для Facebook»', () => {
    const text = 'Всегда пиши для Facebook и Telegram, используй живой тон';
    const result = migrateLegacyGlobalPrompt(text);
    expect(result).toBe(text);
  });

  it('НЕ трогает отрицание «не используй Facebook»', () => {
    const text = 'Не используй Facebook; пиши для Telegram';
    const result = migrateLegacyGlobalPrompt(text);
    expect(result).toBe(text);
  });
});

describe('sanitizeContentPlanItems', () => {
  it('должен обрезать до count, если AI вернул больше', () => {
    const items = [mkItem({ id: '1' }), mkItem({ id: '2' }), mkItem({ id: '3' })];
    const result = sanitizeContentPlanItems(items, 2, ['telegram']);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('1');
    expect(result[1].id).toBe('2');
  });

  it('не должен убирать элементы, если их не больше count', () => {
    const items = [mkItem({ id: '1' }), mkItem({ id: '2' })];
    const result = sanitizeContentPlanItems(items, 3, ['telegram']);
    expect(result).toHaveLength(2);
  });

  it('должен заменить неподключённую платформу на platforms[0]', () => {
    const items = [mkItem({ platform: 'facebook' }), mkItem({ platform: 'telegram' })];
    const result = sanitizeContentPlanItems(items, 5, ['telegram']);
    expect(result[0].platform).toBe('telegram');
    expect(result[1].platform).toBe('telegram');
  });

  it('должен сохранить подключённую платформу', () => {
    const items = [mkItem({ platform: 'vk' })];
    const result = sanitizeContentPlanItems(items, 5, ['vk', 'telegram']);
    expect(result[0].platform).toBe('vk');
  });

  it('должен использовать telegram как fallback, если platforms пуст', () => {
    const items = [mkItem({ platform: 'facebook' })];
    const result = sanitizeContentPlanItems(items, 5, []);
    expect(result[0].platform).toBe('telegram');
  });

  it('должен заполнять пустые поля из дефолтов', () => {
    const items = [mkItem({ platform: '', topic: '', rationale: '' })];
    const result = sanitizeContentPlanItems(items, 5, ['telegram']);
    expect(result[0].platform).toBe('telegram');
    expect(result[0].topic).toBe('');
    expect(result[0].rationale).toBe('');
  });
});

describe('sanitizeRefinedContentPlan', () => {
  it('должен обрезать до исходной длины плана', () => {
    const plan = [mkItem({ platform: 'telegram' }), mkItem({ platform: 'telegram' })];
    const refined = [
      mkItem({ platform: 'telegram' }),
      mkItem({ platform: 'telegram' }),
      mkItem({ platform: 'telegram' }),
    ];
    const result = sanitizeRefinedContentPlan(refined, plan, ['telegram']);
    expect(result).toHaveLength(2);
  });

  it('должен сохранить платформу из исходного плана, если доработка вернула неподключённую', () => {
    const plan = [mkItem({ platform: 'vk' }), mkItem({ platform: 'telegram' })];
    const refined = [mkItem({ platform: 'facebook' }), mkItem({ platform: 'instagram' })];
    const result = sanitizeRefinedContentPlan(refined, plan, ['vk', 'telegram']);
    expect(result[0].platform).toBe('vk'); // from plan[0]
    expect(result[1].platform).toBe('telegram'); // from plan[1]
  });

  it('должен сохранить platform из доработки, если она подключена', () => {
    const plan = [mkItem({ platform: 'telegram' })];
    const refined = [mkItem({ platform: 'vk' })];
    const result = sanitizeRefinedContentPlan(refined, plan, ['vk', 'telegram']);
    expect(result[0].platform).toBe('vk');
  });

  it('должен использовать platforms[0] как fallback при отсутствии в plan', () => {
    const plan = [mkItem({ platform: '' })];
    const refined = [mkItem({ platform: 'facebook' })];
    const result = sanitizeRefinedContentPlan(refined, plan, ['vk']);
    expect(result[0].platform).toBe('vk');
  });

  it('должен матчить платформу с разным регистром (case-insensitive)', () => {
    const items = [mkItem({ platform: 'Telegram' }), mkItem({ platform: 'FACEBOOK' })];
    const result = sanitizeContentPlanItems(items, 5, ['telegram']);
    expect(result[0].platform).toBe('telegram'); // Telegram → telegram
    expect(result[1].platform).toBe('telegram'); // FACEBOOK → telegram
  });

  it('должен матчить платформу с разным регистром в refined', () => {
    const plan = [mkItem({ platform: 'VK' })];
    const refined = [mkItem({ platform: 'vk' })];
    const result = sanitizeRefinedContentPlan(refined, plan, ['telegram', 'vk']);
    expect(result[0].platform).toBe('vk'); // нормализован к каноничному из platforms
  });
});

describe('generateContentPlan integration (тракт, а не хелпер)', () => {
  it('промт, ушедший в модель, не содержит [socialNetworks] — подставлены реальные платформы', async () => {
    // Перехватываем промпт, который aiService отправляет в модель
    let capturedPrompt: string | undefined;
    (aiService.generateContent as any).mockImplementation(
      async (opts: { prompt: string }) => {
        capturedPrompt = opts.prompt;
        return { content: JSON.stringify([
          { id: '1', topic: 'Тема', contentType: 'обучающий', platform: 'telegram', rationale: 'Причина' }
        ]) };
      }
    );

    await generateContentPlan({
      count: 1,
      keywords: ['кейс'],
      trends: [],
      platforms: ['telegram', 'vk'],
      globalPrompt: 'Ты — SMM-менеджер. Аудитория — пользователи [socialNetworks].',
      alwaysInclude: '',
      launchCommand: '',
      analyticsInsights: '',
      request: { userId: 'u1', authToken: 't1' },
    });

    expect(capturedPrompt).toBeDefined();
    // Ключевое: плейсхолдер ДОЛЖЕН быть заменён фактическими платформами до отправки в модель
    expect(capturedPrompt).not.toContain('[socialNetworks]');
    expect(capturedPrompt).toContain('Telegram, ВКонтакте');
    expect(capturedPrompt).toContain('Платформы: telegram, vk');
  });

  it('runtime раскрывает [socialNetworks], но сохраняет literal названия сетей (legacy — через миграцию)', async () => {
    let capturedPrompt: string | undefined;
    (aiService.generateContent as any).mockImplementation(
      async (opts: { prompt: string }) => {
        capturedPrompt = opts.prompt;
        return { content: JSON.stringify([
          { id: '1', topic: 'Тема', contentType: 'обучающий', platform: 'telegram', rationale: 'Причина' }
        ]) };
      }
    );

    // globalPrompt содержит и плейсхолдер, и legacy literal Facebook (смешанный случай).
    const mixedPrompt = 'Ты — SMM-менеджер. Пиши для [socialNetworks]. Аудитория — пользователи Facebook.';

    await generateContentPlan({
      count: 1,
      keywords: ['кейс'],
      trends: [],
      platforms: ['telegram'],
      globalPrompt: mixedPrompt,
      alwaysInclude: '',
      launchCommand: '',
      analyticsInsights: '',
      request: { userId: 'u1', authToken: 't1' },
    });

    expect(capturedPrompt).toBeDefined();
    // Плейсхолдер раскрыт в подключённую соцсеть.
    expect(capturedPrompt).toContain('Telegram');
    expect(capturedPrompt).not.toContain('[socialNetworks]');
    // Legacy literal Facebook НЕ переписывается на лету (чинит миграция, не рантайм).
    expect(capturedPrompt).toContain('Facebook');
  });
});

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

vi.mock('../ai-service', () => ({
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
} from '../services/autonomous-ai';
import type { ContentPlanItem } from '../services/autonomous-ai';

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
});

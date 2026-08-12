/**
 * AI-109. Промт изображения уходил в поле `image_prompt`, которого в коллекции
 * campaign_content нет. Directus отбивал каждую запись 403, catch писал
 * предупреждение, цикл шёл дальше — дефект был виден только в боевых логах.
 *
 * Тест стережёт границу записи: имя поля, с которым уходит updateItem. Он обязан
 * быть красным на коде до правки — там уходило image_prompt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  generateContent: vi.fn(),
  updateItem: vi.fn(),
}));

vi.mock('axios', () => {
  const instance = Object.assign(vi.fn().mockResolvedValue({ data: {} }), {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    interceptors: { request: { use: vi.fn(), eject: vi.fn() }, response: { use: vi.fn(), eject: vi.fn() } },
  });
  return { default: Object.assign(vi.fn(), {
    create: vi.fn().mockReturnValue(instance),
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  }) };
});
vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    list: vi.fn(async () => []),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateItem: H.updateItem,
    getAdminTokenPublic: vi.fn(),
  },
}));
vi.mock('../gemini-direct', () => ({ geminiDirect: { generateContent: vi.fn() } }));
vi.mock('../services/ai-service', () => ({
  aiService: { generateContent: H.generateContent, generateContentWithFallback: vi.fn() },
}));
vi.mock('../services/web-crawler-agent', () => ({ webCrawlerAgent: {} }));
vi.mock('../services/gemini-image', () => ({ createGeminiImageService: vi.fn().mockReturnValue({ generateImage: vi.fn() }) }));
vi.mock('../load-env', () => ({ loadEnv: vi.fn() }));
vi.mock('../utils/logger', () => {
  const logFn: any = vi.fn();
  logFn.info = vi.fn(); logFn.warn = vi.fn(); logFn.error = vi.fn(); logFn.debug = vi.fn();
  return { log: logFn, default: logFn };
});

import { buildImagePromptFromText } from '../services/autonomous-ai';

const PARAMS = {
  postText: 'Пост про утренний свет в переговорной и спокойную работу команды.',
  topic: 'офисные интерьеры',
  contentId: 'content-1',
  userId: 'user-1',
  authToken: 'token-1',
};

describe('AI-109: промт изображения сохраняется в существующее поле', () => {
  beforeEach(() => {
    H.updateItem.mockReset().mockResolvedValue({});
    H.generateContent.mockReset().mockResolvedValue({ content: 'soft morning light through office window' });
  });

  it('запись уходит в поле prompt', async () => {
    await buildImagePromptFromText(PARAMS);

    expect(H.updateItem).toHaveBeenCalledTimes(1);
    const [collection, id, payload] = H.updateItem.mock.calls[0];
    expect(collection).toBe('campaign_content');
    expect(id).toBe('content-1');
    expect(Object.keys(payload)).toEqual(['prompt']);
    expect(payload.prompt).toBe('soft morning light through office window');
  });

  it('поля image_prompt в запросе нет: его не существует в коллекции', async () => {
    await buildImagePromptFromText(PARAMS);

    const payload = H.updateItem.mock.calls[0][2];
    expect(payload).not.toHaveProperty('image_prompt');
  });

  it('отказ Directus не роняет цикл, но промт возвращается вызывающему', async () => {
    H.updateItem.mockRejectedValue(new Error('Request failed with status code 403'));

    await expect(buildImagePromptFromText(PARAMS)).resolves.toBe(
      'soft morning light through office window',
    );
  });

  it('отказ модели не отменяет запись: сохраняется запасной промт', async () => {
    H.generateContent.mockRejectedValue(new Error('gemini недоступен'));

    const result = await buildImagePromptFromText(PARAMS);

    expect(result).toContain('офисные интерьеры');
    const payload = H.updateItem.mock.calls[0][2];
    expect(Object.keys(payload)).toEqual(['prompt']);
    expect(payload.prompt).toBe(result);
  });
});

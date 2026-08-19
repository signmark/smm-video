/**
 * AI-131: генерация по образцу обязана дойти до модели вместе с картинками.
 *
 * ЧТО БЫЛО. Модель «Генерация по образцу» стояла в списке моделей Gemini и
 * уходила в Vertex AI, куда список образцов не передаётся вовсе. Признак
 * «это редактирование по образцу» влиял ровно на одну строчку журнала.
 * Тестировщик приложил карту персонажа, получил случайных людей и написал, что
 * похоже на генерацию по одному тексту. Так и было.
 *
 * Гоняется РЕАЛЬНЫЙ registerAiRoutes в мини-Express; на границах моками закрыты
 * fal, Vertex, Directus и учёт лимитов.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => ({
  falEdit: vi.fn(async (_params: any) => ['https://fal.test/edited.png']),
  falUniversal: vi.fn(async (_params: any) => ['https://fal.test/plain.png']),
  geminiGenerate: vi.fn(async (_params: any) => ({ success: true, imageUrl: 'https://vertex.test/img.png' })),
}));

vi.mock('../middleware/user-auth', () => ({
  authenticateUser: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', token: 'token-1', is_smm_admin: true };
    next();
  },
}));

vi.mock('../services/fal-ai-official-client', () => ({
  falAiOfficialClient: { generateImages: H.falEdit },
}));

vi.mock('../services/fal-ai-universal', () => ({
  falAiUniversalService: { generateImages: H.falUniversal },
  FalAiModelName: {},
}));

vi.mock('../services/gemini-image', () => ({
  GeminiImageService: class {
    generateImage = H.geminiGenerate;
  },
}));

vi.mock('../services/image-gen-tracker', () => ({
  getUsage: vi.fn(async () => ({ count: 0, month: '2026-08' })),
  incrementUsage: vi.fn(async () => 1),
  canGenerate: vi.fn(async () => true),
}));

vi.mock('../services/global-api-keys', () => ({
  globalApiKeysService: { getGlobalApiKey: vi.fn(async () => 'fal-key') },
}));

vi.mock('../services/api-keys', () => ({
  apiKeyService: { getApiKey: vi.fn(async () => 'fal-key') },
  ApiServiceName: { FAL_AI: 'fal_ai' },
}));

vi.mock('../directus', () => {
  const api = { get: vi.fn(async () => ({ data: { data: { plan: 'pro' } } })), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
  return {
    directusApi: api,
    default: api,
    directusApiManager: {
      request: vi.fn(),
      cacheAuthToken: vi.fn(),
      instance: { interceptors: { response: { use: vi.fn() } } },
    },
  };
});

import { registerAiRoutes } from '../routes/ai';

const REFERENCE = 'data:image/png;base64,AAAA';

function app() {
  const server = express();
  server.use(express.json());
  registerAiRoutes(server);
  return server;
}

beforeEach(() => {
  H.falEdit.mockClear();
  H.falUniversal.mockClear();
  H.geminiGenerate.mockClear();
});

describe('AI-131: образцы доходят до модели', () => {
  it('запрос уходит в fal с непустым списком образцов', async () => {
    const res = await request(app())
      .post('/api/generate-image')
      .send({
        prompt: 'character sheet',
        modelName: 'fal-ai/nano-banana-pro/edit',
        imageUrls: [REFERENCE],
      });

    expect(res.status).toBe(200);
    expect(H.falEdit).toHaveBeenCalledTimes(1);
    const params: any = H.falEdit.mock.calls[0][0];
    expect(params.model).toBe('fal-ai/nano-banana-pro/edit');
    expect(params.imageUrls).toEqual([REFERENCE]);
  });

  it('в Vertex AI такой запрос больше не уходит', async () => {
    // Ровно этим дефект и был: картинки оставались в теле запроса, а генерация
    // шла по одному тексту.
    await request(app())
      .post('/api/generate-image')
      .send({
        prompt: 'character sheet',
        modelName: 'fal-ai/nano-banana-pro/edit',
        imageUrls: [REFERENCE],
      });

    expect(H.geminiGenerate).not.toHaveBeenCalled();
  });

  it('несколько образцов передаются все', async () => {
    await request(app())
      .post('/api/generate-image')
      .send({
        prompt: 'scene',
        modelName: 'fal-ai/nano-banana-pro/edit',
        imageUrls: [REFERENCE, 'https://example.test/ref.png'],
      });

    expect((H.falEdit.mock.calls[0][0] as any).imageUrls).toHaveLength(2);
  });

  it('без образца — отказ с понятным текстом, а не тихая генерация по тексту', async () => {
    const res = await request(app())
      .post('/api/generate-image')
      .send({ prompt: 'scene', modelName: 'fal-ai/nano-banana-pro/edit', imageUrls: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('образец');
    expect(H.falEdit).not.toHaveBeenCalled();
    expect(H.geminiGenerate).not.toHaveBeenCalled();
  });

  it('пустые строки образцами не считаются', async () => {
    const res = await request(app())
      .post('/api/generate-image')
      .send({ prompt: 'scene', modelName: 'fal-ai/nano-banana-pro/edit', imageUrls: ['', '   '] });

    expect(res.status).toBe(400);
    expect(H.falEdit).not.toHaveBeenCalled();
  });

  it('отказ fal доходит до человека, а не подменяется генерацией по одному тексту', async () => {
    H.falEdit.mockRejectedValueOnce(new Error('fal: 422 unprocessable'));

    const res = await request(app())
      .post('/api/generate-image')
      .send({ prompt: 'scene', modelName: 'fal-ai/nano-banana-pro/edit', imageUrls: [REFERENCE] });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(H.geminiGenerate).not.toHaveBeenCalled();
    expect(H.falUniversal).not.toHaveBeenCalled();
  });

  it('обычная Nano Banana по-прежнему идёт в Vertex AI', async () => {
    // Сужение не должно задеть соседние модели.
    const res = await request(app())
      .post('/api/generate-image')
      .send({ prompt: 'осенний парк', modelName: 'gemini' });

    expect(res.status).toBe(200);
    expect(H.geminiGenerate).toHaveBeenCalledTimes(1);
    expect(H.falEdit).not.toHaveBeenCalled();
  });

  it('NanoBanana Pro без образцов тоже осталась на прежнем пути', async () => {
    await request(app())
      .post('/api/generate-image')
      .send({ prompt: 'осенний парк', modelName: 'fal-ai/nano-banana-pro' });

    expect(H.geminiGenerate).toHaveBeenCalledTimes(1);
    expect(H.falEdit).not.toHaveBeenCalled();
  });
});

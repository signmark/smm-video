/**
 * Контракт записи контента: валидация title, коды ответов /:id и — главное —
 * СОВПАДЕНИЕ ФОРМЫ между списком и /:id.
 *
 * До этих правок:
 *  - нестроковый title (999, [1,2]) падал в `data.title.charAt is not a function`
 *    и уезжал наружу как HTTP 500 вместе с текстом JS-исключения;
 *  - несуществующий id давал 500 вместо 404 (общий catch глотал 403/404);
 *  - /:id отдавал сырую строку Directus: published_at вместо publishedAt,
 *    keywords строкой вместо массива. Список и /:id жили по разным формам.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../directus', () => ({
  directusApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../services/social-publishing', () => ({
  socialPublishingService: { publishContent: vi.fn() },
}));

vi.mock('../services/publish-scheduler', () => ({
  getPublishScheduler: vi.fn().mockReturnValue({ schedulePublication: vi.fn() }),
}));

vi.mock('../services/directus-crud', () => ({
  directusCrud: { list: vi.fn(), create: vi.fn(), update: vi.fn(), getById: vi.fn() },
}));

vi.mock('../storage', () => ({ storage: {} }));

vi.mock('../services/ai-service', () => ({ aiService: { generateContent: vi.fn() } }));

vi.mock('../middleware/user-auth', () => ({
  authenticateUser: (req: any, _res: any, next: () => void) => {
    req.user = { id: 'user-1', token: 'token-1' };
    next();
  },
  requireSmmAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock('../utils/logger', () => {
  const logFn: any = vi.fn();
  logFn.info = vi.fn();
  logFn.warn = vi.fn();
  logFn.error = vi.fn();
  logFn.debug = vi.fn();
  return { log: logFn, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
});

import { directusApi } from '../directus';
import { registerContentRoutes } from '../routes/content';
import { clearContentCache } from '../utils/content-cache';

const app = express();
app.use(express.json());
registerContentRoutes(app);

const get = vi.mocked(directusApi.get);
const post = vi.mocked(directusApi.post);
const patch = vi.mocked(directusApi.patch);

const directusError = (status: number) =>
  Object.assign(new Error(`Directus ${status}`), { response: { status } });

/** Одна и та же строка Directus, на которой сверяем список и /:id. */
const ROW = {
  id: 'item-1',
  campaign_id: 'camp-1',
  user_id: 'user-1',
  title: 'Пост',
  content: '<p>тело</p>',
  content_type: 'text-image',
  image_url: 'https://example.com/a.jpg',
  additional_images: ['https://example.com/b.jpg'],
  additional_media: [],
  video_url: null,
  prompt: 'prompt',
  keywords: '["one","two"]',
  hashtags: '["#tag"]',
  links: '["https://example.com"]',
  created_at: '2026-07-20T10:00:00Z',
  scheduled_at: null,
  published_at: '2026-07-21T12:00:00Z',
  status: 'published',
  social_platforms: { telegram: { published: true } },
  metadata: { a: 1 },
};

describe('POST/PATCH/PUT /api/campaign-content — валидация title', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearContentCache();
  });

  for (const badTitle of [999, [1, 2], { a: 1 }, true]) {
    it(`POST с title=${JSON.stringify(badTitle)} → 400, а не 500`, async () => {
      const res = await request(app)
        .post('/api/campaign-content')
        .send({ campaignId: 'camp-1', title: badTitle, content: 'x' });

      expect(res.status).toBe(400);
      expect(res.body.details).toMatch(/строкой/);
      // В Directus такой запрос вообще не должен уходить.
      expect(post).not.toHaveBeenCalled();
    });
  }

  it('PATCH с нестроковым title → 400, запись не трогается', async () => {
    const res = await request(app)
      .patch('/api/campaign-content/item-1')
      .send({ title: 777 });

    expect(res.status).toBe(400);
    expect(patch).not.toHaveBeenCalled();
  });

  it('PUT с нестроковым title → 400, запись не трогается', async () => {
    const res = await request(app)
      .put('/api/campaign-content/item-1')
      .send({ title: 777 });

    expect(res.status).toBe(400);
    expect(patch).not.toHaveBeenCalled();
  });

  it('нормальный строковый title по-прежнему принимается и капитализируется', async () => {
    post.mockResolvedValueOnce({ data: { data: { id: 'new-1' } } } as any);

    const res = await request(app)
      .post('/api/campaign-content')
      .send({ campaignId: 'camp-1', title: 'привет', content: 'x' });

    expect(res.status).toBe(201);
    expect((post.mock.calls[0][1] as any).title).toBe('Привет');
  });

  it('без title подставляется дефолт, а не 400', async () => {
    post.mockResolvedValueOnce({ data: { data: { id: 'new-2' } } } as any);

    const res = await request(app)
      .post('/api/campaign-content')
      .send({ campaignId: 'camp-1', content: 'x' });

    expect(res.status).toBe(201);
    expect((post.mock.calls[0][1] as any).title).toBe('Без названия');
  });

  it('слишком длинный title → 400', async () => {
    const res = await request(app)
      .post('/api/campaign-content')
      .send({ campaignId: 'camp-1', title: 'a'.repeat(256), content: 'x' });

    expect(res.status).toBe(400);
    expect(res.body.details).toMatch(/длиннее/);
  });

  it('сырой текст JS-исключения не уходит клиенту', async () => {
    post.mockRejectedValueOnce(new Error('data.title.charAt is not a function'));

    const res = await request(app)
      .post('/api/campaign-content')
      .send({ campaignId: 'camp-1', title: 'ок', content: 'x' });

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/charAt/);
  });

  it('осмысленная ошибка валидации от Directus по-прежнему доезжает', async () => {
    post.mockRejectedValueOnce(
      Object.assign(new Error('Request failed'), {
        response: { status: 400, data: { errors: [{ message: 'Value too long for field "title"' }] } },
      }),
    );

    const res = await request(app)
      .post('/api/campaign-content')
      .send({ campaignId: 'camp-1', title: 'ок', content: 'x' });

    expect(res.status).toBe(400);
    expect(res.body.details).toBe('Value too long for field "title"');
  });
});

describe('GET /api/campaign-content/:id — коды ответов', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearContentCache();
  });

  it('несуществующий id → 404, а не 500', async () => {
    get.mockRejectedValueOnce(directusError(404));

    const res = await request(app).get('/api/campaign-content/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(404);
  });

  it('403 от Directus тоже 404 — существование чужой записи не подтверждаем', async () => {
    get.mockRejectedValueOnce(directusError(403));

    const res = await request(app).get('/api/campaign-content/foreign-id');

    expect(res.status).toBe(404);
  });

  it('пустой data → 404', async () => {
    get.mockResolvedValueOnce({ data: { data: null } } as any);

    const res = await request(app).get('/api/campaign-content/item-1');

    expect(res.status).toBe(404);
  });

  it('чужая запись → 404, тело наружу не отдаётся', async () => {
    get.mockResolvedValueOnce({ data: { data: { ...ROW, user_id: 'user-2' } } } as any);

    const res = await request(app).get('/api/campaign-content/item-1');

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/тело/);
  });

  it('настоящий сбой Directus остаётся 500', async () => {
    get.mockRejectedValueOnce(directusError(503));

    const res = await request(app).get('/api/campaign-content/item-1');

    expect(res.status).toBe(500);
  });
});

describe('форма ответа списка и /:id совпадает', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearContentCache();
  });

  it('одна и та же запись даёт одинаковый объект в обоих эндпоинтах', async () => {
    // Список: сначала запрос коллекции.
    get.mockResolvedValueOnce({ data: { data: [ROW], meta: { filter_count: 1 } } } as any);
    const listRes = await request(app).get('/api/campaign-content?campaignId=camp-1&page=1&limit=10');

    // /:id: та же строка, отдельным вызовом.
    get.mockResolvedValueOnce({ data: { data: ROW } } as any);
    const itemRes = await request(app).get('/api/campaign-content/item-1');

    expect(listRes.status).toBe(200);
    expect(itemRes.status).toBe(200);
    // Ключевое утверждение: побайтово одна и та же форма.
    expect(itemRes.body.data).toEqual(listRes.body.data[0]);
  });

  it('/:id отдаёт camelCase и разобранные массивы, а не сырой Directus', async () => {
    get.mockResolvedValueOnce({ data: { data: ROW } } as any);

    const res = await request(app).get('/api/campaign-content/item-1');

    const item = res.body.data;
    expect(item.publishedAt).toBe('2026-07-21T12:00:00Z');
    expect(item.campaignId).toBe('camp-1');
    expect(item.imageUrl).toBe('https://example.com/a.jpg');
    expect(item.contentType).toBe('text-image');
    // Массивы разобраны, а не отданы JSON-строкой.
    expect(item.keywords).toEqual(['one', 'two']);
    expect(item.hashtags).toEqual(['#tag']);
    expect(item.links).toEqual(['https://example.com']);
    // Сырых snake_case полей быть не должно.
    expect(item.published_at).toBeUndefined();
    expect(item.campaign_id).toBeUndefined();
    expect(item.image_url).toBeUndefined();
  });
});

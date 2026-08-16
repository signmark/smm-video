/**
 * AI-114: кнопка «Снять с публикации» — snake-ключ social_platforms + честный
 * статус + сброс площадки только при реальном удалении.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockAxiosGet = vi.fn();
const mockAxiosPatch = vi.fn();
const mockAxiosPost = vi.fn();

vi.mock('axios', () => ({
  default: {
    get: (...a: any[]) => mockAxiosGet(...a),
    patch: (...a: any[]) => mockAxiosPatch(...a),
    delete: (...a: any[]) => vi.fn(),
    post: (...a: any[]) => mockAxiosPost(...a),
  },
}));

vi.mock('../middleware/user-auth', () => ({
  authenticateUser: (req: any, _res: any, next: any) => { req.user = { id: 'u1' }; next(); },
}));

vi.mock('../services/content-access', () => ({
  assertContentBelongsToRequester: vi.fn().mockResolvedValue(true),
}));

vi.mock('../services/social-platforms/telegram-http', () => ({
  telegramHttp: vi.fn().mockResolvedValue({
    post: vi.fn().mockResolvedValue({ data: { ok: true } }),
  }),
}));

import unpublishRouter from '../routes/unpublish-content';

process.env.DIRECTUS_URL = 'http://directus.test';

function appWithRouter() {
  const app = express();
  app.use(express.json());
  app.use(unpublishRouter);
  return app;
}

function mockContent(platforms: any) {
  // content fetch: campaign_content
  mockAxiosGet.mockImplementation((url: string) => {
    if (url.includes('campaign_content')) {
      return Promise.resolve({
        data: { data: { id: 'c1', campaign_id: 'camp1', social_platforms: platforms } },
      });
    }
    // campaign-settings fetch: user_campaigns
    return Promise.resolve({
      data: {
        data: {
          social_media_settings: {
            telegram: { bot_token: 'TGTKN', chat_id: '123' },
            vk: { access_token: 'VKTKN' },
            facebook: { token: 'FBTKN' },
          },
        },
      },
    });
  });
  mockAxiosPatch.mockResolvedValue({ data: { data: { id: 'c1' } } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AI-114: снятие публикации', () => {
  it('читает snake социальных площадок и пишет snake-ключ social_platforms', async () => {
    mockContent({
      telegram: { status: 'published', postId: '123_456', postUrl: 'https://t.me/x/456', publishedAt: 'x' },
      vk: { status: 'published', postId: '-1_9', postUrl: 'https://vk.com/wall-1_9', publishedAt: 'y' },
    });
    mockAxiosPost.mockResolvedValue({ data: { response: 1 } }); // vk wall.delete ok

    const res = await request(appWithRouter())
      .post('/content/c1/unpublish')
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const patchBody = mockAxiosPatch.mock.calls[0][1];
    expect(patchBody).toHaveProperty('social_platforms');
    expect(patchBody).not.toHaveProperty('socialPlatforms');

    // оба удаления успешны -> обе площадки draft
    expect(patchBody.social_platforms.telegram.status).toBe('draft');
    expect(patchBody.social_platforms.vk.status).toBe('draft');
  });

  it('при неудачном удалении площадку не стирает (история сохраняется) и не врёт об успехе', async () => {
    mockContent({
      vk: { status: 'published', postId: '-1_9', postUrl: 'https://vk.com/wall-1_9', publishedAt: 'x' },
    });
    mockAxiosPost.mockRejectedValue(new Error('delete failed')); // vk wall.delete fail

    const res = await request(appWithRouter())
      .post('/content/c1/unpublish')
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('ни с одной площадки');
  });

  it('без postId удалять нечего -> честный 409, история не трогается', async () => {
    mockContent({
      telegram: { status: 'published', postUrl: 'https://t.me/x/456', publishedAt: 'x' },
    });

    const res = await request(appWithRouter())
      .post('/content/c1/unpublish')
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('частичный успех: одна площадка удалена, другая сохранена без стирания', async () => {
    mockContent({
      telegram: { status: 'published', postId: '123_456', postUrl: 'https://t.me/x/456', publishedAt: 'x' },
      vk: { status: 'published', postId: '-1_9', postUrl: 'https://vk.com/wall-1_9', publishedAt: 'y' },
    });
    // telegram -> telegramHttp().post (ок), vk -> axios.post wall.delete (fail)
    mockAxiosPost.mockRejectedValue(new Error('vk delete failed'));

    const res = await request(appWithRouter())
      .post('/content/c1/unpublish')
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const patchBody = mockAxiosPatch.mock.calls[0][1];
    // telegram удалён -> draft
    expect(patchBody.social_platforms.telegram.status).toBe('draft');
    // vk НЕ удалён -> сохраняем прежнее published состояние
    expect(patchBody.social_platforms.vk.status).toBe('published');
    expect(patchBody.social_platforms.vk.postId).toBe('-1_9');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ── Моки ──────────────────────────────────────────────────────────────────────

vi.mock('../directus', () => ({
  directusApi: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  directusApiManager: {
    request: vi.fn(),
    cacheAuthToken: vi.fn(),
    post: vi.fn(),
    instance: {
      interceptors: { response: { use: vi.fn() } }
    }
  },
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }
}));

vi.mock('../utils/content-cache', () => ({
  buildCacheKey: vi.fn(() => 'cache-key'),
  getFromCache: vi.fn(() => null),
  setToCache: vi.fn(),
  invalidateContentCache: vi.fn(),
}));

vi.mock('../services/publish-scheduler', () => ({
  getPublishScheduler: vi.fn(() => ({ runNow: vi.fn() })),
}));

vi.mock('../middleware/user-auth', () => ({
  authenticateUser: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', token: 'mock-token' };
    next();
  },
}));

vi.mock('../utils/logger', () => ({
  log: vi.fn(),
}));

// ── Импорты после моков ────────────────────────────────────────────────────────

import { directusApiManager, directusApi } from '../directus';
import { registerPublishingRoutes } from '../api/publishing-routes';
import { registerContentRoutes } from '../routes/content';

// ── Хелперы ───────────────────────────────────────────────────────────────────

const makeApp = () => {
  const app = express();
  app.use(express.json());
  registerPublishingRoutes(app);
  registerContentRoutes(app);
  return app;
};

const mockDirectusRequest = directusApiManager.request as ReturnType<typeof vi.fn>;
const mockDirectusGet = (directusApi as any).get as ReturnType<typeof vi.fn>;
const mockDirectusPost = (directusApi as any).post as ReturnType<typeof vi.fn>;

// ── Tests: /api/retry-failed/:contentId ───────────────────────────────────────

describe('POST /api/retry-failed/:contentId', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  it('возвращает 404 если контент не найден', async () => {
    mockDirectusRequest.mockResolvedValueOnce({ data: { data: null } });

    const res = await request(app).post('/api/retry-failed/missing-id');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/не найден/i);
  });

  it('возвращает 400 если нет платформ со статусом failed', async () => {
    mockDirectusRequest.mockResolvedValueOnce({
      data: {
        data: {
          id: 'c1',
          campaign_id: 'camp-1',
          social_platforms: {
            telegram: { status: 'published' },
          },
        },
      },
    });

    const res = await request(app).post('/api/retry-failed/c1');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/нет платформ/i);
  });

  it('сбрасывает failed платформы в pending и возвращает список', async () => {
    // 1-й вызов — получение контента
    mockDirectusRequest
      .mockResolvedValueOnce({
        data: {
          data: {
            id: 'c1',
            campaign_id: 'camp-1',
            social_platforms: {
              telegram: { status: 'published' },
              instagram: { status: 'failed', error: 'timeout' },
              facebook: { status: 'failed', error: 'rate limit' },
            },
          },
        },
      })
      // 2-й вызов — обновление
      .mockResolvedValueOnce({ data: { data: { id: 'c1' } } });

    const res = await request(app).post('/api/retry-failed/c1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.retried).toEqual(expect.arrayContaining(['instagram', 'facebook']));
    expect(res.body.retried).not.toContain('telegram');
  });

  it('при retry обновляет статус контента на scheduled', async () => {
    mockDirectusRequest
      .mockResolvedValueOnce({
        data: {
          data: {
            id: 'c1',
            campaign_id: 'camp-1',
            social_platforms: {
              vk: { status: 'failed', error: 'server error' },
            },
          },
        },
      })
      .mockResolvedValueOnce({ data: { data: { id: 'c1' } } });

    await request(app).post('/api/retry-failed/c1');

    const patchCall = mockDirectusRequest.mock.calls[1];
    expect(patchCall[0]).toMatchObject({
      method: 'patch',
      data: expect.objectContaining({ status: 'scheduled' }),
    });

    const updatedPlatforms = patchCall[0].data.social_platforms;
    expect(updatedPlatforms.vk.status).toBe('pending');
    expect(updatedPlatforms.vk.error).toBeNull();
  });

  it('возвращает 500 при ошибке Directus', async () => {
    mockDirectusRequest.mockRejectedValueOnce(new Error('Directus down'));

    const res = await request(app).post('/api/retry-failed/c1');
    expect(res.status).toBe(500);
  });
});

// ── Tests: /api/clone-content/:id ─────────────────────────────────────────────

describe('POST /api/clone-content/:id', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  it('возвращает 404 если исходный контент не найден', async () => {
    mockDirectusGet.mockResolvedValueOnce({ data: { data: null } });

    const res = await request(app).post('/api/clone-content/missing-id');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/не найден/i);
  });

  it('создаёт копию с префиксом "Копия:" и статусом draft', async () => {
    mockDirectusGet.mockResolvedValueOnce({
      data: {
        data: {
          id: 'src-1',
          campaign_id: 'camp-1',
          content_type: 'post',
          title: 'Оригинальный пост',
          content: 'Текст поста',
          image_url: 'https://example.com/img.jpg',
          video_url: null,
          additional_images: [],
          tags: ['tag1'],
          metadata: null,
          status: 'published',
          social_platforms: { telegram: { status: 'published' } },
          scheduled_at: '2026-01-01T10:00:00Z',
        },
      },
    });

    mockDirectusPost.mockResolvedValueOnce({
      data: { data: { id: 'clone-1' } },
    });

    const res = await request(app).post('/api/clone-content/src-1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBe('clone-1');

    const postCall = mockDirectusPost.mock.calls[0];
    const cloneData = postCall[1];
    expect(cloneData.title).toBe('Копия: Оригинальный пост');
    expect(cloneData.status).toBe('draft');
    expect(cloneData.social_platforms).toBeNull();
    expect(cloneData.scheduled_at).toBeNull();
    expect(cloneData.user_id).toBe('user-1');
  });

  it('копирует campaign_id, content_type, image_url из оригинала', async () => {
    mockDirectusGet.mockResolvedValueOnce({
      data: {
        data: {
          id: 'src-2',
          campaign_id: 'camp-42',
          content_type: 'story',
          title: 'Story',
          content: 'text',
          image_url: 'https://example.com/story.jpg',
          video_url: 'https://example.com/video.mp4',
          additional_images: null,
          tags: null,
          metadata: { key: 'value' },
          status: 'published',
          social_platforms: null,
          scheduled_at: null,
        },
      },
    });

    mockDirectusPost.mockResolvedValueOnce({
      data: { data: { id: 'clone-2' } },
    });

    await request(app).post('/api/clone-content/src-2');

    const postCall = mockDirectusPost.mock.calls[0];
    const cloneData = postCall[1];
    expect(cloneData.campaign_id).toBe('camp-42');
    expect(cloneData.content_type).toBe('story');
    expect(cloneData.image_url).toBe('https://example.com/story.jpg');
    expect(cloneData.video_url).toBe('https://example.com/video.mp4');
    expect(cloneData.metadata).toEqual({ key: 'value' });
  });

  it('добавляет только "Копия: " если title пустой', async () => {
    mockDirectusGet.mockResolvedValueOnce({
      data: {
        data: {
          id: 'src-3',
          campaign_id: 'camp-1',
          content_type: 'post',
          title: '',
          content: 'text',
          image_url: null,
          video_url: null,
          additional_images: null,
          tags: null,
          metadata: null,
          status: 'draft',
          social_platforms: null,
          scheduled_at: null,
        },
      },
    });

    mockDirectusPost.mockResolvedValueOnce({
      data: { data: { id: 'clone-3' } },
    });

    await request(app).post('/api/clone-content/src-3');

    const postCall = mockDirectusPost.mock.calls[0];
    expect(postCall[1].title).toBe('Копия:');
  });

  it('возвращает 500 при ошибке Directus', async () => {
    mockDirectusGet.mockRejectedValueOnce(new Error('Network error'));

    const res = await request(app).post('/api/clone-content/src-1');
    expect(res.status).toBe(500);
  });
});

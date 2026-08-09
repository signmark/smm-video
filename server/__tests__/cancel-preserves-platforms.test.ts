/**
 * AI-87: отмена публикации сохраняет историю платформ.
 *
 * Проверяет через реальный HTTP-route, что после cancel:
 * 1. Опубликованная платформа сохраняет postId/postUrl/publishedAt
 * 2. Scheduled платформа получает status: 'cancelled'
 * 3. Оба write-path (direct PATCH + storage) передают updatedPlatforms
 * 4. Ни один write-path не передаёт social_platforms: {}
 *
 * Red-before: вернуть очистку в direct PATCH → тест красный
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Partial mock: сохраняем requireSmmAdmin из оригинала
vi.mock('../middleware/user-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/user-auth')>();
  return {
    ...actual,
    authenticateUser: (req: any, _res: any, next: any) => {
      req.user = { id: 'test-user', token: 'test-token' };
      next();
    },
  };
});

vi.mock('../services/content-access', () => ({
  assertContentBelongsToRequester: vi.fn().mockResolvedValue(true),
}));

let storedDirectusPatch: any = null;
let storedStorageUpdate: any = null;
let directusFails = false;

vi.mock('../directus', () => ({
  directusApiManager: {
    request: vi.fn().mockImplementation(async (opts: any) => {
      if (directusFails) throw new Error('Directus unavailable');
      storedDirectusPatch = opts.data;
      return { data: opts.data };
    }),
  },
  directusApi: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../storage', () => ({
  storage: {
    getCampaignContentById: vi.fn().mockResolvedValue({
      id: 'test-cancel-1',
      status: 'scheduled',
      socialPlatforms: {
        telegram: {
          status: 'published',
          postId: 'tg-post-123',
          postUrl: 'https://t.me/c/123/456',
          publishedAt: '2026-08-05T14:00:00Z',
        },
        vk: {
          status: 'scheduled',
          scheduledAt: '2026-08-06T10:00:00Z',
        },
      },
    }),
    updateCampaignContent: vi.fn().mockImplementation(async (_id: string, data: any) => {
      storedStorageUpdate = data;
      return { id: _id, ...data };
    }),
  },
}));

// Синхронная регистрация маршрутов
const { registerPublishingRoutes } = await vi.importActual<typeof import('../api/publishing-routes')>('../api/publishing-routes');
const app = express();
app.use(express.json());
registerPublishingRoutes(app as any);

const AUTH_TOKEN = 'Bearer test-user-token';

describe('AI-87: cancel preserves platform history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedDirectusPatch = null;
    storedStorageUpdate = null;
    directusFails = false;
  });

  it('direct PATCH + storage сохраняют published и переводят scheduled в cancelled', async () => {
    const res = await request(app)
      .post('/api/publish/cancel/test-cancel-1')
      .set('Authorization', AUTH_TOKEN)
      .send();

    expect(res.status).toBe(200);

    // Directus PATCH должен получить updatedPlatforms
    expect(storedDirectusPatch).toBeDefined();
    expect(storedDirectusPatch.social_platforms).toBeDefined();
    expect(storedDirectusPatch.social_platforms.telegram.status).toBe('published');
    expect(storedDirectusPatch.social_platforms.telegram.postId).toBe('tg-post-123');
    expect(storedDirectusPatch.social_platforms.vk.status).toBe('cancelled');
    // НЕ должно быть пустого объекта
    expect(storedDirectusPatch.social_platforms).not.toEqual({});

    // Storage тоже должен получить updatedPlatforms
    expect(storedStorageUpdate).toBeDefined();
    expect(storedStorageUpdate.socialPlatforms).toBeDefined();
    expect(storedStorageUpdate.socialPlatforms.telegram.status).toBe('published');
    expect(storedStorageUpdate.socialPlatforms.vk.status).toBe('cancelled');
    expect(storedStorageUpdate.socialPlatforms).not.toEqual({});
  });

  it('direct PATCH fail + storage fallback: storage получает те же updatedPlatforms', async () => {
    directusFails = true;

    const res = await request(app)
      .post('/api/publish/cancel/test-cancel-1')
      .set('Authorization', AUTH_TOKEN)
      .send();

    // Storage должен отработать (fallback)
    expect(storedStorageUpdate).toBeDefined();
    expect(storedStorageUpdate.socialPlatforms).toBeDefined();
    expect(storedStorageUpdate.socialPlatforms.telegram.status).toBe('published');
    expect(storedStorageUpdate.socialPlatforms.vk.status).toBe('cancelled');
    expect(storedStorageUpdate.socialPlatforms).not.toEqual({});
  });
});

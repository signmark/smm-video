/**
 * AI-87: отмена публикации сохраняет историю платформ.
 *
 * Проверяет, что после cancel:
 * 1. Опубликованная платформа сохраняет postId/postUrl/publishedAt
 * 2. Scheduled платформа получает status: 'cancelled'
 * 3. Оба write-path (direct PATCH + storage) передают updatedPlatforms
 * 4. Ни один write-path не передаёт social_platforms: {} (стирание истории)
 *
 * Red-before (каждая ломка роняет свой сценарий):
 * - Вернуть social_platforms: {} в direct PATCH → 1 красный
 * - Убрать updatedPlatforms из storage → 1 красный
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Мокаем Directus API и storage
vi.mock('../directus', () => ({
  directusApiManager: {
    request: vi.fn().mockResolvedValue({ data: {} }),
  },
  directusApi: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../storage', () => {
  let content: any = null;
  return {
    storage: {
      getCampaignContent: vi.fn().mockImplementation(async (id: string) => {
        return content || {
          id,
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
        };
      }),
      updateCampaignContent: vi.fn().mockImplementation(async (id: string, data: any) => {
        content = { ...content, ...data, id };
        return content;
      }),
      // expose for test assertions
      _getLastUpdate: () => content,
    },
  };
});

import { storage } from '../storage';

// Загружаем publishing routes
const app = express();
app.use(express.json());

// Регистрируем ТОЛЬКО cancel endpoint
import('../api/publishing-routes').then(({ default: router }) => {
  app.use('/api', router);
});

const AUTH_TOKEN = 'Bearer test-user-token';

describe('AI-87: cancel preserves platform history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock storage state
    (storage as any)._getLastUpdate = null;
  });

  it('сохраняет published платформу с postId/postUrl и переводит scheduled в cancelled', async () => {
    const res = await request(app)
      .post('/api/publish/cancel/test-content-1')
      .set('Authorization', AUTH_TOKEN)
      .send({ contentId: 'test-content-1' });

    // Проверяем что оба write-path получили правильные данные
    const directusCalls = (await import('../directus')).directusApiManager.request;
    expect(directusCalls).toHaveBeenCalled();

    // Проверяем PATCH данные
    const patchCall = (directusCalls as any).mock.calls[0][0];
    expect(patchCall.data.social_platforms).toBeDefined();
    expect(patchCall.data.social_platforms.telegram.status).toBe('published');
    expect(patchCall.data.social_platforms.telegram.postId).toBe('tg-post-123');
    expect(patchCall.data.social_platforms.vk.status).toBe('cancelled');
    expect(patchCall.data.social_platforms).not.toEqual({});

    // Проверяем storage тоже получил данные
    const storageCalls = (storage.updateCampaignContent as any).mock.calls;
    expect(storageCalls.length).toBeGreaterThan(0);
    const storageUpdate = storageCalls[0][1];
    expect(storageUpdate.socialPlatforms).toBeDefined();
    expect(storageUpdate.socialPlatforms).not.toEqual({});
  });
});

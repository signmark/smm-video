/**
 * Тесты сбора комментариев Telegram (polling flow, post_comment)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    create: vi.fn().mockReturnValue({
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
      get: vi.fn(),
      post: vi.fn(),
    })
  }
}));

vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    // Через getById ходит проверка принадлежности тренда арендатору
    // (ревью 2026-07-29): комментарии читаются служебным токеном, поэтому
    // граница обязана стоять в коде.
    getById: vi.fn()
  }
}));

vi.mock('../services/campaign-access', () => {
  class CampaignAccessError extends Error {
    constructor(public readonly status: 404 | 503, public readonly code: string) { super(code); }
  }
  return {
    CampaignAccessError,
    authorizeCampaignAccess: vi.fn(async () => ({ id: 'campaign-1' })),
    listAccessibleCampaignIds: vi.fn(async () => ['campaign-1']),
  };
});

vi.mock('../services/global-api-keys', () => ({
  globalApiKeysService: {
    getGlobalApiKey: vi.fn()
  }
}));

vi.mock('../middleware/user-auth', () => ({
  requireSmmAdmin: (req: any, res: any, next: any) =>
    req.user?.is_smm_admin === true ? next() : res.status(403).json({ error: 'forbidden' }),
  authenticateUser: (_req: any, _res: any, next: () => void) => {
    (_req as any).user = { id: 'user-1', token: 'token-1' };
    next();
  }
}));

vi.mock('../utils/logger', () => {
  const logFn: any = vi.fn();
  logFn.info = vi.fn();
  logFn.warn = vi.fn();
  logFn.error = vi.fn();
  logFn.debug = vi.fn();
  return { log: logFn, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
});

import axios from 'axios';
import { directusCrud } from '../services/directus-crud';
import { globalApiKeysService } from '../services/global-api-keys';
import { registerTrendsRoutes } from '../api/trends-routes';

const app = express();
app.use(express.json());
registerTrendsRoutes(app);

describe('Telegram collect comments', () => {
  // Колбэк перестал быть анонимным (ревью 2026-07-29): у него собственный
  // секрет, и без него ручка отвечает 503. Тесты бизнес-логики обязаны его
  // выставлять — иначе они проверяли бы только гейт.
  const CALLBACK_SECRET = 'trends-secret-for-tests';

  beforeEach(() => {
    vi.clearAllMocks();
    // AI-89: getPublicOrigin() теперь бросает в проде без APP_PUBLIC_URL.
    process.env.APP_PUBLIC_URL = 'http://app.test';
    process.env.TRENDS_WEBHOOK_SECRET = CALLBACK_SECRET;
    vi.mocked(globalApiKeysService.getGlobalApiKey).mockResolvedValue('test-api-key');
    // Тренд принадлежит своей кампании — эти тесты про бизнес-логику, не про границу.
    vi.mocked(directusCrud.getById).mockResolvedValue({ id: 'trend-1', campaign_id: 'campaign-1' } as any);
  });

  afterEach(() => {
    delete process.env.TRENDS_WEBHOOK_SECRET;
  });

  describe('POST /api/telegram/collect-comments-direct', () => {
    it('возвращает 200 и запускает сбор в фоне', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { task_id: 'task-123', status: 'processing' }
      });
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          status: 'done',
          result: {
            post_url: 'https://t.me/ch/123',
            comments: [
              { id: 1, text: 'Comment 1', date: '2026-02-19T10:00:00Z', from_id: 12345 },
              { id: 2, text: 'Comment 2', date: '2026-02-19T11:00:00Z', from_id: 67890 }
            ]
          }
        }
      });
      const res = await request(app)
        .post('/api/telegram/collect-comments-direct')
        .send({ post_url: 'https://t.me/ch/123' })
        .set('Authorization', 'Bearer token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('отправлен');
      expect(axios.post).toHaveBeenCalledWith(
        'http://217.26.25.95:3030/api/telegram/collect-comments',
        expect.objectContaining({
          post_url: 'https://t.me/ch/123',
          limit: 1000,
          download_media: false
        }),
        expect.any(Object)
      );
    });

    it('возвращает 400 без post_url', async () => {
      const res = await request(app)
        .post('/api/telegram/collect-comments-direct')
        .send({})
        .set('Authorization', 'Bearer token');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('post_url');
    });

    it('возвращает 500 если API ключ не настроен', async () => {
      vi.mocked(globalApiKeysService.getGlobalApiKey).mockResolvedValueOnce(null);
      const res = await request(app)
        .post('/api/telegram/collect-comments-direct')
        .send({ post_url: 'https://t.me/ch/123' })
        .set('Authorization', 'Bearer token');
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('not configured');
    });
  });

  describe('GET /api/trend-comments/:trendId', () => {
    it('возвращает комментарии из post_comment', async () => {
      const mockComments = [
        { id: 'c1', author: '12345', text: 'Hello', date: '2026-02-19T10:00:00Z', platform: 'telegram' },
        { id: 'c2', author: '67890', text: 'Hi', date: '2026-02-19T11:00:00Z', platform: 'telegram' }
      ];
      vi.mocked(directusCrud.list).mockResolvedValueOnce(mockComments);

      const res = await request(app)
        .get('/api/trend-comments/trend-uuid-123')
        .set('Authorization', 'Bearer token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].author).toBe('12345');
      expect(res.body.data[0].text).toBe('Hello');
      expect(directusCrud.list).toHaveBeenCalledWith(
        'post_comment',
        expect.objectContaining({
          filter: { trent_post_id: { _eq: 'trend-uuid-123' } }
        })
      );
    });
  });

  describe('POST /api/trends/collect-comments-callback', () => {
    it('сохраняет комментарии в post_comment с маппингом from_id→author', async () => {
      vi.mocked(directusCrud.list)
        .mockResolvedValueOnce([{ id: 'trend-1', comments: 0 }])
        .mockResolvedValueOnce([{ id: 'comment-1' }, { id: 'comment-2' }]);
      vi.mocked(directusCrud.create).mockResolvedValue({ id: 'new-1' });
      vi.mocked(directusCrud.update).mockResolvedValue({});

      const res = await request(app)
        .post('/api/trends/collect-comments-callback')
        .set('x-webhook-secret', CALLBACK_SECRET)
        .send({
          post_url: 'https://t.me/ch/123',
          comments: [
            { id: 172534, text: 'Ты в будущем?', date: '2026-02-19T10:25:18+00:00', from_id: 2043062548 },
            { id: 172533, text: 'Он не дропнул', date: '2026-02-19T08:22:19+00:00', from_id: 6078846545 }
          ]
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(directusCrud.create).toHaveBeenCalledTimes(2);
      expect(directusCrud.create).toHaveBeenNthCalledWith(
        1,
        'post_comment',
        expect.objectContaining({
          trent_post_id: 'trend-1',
          text: 'Ты в будущем?',
          author: '2043062548',
          date: '2026-02-19T10:25:18.000Z',
          comment_id: '172534',
          platform: 'telegram'
        }),
        expect.any(Object)
      );
      expect(directusCrud.update).toHaveBeenCalledWith(
        'campaign_trend_topics',
        'trend-1',
        { comments: 2 },
        expect.any(Object)
      );
    });
  });
});

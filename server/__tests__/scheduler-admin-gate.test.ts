import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { registerRoutes } from '../routes';
import { getPublishScheduler } from '../services/publish-scheduler';

// Security §2 regression: глобальные scheduler-контролы — admin-only, только POST.
// См. docs/PRIORITIZED_IMPROVEMENT_PLAN_2026-07-23.md §2 и
// docs/followups/2026-07-24-security-backlog.md.

vi.mock('../services/admin-token-manager', () => ({
  adminTokenManager: { getAdminToken: vi.fn(async () => 'test-service-token'), clearToken: vi.fn() },
}));
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
    instance: {
      interceptors: {
        response: { use: vi.fn() }
      }
    }
  },
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }
}));

vi.mock('../services/publish-scheduler', () => {
  const scheduler = {
    start: vi.fn(),
    stop: vi.fn(),
    checkScheduledContent: vi.fn(),
  };
  return {
    getPublishScheduler: vi.fn(() => scheduler),
  };
});

const app = express();
app.use(express.json());
// @ts-ignore
registerRoutes(app);

const createMockToken = (payload: object) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${body}.signature`;
};

/**
 * Стаб fetch, обслуживающий оба апстрим-вызова authenticateUser:
 * - validateDirectusSession: GET /users/me?fields=id → ok
 * - fetchAdminStatus: GET /users/<id>?fields=is_smm_admin → { is_smm_admin }
 */
const stubAuthFetch = (isAdmin: boolean) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { id: 'stub', is_smm_admin: isAdmin } }),
    text: async () => '',
    clone() { return this; },
  }));
};

describe('Security §2: admin-only scheduler controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('POST /api/publish/toggle-publishing', () => {
    it('401 для анонимного запроса', async () => {
      const response = await request(app).post('/api/publish/toggle-publishing');
      expect(response.status).toBe(401);
    });

    it('403 для аутентифицированного не-админа', async () => {
      stubAuthFetch(false);
      const token = createMockToken({ id: `user-nonadmin-${Date.now()}-a`, email: 'user@example.com' });
      const response = await request(app)
        .post('/api/publish/toggle-publishing')
        .set('Authorization', `Bearer ${token}`)
        .send({ enable: false });
      expect(response.status).toBe(403);
      const scheduler = getPublishScheduler();
      expect(scheduler.start).not.toHaveBeenCalled();
      expect(scheduler.stop).not.toHaveBeenCalled();
    });

    it('200 для админа, enable=true запускает планировщик', async () => {
      stubAuthFetch(true);
      const token = createMockToken({ id: `user-admin-${Date.now()}-b`, email: 'admin@example.com' });
      const response = await request(app)
        .post('/api/publish/toggle-publishing')
        .set('Authorization', `Bearer ${token}`)
        .send({ enable: true });
      expect(response.status).toBe(200);
      expect(response.body.publishing).toBe(true);
      const scheduler = getPublishScheduler();
      expect(scheduler.start).toHaveBeenCalledTimes(1);
      expect(scheduler.stop).not.toHaveBeenCalled();
    });

    it('GET-мутация запрещена (роут не матчится) — и для админа тоже', async () => {
      stubAuthFetch(true);
      const token = createMockToken({ id: `user-admin-${Date.now()}-c`, email: 'admin@example.com' });
      const response = await request(app)
        .get('/api/publish/toggle-publishing?enable=false')
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(404);
      const scheduler = getPublishScheduler();
      expect(scheduler.start).not.toHaveBeenCalled();
      expect(scheduler.stop).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/publish/reset-processed-cache', () => {
    it('401 для анонимного запроса', async () => {
      const response = await request(app).post('/api/publish/reset-processed-cache');
      expect(response.status).toBe(401);
    });

    it('403 для аутентифицированного не-админа', async () => {
      stubAuthFetch(false);
      const token = createMockToken({ id: `user-nonadmin-${Date.now()}-d`, email: 'user@example.com' });
      const response = await request(app)
        .post('/api/publish/reset-processed-cache')
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(403);
      const scheduler = getPublishScheduler();
      expect(scheduler.stop).not.toHaveBeenCalled();
    });

    it('200 для админа — рестарт планировщика', async () => {
      stubAuthFetch(true);
      const token = createMockToken({ id: `user-admin-${Date.now()}-e`, email: 'admin@example.com' });
      const response = await request(app)
        .post('/api/publish/reset-processed-cache')
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(200);
      const scheduler = getPublishScheduler();
      expect(scheduler.stop).toHaveBeenCalledTimes(1);
      expect(scheduler.start).toHaveBeenCalledTimes(1);
    });

    it('GET-мутация запрещена (роут не матчится)', async () => {
      stubAuthFetch(true);
      const token = createMockToken({ id: `user-admin-${Date.now()}-f`, email: 'admin@example.com' });
      const response = await request(app)
        .get('/api/publish/reset-processed-cache')
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(404);
      const scheduler = getPublishScheduler();
      expect(scheduler.stop).not.toHaveBeenCalled();
    });
  });
});

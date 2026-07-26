import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { registerRoutes } from '../routes';
import { directusApi } from '../directus';

// Mock directusApi
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

const app = express();
app.use(express.json());
// @ts-ignore
registerRoutes(app);

// Helper to create a fake JWT
const createMockToken = (payload: object) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${body}.signature`;
};

describe('Auth Flow Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Флак «expected 503 to be 200» (2 падения из 10 полных прогонов, 1 из 7
    // изолированных). Причина: createMockToken выводит exp из
    // Math.floor(Date.now()/1000), поэтому два токена совпадают побайтово
    // только внутри одной секунды. validateDirectusSession кэширует результат
    // по sha256(token) на 30 с, и раньше единственным местом со стабом fetch
    // был тест профиля — остальные session-зависимые тесты просто попадали в
    // его кэш. Стоило прогону пересечь границу секунды, как ключ переставал
    // совпадать, шёл реальный fetch в Directus, и авторизация отдавала
    // 'unavailable' → 503. Сколько тестов упадёт, зависело от того, где
    // легла граница: в наблюдавшихся прогонах 3 и 1.
    //
    // Дефолтный стаб убирает зависимость от кэша и часов: сессия валидна
    // всегда, каждый тест самодостаточен. Тестам, которым нужен специфичный
    // ответ (профиль), стаб переопределяют локально.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: 'test-user-id', is_smm_admin: false } }),
      text: async () => '',
      clone() { return this; },
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('GET /api/user/profile', () => {
    it('should return 401 when no authorization header is provided', async () => {
      const response = await request(app).get('/api/user/profile');
      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Не авторизован');
    });

    it('should return 401 when an invalid token format is provided', async () => {
      const response = await request(app)
        .get('/api/user/profile')
        .set('Authorization', 'Bearer invalid-token');
      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Неверный формат токена');
    });

    it('should return 200 and profile data when a valid token is provided', async () => {
      const mockUserId = 'test-user-id';
      const mockToken = createMockToken({ id: mockUserId, email: 'test@example.com' });
      
      const mockProfileData = {
        id: mockUserId,
        email: 'test@example.com',
        first_name: 'Test',
        last_name: 'User',
        is_smm_admin: false
      };

      // Route uses native fetch (not directusApi), so mock global fetch
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { ...mockProfileData } }),
      }));

      const response = await request(app)
        .get('/api/user/profile')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: mockUserId,
        email: 'test@example.com',
        first_name: 'Test',
        last_name: 'User',
        is_smm_admin: false
      });
    });
  });

  describe('GET /api/campaign-content', () => {
    it('should return 401 when no authorization header is provided', async () => {
      const response = await request(app).get('/api/campaign-content');
      expect(response.status).toBe(401);
    });

    it('should return 401 when an invalid token format is provided', async () => {
      const response = await request(app)
        .get('/api/campaign-content')
        .set('Authorization', 'Bearer invalid-token');
      expect(response.status).toBe(401);
    });

    it('should return 200 and JSON content when a valid token is provided', async () => {
      const mockUserId = 'test-user-id';
      const mockToken = createMockToken({ id: mockUserId, email: 'test@example.com' });
      
      const mockContentData = [
        { 
          id: '1', 
          title: 'Test Post', 
          content: 'Hello world', 
          user_id: mockUserId,
          campaign_id: 'campaign-1',
          content_type: 'text',
          created_at: new Date().toISOString()
        }
      ];

      // Mock Directus response
      (directusApi.get as any).mockResolvedValue({
        data: { 
          data: mockContentData,
          meta: { total_count: 1 }
        }
      });

      const response = await request(app)
        .get('/api/campaign-content')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0].title).toBe('Test Post');
      expect(response.header['content-type']).toContain('application/json');
      // Ensure we didn't get HTML
      expect(response.text).not.toContain('<!DOCTYPE html>');
    });
  });

  describe('campaign content creation timestamp', () => {
    it('does not forward a client-provided creation timestamp when creating content', async () => {
      const mockToken = createMockToken({ id: 'test-user-id', email: 'test@example.com' });
      (directusApi.post as any).mockResolvedValue({
        status: 200,
        data: { data: { id: 'content-1' } },
      });

      const response = await request(app)
        .post('/api/campaign-content')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          campaignId: 'campaign-1',
          title: 'Test content',
          content: 'Text',
          createdAt: '2000-01-01T00:00:00Z',
          created_at: '2001-01-01T00:00:00Z',
          date_created: '2002-01-01T00:00:00Z',
        });

      expect(response.status).toBe(201);
      const directusPayload = (directusApi.post as any).mock.calls[0][1];
      expect(directusPayload).not.toHaveProperty('createdAt');
      expect(directusPayload).not.toHaveProperty('created_at');
      expect(directusPayload).not.toHaveProperty('date_created');
    });

    it('does not forward a client-provided creation timestamp when updating content', async () => {
      const mockToken = createMockToken({ id: 'test-user-id', email: 'test@example.com' });
      (directusApi.patch as any).mockResolvedValue({
        data: { data: { id: 'content-1', title: 'Updated title' } },
      });

      const response = await request(app)
        .patch('/api/campaign-content/content-1')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          title: 'Updated title',
          createdAt: '2000-01-01T00:00:00Z',
          created_at: '2001-01-01T00:00:00Z',
          date_created: '2002-01-01T00:00:00Z',
        });

      expect(response.status).toBe(200);
      const directusPayload = (directusApi.patch as any).mock.calls[0][1];
      expect(directusPayload.title).toBe('Updated title');
      expect(directusPayload).not.toHaveProperty('createdAt');
      expect(directusPayload).not.toHaveProperty('created_at');
      expect(directusPayload).not.toHaveProperty('date_created');
    });
  });

  describe('GET /api/auth/system-token (should be removed)', () => {
    it('should return 404 for anonymous request', async () => {
      const response = await request(app).get('/api/auth/system-token');
      expect(response.status).toBe(404);
    });

    it('should return 404 for authenticated user request', async () => {
      const mockToken = createMockToken({ id: 'test-user-id', email: 'test@example.com' });
      const response = await request(app)
        .get('/api/auth/system-token')
        .set('Authorization', `Bearer ${mockToken}`);
      expect(response.status).toBe(404);
    });
  });
});

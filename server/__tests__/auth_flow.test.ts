import { describe, it, expect, vi, beforeEach } from 'vitest';
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

      vi.unstubAllGlobals();

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
});

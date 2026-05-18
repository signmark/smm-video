import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { registerRoutes } from '../routes';
import { directusApi } from '../directus';
import { aiService } from '../services/ai-service';

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

// Mock aiService
vi.mock('../services/ai-service', () => ({
  aiService: {
    generateContent: vi.fn(),
    validateApiKeys: vi.fn(),
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

describe('API Routes New Tests', () => {
  const mockUserId = 'test-user-id';
  const mockToken = createMockToken({ id: mockUserId, email: 'test@example.com' });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/keywords', () => {
    it('should return 200 and an array of keywords', async () => {
      const mockKeywords = [
        { id: 1, keyword: 'smm', campaign_id: '123' },
        { id: 2, keyword: 'ai', campaign_id: '123' }
      ];

      (directusApi.get as any).mockResolvedValue({
        data: { data: mockKeywords }
      });

      const response = await request(app)
        .get('/api/keywords')
        .query({ campaignId: '123' })
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].keyword).toBe('smm');
    });

    it('should return empty array when no keywords found', async () => {
      (directusApi.get as any).mockResolvedValue({
        data: { data: [] }
      });

      const response = await request(app)
        .get('/api/keywords')
        .query({ campaignId: '123' })
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(0);
    });
  });

  describe('POST /api/generate', () => {
    it('should return correct JSON when Gemini 3.0 Pro is selected', async () => {
      const mockAiResponse = {
        success: true,
        content: 'Generated content for Gemini 3.0 Pro',
        model: 'gemini-1.5-pro-latest',
        service: 'gemini'
      };

      (aiService.generateContent as any).mockResolvedValue(mockAiResponse);

      const response = await request(app)
        .post('/api/generate')
        .send({
          prompt: 'Write a post about AI',
          model: 'Gemini 3.0 Pro',
          service: 'gemini'
        })
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.content).toBe('Generated content for Gemini 3.0 Pro');
      expect(aiService.generateContent).toHaveBeenCalledWith(expect.objectContaining({
        model: 'Gemini 3.0 Pro'
      }));
    });

    it('should return 500 when AI service fails', async () => {
      (aiService.generateContent as any).mockRejectedValue(new Error('AI Service Error'));

      const response = await request(app)
        .post('/api/generate')
        .send({
          prompt: 'Write a post about AI',
          model: 'Gemini 3.0 Pro'
        })
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('AI Service Error');
    });
  });

  describe('GET /api/ai/validate-keys', () => {
    it('should return validation results', async () => {
      const mockValidationResults = {
        gemini: { valid: true },
        deepseek: { valid: false, error: 'Invalid key' }
      };

      (aiService.validateApiKeys as any).mockResolvedValue(mockValidationResults);

      const response = await request(app)
        .get('/api/ai/validate-keys')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.results).toEqual(mockValidationResults);
    });
  });
});

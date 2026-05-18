import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import axios from 'axios';
import { aiService } from '../services/ai-service';
import { registerRoutes } from '../routes';
import { globalApiKeysService } from '../services/global-api-keys';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// Mock globalApiKeysService
vi.mock('../services/global-api-keys', () => {
  const mockService = {
    getGlobalApiKey: vi.fn(),
    refreshCache: vi.fn().mockResolvedValue(undefined),
    getVertexAIServiceAccount: vi.fn().mockResolvedValue({
      type: 'service_account',
      project_id: 'test-project',
      private_key: 'test-key',
      client_email: 'test@example.com'
    })
  };
  return {
    globalApiKeysService: mockService,
    GlobalApiKeysService: function () {
      return mockService;
    }
  };
});

// Mock directusApi
vi.mock('../directus', () => {
  const mockApi = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() }
    }
  };
  return {
    directusApi: mockApi,
    directusApiManager: {
      request: vi.fn(),
      instance: mockApi
    },
    default: mockApi
  };
});

vi.mock('../lib/directus', () => {
  const mockApi = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() }
    }
  };
  return {
    directusApi: mockApi,
    default: mockApi
  };
});

const app = express();
app.use(express.json());
// @ts-ignore
registerRoutes(app);

describe('GEMINI_FINAL_CHECK', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AiService.generateContent with Gemini 3.0 Pro', () => {
    it('should map gemini-3.0-pro to gemini-1.5-pro and not fail', async () => {
      // 1. Mock API Key availability
      (globalApiKeysService.getGlobalApiKey as any).mockResolvedValue('test-api-key');

      // 2. Mock Gemini API response
      mockedAxios.post.mockResolvedValue({
        data: {
          candidates: [{
            content: {
              parts: [{ text: 'Check successful' }]
            }
          }]
        }
      });

      const result = await aiService.generateContent({
        prompt: 'test prompt',
        model: 'gemini-3.0-pro',
        service: 'gemini'
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('Check successful');
      // In 2026 it should map to gemini-3-pro-preview
      expect(result.model).toBe('gemini-3-pro-preview');

      // Verify the correct URL was called
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/models/gemini-3-pro-preview:generateContent'),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should catch Directus Key Missing', async () => {
      // 1. Mock API Key ABSENCE
      (globalApiKeysService.getGlobalApiKey as any).mockResolvedValue(null);

      try {
        await aiService.generateContent({
          prompt: 'test prompt',
          model: 'gemini-3.0-pro',
          service: 'gemini'
        });
        // Should not reach here
        expect(true).toBe(false);
      } catch (error: any) {
        if (error.message.includes('API ключ Gemini не найден')) {
          console.error('ERROR: Directus Key Missing');
        }
        expect(error.message).toContain('API ключ Gemini не найден');
      }
    });
  });

  describe('GET /api/proxy-image', () => {
    it('should return 200 and image/jpeg for valid URL', async () => {
      const imageUrl = 'https://v3b.fal.media/files/b/0a8ad874/sNdTdyI5dotXDk79nFUr4.jpg';
      const mockImageData = Buffer.from('mock-image-binary-data');

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: mockImageData,
        headers: {
          'content-type': 'image/jpeg'
        }
      });

      const response = await request(app)
        .get('/api/proxy-image')
        .query({ url: imageUrl });

      expect(response.status).toBe(200);
      expect(response.header['content-type']).toBe('image/jpeg');
      expect(response.body).toEqual(mockImageData);
    });
  });
});

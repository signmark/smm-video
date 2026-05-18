import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('axios', () => ({
  default: {
    create: vi.fn().mockReturnValue({
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() }
      }
    }),
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn()
  }
}));

vi.mock('../../utils/logger');
vi.mock('../services/directus-auth-manager', () => ({
  directusAuthManager: {
    getAllActiveSessions: vi.fn().mockReturnValue([{ token: 'admin-token' }])
  }
}));

import axios from 'axios';
import { facebookService } from '../services/social-platforms/facebook-service';
import log from '../../utils/logger';

describe('FacebookService', () => {
  const mockPageId = '12345';
  const mockUserToken = 'user-token';
  const mockPageToken = 'page-token';

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-ignore - Accessing private property for testing to clear cache
    if (facebookService.pageTokenCache) {
      facebookService.pageTokenCache.clear();
    }
  });

  describe('getPageAccessToken', () => {
    it('should fetch and return page access token', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          data: [
            { id: mockPageId, access_token: mockPageToken, name: 'Test Page' }
          ]
        }
      });

      const token = await facebookService.getPageAccessToken(mockUserToken, mockPageId);
      expect(token).toBe(mockPageToken);
    });

    it('should return user token if page not found in list', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          data: [
            { id: 'other-page', access_token: 'other-token' }
          ]
        }
      });

      const token = await facebookService.getPageAccessToken(mockUserToken, mockPageId);
      expect(token).toBe(mockUserToken);
    });

    it('should handle API errors and fallback to user token', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('API Error'));
      
      const token = await facebookService.getPageAccessToken(mockUserToken, mockPageId);
      expect(token).toBe(mockUserToken);
    });
  });

  describe('publishToFacebook', () => {
    const mockContent: any = {
      id: 'content-1',
      content: 'Hello Facebook!',
      imageUrl: 'http://example.com/image.jpg'
    };
    const mockSettings = {
      token: mockUserToken,
      pageId: mockPageId
    };

    it('should successfully publish image with text', async () => {
      vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: { data: [{ id: mockPageId, access_token: mockPageToken }] } }) // pages
        .mockResolvedValueOnce({ data: { permalink_url: 'http://fb.com/post/123' } }); // permalink

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { id: 'post-id-123' }
      });

      const result = await facebookService.publishToFacebook(mockContent, mockSettings);

      expect(result.status).toBe('published');
      expect(result.postId).toBe('post-id-123');
    });

    it('should return failed status on API error', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { data: [{ id: mockPageId, access_token: mockPageToken }] }
      });
      // Correctly structure the axios error response
      const axiosError = new Error('Request failed');
      (axiosError as any).response = { 
        data: { error: { message: 'OAuth Exception', code: 190 } } 
      };
      // Mock both potential attempts in publishImageWithText
      vi.mocked(axios.post).mockRejectedValue(axiosError);

      const result = await facebookService.publishToFacebook(mockContent, mockSettings);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('OAuth Exception');
    });
  });

  describe('updatePublicationStatus', () => {
    const mockContentId = 'content-123';
    const mockResult: any = {
      status: 'published',
      publishedAt: new Date(),
      postUrl: 'http://fb.com/final',
      postId: 'fb-id'
    };

    it('should fetch content, merge platforms, and patch Directus', async () => {
      process.env.DIRECTUS_URL = 'http://directus.local';
      
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          data: {
            id: mockContentId,
            social_platforms: { telegram: { status: 'published' } }
          }
        }
      });

      vi.mocked(axios.patch).mockResolvedValueOnce({ data: { success: true } });

      const updated = await facebookService.updatePublicationStatus(mockContentId, 'facebook', mockResult);

      expect(updated).not.toBeNull();
      expect(axios.patch).toHaveBeenCalledWith(
        expect.stringContaining(`/items/campaign_content/${mockContentId}`),
        expect.any(Object),
        expect.any(Object)
      );
    });
  });
});


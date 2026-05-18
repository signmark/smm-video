import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock axios BEFORE importing services
vi.mock('axios', () => ({
  default: {
    create: vi.fn().mockReturnValue({
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() }
      }
    }),
    get: vi.fn(),
    post: vi.fn()
  }
}));

vi.mock('../../utils/logger');
vi.mock('../directus', () => ({
  directusApi: {
    get: vi.fn(),
    patch: vi.fn()
  }
}));

import axios from 'axios';
import { instagramReelsService } from '../services/social-platforms/instagram-reels-service';
import { directusApi } from '../directus';

describe('InstagramReelsService', () => {
  const mockContentId = 'content-1';
  const mockCampaignId = 'camp-1';
  const mockAuthToken = 'user-token';
  const mockBusinessId = '123456789';
  const mockAccessToken = 'ig-token';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIRECTUS_ADMIN_TOKEN = 'admin-token';
    process.env.SMM_DOMAIN = 'smm.test';
  });

  describe('publishReels', () => {
    it('should return error if content not found', async () => {
      vi.mocked(directusApi.get).mockRejectedValueOnce(new Error('Not found'));
      const result = await instagramReelsService.publishReels(mockContentId, mockAuthToken);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Контент не найден');
    });

    it('should return error if video_url is missing', async () => {
      vi.mocked(directusApi.get).mockResolvedValueOnce({
        data: { data: { id: mockContentId, campaign_id: mockCampaignId, video_url: null } }
      });
      const result = await instagramReelsService.publishReels(mockContentId, mockAuthToken);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Видео URL не найден');
    });

    it('should successfully publish Reels', async () => {
      // 1. Mock Content
      vi.mocked(directusApi.get).mockResolvedValueOnce({
        data: { data: { id: mockContentId, campaign_id: mockCampaignId, video_url: 'http://s3.cloud/video.mp4', content: 'Test Reel' } }
      });

      // 2. Mock Campaign Settings
      vi.mocked(directusApi.get).mockResolvedValueOnce({
        data: { data: { social_settings: { instagram: { businessAccountId: mockBusinessId, token: mockAccessToken } } } }
      });

      // 3. Mock Container Creation (axios.post)
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { id: 'container-123' }
      });

      // 4. Mock Status Check (axios.get)
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { status_code: 'FINISHED' }
      });

      // 5. Mock Final Publish (axios.post)
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { id: 'media-999' }
      });

      // 6. Mock Permalink (axios.get)
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { permalink: 'https://inst.gr/reel/999' }
      });

      // 7. Mock Status Update (Directus calls)
      vi.mocked(directusApi.get).mockResolvedValueOnce({ data: { data: { social_platforms: {} } } });
      vi.mocked(directusApi.patch).mockResolvedValueOnce({ data: {} });

      const result = await instagramReelsService.publishReels(mockContentId, mockAuthToken);

      expect(result.success).toBe(true);
      expect(result.mediaId).toBe('media-999');
      expect(result.postUrl).toBe('https://inst.gr/reel/999');
      
      // Verify container check was called
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('container-123'),
        expect.any(Object)
      );
    });

    it('should handle video processing error', async () => {
      vi.mocked(directusApi.get).mockResolvedValueOnce({
        data: { data: { id: mockContentId, campaign_id: mockCampaignId, video_url: 'v.mp4' } }
      });
      vi.mocked(directusApi.get).mockResolvedValueOnce({
        data: { data: { social_settings: { instagram: { businessAccountId: mockBusinessId, token: mockAccessToken } } } }
      });
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { id: 'c-1' } });
      
      // Mock processing error 2207026 (Unsupported format)
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { status_code: 'ERROR', status: '2207026' }
      });

      const result = await instagramReelsService.publishReels(mockContentId, mockAuthToken);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Неподдерживаемый формат видео');
    });
  });
});

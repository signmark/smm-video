import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { YouTubeService } from '../services/social-platforms/youtube-service';

vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({ data: { success: true } }),
    get: vi.fn().mockResolvedValue({ data: {} }),
    create: vi.fn().mockReturnValue({
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
      post: vi.fn().mockResolvedValue({ data: {} }),
      get: vi.fn().mockResolvedValue({ data: {} }),
    }),
  },
}));

vi.mock('../utils/logger', () => ({
  log: vi.fn(),
  default: { log: vi.fn() },
}));

vi.mock('../utils/n8n-utils', () => ({
  getN8nUrl: vi.fn().mockReturnValue('https://n8n.test'),
  getYouTubeWebhookUrl: vi.fn().mockReturnValue('https://n8n.test/webhook/publish-youtube'),
}));

describe('YouTubeService', () => {
  let service: YouTubeService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(axios.post).mockResolvedValue({ data: { success: true } });
    service = new YouTubeService();
    process.env.N8N_URL = 'https://n8n.test';
  });

  describe('publishContent', () => {
    it('should successfully send payload to n8n webhook', async () => {
      const mockContent = {
        id: 'c-1',
        title: '<b>Cool</b> Video',
        content: '<p>Sub here</p>',
        campaign_id: 'camp-1',
        video_url: 'http://s3/v.mp4',
        content_type: 'video'
      };

      const result = await service.publishContent(mockContent, {}, 'user-1');

      expect(result.success).toBe(true);
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/webhook/publish-youtube'),
        expect.objectContaining({
          contentId: 'c-1',
          title: 'Cool Video',
          description: 'Sub here',
          isShort: false
        }),
        expect.any(Object)
      );
    });

    it('should set isShort to true if content type is clip', async () => {
      const mockContent = {
        id: 'c-1',
        content_type: 'clip',
        title: 'Short'
      };

      await service.publishContent(mockContent, {}, 'user-1');

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ isShort: true }),
        expect.any(Object)
      );
    });

    it('should handle request errors gracefully', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce(new Error('Network error'));

      const result = await service.publishContent({ id: '1' }, {}, 'u-1');
      expect(result.success).toBe(true);
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('publishContent', () => {
    it('should delegate regular video publishing without calling removed n8n webhook', async () => {
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
      expect(result.postUrl).toBeUndefined();
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should delegate clip publishing without calling removed n8n webhook', async () => {
      const mockContent = {
        id: 'c-1',
        content_type: 'clip',
        title: 'Short'
      };

      const result = await service.publishContent(mockContent, {}, 'user-1');

      expect(result.success).toBe(true);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should not require n8n configuration for scheduler delegation', async () => {
      vi.stubEnv('N8N_URL', '');

      const result = await service.publishContent({ id: '1' }, {}, 'u-1');
      expect(result.success).toBe(true);
      expect(axios.post).not.toHaveBeenCalled();
    });
  });
});

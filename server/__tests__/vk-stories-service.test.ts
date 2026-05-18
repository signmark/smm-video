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

import { VKStoriesService } from '../services/social-platforms/vk-stories-service';
import axios from 'axios';
import { directusApi } from '../directus';
import StoriesMediaService from '../services/stories-media-service';

vi.mock('../directus', () => ({
  directusApi: {
    get: vi.fn(),
    patch: vi.fn()
  }
}));
vi.mock('../services/stories-media-service');
vi.mock('../utils/logger');

describe('VKStoriesService', () => {
  let service: VKStoriesService;
  const mockAuthToken = 'mock-token';

  beforeEach(() => {
    vi.clearAllMocks();
    service = new VKStoriesService();
    process.env.DIRECTUS_ADMIN_TOKEN = 'admin-token';
  });

  describe('publishStory', () => {
    it('should return error if content not found', async () => {
      vi.mocked(directusApi.get).mockRejectedValue(new Error('Not found'));
      const result = await service.publishStory('invalid-id', mockAuthToken);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Контент не найден');
    });

    it('should return error if VK settings missing', async () => {
      vi.mocked(directusApi.get)
        .mockResolvedValueOnce({ data: { data: { id: '1', campaign_id: 'camp-1' } } }) // Content
        .mockResolvedValueOnce({ data: { data: { social_settings: {} } } }); // Campaign settings
      
      const result = await service.publishStory('1', mockAuthToken);
      expect(result.success).toBe(false);
      expect(result.error).toBe('VK настройки не найдены в кампании');
    });

    it('should successfully publish a photo story', async () => {
      // 1. Mock Content
      vi.mocked(directusApi.get)
        .mockResolvedValueOnce({ data: { data: { id: '1', campaign_id: 'camp-1', image_url: 'http://img.jpg' } } })
        .mockResolvedValueOnce({ data: { data: { social_settings: { vk: { groupId: '123', token: 'vk-token' } } } } })
        .mockResolvedValueOnce({ data: { data: { social_platforms: {} } } }); // For updateContentStatus

      // 2. Mock StoriesMediaService
      vi.mocked(StoriesMediaService.getMediaFromAdditionalMedia).mockResolvedValue(null);

      // 3. Mock Axios for download, upload server, upload, and save
      vi.mocked(axios.get).mockResolvedValue({ data: Buffer.from('fake-image') });
      vi.mocked(axios.post)
        .mockResolvedValueOnce({ data: { response: { upload_url: 'http://vk.upload/url' } } }) // getUploadServer
        .mockResolvedValueOnce({ data: { response: { story: [{ upload_result: 'res123' }] } } }) // uploadMedia
        .mockResolvedValueOnce({ data: { response: { items: [{ id: '999', owner_id: '888' }] } } }); // saveStory

      vi.mocked(directusApi.patch).mockResolvedValue({ data: {} });

      const result = await service.publishStory('1', mockAuthToken);

      expect(result.success).toBe(true);
      expect(result.storyId).toBe('999');
      expect(result.storyUrl).toBe('https://vk.com/story888_999');
    });

    it('should handle VK API errors', async () => {
      vi.mocked(directusApi.get)
        .mockResolvedValueOnce({ data: { data: { id: '1', campaign_id: 'camp-1', image_url: 'http://img.jpg' } } })
        .mockResolvedValueOnce({ data: { data: { social_settings: { vk: { groupId: '123', token: 'vk-token' } } } } });

      vi.mocked(axios.get).mockResolvedValue({ data: Buffer.from('fake-image') });
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { error: { error_msg: 'Invalid token' } } });

      const result = await service.publishStory('1', mockAuthToken);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid token');
    });
  });
});

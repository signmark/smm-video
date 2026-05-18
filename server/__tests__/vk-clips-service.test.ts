import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock axios BEFORE anything else
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    create: vi.fn().mockReturnValue({
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() }
      }
    })
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
import { vkClipsService } from '../services/social-platforms/vk-clips-service';
import { directusApi } from '../directus';

describe('VKClipsService', () => {
  const mockContentId = 'c-1';
  const mockAuthToken = 'user-token';
  const mockVKToken = 'vk-token';
  const mockGroupId = '123';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIRECTUS_ADMIN_TOKEN = 'admin-token';
  });

  describe('publishClip', () => {
    it('should successfully publish a clip via clips API', async () => {
      // 1. Mock Content
      vi.mocked(directusApi.get).mockResolvedValueOnce({
        data: { data: { id: mockContentId, campaign_id: 'camp-1', video_url: 'http://s3/v.mp4' } }
      });

      // 2. Mock VK Settings
      vi.mocked(directusApi.get).mockResolvedValueOnce({
        data: { data: { social_settings: { vk: { groupId: mockGroupId, token: mockVKToken } } } }
      });

      // 3. Mock clips.getUploadServer
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { response: { upload_url: 'http://vk.upload/clip' } }
      });

      // 4. Mock Video Download
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: Buffer.from('fake-video-data')
      });

      // 5. Mock Video Upload
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { video_id: 'vid-999', clip_id: 'clip-999' }
      });

      // 6. Mock clips.save
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { response: { id: 'clip-999', owner_id: 'owner-123' } }
      });

      // 7. Mock Directus status update
      vi.mocked(directusApi.get).mockResolvedValueOnce({ data: { data: {} } });
      vi.mocked(directusApi.patch).mockResolvedValueOnce({ data: {} });

      const result = await vkClipsService.publishClip(mockContentId, mockAuthToken);

      expect(result.success).toBe(true);
      expect(result.videoId).toBe('clip-999');
      expect(result.videoUrl).toBe('https://vk.com/clipowner-123_clip-999');
    });

    it('should fallback to video.save if clips API is unavailable', async () => {
      vi.mocked(directusApi.get).mockResolvedValueOnce({
        data: { data: { id: mockContentId, campaign_id: 'camp-1', video_url: 'http://s3/v.mp4' } }
      });
      vi.mocked(directusApi.get).mockResolvedValueOnce({
        data: { data: { social_settings: { vk: { groupId: mockGroupId, token: mockVKToken } } } }
      });

      // Mock clips.getUploadServer failure (e.g. Unknown method)
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { error: { error_code: 3, error_msg: 'Unknown method' } }
      });

      // Mock video.save (fallback)
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { response: { upload_url: 'http://vk.upload/video', video_id: 'v-fallback', owner_id: 'o-fallback' } }
      });

      // Mock Download
      vi.mocked(axios.get).mockResolvedValueOnce({ data: Buffer.from('v') });

      // Mock Upload
      vi.mocked(axios.post).mockResolvedValueOnce({ data: {} });

      // Mock Update status
      vi.mocked(directusApi.get).mockResolvedValueOnce({ data: { data: {} } });
      vi.mocked(directusApi.patch).mockResolvedValueOnce({ data: {} });

      const result = await vkClipsService.publishClip(mockContentId, mockAuthToken);

      expect(result.success).toBe(true);
      expect(result.videoId).toBe('v-fallback');
      expect(result.videoUrl).toBe('https://vk.com/videoo-fallback_v-fallback');
    });
  });
});

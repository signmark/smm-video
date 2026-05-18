import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { tiktokService } from '../services/social-platforms/tiktok-service';

vi.mock('axios');

describe('TikTokService', () => {
  const mockAccessToken = 'tiktok-token';
  const mockVideoUrl = 'https://s3.test/v.mp4';
  const mockCaption = 'Best video ever #cool';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initVideoPostFromUrl', () => {
    it('should return error if videoUrl is missing', async () => {
      const result = await tiktokService.initVideoPostFromUrl({ accessToken: mockAccessToken, caption: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('videoUrl is required');
    });

    it('should successfully initiate video post', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          error: { code: 'ok' },
          data: { publish_id: 'pub-123' }
        }
      });

      const result = await tiktokService.initVideoPostFromUrl({
        accessToken: mockAccessToken,
        videoUrl: mockVideoUrl,
        caption: mockCaption
      });

      expect(result.success).toBe(true);
      expect(result.publishId).toBe('pub-123');
      expect(result.status).toBe('PROCESSING');
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/post/publish/video/init/'),
        expect.objectContaining({
          source_info: { source: 'PULL_FROM_URL', video_url: mockVideoUrl }
        }),
        expect.any(Object)
      );
    });

    it('should handle API error codes', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          error: { code: 'spam_risk', message: 'Too many posts' }
        }
      });

      const result = await tiktokService.initVideoPostFromUrl({
        accessToken: mockAccessToken,
        videoUrl: mockVideoUrl,
        caption: mockCaption
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Too many posts');
    });
  });

  describe('checkPublishStatus', () => {
    it('should return PUBLISHED when status is PUBLISH_COMPLETE', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          error: { code: 'ok' },
          data: { 
            status: 'PUBLISH_COMPLETE',
            publicaly_available_post_id: ['post-999']
          }
        }
      });

      const result = await tiktokService.checkPublishStatus(mockAccessToken, 'pub-123');

      expect(result.success).toBe(true);
      expect(result.status).toBe('PUBLISHED');
      expect(result.postId).toBe('post-999');
    });

    it('should return FAILED when status is FAILED', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          error: { code: 'ok' },
          data: { status: 'FAILED' }
        }
      });

      const result = await tiktokService.checkPublishStatus(mockAccessToken, 'pub-123');

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
    });
  });

  describe('uploadToDraft', () => {
    it('should initiate draft upload', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          error: { code: 'ok' },
          data: { publish_id: 'draft-123' }
        }
      });

      const result = await tiktokService.uploadToDraft({
        accessToken: mockAccessToken,
        videoUrl: mockVideoUrl,
        caption: mockCaption
      });

      expect(result.success).toBe(true);
      expect(result.publishId).toBe('draft-123');
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/post/publish/inbox/video/init/'),
        expect.any(Object),
        expect.any(Object)
      );
    });
  });
});

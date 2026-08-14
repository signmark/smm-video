import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatVkErrorMessage } from '../utils/vk-error';

// Shared mock functions
const mockAxiosPost = vi.fn();
const mockAxiosGet = vi.fn();

vi.mock('axios', () => ({
  default: {
    post: (...args: any[]) => mockAxiosPost(...args),
    get: (...args: any[]) => mockAxiosGet(...args),
    create: vi.fn(() => ({
      post: (...args: any[]) => mockAxiosPost(...args),
      get: (...args: any[]) => mockAxiosGet(...args),
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    })),
  },
}));

// Mock directus
const mockGetContent = vi.fn();
const mockGetVKSettings = vi.fn();

vi.mock('../directus', () => ({
  directusApi: {
    getCampaign: vi.fn(),
    updateCampaign: vi.fn(),
    getContent: (...args: any[]) => mockGetContent(...args),
  },
}));

describe('AI-110 VK Error Formatting', () => {
  describe('formatVkErrorMessage', () => {
    it('should use error_msg when present', () => {
      const result = formatVkErrorMessage('photos.getWallUploadServer', {
        error_msg: 'Access denied',
        error_code: 15,
      });
      expect(result).toBe('photos.getWallUploadServer: Access denied');
      expect(result).not.toContain('JSON.stringify');
      expect(result).not.toContain('{"error');
    });

    it('should fall back to message when error_msg absent', () => {
      const result = formatVkErrorMessage('photos.saveWallPhoto', {
        message: 'Internal server error',
      });
      expect(result).toBe('photos.saveWallPhoto: Internal server error');
    });

    it('should use fallback message when no msg fields present', () => {
      const result = formatVkErrorMessage('VK Stories Upload', {
        error_code: 5,
      });
      expect(result).toBe('VK Stories Upload: Unknown VK error');
    });
  });

  describe('VK Service throw sites — real paths', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('site 1: vk-service photos.getWallUploadServer — error_msg preserved, no raw JSON', async () => {
      const vkError = { error_msg: 'Access denied: token required', error_code: 5 };
      mockAxiosPost.mockResolvedValueOnce({
        data: { error: vkError },
        status: 200,
      });

      const { vkService } = await import('../services/social-platforms/vk-service');
      const result = await vkService.publishPost(
        { token: 'test', groupId: '123' },
        { text: 'test', imageUrl: 'http://example.com/img.jpg' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Access denied: token required');
      expect(result.error).not.toContain('{"error');
      expect(result.error).not.toContain('"error_msg"');
      expect(result.error).not.toContain('"error_code"');
    });

    it('site 2: vk-service photos.saveWallPhoto — error_msg preserved, no raw JSON', async () => {
      // getWallUploadServer succeeds
      mockAxiosPost.mockResolvedValueOnce({
        data: { response: { upload_url: 'http://upload.vk.com' } },
        status: 200,
      });

      // Image download
      mockAxiosGet.mockResolvedValueOnce({
        data: Buffer.from('fake-image'),
        headers: { 'content-type': 'image/jpeg' },
      });

      // Upload server succeeds
      mockAxiosPost.mockResolvedValueOnce({
        data: { photo: 'data', server: 123, hash: 'abc' },
      });

      // saveWallPhoto fails
      const vkError = { error_msg: 'Permission denied for group', error_code: 7 };
      mockAxiosPost.mockResolvedValueOnce({
        data: { error: vkError },
        status: 200,
      });

      const { vkService } = await import('../services/social-platforms/vk-service');
      const result = await vkService.publishPost(
        { token: 'test', groupId: '123' },
        { text: 'test', imageUrl: 'http://example.com/img.jpg' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied for group');
      expect(result.error).not.toContain('{"error');
      expect(result.error).not.toContain('"error_msg"');
    });

    it('site 3: vk-stories upload — error_msg preserved, no raw JSON', async () => {
      const { vkStoriesService } = await import('../services/social-platforms/vk-stories-service');
      
      // Reset mocks
      mockAxiosPost.mockReset();
      
      // uploadMedia calls axios.post once — return error
      const vkError = { error_msg: 'Service temporarily unavailable', error_code: 10 };
      mockAxiosPost.mockResolvedValueOnce({
        data: { error: vkError },
        status: 200,
      });
      
      // Access private uploadMedia through prototype
      const uploadMedia = (vkStoriesService as any).uploadMedia.bind(vkStoriesService);
      
      try {
        await uploadMedia('http://upload.vk.com/stories', Buffer.from('fake-story'), false);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('VK Stories Upload');
        expect(err.message).toContain('Service temporarily unavailable');
        expect(err.message).not.toContain('{"error');
        expect(err.message).not.toContain('"error_msg"');
        expect(err.code).toBe(10);
      }
    });

    it('site 4: vk-clips upload — error_msg preserved, no raw JSON', async () => {
      const { vkClipsService } = await import('../services/social-platforms/vk-clips-service');
      
      // Reset mocks
      mockAxiosPost.mockReset();
      
      // uploadVideoToClips (axios.post) - returns error
      const vkError = { error_msg: 'Invalid request: bad video format', error_code: 100 };
      mockAxiosPost.mockResolvedValueOnce({
        data: { error: vkError },
        status: 200,
      });
      
      // Access private uploadVideoToClips through prototype
      const uploadVideoToClips = (vkClipsService as any).uploadVideoToClips.bind(vkClipsService);
      
      try {
        await uploadVideoToClips('http://upload.vk.com/clips', Buffer.from('fake-video'));
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('VK Clips Upload');
        expect(err.message).toContain('Invalid request: bad video format');
        expect(err.message).not.toContain('{"error');
        expect(err.message).not.toContain('"error_msg"');
        expect(err.code).toBe(100);
      }
    });

    it('mutation red: revert site 1 throw → raw JSON leaks when error_msg absent', async () => {
      // Test with error_msg ABSENT - old code would use JSON.stringify
      // New code uses formatVkErrorMessage which returns human-readable text
      const vkError = { error_code: 5 }; // no error_msg, no message
      mockAxiosPost.mockResolvedValueOnce({
        data: { error: vkError },
        status: 200,
      });

      const { vkService } = await import('../services/social-platforms/vk-service');
      const result = await vkService.publishPost(
        { token: 'test', groupId: '123' },
        { text: 'test', imageUrl: 'http://example.com/img.jpg' }
      );

      // With our fix: message contains 'Unknown VK error' (from formatVkErrorMessage)
      // With reverted code: message would contain '{"error_code":5}' (raw JSON)
      expect(result.error).toContain('Unknown VK error');
      expect(result.error).not.toContain('{"error_code"');
    });
  });
});

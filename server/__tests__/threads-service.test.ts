import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn()
  }
}));
vi.mock('../utils/logger');

import { threadsService } from '../services/social-platforms/threads-service';
import axios from 'axios';

const mockSettings = {
  appId: 'app-123',
  appSecret: 'secret-abc',
  accessToken: 'token-xyz',
  threadsUserId: 'user-999',
  username: 'testuser'
};

describe('ThreadsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── validateToken ───────────────────────────────────────────────────────────

  describe('validateToken', () => {
    it('should return invalid if accessToken is missing', async () => {
      const result = await threadsService.validateToken({});
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Токен отсутствует');
    });

    it('should return valid with username on success', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { id: 'user-999', username: 'testuser' }
      });
      const result = await threadsService.validateToken(mockSettings);
      expect(result.isValid).toBe(true);
      expect(result.username).toBe('testuser');
    });

    it('should return pendingReview=true on permission/review error', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce({
        response: { data: { error: { message: 'threads_basic permission required for app review' } } }
      });
      const result = await threadsService.validateToken(mockSettings);
      expect(result.isValid).toBe(true);
      expect(result.pendingReview).toBe(true);
    });

    it('should return invalid on generic API error', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce({
        response: { data: { error: { message: 'Invalid OAuth access token' } } }
      });
      const result = await threadsService.validateToken(mockSettings);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid OAuth access token');
    });
  });

  // ─── getUserId ───────────────────────────────────────────────────────────────

  describe('getUserId', () => {
    it('should return id and username', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { id: 'user-999', username: 'testuser' }
      });
      const result = await threadsService.getUserId('token-xyz');
      expect(result.id).toBe('user-999');
      expect(result.username).toBe('testuser');
    });

    it('should propagate errors', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'));
      await expect(threadsService.getUserId('bad-token')).rejects.toThrow('Network error');
    });
  });

  // ─── getLongLivedToken ───────────────────────────────────────────────────────

  describe('getLongLivedToken', () => {
    it('should return long-lived token on success', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { access_token: 'long-lived-token-abc' }
      });
      const result = await threadsService.getLongLivedToken('short-token', 'app-id', 'app-secret');
      expect(result).toBe('long-lived-token-abc');
    });

    it('should fall back to short-lived token on API error', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce({
        response: { status: 400, data: { error: 'bad request' } }
      });
      const result = await threadsService.getLongLivedToken('short-token', 'app-id', 'app-secret');
      expect(result).toBe('short-token');
    });
  });

  // ─── exchangeCodeForToken ────────────────────────────────────────────────────

  describe('exchangeCodeForToken', () => {
    it('should return access_token and user_id on success', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { access_token: 'access-tok', user_id: 12345 }
      });
      const result = await threadsService.exchangeCodeForToken('auth-code', 'app-id', 'app-secret', 'https://redirect.uri');
      expect(result.access_token).toBe('access-tok');
      expect(result.user_id).toBe('12345');
    });

    it('should throw on API error', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce({
        response: { status: 400, data: { error: 'invalid_code' } }
      });
      await expect(
        threadsService.exchangeCodeForToken('bad-code', 'app-id', 'app-secret', 'https://redirect.uri')
      ).rejects.toBeDefined();
    });
  });

  // ─── publishPost ─────────────────────────────────────────────────────────────

  describe('publishPost', () => {
    beforeEach(() => {
      // Сбрасываем очереди once-моков, чтобы не утекали между тестами
      vi.mocked(axios.post).mockReset();
      vi.mocked(axios.get).mockReset();
      // Fake timers нужны для обхода 3-секундной паузы (Threads eventual consistency)
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('should publish a TEXT post successfully', async () => {
      vi.mocked(axios.post)
        .mockResolvedValueOnce({ data: { id: 'container-111' } })
        .mockResolvedValueOnce({ data: { id: 'post-222' } });

      const publishPromise = threadsService.publishPost(mockSettings, { text: 'Hello Threads!' });
      await vi.runAllTimersAsync();
      const result = await publishPromise;

      expect(result.success).toBe(true);
      expect(result.postId).toBe('post-222');
      expect(result.postUrl).toContain('testuser');
      expect(result.postUrl).toContain('post-222');
    });

    it('should publish an IMAGE post successfully', async () => {
      vi.mocked(axios.post)
        .mockResolvedValueOnce({ data: { id: 'container-333' } })
        .mockResolvedValueOnce({ data: { id: 'post-444' } });

      const publishPromise = threadsService.publishPost(mockSettings, {
        text: 'Check this out!',
        imageUrl: 'https://example.com/image.jpg'
      });
      await vi.runAllTimersAsync();
      const result = await publishPromise;

      expect(result.success).toBe(true);
      expect(result.postId).toBe('post-444');
      const firstCall = vi.mocked(axios.post).mock.calls[0];
      expect(firstCall[2]).toMatchObject({ params: expect.objectContaining({ media_type: 'IMAGE' }) });
    });

    it('should create VIDEO container with correct media_type and publish', async () => {
      // VIDEO flow вызывает: axios.get (refreshLongLivedToken), axios.get (скачать видео),
      // axios.post (Cloudinary), axios.post (контейнер), axios.get (polling),
      // axios.post (publish), axios.get (permalink)
      const fakeVideo = Buffer.from('fake-video-data');

      vi.mocked(axios.get)
        // 0. refreshLongLivedToken → no access_token → returns original token
        .mockResolvedValueOnce({ data: {} })
        // 1. скачать видео (proxyVideoForThreads)
        .mockResolvedValueOnce({ data: fakeVideo, headers: { 'content-type': 'video/mp4' } })
        // 2. polling status → FINISHED
        .mockResolvedValueOnce({ data: { status: 'FINISHED' } })
        // 3. permalink fetch
        .mockResolvedValueOnce({ data: {} });

      vi.mocked(axios.post)
        // 1. Cloudinary upload → fail (нет secure_url, fallback на original URL)
        .mockResolvedValueOnce({ data: {} })
        // 2. Threads container creation
        .mockResolvedValueOnce({ data: { id: 'container-555' } })
        // 3. Threads publish
        .mockResolvedValueOnce({ data: { id: 'post-666' } });

      const publishPromise = threadsService.publishPost(mockSettings, {
        text: 'Watch this!',
        videoUrl: 'https://example.com/video.mp4'
      });
      const [result] = await Promise.all([publishPromise, vi.runAllTimersAsync()]);

      // Контейнер должен быть создан с media_type: VIDEO
      const containerCall = vi.mocked(axios.post).mock.calls[1]; // call #2 = container creation
      expect(containerCall[2]).toMatchObject({ params: expect.objectContaining({ media_type: 'VIDEO' }) });
      expect(result.success).toBe(true);
      expect(result.postId).toBe('post-666');
    });

    it('should fail if VIDEO container polling times out', async () => {
      // VIDEO flow: refreshLongLivedToken → скачать видео → Cloudinary fail → контейнер → polling (всегда IN_PROGRESS)
      const fakeVideo = Buffer.from('fake');

      vi.mocked(axios.get)
        // 0. refreshLongLivedToken → no access_token → returns original token
        .mockResolvedValueOnce({ data: {} })
        // 1. скачать видео
        .mockResolvedValueOnce({ data: fakeVideo, headers: { 'content-type': 'video/mp4' } })
        // 2-16. polling — всегда IN_PROGRESS (15 попыток)
        .mockResolvedValue({ data: { status: 'IN_PROGRESS' } });

      vi.mocked(axios.post)
        // 1. Cloudinary fail
        .mockResolvedValueOnce({ data: {} })
        // 2. container creation
        .mockResolvedValueOnce({ data: { id: 'container-555' } });

      const publishPromise = threadsService.publishPost(mockSettings, {
        text: 'Video timeout test',
        videoUrl: 'https://example.com/video.mp4'
      });
      const [result] = await Promise.all([publishPromise, vi.runAllTimersAsync()]);

      expect(result.success).toBe(false);
      expect(result.error).toContain('FINISHED in time');
    });

    it('should return error if container ID is missing', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: {} });

      const publishPromise = threadsService.publishPost(mockSettings, { text: 'Test' });
      await vi.runAllTimersAsync();
      const result = await publishPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('контейнера');
    });

    it('should return error on API failure', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce({
        response: { data: { error: { message: 'Rate limit exceeded' } } }
      });
      const publishPromise = threadsService.publishPost(mockSettings, { text: 'Test' });
      await vi.runAllTimersAsync();
      const result = await publishPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Rate limit exceeded');
    });

    it('should strip HTML tags and truncate text over 500 chars', async () => {
      vi.mocked(axios.post)
        .mockResolvedValueOnce({ data: { id: 'c-1' } })
        .mockResolvedValueOnce({ data: { id: 'p-1' } });

      const longHtmlText = '<b>' + 'A'.repeat(600) + '</b>';
      const publishPromise = threadsService.publishPost(mockSettings, { text: longHtmlText });
      await vi.runAllTimersAsync();
      await publishPromise;

      const firstCall = vi.mocked(axios.post).mock.calls[0];
      const sentText = firstCall[2]?.params?.text as string;
      expect(sentText).not.toContain('<b>');
      expect(sentText.length).toBeLessThanOrEqual(500);
      expect(sentText.endsWith('...')).toBe(true);
    });

    it('should decode HTML entities in text', async () => {
      vi.mocked(axios.post)
        .mockResolvedValueOnce({ data: { id: 'c-1' } })
        .mockResolvedValueOnce({ data: { id: 'p-1' } });

      const publishPromise = threadsService.publishPost(mockSettings, { text: 'Hello &amp; World &mdash; test' });
      await vi.runAllTimersAsync();
      await publishPromise;

      const firstCall = vi.mocked(axios.post).mock.calls[0];
      const sentText = firstCall[2]?.params?.text as string;
      expect(sentText).toBe('Hello & World — test');
    });

    it('should use threadsUserId as fallback in postUrl when username missing', async () => {
      vi.mocked(axios.post)
        .mockResolvedValueOnce({ data: { id: 'c-1' } })
        .mockResolvedValueOnce({ data: { id: 'p-777' } });

      const settingsNoUsername = { ...mockSettings, username: undefined };
      const publishPromise = threadsService.publishPost(settingsNoUsername, { text: 'Test' });
      await vi.runAllTimersAsync();
      const result = await publishPromise;

      expect(result.postUrl).toContain('user-999');
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: {
    create: vi.fn().mockReturnValue({
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() }
      },
      get: vi.fn(),
      post: vi.fn()
    }),
    get: vi.fn(),
    post: vi.fn()
  }
}));
vi.mock('../services/api-keys', () => ({
  apiKeyService: { getApiKey: vi.fn() },
  ApiServiceName: { DEEPSEEK: 'deepseek' }
}));
vi.mock('../utils/logger');

import axios from 'axios';
import { DeepSeekService } from '../services/deepseek';

const mockApiKey = 'test-deepseek-key';

const mockSuccessResponse = (content: string) => ({
  data: {
    choices: [{ message: { content } }]
  }
});

describe('DeepSeekService', () => {
  let service: DeepSeekService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DeepSeekService({ apiKey: mockApiKey });
  });

  // ─── hasApiKey ───────────────────────────────────────────────────────────────

  describe('hasApiKey', () => {
    it('should return true when API key is set', () => {
      expect(service.hasApiKey()).toBe(true);
    });

    it('should return false when API key is empty', () => {
      const empty = new DeepSeekService({ apiKey: '' });
      expect(empty.hasApiKey()).toBe(false);
    });

    it('should return false when API key is whitespace', () => {
      const ws = new DeepSeekService({ apiKey: '   ' });
      expect(ws.hasApiKey()).toBe(false);
    });
  });

  // ─── updateApiKey ────────────────────────────────────────────────────────────

  describe('updateApiKey', () => {
    it('should update API key', () => {
      const empty = new DeepSeekService({ apiKey: '' });
      expect(empty.hasApiKey()).toBe(false);
      empty.updateApiKey('new-key');
      expect(empty.hasApiKey()).toBe(true);
    });

    it('should not update with empty string', () => {
      service.updateApiKey('');
      expect(service.hasApiKey()).toBe(true); // Original key preserved
    });
  });

  // ─── generateText (string prompt) ────────────────────────────────────────────

  describe('generateText with string prompt', () => {
    it('should generate text from a string prompt', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(mockSuccessResponse('Hello World'));
      const result = await service.generateText('Say hello');
      expect(result).toBe('Hello World');
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/chat/completions'),
        expect.objectContaining({
          messages: [{ role: 'user', content: 'Say hello' }],
          temperature: 0.7
        }),
        expect.any(Object)
      );
    });

    it('should strip leading/trailing --- from response', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(mockSuccessResponse('---\nClean content\n---'));
      const result = await service.generateText('test');
      expect(result).toBe('Clean content');
    });

    it('should throw if API key is not set', async () => {
      const empty = new DeepSeekService({ apiKey: '' });
      await expect(empty.generateText('test')).rejects.toThrow('DeepSeek API ключ не установлен');
    });

    it('should throw on invalid response format', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { choices: [] } });
      await expect(service.generateText('test')).rejects.toThrow('Некорректный ответ от DeepSeek API');
    });

    it('should throw on invalid API key (401)', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce({
        response: {
          status: 401,
          data: { error: { message: 'Invalid API key' } }
        }
      });
      await expect(service.generateText('test')).rejects.toThrow('Недействительный API ключ DeepSeek');
    });

    it('should throw on auth error (403)', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce({
        response: {
          status: 403,
          data: { error: { message: 'authentication failed' } }
        }
      });
      await expect(service.generateText('test')).rejects.toThrow('Недействительный API ключ DeepSeek');
    });
  });

  // ─── generateText (messages array) ───────────────────────────────────────────

  describe('generateText with messages array', () => {
    it('should generate text from messages array with lower temperature', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(mockSuccessResponse('Response'));
      const messages = [
        { role: 'system' as const, content: 'You are helpful' },
        { role: 'user' as const, content: 'Hello' }
      ];
      const result = await service.generateText(messages);
      expect(result).toBe('Response');
      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ temperature: 0.3 }),
        expect.any(Object)
      );
    });
  });

  // ─── generateSocialContent ───────────────────────────────────────────────────

  describe('generateSocialContent', () => {
    it('should generate instagram content', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(mockSuccessResponse('Great instagram post!'));
      const result = await service.generateSocialContent(['brand', 'style'], ['fashion'], 'instagram');
      expect(result).toBe('Great instagram post!');
      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ temperature: 0.7 }),
        expect.any(Object)
      );
    });

    it('should generate telegram content', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(mockSuccessResponse('Telegram post'));
      const result = await service.generateSocialContent(['news'], ['breaking'], 'telegram');
      expect(result).toBe('Telegram post');
    });

    it('should respect length options (short)', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(mockSuccessResponse('Short'));
      await service.generateSocialContent(['k'], ['t'], 'vk', { length: 'short' });
      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ max_tokens: 600 }),
        expect.any(Object)
      );
    });

    it('should respect length options (long)', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(mockSuccessResponse('Long content'));
      await service.generateSocialContent(['k'], ['t'], 'vk', { length: 'long' });
      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ max_tokens: 1500 }),
        expect.any(Object)
      );
    });

    it('should throw on API error', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce(new Error('Network failure'));
      await expect(service.generateSocialContent(['k'], ['t'], 'vk')).rejects.toThrow();
    });
  });

  // ─── generateImagePrompt ─────────────────────────────────────────────────────

  describe('generateImagePrompt', () => {
    it('should return image prompt in English', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(mockSuccessResponse('A beautiful sunset over mountains, 4k, masterpiece'));
      const result = await service.generateImagePrompt('Красивый закат над горами');
      expect(result).toBe('A beautiful sunset over mountains, 4k, masterpiece');
    });

    it('should strip wrapping quotes from result', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(mockSuccessResponse('"A clean prompt"'));
      const result = await service.generateImagePrompt('test');
      expect(result).toBe('A clean prompt');
    });

    it('should strip HTML from content', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(mockSuccessResponse('clean prompt'));
      await service.generateImagePrompt('<p>Контент с тегами</p>');
      const call = vi.mocked(axios.post).mock.calls[0];
      const messages = (call[1] as any).messages;
      const userContent = messages.find((m: any) => m.role === 'user').content;
      expect(userContent).not.toContain('<p>');
    });

    it('should include keywords in prompt', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(mockSuccessResponse('prompt'));
      await service.generateImagePrompt('Content', ['luxury', 'fashion']);
      const call = vi.mocked(axios.post).mock.calls[0];
      const messages = (call[1] as any).messages;
      const userContent = messages.find((m: any) => m.role === 'user').content;
      expect(userContent).toContain('luxury');
      expect(userContent).toContain('fashion');
    });

    it('should throw on error', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce(new Error('API down'));
      await expect(service.generateImagePrompt('test')).rejects.toThrow('Не удалось сгенерировать промт');
    });
  });

  // ─── generateKeywordsForUrl ───────────────────────────────────────────────────

  describe('generateKeywordsForUrl', () => {
    it('should return parsed keywords array', async () => {
      const keywords = [
        { keyword: 'онлайн курсы python', trend: 5000, competition: 60 },
        { keyword: 'обучение программированию', trend: 3000, competition: 55 }
      ];
      vi.mocked(axios.post).mockResolvedValueOnce(mockSuccessResponse(JSON.stringify(keywords)));
      const result = await service.generateKeywordsForUrl('https://example.com', 'Python courses', 'req-1');
      expect(result).toHaveLength(2);
      expect(result[0].keyword).toBe('онлайн курсы python');
    });

    it('should extract JSON from mixed text response', async () => {
      const mixed = 'Here are keywords:\n[{"keyword": "тест курсы", "trend": 1000, "competition": 50}]';
      vi.mocked(axios.post).mockResolvedValueOnce(mockSuccessResponse(mixed));
      const result = await service.generateKeywordsForUrl('https://example.com', 'content', 'req-2');
      expect(result).toHaveLength(1);
    });

    it('should filter out keywords shorter than 5 chars', async () => {
      const keywords = [
        { keyword: 'ab', trend: 1000, competition: 50 },
        { keyword: 'valid keyword here', trend: 2000, competition: 40 }
      ];
      vi.mocked(axios.post).mockResolvedValueOnce(mockSuccessResponse(JSON.stringify(keywords)));
      const result = await service.generateKeywordsForUrl('https://example.com', 'content', 'req-3');
      expect(result.every(k => k.keyword.length >= 5)).toBe(true);
    });

    it('should return empty array on API error', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce(new Error('API error'));
      const result = await service.generateKeywordsForUrl('https://example.com', 'content', 'req-4');
      expect(result).toEqual([]);
    });

    it('should normalize keywords to lowercase', async () => {
      const keywords = [{ keyword: 'UPPERCASE KEYWORD TEST', trend: 1000, competition: 50 }];
      vi.mocked(axios.post).mockResolvedValueOnce(mockSuccessResponse(JSON.stringify(keywords)));
      const result = await service.generateKeywordsForUrl('https://example.com', 'content', 'req-5');
      expect(result[0].keyword).toBe('uppercase keyword test');
    });
  });
});

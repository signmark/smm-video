import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn()
  }
}));
vi.mock('../utils/logger');

import { telegramService } from '../services/social-platforms/telegram-service';
import axios from 'axios';

const mockSettings = {
  token: 'bot123:AABBCCDDEEFFaabbccddeeff',
  chatId: '@test_channel'
};

describe('TelegramService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── publishPost: валидация ──────────────────────────────────────────────────

  describe('publishPost — отсутствие настроек', () => {
    it('возвращает ошибку если token пустой', async () => {
      const result = await telegramService.publishPost(
        { token: '', chatId: '@test' },
        { text: 'Test' }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('token');
    });

    it('возвращает ошибку если chatId пустой', async () => {
      const result = await telegramService.publishPost(
        { token: 'bot123:xxx', chatId: '' },
        { text: 'Test' }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('chatId');
    });
  });

  // ─── publishPost: текст ──────────────────────────────────────────────────────

  describe('publishPost — текстовый контент', () => {
    it('публикует простой текст через sendMessage', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { ok: true, result: { message_id: 42 } }
      });

      const result = await telegramService.publishPost(mockSettings, {
        text: 'Привет мир!'
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe(42);
      expect(result.postUrl).toContain('t.me');
      expect(result.postUrl).toContain('42');

      const call = vi.mocked(axios.post).mock.calls[0];
      expect(call[0]).toContain('/sendMessage');
      expect(call[1]).toMatchObject({ chat_id: '@test_channel', parse_mode: 'HTML' });
    });

    it('конвертирует HTML-теги в разрешённый Telegram HTML', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { ok: true, result: { message_id: 10 } }
      });

      await telegramService.publishPost(mockSettings, {
        text: '<p><strong>Важно</strong> &amp; <em>курсив</em></p>'
      });

      const sentText: string = vi.mocked(axios.post).mock.calls[0][1].text;
      expect(sentText).toContain('<b>Важно</b>');
      expect(sentText).toContain('<i>курсив</i>');
      expect(sentText).toContain('&');
      expect(sentText).not.toContain('<p>');
      expect(sentText).not.toContain('<strong>');
    });

    it('декодирует HTML-сущности (&nbsp;, &mdash;, &ndash;)', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { ok: true, result: { message_id: 11 } }
      });

      await telegramService.publishPost(mockSettings, {
        text: 'Текст&nbsp;с&mdash;тире&ndash;и пробелом'
      });

      const sentText: string = vi.mocked(axios.post).mock.calls[0][1].text;
      expect(sentText).toContain(' ');
      expect(sentText).toContain('—');
      expect(sentText).toContain('–');
      expect(sentText).not.toContain('&nbsp;');
    });

    it('убирает лишние переносы строк (не более двух подряд)', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { ok: true, result: { message_id: 12 } }
      });

      await telegramService.publishPost(mockSettings, {
        text: '<p>Абзац 1</p><p>Абзац 2</p><p>Абзац 3</p>'
      });

      const sentText: string = vi.mocked(axios.post).mock.calls[0][1].text;
      expect(sentText).not.toMatch(/\n{3,}/);
    });

    it('формирует postUrl с username канала без @', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { ok: true, result: { message_id: 99 } }
      });

      const result = await telegramService.publishPost(mockSettings, { text: 'Test' });

      expect(result.postUrl).toBe('https://t.me/test_channel/99');
    });
  });

  // ─── publishPost: с изображением ────────────────────────────────────────────

  describe('publishPost — контент с изображением', () => {
    it('использует sendPhoto когда есть imageUrl', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: Buffer.from('img'),
        headers: { 'content-type': 'image/jpeg' }
      });
      vi.mocked(axios.post)
        .mockResolvedValueOnce({ data: { secure_url: 'https://cloudinary.example/img.jpg' } })
        .mockResolvedValueOnce({ data: { ok: true, result: { message_id: 55 } } });

      const result = await telegramService.publishPost(mockSettings, {
        text: 'Смотри картинку',
        imageUrl: 'https://s3.example.ru/image.jpg'
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe(55);

      const postCalls = vi.mocked(axios.post).mock.calls;
      const sendPhotoCall = postCalls.find(c => String(c[0]).includes('/sendPhoto'));
      expect(sendPhotoCall).toBeDefined();
      expect(sendPhotoCall![1]).toMatchObject({ parse_mode: 'HTML' });
    });

    it('использует оригинальный URL если Cloudinary недоступен', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'));
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { ok: true, result: { message_id: 56 } }
      });

      const result = await telegramService.publishPost(mockSettings, {
        text: 'Test',
        imageUrl: 'https://example.com/img.png'
      });

      expect(result.success).toBe(true);
      const sendPhotoCall = vi.mocked(axios.post).mock.calls.find(c =>
        String(c[0]).includes('/sendPhoto')
      );
      expect(sendPhotoCall![1].photo).toBe('https://example.com/img.png');
    });
  });

  // ─── publishPost: ошибки API ─────────────────────────────────────────────────

  describe('publishPost — ошибки API', () => {
    it('возвращает ошибку если Telegram API вернул ok=false', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { ok: false, description: 'Bad Request: chat not found' }
      });

      const result = await telegramService.publishPost(mockSettings, { text: 'Test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('chat not found');
    });

    it('возвращает ошибку при сетевом сбое', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce({
        response: { data: { description: 'Unauthorized' } }
      });

      const result = await telegramService.publishPost(mockSettings, { text: 'Test' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unauthorized');
    });
  });
});

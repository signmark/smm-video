import { describe, it, expect, vi, beforeEach } from 'vitest';

// AI-101 перевёл публикацию на `telegramAxios()` — а тот внутри зовёт
// `axios.create()`. Мок без `create` давал `axios.create is not a function`, и
// 11 тестов падали не из-за поведения сервиса, а из-за устаревшего двойника.
//
// Инстанс намеренно переиспользует ТЕ ЖЕ get/post, что и корневой axios:
// в одном сценарии публикации участвуют оба (загрузка в Cloudinary идёт мимо
// Telegram-инстанса), и тесты опираются на общий порядок вызовов.
vi.mock('axios', () => {
  const get = vi.fn();
  const post = vi.fn();
  const instance = { get, post };
  return {
    default: { get, post, create: vi.fn(() => instance) },
    __esModule: true,
  };
});
// telegramAxios резолвит A-записи api.telegram.org. В юнит-тесте настоящий DNS
// не нужен: он делает тест сетевым и медленным на ровном месте.
vi.mock('dns/promises', () => ({
  resolve4: vi.fn(async () => ['149.154.167.220']),
  default: { resolve4: vi.fn(async () => ['149.154.167.220']) },
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

    it('регрессия: экранированный HTML не воскрешает <p> («Unsupported start tag "p" at byte offset 0»)', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { ok: true, result: { message_id: 13 } }
      });

      const result = await telegramService.publishPost(mockSettings, {
        text: '&lt;p&gt;&lt;strong&gt;Акция!&lt;/strong&gt;&lt;/p&gt;&lt;p&gt;Скидки &lt; 50%&lt;/p&gt;&lt;ul&gt;&lt;li&gt;раз&lt;/li&gt;&lt;li&gt;два&lt;/li&gt;&lt;/ul&gt;'
      });

      expect(result.success).toBe(true);
      const sentText: string = vi.mocked(axios.post).mock.calls[0][1].text;
      expect(sentText).toContain('<b>Акция!</b>');
      expect(sentText).toContain('• раз');
      expect(sentText).toContain('• два');
      expect(sentText).toContain('&lt; 50%');
      // Ни одного неподдерживаемого тега в отправляемом тексте
      expect(sentText).not.toMatch(/<\/?(?:p|div|ul|ol|li|strong|em|span|h[1-6])\b/);
      expect(sentText.startsWith('<p>')).toBe(false);
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

    it('публикует основное и дополнительные изображения альбомом', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: Buffer.from('img'),
        headers: { 'content-type': 'image/jpeg' }
      });
      vi.mocked(axios.post)
        .mockResolvedValueOnce({ data: { secure_url: 'https://cloudinary.example/main.jpg' } })
        .mockResolvedValueOnce({ data: { secure_url: 'https://cloudinary.example/additional.jpg' } })
        .mockResolvedValueOnce({
          data: { ok: true, result: [{ message_id: 70 }, { message_id: 71 }] }
        })
        .mockResolvedValueOnce({ data: { ok: true, result: { message_id: 72 } } });

      const result = await telegramService.publishPost(mockSettings, {
        text: 'Длинный текст '.repeat(100),
        imageUrl: 'https://s3.example.ru/main.jpg',
        additionalImages: JSON.stringify([{ url: 'https://s3.example.ru/additional.jpg' }])
      });

      expect(result).toMatchObject({ success: true, messageId: 70 });

      const postCalls = vi.mocked(axios.post).mock.calls;
      const mediaGroupCall = postCalls.find(c => String(c[0]).includes('/sendMediaGroup'));
      expect(mediaGroupCall).toBeDefined();
      expect(mediaGroupCall![1].media).toHaveLength(2);
      expect(mediaGroupCall![1].media[0]).not.toHaveProperty('caption');

      const textCall = postCalls.find(c => String(c[0]).includes('/sendMessage'));
      expect(textCall![1]).toMatchObject({ reply_to_message_id: 70 });
      expect(postCalls.some(c => String(c[0]).includes('/sendPhoto'))).toBe(false);
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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const telegramHtmlMockState = vi.hoisted(() => ({ shouldThrow: false }));

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      post: vi.fn(),
    },
  };
});

vi.mock('../utils/logger', () => ({ log: vi.fn() }));

vi.mock('../utils/telegram-html', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/telegram-html')>();
  return {
    ...actual,
    toTelegramHtml: (content: string) => {
      if (telegramHtmlMockState.shouldThrow) throw new Error('boom');
      return actual.toTelegramHtml(content);
    },
  };
});

import axios from 'axios';
import { TelegramService } from '../services/social/telegram-service';

type LegacyTelegramSender = {
  sendTextMessageToTelegram(
    text: string,
    chatId: string,
    token: string,
  ): Promise<{ success: boolean }>;
};

describe('legacy Telegram formatting flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    telegramHtmlMockState.shouldThrow = false;
  });

  it('sends Telegram-safe HTML without a second tag-fixing pass', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      status: 200,
      data: { ok: true, result: { message_id: 42 } },
    });

    const service = new TelegramService();
    const sender = service as unknown as LegacyTelegramSender;
    const result = await sender.sendTextMessageToTelegram(
      '<div><strong>Важно</strong></div><ul><li>раз</li><li>два</li></ul>',
      '@test_channel',
      'bot-token',
    );

    expect(result.success).toBe(true);
    const sentText = vi.mocked(axios.post).mock.calls[0][1].text;
    expect(sentText).toContain('<b>Важно</b>');
    expect(sentText).toContain('• раз');
    expect(sentText).toContain('• два');
    expect(sentText).not.toMatch(/<\/?(?:p|div|ul|ol|li|strong|em)\b/);
  });

  it('falls back to plain text when toTelegramHtml throws', async () => {
    telegramHtmlMockState.shouldThrow = true;
    vi.mocked(axios.post).mockResolvedValueOnce({
      status: 200,
      data: { ok: true, result: { message_id: 43 } },
    });

    const service = new TelegramService();
    const sender = service as unknown as LegacyTelegramSender;
    const result = await sender.sendTextMessageToTelegram(
      '<p>Hello <b>world</b></p>',
      '@test_channel',
      'bot-token',
    );

    expect(result.success).toBe(true);
    expect(vi.mocked(axios.post).mock.calls[0][1].text).toBe('Hello world');
  });
});

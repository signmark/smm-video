import { beforeEach, describe, expect, it, vi } from 'vitest';

const telegramHtmlMockState = vi.hoisted(() => ({ shouldThrow: false }));

const tgClient = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  // AI-101 Phase 2A: отправка идёт через клиент из axios.create. Настоящий
  // create отдал бы живой инстанс с живым post, то есть тест ушёл бы в сеть.
  // Клиент отдельным объектом: голый axios.post остаётся свидетелем того, что
  // мимо транспорта не ушло ничего.
  const mocked: any = {
    ...actual.default,
    post: vi.fn(),
    // httpsAgent ставит только транспорт Telegram; остальным (Directus и
    // прочим) отдаём настоящий инстанс, иначе они остаются без interceptors.
    create: vi.fn((config: any) =>
      config && config.httpsAgent ? tgClient : actual.default.create(config),
    ),
  };
  return { ...actual, default: mocked };
});
// Транспорт спрашивает адреса у резолвера. Без мока прогон зависит от сети и от
// того, что именно резолвер сегодня отдаёт — то есть перестаёт быть прогоном.
vi.mock('dns/promises', () => ({
  resolve4: vi.fn(async () => ['149.154.167.220']),
  default: { resolve4: vi.fn(async () => ['149.154.167.220']) },
}));


vi.mock('../utils/logger', () => ({ log: Object.assign(vi.fn(), { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

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
    tgClient.post.mockResolvedValueOnce({
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
    expect(vi.mocked(axios.post)).not.toHaveBeenCalled(); // мимо транспорта не ушло
    const sentText = tgClient.post.mock.calls[0][1].text;
    expect(sentText).toContain('<b>Важно</b>');
    expect(sentText).toContain('• раз');
    expect(sentText).toContain('• два');
    expect(sentText).not.toMatch(/<\/?(?:p|div|ul|ol|li|strong|em)\b/);
  });

  it('falls back to plain text when toTelegramHtml throws', async () => {
    telegramHtmlMockState.shouldThrow = true;
    tgClient.post.mockResolvedValueOnce({
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
    expect(tgClient.post.mock.calls[0][1].text).toBe('Hello world');
  });
});

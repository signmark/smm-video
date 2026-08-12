/**
 * AI-106: sendVideoToTelegram returns human-readable errors, not raw JSON.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  log: Object.assign(vi.fn(), { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import axios from 'axios';
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

// AI-101 Phase 2A: отправка идёт через клиент из axios.create, а не через голый
// axios. Клиент — ОТДЕЛЬНЫЙ объект намеренно: тогда «ушло через транспорт»
// проверяемо, а не подразумевается. Вернуть отсюда сам мок значило бы сделать
// оба пути неотличимыми — ровно та ошибка, из-за которой перевод легко не
// заметить.
const tgClient = { post: vi.fn() } as any;
mockedAxios.create.mockReturnValue(tgClient);

// Транспорт спрашивает адреса у резолвера. Без мока прогон зависит от сети и от
// того, что именно резолвер сегодня отдаёт — то есть перестаёт быть прогоном.
vi.mock('dns/promises', () => ({
  resolve4: vi.fn(async () => ['149.154.167.220']),
  default: { resolve4: vi.fn(async () => ['149.154.167.220']) },
}));


vi.mock('../beget-s3-storage-aws', () => ({ begetS3StorageAws: {} }));
vi.mock('../beget-s3-video-service', () => ({
  begetS3VideoService: { uploadVideoFromUrl: vi.fn() },
}));

import { TelegramS3Integration } from '../services/social/telegram-s3-integration';

describe('AI-106: sendVideoToTelegram error messages', () => {
  let integration: InstanceType<typeof TelegramS3Integration>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.create.mockReturnValue(tgClient);
    integration = new TelegramS3Integration();
  });

  it('returns human-readable error when Telegram API returns error JSON', async () => {
    // beget-storage URL skips S3 upload entirely
    const begetUrl = 'https://s3.beget-storage.example/video.mp4';

    tgClient.post.mockResolvedValueOnce({
      data: { ok: false, error_code: 400, description: 'Bad Request: chat not found' },
      status: 400,
    });

    const result = await integration.sendVideoToTelegram(begetUrl, 'test-chat-id', 'test-token', {});

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // Ключевая проверка: ошибка должна быть человекочитаемой, а не JSON
    expect(result.error).not.toContain('{"ok":false');
    expect(result.error).not.toContain('"error_code"');
    expect(result.error).toContain('chat not found');
    // Мимо транспорта запрос не ушёл: голый axios.post не звали ни разу.
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockedAxios.create).toHaveBeenCalled();
    expect(result.error).toContain('400');
  });

  it('returns structured error for network failures', async () => {
    const begetUrl = 'https://s3.beget-storage.example/video.mp4';
    const networkError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    tgClient.post.mockRejectedValueOnce(networkError);

    const result = await integration.sendVideoToTelegram(begetUrl, 'test-chat-id', 'test-token', {});

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('ECONNREFUSED');
    // Не должен быть голый error.message
    expect(result.error).not.toBe('connect ECONNREFUSED');
  });

  it('handles errors with AggregateError (DNS failover exhaustion)', async () => {
    const begetUrl = 'https://s3.beget-storage.example/video.mp4';
    const aggError = Object.assign(new Error('Telegram: all 3 IPs unreachable'), {
      errors: [
        Object.assign(new Error('connect ETIMEDOUT 10.0.0.1'), { code: 'ETIMEDOUT' }),
        Object.assign(new Error('connect ECONNREFUSED 10.0.0.2'), { code: 'ECONNREFUSED' }),
      ],
    });
    tgClient.post.mockRejectedValueOnce(aggError);

    const result = await integration.sendVideoToTelegram(begetUrl, 'test-chat-id', 'test-token', {});

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('unreachable');
    expect(result.error).toContain('ETIMEDOUT');
  });
});

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
// AI-101 Phase 2A: отправка идёт через клиент из axios.create. Возвращаем из
// create тот же мок, чтобы подменённым остался ровно тот же шов — axios.post.
mockedAxios.create.mockReturnValue(mockedAxios as any);

vi.mock('../beget-s3-storage-aws', () => ({ begetS3StorageAws: {} }));
vi.mock('../beget-s3-video-service', () => ({
  begetS3VideoService: { uploadVideoFromUrl: vi.fn() },
}));

import { TelegramS3Integration } from '../services/social/telegram-s3-integration';

describe('AI-106: sendVideoToTelegram error messages', () => {
  let integration: InstanceType<typeof TelegramS3Integration>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.create.mockReturnValue(mockedAxios as any);
    integration = new TelegramS3Integration();
  });

  it('returns human-readable error when Telegram API returns error JSON', async () => {
    // beget-storage URL skips S3 upload entirely
    const begetUrl = 'https://s3.beget-storage.example/video.mp4';

    mockedAxios.post.mockResolvedValueOnce({
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
    expect(result.error).toContain('400');
  });

  it('returns structured error for network failures', async () => {
    const begetUrl = 'https://s3.beget-storage.example/video.mp4';
    const networkError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    mockedAxios.post.mockRejectedValueOnce(networkError);

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
    mockedAxios.post.mockRejectedValueOnce(aggError);

    const result = await integration.sendVideoToTelegram(begetUrl, 'test-chat-id', 'test-token', {});

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('unreachable');
    expect(result.error).toContain('ETIMEDOUT');
  });
});

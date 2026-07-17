import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../services/trend-collector', () => ({
  SCRAPER_BASE: 'http://analytics.test',
  getScraperApiKey: vi.fn().mockResolvedValue('test-key'),
}));

vi.mock('../utils/logger', () => ({
  log: Object.assign(vi.fn(), {
    warn: vi.fn(),
  }),
}));

import axios from 'axios';
import { log } from '../utils/logger';
import { getMonitoredChannels, refreshChannelMetrics } from '../services/scraper-analytics';

describe('scraper analytics client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SCRAPER_ANALYTICS_API_KEY;
    delete process.env.SCRAPER_API_KEY;
  });

  it('sends the documented bearer token and metrics-refresh query', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      status: 200,
      data: {
        status: 'completed',
        processed: 1,
        failed: 0,
        skipped: 0,
        duration_seconds: 0.5,
        errors: [],
      },
    });

    await refreshChannelMetrics({
      channels: [{ id: 'channel-uuid', platform: 'telegram', platform_channel_id: '@channel' }],
      days: 30,
      force: true,
    });

    expect(axios.post).toHaveBeenCalledWith(
      'http://analytics.test/api/v1/monitoring/scheduler/metrics-refresh',
      {},
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        params: {
          channel_ids: 'channel-uuid',
          days: 30,
          force: true,
        },
      }),
    );
  });

  it('surfaces authorization failures without exposing the key', async () => {
    vi.mocked(axios.post).mockRejectedValue({
      message: 'Request failed with status code 401',
      response: {
        status: 401,
        data: { detail: 'Invalid API key' },
      },
    });

    await expect(refreshChannelMetrics({
      channels: [{ id: 'channel-uuid', platform: 'vk', platform_channel_id: '123' }],
    })).rejects.toThrow('Analytics API отклонил ключ доступа (HTTP 401): Invalid API key');

    expect(log.warn).toHaveBeenCalledWith(
      'Analytics API отклонил ключ доступа (HTTP 401): Invalid API key',
      'analytics',
    );
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toContain('test-key');
  });

  it('can make channel lookup failures strict instead of returning a false empty list', async () => {
    vi.mocked(axios.get).mockRejectedValue({
      message: 'Request failed with status code 401',
      response: {
        status: 401,
        data: { detail: 'Invalid API key' },
      },
    });

    await expect(getMonitoredChannels({ page_size: 100 }, true))
      .rejects.toThrow('Analytics API отклонил ключ доступа (HTTP 401): Invalid API key');
  });

  it('retries channels separately when the batch refresh returns HTTP 500', async () => {
    vi.mocked(axios.post)
      .mockRejectedValueOnce({
        message: 'Request failed with status code 500',
        response: { status: 500, data: { detail: 'Internal Server Error' } },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          status: 'completed',
          processed: 3,
          failed: 0,
          skipped: 0,
          duration_seconds: 1,
          errors: [],
        },
      })
      .mockRejectedValueOnce({
        message: 'Request failed with status code 500',
        response: { status: 500, data: { detail: 'Internal Server Error' } },
      });

    const result = await refreshChannelMetrics({
      channels: [
        { id: 'telegram-uuid', platform: 'telegram', platform_channel_id: '@channel' },
        { id: 'vk-uuid', platform: 'vk', platform_channel_id: '123' },
      ],
      days: 7,
    });

    expect(axios.post).toHaveBeenCalledTimes(3);
    expect(vi.mocked(axios.post).mock.calls[1][2]).toEqual(expect.objectContaining({
      params: expect.objectContaining({ channel_ids: 'telegram-uuid' }),
    }));
    expect(vi.mocked(axios.post).mock.calls[2][2]).toEqual(expect.objectContaining({
      params: expect.objectContaining({ channel_ids: 'vk-uuid' }),
    }));
    expect(result).toEqual(expect.objectContaining({
      status: 'partial',
      processed: 3,
      failed: 1,
      errors: [
        expect.stringContaining('vk:123'),
      ],
    }));
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '"query":{"channel_ids":"telegram-uuid,vk-uuid","days":7,"force":true}',
      ),
      'analytics',
    );
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '"query":{"channel_ids":"vk-uuid","days":7,"force":true}',
      ),
      'analytics',
    );
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).toContain('Bearer [REDACTED]');
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toContain('test-key');
  });

  it('identifies the channel when a single-channel refresh fails', async () => {
    vi.mocked(axios.post).mockRejectedValue({
      message: 'Request failed with status code 500',
      response: { status: 500, data: { detail: 'Internal Server Error' } },
    });

    await expect(refreshChannelMetrics({
      channels: [
        { id: 'telegram-uuid', platform: 'telegram', platform_channel_id: '@channel' },
      ],
    })).rejects.toThrow(
      'Не удалось обновить telegram:@channel: Analytics API вернул HTTP 500',
    );
  });
});

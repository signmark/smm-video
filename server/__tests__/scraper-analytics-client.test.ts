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
import {
  ensureChannelsRegistered,
  getAllMonitoredChannels,
  getMonitoredChannels,
  getScraperCampaignChannels,
  forceParseChannel,
  refreshChannelMetrics,
} from '../services/scraper-analytics';

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
          channel_ids: ['channel-uuid'],
          days: 30,
          force: true,
        },
        paramsSerializer: { indexes: null },
      }),
    );
    expect(log.warn).toHaveBeenCalledWith(
      'scraper request={"method":"POST","url":"http://analytics.test/api/v1/monitoring/scheduler/metrics-refresh","headers":{"Content-Type":"application/json","Authorization":"Bearer [REDACTED]"},"query":{"channel_ids":["channel-uuid"],"days":30,"force":true},"body":{}}',
      'analytics',
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
      expect.stringContaining('Analytics API отклонил ключ доступа (HTTP 401): Invalid API key'),
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
    expect(log.warn).toHaveBeenCalledWith(
      'scraper request={"method":"GET","url":"http://analytics.test/api/v1/monitoring/channels","headers":{"Authorization":"Bearer [REDACTED]"},"query":{"page_size":100}}',
      'analytics',
    );
  });

  it('loads every page of monitored channels', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `channel-${index + 1}`,
      platform: 'telegram',
      platform_channel_id: `@channel_${index + 1}`,
    }));
    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        data: {
          items: firstPage,
          total: 101,
          page: 1,
          page_size: 100,
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [{
            id: 'channel-101',
            platform: 'vk',
            platform_channel_id: '101',
          }],
          total: 101,
          page: 2,
          page_size: 100,
        },
      });

    const result = await getAllMonitoredChannels(undefined, true);

    expect(result.items).toHaveLength(101);
    expect(axios.get).toHaveBeenNthCalledWith(
      1,
      'http://analytics.test/api/v1/monitoring/channels',
      expect.objectContaining({ params: { page: 1, page_size: 100 } }),
    );
    expect(axios.get).toHaveBeenNthCalledWith(
      2,
      'http://analytics.test/api/v1/monitoring/channels',
      expect.objectContaining({ params: { page: 2, page_size: 100 } }),
    );
  });

  it('does not start a duplicate force parse after channel registration', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        items: [],
        total: 0,
        page: 1,
        page_size: 100,
      },
    });
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        id: 'new-channel-id',
        platform: 'telegram',
        platform_channel_id: '@new_channel',
      },
    });

    const result = await ensureChannelsRegistered([
      { platform: 'telegram', id: '@new_channel' },
    ]);

    expect(result.get('telegram:@new_channel')).toBe('new-channel-id');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith(
      'http://analytics.test/api/v1/monitoring/channels',
      {
        platform: 'telegram',
        platform_channel_id: '@new_channel',
        name: undefined,
      },
      expect.any(Object),
    );
  });

  it('uses only a public Telegram username for scraper analytics', () => {
    expect(getScraperCampaignChannels({
      telegram: { chatId: '@public_channel' },
      vk: { groupId: '228626989' },
    })).toEqual([
      { platform: 'telegram', id: '@public_channel', name: undefined },
      { platform: 'vk', id: '228626989', name: undefined },
    ]);

    expect(getScraperCampaignChannels({
      telegram: { chatId: '-1001234567890', username: 'public_channel' },
    })).toEqual([
      { platform: 'telegram', id: '@public_channel', name: undefined },
    ]);

    expect(getScraperCampaignChannels({
      telegram: { chatId: '-1001234567890' },
    })).toEqual([]);

    expect(getScraperCampaignChannels({
      telegram: { chatId: '@public_channel' },
      vk: { groupId: 'invalid-group-id' },
    })).toEqual([
      { platform: 'telegram', id: '@public_channel', name: undefined },
    ]);

    expect(getScraperCampaignChannels({
      telegram: { chatId: '@public_channel' },
      vk: { groupId: '-228626989' },
    })).toEqual([
      { platform: 'telegram', id: '@public_channel', name: undefined },
      { platform: 'vk', id: '-228626989', name: undefined },
    ]);
  });

  it('rejects a failed force-parse response with its real message', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        message: 'Telegram channel is not public',
        task_id: 'task-1',
        status: 'failed',
      },
    });

    await expect(forceParseChannel('channel-uuid', true))
      .rejects.toThrow('Telegram channel is not public');
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
      params: expect.objectContaining({ channel_ids: ['telegram-uuid'] }),
    }));
    expect(vi.mocked(axios.post).mock.calls[2][2]).toEqual(expect.objectContaining({
      params: expect.objectContaining({ channel_ids: ['vk-uuid'] }),
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
        '"query":{"channel_ids":["telegram-uuid","vk-uuid"],"days":7,"force":true}',
      ),
      'analytics',
    );
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'scraper_channels=[{"scraper_channel_id":"telegram-uuid","platform":"telegram","platform_channel_id":"@channel"},{"scraper_channel_id":"vk-uuid","platform":"vk","platform_channel_id":"123"}]',
      ),
      'analytics',
    );
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '"query":{"channel_ids":["vk-uuid"],"days":7,"force":true}',
      ),
      'analytics',
    );
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).toContain('Bearer [REDACTED]');
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toContain('test-key');
  });

  it('retries channels separately when the batch connection is aborted', async () => {
    vi.mocked(axios.post)
      .mockRejectedValueOnce({
        code: 'ECONNABORTED',
        message: 'timeout of 60000ms exceeded',
      })
      .mockResolvedValueOnce({
        data: {
          status: 'completed',
          processed: 1,
          failed: 0,
          skipped: 0,
          duration_seconds: 1,
          errors: [],
        },
      })
      .mockResolvedValueOnce({
        data: {
          status: 'completed',
          processed: 2,
          failed: 0,
          skipped: 0,
          duration_seconds: 1,
          errors: [],
        },
      });

    const result = await refreshChannelMetrics({
      channels: [
        { id: 'telegram-uuid', platform: 'telegram', platform_channel_id: '@channel' },
        { id: 'vk-uuid', platform: 'vk', platform_channel_id: '123' },
      ],
      days: 7,
    });

    expect(axios.post).toHaveBeenCalledTimes(3);
    expect(result).toEqual(expect.objectContaining({
      status: 'completed',
      processed: 3,
      failed: 0,
    }));
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'ECONNABORTED: timeout of 60000ms exceeded elapsed_ms=',
      ),
      'analytics',
    );
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

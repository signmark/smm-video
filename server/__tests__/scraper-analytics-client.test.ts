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
import { refreshChannelMetrics } from '../services/scraper-analytics';

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
});

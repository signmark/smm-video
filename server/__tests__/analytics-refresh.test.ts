import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

vi.mock('../directus', () => ({
  directusApi: { get: vi.fn() },
}));

vi.mock('../utils/logger', () => ({
  log: vi.fn(),
}));

vi.mock('../services/scraper-analytics', () => ({
  ensureChannelsRegistered: vi.fn(),
  getMonitoredChannels: vi.fn(),
  refreshChannelMetrics: vi.fn(),
  forceParseChannel: vi.fn(),
}));

import axios from 'axios';
import { AnalyticsService } from '../services/analytics-service';
import {
  ensureChannelsRegistered,
  getMonitoredChannels,
  refreshChannelMetrics,
} from '../services/scraper-analytics';

describe('AnalyticsService.refreshCampaignAnalytics', () => {
  const previousAdminToken = process.env.DIRECTUS_ADMIN_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIRECTUS_ADMIN_TOKEN = 'admin-token';
  });

  afterEach(() => {
    if (previousAdminToken === undefined) delete process.env.DIRECTUS_ADMIN_TOKEN;
    else process.env.DIRECTUS_ADMIN_TOKEN = previousAdminToken;
  });

  it('waits for synchronous scraper refresh and forwards the selected period', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: {
          social_media_settings: {
            telegram: { chatId: '@public_channel' },
            vk: { groupId: '228626989' },
          },
        },
      },
    } as any);
    vi.mocked(ensureChannelsRegistered).mockResolvedValue(new Map());
    vi.mocked(getMonitoredChannels).mockResolvedValue({
      items: [
        { id: 'tg-monitor', platform: 'telegram', platform_channel_id: '@public_channel', last_parsed_at: '2026-07-16T10:00:00Z' },
        { id: 'vk-monitor', platform: 'vk', platform_channel_id: '228626989', last_parsed_at: '2026-07-16T10:00:00Z' },
      ],
    } as any);
    vi.mocked(refreshChannelMetrics).mockResolvedValue({
      status: 'completed',
      processed: 2,
      failed: 0,
      skipped: 0,
      duration_seconds: 1.2,
      errors: [],
    });

    const result = await AnalyticsService.refreshCampaignAnalytics('campaign-1', 16);

    expect(refreshChannelMetrics).toHaveBeenCalledWith({
      channels: expect.arrayContaining([
        expect.objectContaining({ platform: 'telegram' }),
        expect.objectContaining({ platform: 'vk' }),
      ]),
      days: 16,
      force: true,
    });
    expect(result).toEqual(expect.objectContaining({
      success: true,
      processed: 2,
      failed: 0,
    }));
    expect(getMonitoredChannels).toHaveBeenCalledWith({ page_size: 100 }, true);
  });

  it('does not report a successful refresh when scraper channel lookup fails', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: {
          social_media_settings: {
            telegram: { chatId: '@public_channel' },
          },
        },
      },
    } as any);
    vi.mocked(ensureChannelsRegistered).mockResolvedValue(new Map());
    vi.mocked(getMonitoredChannels).mockRejectedValue(
      new Error('Analytics API отклонил ключ доступа (HTTP 401)'),
    );

    const result = await AnalyticsService.refreshCampaignAnalytics('campaign-1', 7);

    expect(result).toEqual({
      success: false,
      message: 'Analytics API отклонил ключ доступа (HTTP 401)',
    });
    expect(refreshChannelMetrics).not.toHaveBeenCalled();
  });

  it('reports initial parsing instead of claiming that zero channels were updated', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: {
          social_media_settings: {
            telegram: { chatId: '@public_channel' },
          },
        },
      },
    } as any);
    vi.mocked(ensureChannelsRegistered).mockResolvedValue(new Map());
    vi.mocked(getMonitoredChannels).mockResolvedValue({
      items: [
        {
          id: 'tg-monitor',
          platform: 'telegram',
          platform_channel_id: '@public_channel',
          last_parsed_at: null,
        },
      ],
    } as any);

    const result = await AnalyticsService.refreshCampaignAnalytics('campaign-1', 7);

    expect(result).toEqual(expect.objectContaining({
      success: true,
      processed: 0,
      message: expect.stringContaining('Первичный сбор данных запущен'),
    }));
    expect(refreshChannelMetrics).not.toHaveBeenCalled();
  });
});

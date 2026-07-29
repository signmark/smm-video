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
  getChannelParseStatus: vi.fn(),
  getScraperCampaignChannels: vi.fn((settings: any) => {
    const channels = [];
    if (settings?.telegram?.chatId?.startsWith('@')) {
      channels.push({ platform: 'telegram', id: settings.telegram.chatId });
    }
    if (settings?.vk?.groupId) {
      channels.push({ platform: 'vk', id: settings.vk.groupId });
    }
    return channels;
  }),
  refreshChannelMetrics: vi.fn(),
  forceParseChannel: vi.fn(),
  resolveAnalyticsChannel: vi.fn(),
  reresolveAnalyticsChannel: vi.fn(),
}));

import axios from 'axios';
import { AnalyticsService } from '../services/analytics-service';
import {
  getChannelParseStatus,
  refreshChannelMetrics,
  forceParseChannel,
  reresolveAnalyticsChannel,
  resolveAnalyticsChannel,
} from '../services/scraper-analytics';

describe('AnalyticsService.refreshCampaignAnalytics', () => {
  const previousAdminToken = process.env.DIRECTUS_STATIC_TOKEN;
  const previousStaticToken = process.env.DIRECTUS_STATIC_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIRECTUS_STATIC_TOKEN = 'admin-token';
    vi.mocked(resolveAnalyticsChannel).mockImplementation(async (platform) => (
      platform === 'telegram' ? 'tg-monitor' : 'vk-monitor'
    ));
  });

  afterEach(() => {
    if (previousAdminToken === undefined) delete process.env.DIRECTUS_STATIC_TOKEN;
    else process.env.DIRECTUS_STATIC_TOKEN = previousAdminToken;
    if (previousStaticToken === undefined) delete process.env.DIRECTUS_STATIC_TOKEN;
    else process.env.DIRECTUS_STATIC_TOKEN = previousStaticToken;
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
    vi.mocked(getChannelParseStatus).mockImplementation(async (channelId) => ({
      channel_id: channelId,
      status: 'idle',
      last_parsed_at: '2026-07-16T10:00:00Z',
      posts_count: 1,
      last_error: null,
      next_parse_at: null,
    }));
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
        expect.objectContaining({ id: 'tg-monitor', platform: 'telegram' }),
        expect.objectContaining({ id: 'vk-monitor', platform: 'vk' }),
      ]),
      days: 16,
      force: true,
    });
    expect(result).toEqual(expect.objectContaining({
      success: true,
      processed: 2,
      failed: 0,
    }));
    expect(resolveAnalyticsChannel).toHaveBeenCalledTimes(2);
  });

  it('uses a cached channel UUID without legacy registration lookup', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: {
          name: 'Campaign',
          social_media_settings: {
            telegram: {
              chatId: '-1001234567890',
              analyticsChannelId: 'cached-uuid',
            },
          },
        },
      },
    } as any);
    vi.mocked(resolveAnalyticsChannel).mockResolvedValue('cached-uuid');
    vi.mocked(getChannelParseStatus).mockResolvedValue({
      channel_id: 'cached-uuid',
      status: 'idle',
      last_parsed_at: '2026-07-16T10:00:00Z',
    } as any);
    vi.mocked(refreshChannelMetrics).mockResolvedValue({
      status: 'completed',
      processed: 1,
      failed: 0,
      skipped: 0,
      duration_seconds: 1,
      errors: [],
    });

    await AnalyticsService.refreshCampaignAnalytics('campaign-1', 7);

    expect(resolveAnalyticsChannel).toHaveBeenCalledWith(
      'telegram',
      '-1001234567890',
      'cached-uuid',
      'campaign-1',
      'admin-token',
      'Campaign',
    );
    expect(getChannelParseStatus).toHaveBeenCalledWith('cached-uuid', true);
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
    vi.mocked(resolveAnalyticsChannel).mockResolvedValue(null);

    const result = await AnalyticsService.refreshCampaignAnalytics('campaign-1', 7);

    expect(result).toEqual({
      success: false,
      message: 'Не удалось найти или зарегистрировать каналы кампании в scraper.',
      processed: 0,
      failed: 1,
      skipped: 0,
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
    vi.mocked(getChannelParseStatus).mockResolvedValue({
      channel_id: 'tg-monitor',
      status: 'parsing',
      progress: 10,
      message: 'Initial parsing is already running',
    } as any);

    const result = await AnalyticsService.refreshCampaignAnalytics('campaign-1', 7);

    expect(result).toEqual(expect.objectContaining({
      success: true,
      processed: 0,
      message: expect.stringContaining('Сбор данных по каналам уже выполняется'),
    }));
    expect(refreshChannelMetrics).not.toHaveBeenCalled();
    expect(forceParseChannel).not.toHaveBeenCalled();
  });

  it('starts force parse only when an unparsed channel is idle', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: {
          social_media_settings: {
            telegram: { chatId: '@public_channel' },
          },
        },
      },
    } as any);
    vi.mocked(getChannelParseStatus).mockResolvedValue({
      channel_id: 'tg-monitor',
      status: 'idle',
      last_parsed_at: null,
    } as any);
    vi.mocked(forceParseChannel).mockResolvedValue({
      message: 'Parse started',
      task_id: 'task-1',
      status: 'started',
    });

    const result = await AnalyticsService.refreshCampaignAnalytics('campaign-1', 7);

    expect(forceParseChannel).toHaveBeenCalledWith('tg-monitor', true);
    expect(refreshChannelMetrics).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      success: true,
      processed: 0,
    }));
  });

  it('refreshes metrics immediately when force-parse completes instantly', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: {
          social_media_settings: {
            telegram: { chatId: '@public_channel' },
          },
        },
      },
    } as any);
    vi.mocked(getChannelParseStatus).mockResolvedValue({
      channel_id: 'tg-monitor',
      status: 'idle',
      last_parsed_at: null,
    } as any);
    vi.mocked(forceParseChannel).mockResolvedValue({
      message: 'Parse completed',
      task_id: 'task-1',
      status: 'completed',
    });
    vi.mocked(refreshChannelMetrics).mockResolvedValue({
      status: 'completed',
      processed: 1,
      failed: 0,
      skipped: 0,
      duration_seconds: 1,
      errors: [],
    });

    const result = await AnalyticsService.refreshCampaignAnalytics('campaign-1', 7);

    expect(forceParseChannel).toHaveBeenCalledWith('tg-monitor', true);
    expect(refreshChannelMetrics).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      success: true,
      message: expect.stringContaining('Аналитика обновлена'),
      processed: 1,
    }));
  });

  it('re-resolves a stale cached UUID once when parse-status rejects it', async () => {
    // Task 6: parse-status по протухшему кешу падает (404) — один re-resolve,
    // повторный parse-status и refresh идут уже по свежему UUID.
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: {
          name: 'Campaign',
          social_media_settings: {
            telegram: {
              chatId: '@public_channel',
              analyticsChannelId: 'stale-uuid',
            },
          },
        },
      },
    } as any);
    vi.mocked(resolveAnalyticsChannel).mockResolvedValue('stale-uuid');
    vi.mocked(reresolveAnalyticsChannel).mockResolvedValue('fresh-uuid');
    vi.mocked(getChannelParseStatus).mockImplementation(async (channelId) => {
      if (channelId === 'stale-uuid') {
        throw new Error('Analytics API вернул HTTP 404 для GET /api/v1/monitoring/channels/stale-uuid/parse-status');
      }
      return {
        channel_id: channelId,
        status: 'idle',
        last_parsed_at: '2026-07-16T10:00:00Z',
      } as any;
    });
    vi.mocked(refreshChannelMetrics).mockResolvedValue({
      status: 'completed',
      processed: 1,
      failed: 0,
      skipped: 0,
      duration_seconds: 1,
      errors: [],
    });

    const result = await AnalyticsService.refreshCampaignAnalytics('campaign-1', 7);

    expect(reresolveAnalyticsChannel).toHaveBeenCalledTimes(1);
    expect(reresolveAnalyticsChannel).toHaveBeenCalledWith(
      'telegram',
      '@public_channel',
      'stale-uuid',
      'campaign-1',
      'admin-token',
      'Campaign',
    );
    expect(getChannelParseStatus).toHaveBeenCalledWith('fresh-uuid', true);
    expect(refreshChannelMetrics).toHaveBeenCalledWith(expect.objectContaining({
      channels: [expect.objectContaining({ id: 'fresh-uuid' })],
    }));
    expect(result).toEqual(expect.objectContaining({ success: true, processed: 1 }));
  });
});

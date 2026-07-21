import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../directus', () => ({
  directusApi: { get: vi.fn() },
}));

vi.mock('../utils/logger', () => ({
  log: vi.fn(),
}));

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

vi.mock('../services/scraper-analytics', () => ({
  getAllChannelPosts: vi.fn(),
  getChannelAnalytics: vi.fn(),
  reresolveAnalyticsChannel: vi.fn(),
  resolveAnalyticsChannel: vi.fn(),
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
}));

import axios from 'axios';
import { directusApi } from '../directus';
import { AnalyticsService } from '../services/analytics-service';
import { log } from '../utils/logger';
import {
  getAllChannelPosts,
  getChannelAnalytics,
  reresolveAnalyticsChannel,
  resolveAnalyticsChannel,
} from '../services/scraper-analytics';

describe('AnalyticsService scraper supplementation', () => {
  const previousAdminToken = process.env.DIRECTUS_ADMIN_TOKEN;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
    vi.clearAllMocks();
    process.env.DIRECTUS_ADMIN_TOKEN = 'admin-token';
    vi.mocked(resolveAnalyticsChannel).mockImplementation(async (platform) => (
      platform === 'vk' ? 'vk-monitor' : 'tg-monitor'
    ));
    vi.mocked(getAllChannelPosts).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousAdminToken === undefined) delete process.env.DIRECTUS_ADMIN_TOKEN;
    else process.env.DIRECTUS_ADMIN_TOKEN = previousAdminToken;
  });

  it('does not replace campaign metrics with unattributed channel aggregates', async () => {
    vi.mocked(directusApi.get).mockResolvedValue({
      data: {
        data: [{
          id: 'content-1',
          status: 'published',
          published_at: '2026-07-15T12:00:00.000Z',
          social_platforms: {
            vk: {
              status: 'published',
              postId: '-228626989_10',
              publishedAt: '2026-07-15T12:00:00.000Z',
              analytics: { views: 5, likes: 1, comments: 0, shares: 0 },
            },
            telegram: {
              status: 'published',
              postId: '20',
              publishedAt: '2026-07-15T12:00:00.000Z',
              analytics: { views: 7, likes: 1, comments: 0, shares: 0 },
            },
          },
        }],
      },
    } as any);

    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: {
          social_media_settings: {
            vk: { groupId: '-228626989' },
            telegram: { chatId: '@tg_channel' },
          },
        },
      },
    } as any);

    vi.mocked(getChannelAnalytics).mockImplementation(async (channelId) => ({
      total_views: channelId === 'vk-monitor' ? 10 : 20,
      total_likes: channelId === 'vk-monitor' ? 1 : 2,
      total_comments: channelId === 'vk-monitor' ? 0 : 1,
      total_shares: 0,
    } as any));

    const result = await AnalyticsService.getCampaignAnalytics('campaign-1', 'thisMonth', 'user-token');

    expect(result.totalPosts).toBe(2);
    expect(result.totalViews).toBe(12);
    expect(result.totalLikes).toBe(2);
    expect(result.totalComments).toBe(0);
    expect(result.platforms).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'vk', posts: 1, views: 5 }),
      expect.objectContaining({ name: 'telegram', posts: 1, views: 7 }),
    ]));
  });

  it('matches campaign post ids, excludes other channel posts, and keeps the latest snapshot', async () => {
    vi.mocked(directusApi.get).mockResolvedValue({
      data: {
        data: [{
          id: 'content-1',
          status: 'published',
          social_platforms: {
            telegram: {
              status: 'published',
              postId: 'post-1',
              publishedAt: '2026-07-15T09:00:00.000Z',
            },
          },
        }],
      },
    } as any);
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: {
          social_media_settings: {
            telegram: { chatId: '@tg_channel' },
          },
        },
      },
    } as any);
    vi.mocked(getChannelAnalytics).mockResolvedValue({
      total_posts: 4,
      total_views: 105,
      total_likes: 4,
      total_comments: 0,
      total_shares: 0,
    } as any);
    vi.mocked(getAllChannelPosts).mockResolvedValue([
      {
        platform_post_id: 'post-1',
        captured_at: '2026-07-15T10:00:00.000Z',
        views: 10,
        likes: 1,
        comments: 0,
        shares: 0,
      },
      {
        platform_post_id: 'post-1',
        captured_at: '2026-07-16T10:00:00.000Z',
        views: 15,
        likes: 2,
        comments: 0,
        shares: 0,
      },
      {
        platform_post_id: 'post-2',
        captured_at: '2026-07-15T11:00:00.000Z',
        views: 20,
        likes: 1,
        comments: 0,
        shares: 0,
      },
      {
        platform_post_id: 'post-2',
        captured_at: '2026-07-14T11:00:00.000Z',
        views: 60,
        likes: 0,
        comments: 0,
        shares: 0,
      },
    ] as any);

    const result = await AnalyticsService.getCampaignAnalytics(
      'campaign-1',
      'thisMonth',
      'user-token',
    );

    expect(result.totalPosts).toBe(1);
    expect(result.totalViews).toBe(15);
    expect(result.totalLikes).toBe(2);
    expect(result.platforms).toEqual([
      expect.objectContaining({
        name: 'telegram',
        posts: 1,
        views: 15,
        likes: 2,
      }),
    ]);
  });

  it('counts only four July 13 campaign publications instead of all thirteen channel posts', async () => {
    // Production regression 2026-07-21, campaign "Чушь": Directus contained
    // VK posts 1811-1814, while channel-level scraper data contained 13 posts.
    vi.setSystemTime(new Date('2026-07-21T12:00:00.000Z'));
    vi.mocked(directusApi.get).mockResolvedValue({
      data: {
        data: ['1811', '1812', '1813', '1814'].map(postId => ({
          id: `content-${postId}`,
          status: 'published',
          social_platforms: {
            vk: {
              status: 'published',
              postId,
              postUrl: `https://vk.com/wall-228626989_${postId}`,
              publishedAt: '2026-07-13T07:00:00.000Z',
            },
          },
        })),
      },
    } as any);
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: {
          social_media_settings: { vk: { groupId: '-228626989' } },
        },
      },
    } as any);
    vi.mocked(getChannelAnalytics).mockResolvedValue({
      total_posts: 13,
      total_views: 36,
      total_likes: 0,
      total_comments: 0,
      total_shares: 0,
    } as any);
    vi.mocked(getAllChannelPosts).mockResolvedValue([
      ...['1811', '1812', '1813', '1814'].map((postId, index) => ({
        platform_post_id: `-228626989_${postId}`,
        captured_at: '2026-07-21T09:00:00.000Z',
        views: index + 1,
        likes: 0,
        comments: 0,
        shares: 0,
      })),
      ...Array.from({ length: 9 }, (_, index) => ({
        platform_post_id: `-228626989_${1900 + index}`,
        captured_at: '2026-07-21T09:00:00.000Z',
        views: 100,
        likes: 10,
        comments: 5,
        shares: 2,
      })),
    ] as any);

    const month = await AnalyticsService.getCampaignAnalytics(
      'campaign-chush',
      'thisMonth',
      'user-token',
    );
    const sevenDays = await AnalyticsService.getCampaignAnalytics(
      'campaign-chush',
      '7days',
      'user-token',
    );

    expect(month.totalPosts).toBe(4);
    expect(month.totalViews).toBe(10);
    expect(month.platforms).toEqual([
      expect.objectContaining({ name: 'vk', posts: 4, views: 10 }),
    ]);
    expect(sevenDays.totalPosts).toBe(0);
    expect(sevenDays.totalViews).toBe(0);
    expect(sevenDays.platforms).toEqual([]);
  });

  it('keeps stored metrics when the scraper has no data for the period', async () => {
    // Регрессия: нулевые агрегаты скрейпера (канал найден, но первичный сбор
    // ещё не завершён) затирали реальные метрики, сохранённые в Directus.
    vi.mocked(directusApi.get).mockResolvedValue({
      data: {
        data: [{
          id: 'content-1',
          status: 'published',
          published_at: '2026-07-15T12:00:00.000Z',
          social_platforms: {
            vk: {
              status: 'published',
              postId: '-228626989_10',
              publishedAt: '2026-07-15T12:00:00.000Z',
              analytics: { views: 5, likes: 1, comments: 0, shares: 0 },
            },
          },
        }],
      },
    } as any);

    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: {
          social_media_settings: {
            vk: { groupId: '-228626989' },
          },
        },
      },
    } as any);

    vi.mocked(getChannelAnalytics).mockResolvedValue({
      total_views: 0,
      total_likes: 0,
      total_comments: 0,
      total_shares: 0,
    } as any);

    const result = await AnalyticsService.getCampaignAnalytics('campaign-1', 'thisMonth', 'user-token');

    expect(result.platforms).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'vk', posts: 1, views: 5, likes: 1 }),
    ]));
    expect(result.totalViews).toBe(5);
  });

  it('uses the cached analyticsChannelId for scraper analytics', async () => {
    vi.mocked(directusApi.get).mockResolvedValue({
      data: {
        data: [{
          id: 'content-1',
          status: 'published',
          published_at: '2026-07-15T12:00:00.000Z',
          social_platforms: {
            telegram: {
              status: 'published',
              postId: '20',
              publishedAt: '2026-07-15T12:00:00.000Z',
              analytics: { views: 1, likes: 0, comments: 0, shares: 0 },
            },
          },
        }],
      },
    } as any);
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
    vi.mocked(getChannelAnalytics).mockResolvedValue({
      total_views: 25,
      total_likes: 2,
      total_comments: 1,
      total_shares: 0,
    } as any);

    await AnalyticsService.getCampaignAnalytics('campaign-1', 'thisMonth', 'user-token');

    expect(resolveAnalyticsChannel).toHaveBeenCalledWith(
      'telegram',
      '-1001234567890',
      'cached-uuid',
      'campaign-1',
      'admin-token',
      'Campaign',
    );
    expect(getChannelAnalytics).toHaveBeenCalledWith(
      'cached-uuid',
      expect.any(Object),
    );
  });

  it('invokes auto-resolution when the channel UUID is not cached', async () => {
    vi.mocked(directusApi.get).mockResolvedValue({
      data: {
        data: [{
          id: 'content-1',
          status: 'published',
          published_at: '2026-07-15T12:00:00.000Z',
          social_platforms: {
            telegram: {
              status: 'published',
              postId: '20',
              publishedAt: '2026-07-15T12:00:00.000Z',
              analytics: { views: 1, likes: 0, comments: 0, shares: 0 },
            },
          },
        }],
      },
    } as any);
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: {
          name: 'Campaign',
          social_media_settings: {
            telegram: { chatId: '@tg_channel' },
          },
        },
      },
    } as any);
    vi.mocked(resolveAnalyticsChannel).mockResolvedValue('registered-uuid');
    vi.mocked(getChannelAnalytics).mockResolvedValue({
      total_views: 10,
      total_likes: 1,
      total_comments: 0,
      total_shares: 0,
    } as any);

    await AnalyticsService.getCampaignAnalytics('campaign-1', 'thisMonth', 'user-token');

    expect(resolveAnalyticsChannel).toHaveBeenCalledWith(
      'telegram',
      '@tg_channel',
      undefined,
      'campaign-1',
      'admin-token',
      'Campaign',
    );
    expect(getChannelAnalytics).toHaveBeenCalledWith(
      'registered-uuid',
      expect.any(Object),
    );
  });

  it('re-resolves a stale cached UUID once and uses the fresh channel', async () => {
    // Task 6: кешированный analyticsChannelId протух (канал пересоздали в
    // скрейпере) — getChannelAnalytics по нему даёт null (404). Один
    // re-resolve, повторный запрос идёт уже по свежему UUID.
    vi.mocked(directusApi.get).mockResolvedValue({
      data: {
        data: [{
          id: 'content-1',
          status: 'published',
          published_at: '2026-07-15T12:00:00.000Z',
          social_platforms: {
            telegram: {
              status: 'published',
              postId: '20',
              publishedAt: '2026-07-15T12:00:00.000Z',
              analytics: { views: 1, likes: 0, comments: 0, shares: 0 },
            },
          },
        }],
      },
    } as any);
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: {
          name: 'Campaign',
          social_media_settings: {
            telegram: {
              chatId: '@tg_channel',
              analyticsChannelId: 'stale-uuid',
            },
          },
        },
      },
    } as any);
    vi.mocked(resolveAnalyticsChannel).mockResolvedValue('stale-uuid');
    vi.mocked(reresolveAnalyticsChannel).mockResolvedValue('fresh-uuid');
    vi.mocked(getChannelAnalytics).mockImplementation(async (channelId) => (
      channelId === 'stale-uuid'
        ? null
        : {
            total_views: 42,
            total_likes: 3,
            total_comments: 2,
            total_shares: 1,
          } as any
    ));

    const result = await AnalyticsService.getCampaignAnalytics('campaign-1', 'thisMonth', 'user-token');

    expect(reresolveAnalyticsChannel).toHaveBeenCalledTimes(1);
    expect(reresolveAnalyticsChannel).toHaveBeenCalledWith(
      'telegram',
      '@tg_channel',
      'stale-uuid',
      'campaign-1',
      'admin-token',
      'Campaign',
    );
    expect(getChannelAnalytics).toHaveBeenCalledWith('stale-uuid', expect.any(Object));
    expect(getChannelAnalytics).toHaveBeenCalledWith('fresh-uuid', expect.any(Object));
    expect(result.totalViews).toBe(1);
  });

  it('logs safe campaign decisions and scraper response summaries', async () => {
    vi.mocked(directusApi.get).mockResolvedValue({ data: { data: [] } } as any);
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: {
          name: 'Campaign',
          social_media_settings: {
            telegram: { chatId: '@tg_channel' },
            vk: { groupId: '-228626989' },
            instagram: { accessToken: 'instagram-secret' },
            facebook: { accessToken: 'facebook-secret' },
            threads: { accessToken: 'threads-secret' },
            youtube: { refreshToken: 'youtube-secret' },
          },
        },
      },
    } as any);
    vi.mocked(getChannelAnalytics).mockImplementation(async (channelId) => (
      channelId === 'vk-monitor'
        ? {
            total_posts: 2,
            total_views: 12,
            total_likes: 1,
            total_comments: 0,
            total_shares: 0,
          } as any
        : null
    ));

    await AnalyticsService.getCampaignAnalytics('campaign-1', 'thisMonth', 'user-token');

    const logged = vi.mocked(log).mock.calls
      .map(([message]) => String(message))
      .filter(message => message.startsWith('analytics trace='))
      .map(message => JSON.parse(message.slice('analytics trace='.length)));

    expect(logged).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'campaign_plan',
        campaignId: 'campaign-1',
        settingsPresentPlatforms: [
          'telegram',
          'vk',
          'instagram',
          'facebook',
          'threads',
          'youtube',
        ],
        skippedPlatforms: [
          { platform: 'instagram', reason: 'unsupported_by_analytics_scraper' },
          { platform: 'facebook', reason: 'unsupported_by_analytics_scraper' },
          { platform: 'threads', reason: 'unsupported_by_analytics_scraper' },
          { platform: 'youtube', reason: 'unsupported_by_analytics_scraper' },
        ],
      }),
      expect.objectContaining({
        event: 'channel_response_summary',
        platform: 'telegram',
        analyticsReceived: false,
        postsReceived: false,
        source: null,
      }),
      expect.objectContaining({
        event: 'channel_skipped',
        platform: 'telegram',
        reason: 'no_post_level_attribution',
      }),
      expect.objectContaining({
        event: 'channel_response_summary',
        platform: 'vk',
        analyticsReceived: true,
        source: null,
        metrics: null,
      }),
      expect.objectContaining({
        event: 'channel_skipped',
        platform: 'vk',
        reason: 'no_post_level_attribution',
      }),
    ]));

    const serializedLogs = JSON.stringify(vi.mocked(log).mock.calls);
    expect(serializedLogs).not.toContain('instagram-secret');
    expect(serializedLogs).not.toContain('facebook-secret');
    expect(serializedLogs).not.toContain('threads-secret');
    expect(serializedLogs).not.toContain('youtube-secret');
  });
});

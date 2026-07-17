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
  getAllMonitoredChannels: vi.fn(),
  getChannelAnalytics: vi.fn(),
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
import { getAllMonitoredChannels, getChannelAnalytics } from '../services/scraper-analytics';

describe('AnalyticsService scraper supplementation', () => {
  const previousAdminToken = process.env.DIRECTUS_ADMIN_TOKEN;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
    vi.clearAllMocks();
    process.env.DIRECTUS_ADMIN_TOKEN = 'admin-token';
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousAdminToken === undefined) delete process.env.DIRECTUS_ADMIN_TOKEN;
    else process.env.DIRECTUS_ADMIN_TOKEN = previousAdminToken;
  });

  it('uses current channel aggregates without double-counting stored metrics', async () => {
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

    vi.mocked(getAllMonitoredChannels).mockResolvedValue({
      items: [
        { id: 'vk-monitor', platform: 'vk', platform_channel_id: '-228626989' },
        { id: 'tg-monitor', platform: 'telegram', platform_channel_id: '@tg_channel' },
      ],
    } as any);

    vi.mocked(getChannelAnalytics).mockImplementation(async (channelId) => ({
      total_views: channelId === 'vk-monitor' ? 10 : 20,
      total_likes: channelId === 'vk-monitor' ? 1 : 2,
      total_comments: channelId === 'vk-monitor' ? 0 : 1,
      total_shares: 0,
    } as any));

    const result = await AnalyticsService.getCampaignAnalytics('campaign-1', 'thisMonth', 'user-token');

    expect(result.totalPosts).toBe(2);
    expect(result.totalViews).toBe(30);
    expect(result.totalLikes).toBe(3);
    expect(result.totalComments).toBe(1);
    expect(result.platforms).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'vk', posts: 1, views: 10 }),
      expect.objectContaining({ name: 'telegram', posts: 1, views: 20 }),
    ]));
  });
});

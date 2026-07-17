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
  getChannelPosts: vi.fn(),
  getScraperCampaignChannels: vi.fn((settings: any) => {
    const channels = [];
    if (settings?.telegram?.chatId?.startsWith('@') || settings?.telegram?.chatId === 'tg-channel') {
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
import { getAllMonitoredChannels, getChannelPosts } from '../services/scraper-analytics';

describe('AnalyticsService scraper matching', () => {
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

  it('ignores unrelated channel posts and supplements both VK and Telegram', async () => {
    vi.mocked(directusApi.get).mockResolvedValue({
      data: {
        data: [{
          id: 'content-1',
          status: 'published',
          published_at: '2026-07-15T12:00:00.000Z',
          social_platforms: {
            vk: { status: 'published', postId: '-1_10', publishedAt: '2026-07-15T12:00:00.000Z' },
            telegram: { status: 'published', postId: '20', publishedAt: '2026-07-15T12:00:00.000Z' },
          },
        }],
      },
    } as any);

    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: {
          social_media_settings: {
            vk: { groupId: 'vk-channel' },
            telegram: { chatId: 'tg-channel' },
          },
        },
      },
    } as any);

    vi.mocked(getAllMonitoredChannels).mockResolvedValue({
      items: [
        { id: 'vk-monitor', platform: 'vk', platform_channel_id: 'vk-channel' },
        { id: 'tg-monitor', platform: 'telegram', platform_channel_id: 'tg-channel' },
      ],
    } as any);

    vi.mocked(getChannelPosts).mockImplementation(async (channelId) => ({
      items: channelId === 'vk-monitor'
        ? [
            { id: 'old-vk', platform_post_id: '-1_9', views: 100, likes: 0, comments: 0, shares: 0 },
            { id: 'campaign-vk', platform_post_id: '-1_10', views: 10, likes: 1, comments: 0, shares: 0 },
          ]
        : [
            { id: 'campaign-tg', platform_post_id: '20', views: 20, likes: 2, comments: 1, shares: 0 },
          ],
      total: channelId === 'vk-monitor' ? 2 : 1,
      page: 1,
      page_size: 100,
      has_next_page: false,
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

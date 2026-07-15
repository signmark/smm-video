import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../directus', () => ({
  directusApi: { get: vi.fn() },
}));

vi.mock('../utils/logger', () => ({
  log: vi.fn(),
}));

import { directusApi } from '../directus';
import { AnalyticsService } from '../services/analytics-service';

describe('AnalyticsService.getCampaignAnalytics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T15:00:00.000Z'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('requests published content in a stable newest-first order', async () => {
    vi.mocked(directusApi.get).mockResolvedValue({
      data: {
        data: [{
          id: 'content-1',
          status: 'partial',
          scheduled_at: null,
          published_at: '2026-07-15T14:00:00.000Z',
          social_platforms: {
            telegram: {
              status: 'published',
              analytics: { views: 1 },
            },
          },
        }],
      },
    } as any);

    const result = await AnalyticsService.getCampaignAnalytics('campaign-1', '7days', 'token');

    expect(result.totalPosts).toBe(1);
    const requestConfig = vi.mocked(directusApi.get).mock.calls[0][1] as any;
    expect(JSON.parse(requestConfig.params.filter)).toEqual({
      campaign_id: { _eq: 'campaign-1' },
      status: { _in: ['published', 'partially_published', 'partial'] },
    });
    expect(requestConfig.params.sort).toEqual(['-published_at', '-id']);
    expect(requestConfig.params.limit).toBe(1000);
    expect(requestConfig.params.offset).toBe(0);
  });

  it('loads every page so publications beyond the first 1000 are counted', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `content-${index}`,
      status: 'published',
      published_at: '2026-07-15T14:00:00.000Z',
      social_platforms: {},
    }));
    const lastPost = {
      id: 'content-1000',
      status: 'published',
      published_at: '2026-07-15T14:00:00.000Z',
      social_platforms: {
        telegram: { status: 'published' },
      },
    };
    vi.mocked(directusApi.get)
      .mockResolvedValueOnce({ data: { data: firstPage } } as any)
      .mockResolvedValueOnce({ data: { data: [lastPost] } } as any);

    const result = await AnalyticsService.getCampaignAnalytics('campaign-1', '7days', 'token');

    expect(result.totalPosts).toBe(1);
    expect(directusApi.get).toHaveBeenCalledTimes(2);
    expect((vi.mocked(directusApi.get).mock.calls[1][1] as any).params.offset).toBe(1000);
  });
});

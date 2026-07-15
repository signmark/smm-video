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

  it('does not exclude immediate or partial publications in the Directus query', async () => {
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
    });
  });
});

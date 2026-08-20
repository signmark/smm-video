import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../directus', () => ({
  directusApi: { get: vi.fn() },
}));

vi.mock('../utils/logger', () => ({
  log: Object.assign(vi.fn(), { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { directusApi } from '../directus';
import { AnalyticsService } from '../services/analytics-service';

describe('AnalyticsService.getCampaignAnalytics', () => {
  const previousStaticToken = process.env.DIRECTUS_STATIC_TOKEN;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T15:00:00.000Z'));
    vi.clearAllMocks();
    process.env.DIRECTUS_STATIC_TOKEN = 'service-token';
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousStaticToken === undefined) delete process.env.DIRECTUS_STATIC_TOKEN;
    else process.env.DIRECTUS_STATIC_TOKEN = previousStaticToken;
  });

  const ownedCampaign = {
    data: { data: { id: 'campaign-1', user_id: 'user-1', social_media_settings: {} } },
  } as any;

  it('requests published content in a stable newest-first order', async () => {
    vi.mocked(directusApi.get).mockResolvedValueOnce(ownedCampaign).mockResolvedValueOnce({
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

    const result = await AnalyticsService.getCampaignAnalytics('campaign-1', '7days', 'token', 'user-1');

    expect(result.totalPosts).toBe(1);
    const requestConfig = vi.mocked(directusApi.get).mock.calls[1][1] as any;
    expect(JSON.parse(requestConfig.params.filter)).toEqual({
      campaign_id: { _eq: 'campaign-1' },
      status: { _in: ['published', 'partially_published', 'partial'] },
      user_id: { _eq: 'user-1' },
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
      .mockResolvedValueOnce(ownedCampaign)
      .mockResolvedValueOnce({ data: { data: firstPage } } as any)
      .mockResolvedValueOnce({ data: { data: [lastPost] } } as any);

    const result = await AnalyticsService.getCampaignAnalytics('campaign-1', '7days', 'token', 'user-1');

    expect(result.totalPosts).toBe(1);
    expect(directusApi.get).toHaveBeenCalledTimes(3);
    expect((vi.mocked(directusApi.get).mock.calls[2][1] as any).params.offset).toBe(1000);
  });

  it('uses the service credential and scopes ordinary users to their own content', async () => {
    vi.mocked(directusApi.get)
      .mockResolvedValueOnce(ownedCampaign)
      .mockResolvedValueOnce({ data: { data: [] } } as any);

    await AnalyticsService.getCampaignAnalytics(
      'campaign-1',
      '7days',
      'user-token',
      'user-1',
      false,
    );

    const requestConfig = vi.mocked(directusApi.get).mock.calls[1][1] as any;
    expect(requestConfig.headers.Authorization).toBe('Bearer service-token');
    expect(JSON.parse(requestConfig.params.filter)).toEqual({
      campaign_id: { _eq: 'campaign-1' },
      status: { _in: ['published', 'partially_published', 'partial'] },
      user_id: { _eq: 'user-1' },
    });
  });

  it('does not disguise a Directus failure as successful zero analytics', async () => {
    vi.mocked(directusApi.get)
      .mockResolvedValueOnce(ownedCampaign)
      .mockRejectedValueOnce(new Error('Directus denied access'));

    await expect(
      AnalyticsService.getCampaignAnalytics('campaign-1', '7days', 'user-token', 'user-1'),
    ).rejects.toThrow('Directus denied access');
  });

  it('rejects a foreign campaign before reading content or invoking scraper work', async () => {
    vi.mocked(directusApi.get).mockResolvedValueOnce({
      data: { data: { id: 'campaign-1', user_id: 'another-user', social_media_settings: {} } },
    } as any);

    await expect(
      AnalyticsService.getCampaignAnalytics('campaign-1', '7days', 'user-token', 'user-1'),
    ).rejects.toMatchObject({ status: 404, code: 'CAMPAIGN_NOT_FOUND' });
    expect(directusApi.get).toHaveBeenCalledTimes(1);
  });

  it('allows an administrator to read a campaign owned by another user', async () => {
    vi.mocked(directusApi.get)
      .mockResolvedValueOnce({
        data: { data: { id: 'campaign-1', user_id: 'another-user', social_media_settings: {} } },
      } as any)
      .mockResolvedValueOnce({ data: { data: [] } } as any);

    await expect(
      AnalyticsService.getCampaignAnalytics('campaign-1', '7days', 'admin-token', 'admin-1', true),
    ).resolves.toMatchObject({ success: true });
  });
});

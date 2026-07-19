import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../services/trend-collector', () => ({
  SCRAPER_BASE: 'http://analytics.test',
  getScraperApiKey: vi.fn().mockResolvedValue('test-key'),
}));

vi.mock('../utils/logger', () => ({
  log: Object.assign(vi.fn(), { warn: vi.fn() }),
}));

import axios from 'axios';
import {
  persistAnalyticsChannelId,
  resolveAnalyticsChannel,
} from '../services/scraper-analytics';

describe('resolveAnalyticsChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIRECTUS_URL = 'http://directus.test';
  });

  it('returns a cached UUID without HTTP calls', async () => {
    const result = await resolveAnalyticsChannel(
      'telegram',
      '@channel',
      'cached-uuid',
      'campaign-1',
      'admin-token',
    );

    expect(result).toBe('cached-uuid');
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.patch).not.toHaveBeenCalled();
  });

  it('finds an existing channel and persists its UUID', async () => {
    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        data: {
          items: [{
            id: 'existing-uuid',
            platform: 'telegram',
            platform_channel_id: '@channel',
          }],
          total: 1,
          page: 1,
          page_size: 100,
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            social_media_settings: {
              telegram: { chatId: '@channel' },
              vk: { groupId: '123' },
            },
          },
        },
      });
    vi.mocked(axios.patch).mockResolvedValue({ data: { data: {} } });

    const result = await resolveAnalyticsChannel(
      'telegram',
      '@channel',
      null,
      'campaign-1',
      'admin-token',
    );

    expect(result).toBe('existing-uuid');
    await vi.waitFor(() => {
      expect(axios.patch).toHaveBeenCalledWith(
        'http://directus.test/items/user_campaigns/campaign-1',
        {
          social_media_settings: {
            telegram: {
              chatId: '@channel',
              analyticsChannelId: 'existing-uuid',
            },
            vk: { groupId: '123' },
          },
        },
        expect.objectContaining({
          headers: { Authorization: 'Bearer admin-token' },
        }),
      );
    });
  });

  it('registers a missing channel and persists the created UUID', async () => {
    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, page_size: 100 },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            social_media_settings: {
              vk: { groupId: '123' },
            },
          },
        },
      });
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        id: 'created-uuid',
        platform: 'vk',
        platform_channel_id: '123',
      },
    });
    vi.mocked(axios.patch).mockResolvedValue({ data: { data: {} } });

    const result = await resolveAnalyticsChannel(
      'vk',
      '123',
      undefined,
      'campaign-1',
      'admin-token',
      'Campaign',
    );

    expect(result).toBe('created-uuid');
    expect(axios.post).toHaveBeenCalledWith(
      'http://analytics.test/api/v1/monitoring/channels',
      {
        platform: 'vk',
        platform_channel_id: '123',
        name: 'Campaign',
      },
      expect.any(Object),
    );
    await vi.waitFor(() => {
      expect(axios.patch).toHaveBeenCalledWith(
        'http://directus.test/items/user_campaigns/campaign-1',
        {
          social_media_settings: {
            vk: {
              groupId: '123',
              analyticsChannelId: 'created-uuid',
            },
          },
        },
        expect.any(Object),
      );
    });
  });

  it('returns null when lookup and registration both fail', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('lookup failed'));
    vi.mocked(axios.post).mockRejectedValueOnce(new Error('register failed'));

    await expect(resolveAnalyticsChannel(
      'telegram',
      '@channel',
      null,
      'campaign-1',
      'admin-token',
    )).resolves.toBeNull();

    expect(axios.patch).not.toHaveBeenCalled();
  });

  it('does not patch when Directus already stores the same UUID', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        data: {
          social_media_settings: {
            telegram: {
              chatId: '@channel',
              analyticsChannelId: 'existing-uuid',
            },
          },
        },
      },
    });

    await persistAnalyticsChannelId(
      'campaign-1',
      'telegram',
      'existing-uuid',
      'admin-token',
    );

    expect(axios.patch).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from 'vitest';
import {
  aggregatePublishedPlatformAnalytics,
  getPublishedPlatformPostIds,
  matchesPublishedPlatformPostId,
} from '../services/analytics-aggregation';

const from = new Date('2026-07-10T00:00:00.000Z');
const to = new Date('2026-07-16T00:00:00.000Z');

describe('aggregatePublishedPlatformAnalytics', () => {
  it('counts every published platform as a separate post', () => {
    const result = aggregatePublishedPlatformAnalytics([{
      status: 'published',
      scheduled_at: null,
      published_at: '2026-07-15T12:00:00.000Z',
      social_platforms: {
        telegram: { status: 'published', publishedAt: '2026-07-15T11:00:00.000Z' },
        vk: { status: 'published', publishedAt: '2026-07-15T11:05:00.000Z' },
        youtube: { status: 'failed' },
      },
    }], from, to);

    expect(result.totalPosts).toBe(2);
    expect(result.platformStatsMap.get('telegram')?.posts).toBe(1);
    expect(result.platformStatsMap.get('vk')?.posts).toBe(1);
  });

  it('counts publications on every platform even when analytics are unavailable', () => {
    const platforms = ['instagram', 'facebook', 'telegram', 'vk', 'youtube', 'threads', 'tiktok'];
    const socialPlatforms = Object.fromEntries(platforms.map((platform) => [platform, {
      status: 'published',
      publishedAt: '2026-07-15T11:00:00.000Z',
    }]));

    const result = aggregatePublishedPlatformAnalytics([{
      status: 'published',
      social_platforms: socialPlatforms,
    }], from, to);

    expect(result.totalPosts).toBe(platforms.length);
    expect(result.totalViews).toBe(0);
    expect(Array.from(result.platformStatsMap.keys()).sort()).toEqual(platforms.sort());
    expect(Array.from(result.platformStatsMap.values()).every((stats) => stats.views === 0)).toBe(true);
  });

  it('counts immediate publications with no scheduled_at', () => {
    const result = aggregatePublishedPlatformAnalytics([{
      status: 'published',
      scheduled_at: null,
      published_at: '2026-07-15T12:00:00.000Z',
      social_platforms: {
        telegram: { status: 'published' },
      },
    }], from, to);

    expect(result.totalPosts).toBe(1);
  });

  it('uses each platform publication time instead of the content schedule', () => {
    const result = aggregatePublishedPlatformAnalytics([{
      status: 'partially_published',
      scheduled_at: '2026-06-01T12:00:00.000Z',
      social_platforms: {
        telegram: { status: 'published', publishedAt: '2026-07-15T10:00:00.000Z' },
        vk: { status: 'published', publishedAt: '2026-07-01T10:00:00.000Z' },
      },
    }], from, to);

    expect(result.totalPosts).toBe(1);
    expect(result.platformStatsMap.has('telegram')).toBe(true);
    expect(result.platformStatsMap.has('vk')).toBe(false);
  });

  it('counts platform publications regardless of the content-level partial status', () => {
    const result = aggregatePublishedPlatformAnalytics([{
      status: 'partial',
      published_at: '2026-07-15T12:00:00.000Z',
      social_platforms: JSON.stringify({
        telegram: {
          status: 'published',
          analytics: { views: '10', likes: 2, comments: 1, shares: 3 },
        },
      }),
    }], from, to);

    expect(result.totalPosts).toBe(1);
    expect(result.totalViews).toBe(10);
    expect(result.totalLikes).toBe(2);
    expect(result.totalComments).toBe(1);
    expect(result.totalShares).toBe(3);
  });

  it('does not attribute publications without any timestamp to a selected period', () => {
    const result = aggregatePublishedPlatformAnalytics([{
      status: 'published',
      social_platforms: {
        telegram: { status: 'published' },
      },
    }], from, to);

    expect(result.totalPosts).toBe(0);
    expect(result.platformStatsMap.size).toBe(0);
  });

  it('matches scraper metrics only to VK publications from this campaign', () => {
    const ids = getPublishedPlatformPostIds([{
      published_at: '2026-07-15T12:00:00.000Z',
      social_platforms: {
        vk: {
          status: 'published',
          postId: '-228626989_1818',
          postUrl: 'https://vk.com/wall-228626989_1818',
        },
      },
    }], 'vk', from, to);

    expect(matchesPublishedPlatformPostId(ids, '-228626989_1818')).toBe(true);
    expect(matchesPublishedPlatformPostId(ids, '1818')).toBe(true);
    expect(matchesPublishedPlatformPostId(ids, '-228626989_1700')).toBe(false);
  });

  it('matches a closed Telegram publication by its saved messageId', () => {
    const ids = getPublishedPlatformPostIds([{
      published_at: '2026-07-15T12:00:00.000Z',
      social_platforms: {
        telegram: { status: 'published', postId: '456' },
      },
    }], 'telegram', from, to);

    expect(matchesPublishedPlatformPostId(ids, '456')).toBe(true);
    expect(matchesPublishedPlatformPostId(ids, '455')).toBe(false);
  });
});

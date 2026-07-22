import { describe, expect, it } from 'vitest';
import type { CampaignContent, SocialPlatform } from '@/types';
import {
  countConfirmedPlatformPublications,
  getConfirmedPublicationEvents,
  getConfirmedPublicationDates,
  getFailedPlatforms,
  getFailedPublicationAttemptDate,
  getPublishedDisplayDate,
  getPublicationCardDates,
  hasConfirmedPublication,
  hasFailedPublicationAttempt,
  isFullyFailedPublication,
} from '../published-content';

function content(overrides: Partial<CampaignContent>): CampaignContent {
  return {
    id: 'content-1',
    title: 'Post',
    content: 'Text',
    contentType: 'text',
    campaignId: 'campaign-1',
    createdAt: '2026-07-10T10:00:00.000Z',
    status: 'draft',
    ...overrides,
  };
}

describe('published content helpers', () => {
  it('counts only confirmed platform publications', () => {
    const posts = [
      content({
        status: 'published',
        socialPlatforms: {
          telegram: { status: 'published', publishedAt: '2026-07-15T09:00:00.000Z' },
        } as any,
      }),
      content({
        id: 'content-2',
        status: 'scheduled',
        socialPlatforms: {
          telegram: { status: 'scheduled', scheduledAt: '2026-07-16T09:00:00.000Z' },
        } as any,
      }),
      content({
        id: 'content-3',
        status: 'partial',
        socialPlatforms: {
          telegram: { status: 'failed' },
          vk: { status: 'published', publishedAt: '2026-07-15T09:05:00.000Z' },
        } as any,
      }),
    ];

    expect(countConfirmedPlatformPublications(
      posts,
      ['telegram', 'vk'] as SocialPlatform[],
    )).toEqual({ telegram: 1, vk: 1 });
  });

  it('limits platform counts to the visible calendar period', () => {
    const posts = [
      content({
        status: 'published',
        socialPlatforms: {
          telegram: { status: 'published', publishedAt: '2026-07-15T09:00:00.000Z' },
        } as any,
      }),
      content({
        id: 'content-2',
        status: 'published',
        socialPlatforms: {
          telegram: { status: 'published', publishedAt: '2026-08-01T09:00:00.000Z' },
        } as any,
      }),
    ];

    expect(countConfirmedPlatformPublications(
      posts,
      ['telegram'] as SocialPlatform[],
      {
        from: new Date('2026-07-01T00:00:00.000Z'),
        to: new Date('2026-07-31T23:59:59.999Z'),
      },
    )).toEqual({ telegram: 1 });
  });

  it('does not mark both scheduled and actual dates for an already published post', () => {
    const dates = getConfirmedPublicationDates(content({
      status: 'published',
      scheduledAt: '2026-07-14T09:00:00.000Z',
      publishedAt: '2026-07-15T09:00:00.000Z',
      socialPlatforms: {
        telegram: { status: 'published', publishedAt: '2026-07-15T09:00:00.000Z' },
      } as any,
    }));

    expect(dates.map((date) => date.toISOString())).toEqual([
      '2026-07-15T09:00:00.000Z',
    ]);
  });

  it('creates one calendar event for every published platform', () => {
    const events = getConfirmedPublicationEvents(content({
      status: 'published',
      publishedAt: '2026-07-15T09:05:00.000Z',
      socialPlatforms: {
        telegram: { status: 'published', publishedAt: '2026-07-15T09:00:00.000Z' },
        vk: { status: 'published', publishedAt: '2026-07-15T09:05:00.000Z' },
        youtube: { status: 'failed' },
      } as any,
    }));

    expect(events.map(({ key }) => key).sort()).toEqual([
      'content-1:telegram',
      'content-1:vk',
    ]);
  });

  it('excludes scheduled and failed attempts from published content', () => {
    expect(hasConfirmedPublication(content({
      status: 'scheduled',
      socialPlatforms: { telegram: { status: 'scheduled' } } as any,
    }))).toBe(false);
    expect(hasConfirmedPublication(content({
      status: 'scheduled',
      socialPlatforms: { telegram: { status: 'failed' } } as any,
    }))).toBe(false);
  });

  it('does not treat a bare published platform status as a confirmed event', () => {
    const item = content({
      status: 'scheduled',
      socialPlatforms: { telegram: { status: 'published' } } as any,
    });

    expect(hasConfirmedPublication(item)).toBe(false);
    expect(getConfirmedPublicationEvents(item)).toEqual([]);
  });

  it('keeps a fully failed post reachable on its scheduled day for retry', () => {
    const failed = content({
      status: 'scheduled',
      scheduledAt: '2026-07-16T09:00:00.000Z',
      socialPlatforms: {
        telegram: {
          status: 'failed',
          error: 'Telegram API error',
          failedAt: '2026-07-16T09:01:00.000Z',
        },
      } as any,
    });

    expect(hasFailedPublicationAttempt(failed)).toBe(true);
    expect(getFailedPublicationAttemptDate(failed)?.toISOString()).toBe('2026-07-16T09:00:00.000Z');
    expect(getPublicationCardDates(failed).map((date) => date.toISOString())).toEqual([
      '2026-07-16T09:00:00.000Z',
    ]);
    expect(getConfirmedPublicationEvents(failed)).toEqual([]);
  });

  it('shows a partially published post only on its actual publication date', () => {
    const partial = content({
      status: 'partial',
      scheduledAt: '2026-07-14T09:00:00.000Z',
      socialPlatforms: {
        telegram: { status: 'failed', error: 'Timeout' },
        vk: { status: 'published', publishedAt: '2026-07-15T09:00:00.000Z' },
      } as any,
    });

    expect(getFailedPublicationAttemptDate(partial)).toBeNull();
    expect(getPublicationCardDates(partial).map((date) => date.toISOString())).toEqual([
      '2026-07-15T09:00:00.000Z',
    ]);
  });

  it('uses a confirmed platform timestamp when the aggregate timestamp is missing', () => {
    const published = content({
      status: 'published',
      scheduledAt: '2026-07-17T08:00:00.000Z',
      publishedAt: null,
      socialPlatforms: {
        telegram: {
          status: 'published',
          postId: '42',
          publishedAt: '2026-07-17T09:30:00.000Z',
        },
      } as any,
    });

    expect(getPublishedDisplayDate(published)?.toISOString()).toBe('2026-07-17T09:30:00.000Z');
  });

  it('prefers the aggregate publication timestamp when both timestamps exist', () => {
    const published = content({
      status: 'published',
      publishedAt: '2026-07-17T10:00:00.000Z',
      socialPlatforms: {
        telegram: {
          status: 'published',
          postId: '42',
          publishedAt: '2026-07-17T09:30:00.000Z',
        },
      } as any,
    });

    expect(getPublishedDisplayDate(published)?.toISOString()).toBe('2026-07-17T10:00:00.000Z');
  });
});

describe('isFullyFailedPublication', () => {
  it('returns true when all platforms failed', () => {
    const post = content({
      status: 'failed',
      socialPlatforms: {
        telegram: { status: 'failed', error: 'timeout' },
        vk: { status: 'failed', error: 'auth' },
      } as any,
    });
    expect(isFullyFailedPublication(post)).toBe(true);
  });

  it('returns false for a partial post (at least one platform succeeded)', () => {
    const post = content({
      status: 'partial',
      socialPlatforms: {
        telegram: { status: 'failed', error: 'timeout' },
        vk: { status: 'published', publishedAt: '2026-07-15T09:00:00.000Z' },
      } as any,
    });
    expect(isFullyFailedPublication(post)).toBe(false);
  });

  it('returns false for a post with no platforms at all', () => {
    const post = content({ status: 'draft' });
    expect(isFullyFailedPublication(post)).toBe(false);
  });
});

describe('getFailedPlatforms', () => {
  it('lists every platform that failed, ignoring successful ones', () => {
    const post = content({
      status: 'partial',
      socialPlatforms: {
        telegram: { status: 'failed', error: 'timeout' },
        vk: { status: 'published', publishedAt: '2026-07-15T09:00:00.000Z' },
        instagram: { status: 'failed', error: 'rate-limit' },
      } as any,
    });
    const failed = getFailedPlatforms(post);
    expect(failed.map((f) => f.platform).sort()).toEqual(['instagram', 'telegram']);
    expect(failed.find((f) => f.platform === 'telegram')?.reason).toBe('timeout');
  });

  it('returns an empty list for fully successful posts', () => {
    const post = content({
      status: 'published',
      socialPlatforms: {
        telegram: { status: 'published', publishedAt: '2026-07-15T09:00:00.000Z' },
      } as any,
    });
    expect(getFailedPlatforms(post)).toEqual([]);
  });
});

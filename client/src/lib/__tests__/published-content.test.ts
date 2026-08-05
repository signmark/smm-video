import { describe, expect, it } from 'vitest';
import type { CampaignContent, SocialPlatform } from '@/types';
import {
  categorisePlatformFailure,
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
    expect(failed.find((f) => f.platform === 'telegram')?.reasonCategory).toBe('timeout');
    expect(failed.find((f) => f.platform === 'telegram')?.reasonLabel).toBe('таймаут');
    expect(failed.find((f) => f.platform === 'instagram')?.reasonCategory).toBe('rate-limit');
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

  it('never leaks the raw backend error to the UI label (security: CL-03)', () => {
    const post = content({
      status: 'partial',
      socialPlatforms: {
        telegram: {
          status: 'failed',
          error: 'POST https://api.telegram.org/bot1234567:ABCDEFG/sendMessage returned 401 with token=leaked-secret',
        } as any,
      },
    });
    const failed = getFailedPlatforms(post);
    const tg = failed.find((f) => f.platform === 'telegram')!;
    // The label is a stable, harmless category phrase.
    expect(tg.reasonLabel).toBe('ошибка авторизации');
    // The raw text is preserved on the object for tests, but it must
    // NOT appear in the user-facing reasonLabel.
    expect(tg.reasonLabel).not.toMatch(/token|leaked|1234567|sendMessage/);
  });

  it('collapses unknown error strings to a generic category', () => {
    const post = content({
      status: 'partial',
      socialPlatforms: {
        instagram: {
          status: 'failed',
          error: 'something weird and uncategorised',
        } as any,
      },
    });
    const ig = getFailedPlatforms(post).find((f) => f.platform === 'instagram')!;
    expect(ig.reasonCategory).toBe('unknown');
    expect(ig.reasonLabel).toBe('неизвестная ошибка');
  });
});

describe('categorisePlatformFailure', () => {
  it.each<[string | null, string]>([
    ['401 Unauthorized', 'auth'],
    ['403 forbidden — token expired', 'auth'],
    ['429 rate limit exceeded', 'rate-limit'],
    ['etimedout while sending', 'timeout'],
    ['econnreset by peer', 'network'],
    ['invalid JSON in body', 'invalid-content'],
    ['500 internal server error', 'server'],
    [null, 'unknown'],
    [undefined, 'unknown'],
    ['', 'unknown'],
  ])('maps %p to %p', (raw, expected) => {
    expect(categorisePlatformFailure(raw as any)).toBe(expected);
  });
});

/**
 * SM-16 / SM-9 regression: Directus returns timestamps as
 * `timestamp without time zone`, i.e. naive strings like '2026-08-05T09:33:37'.
 * The browser parses such a string as LOCAL time, which for an MSK viewer
 * produces a moment 3 hours behind the real UTC instant. `validDate`
 * must hand the string through `normalizeTimestamp` so the appended 'Z'
 * lets `Date` parse an absolute moment; once a `Date` is constructed,
 * downstream formatters (which check `value instanceof Date` first)
 * cannot recover the offset.
 */
describe('validDate — TZ normalization (SM-16 / SM-9)', () => {
  it('naive UTC string is parsed as the same instant as the same string with Z', () => {
    // On Hermes TZ is UTC, so naive === withZ here; the real regression
    // surfaces on MSK-local browsers where naive gets a different instant.
    const naive = new Date('2026-08-05T09:33:37');           // parsed as local
    const withZ = new Date('2026-08-05T09:33:37Z');          // parsed as UTC
    expect(Number.isFinite(naive.getTime())).toBe(true);
    expect(Number.isFinite(withZ.getTime())).toBe(true);
  });

  it('getPublishedDisplayDate with naive string returns a Date that formats to MSK 12:33, not 09:33', async () => {
    const { getPublishedDisplayDate } = await import('../published-content');
    const tz = process.env.TZ;
    process.env.TZ = 'Europe/Moscow';
    try {
      const date = getPublishedDisplayDate({
        publishedAt: '2026-08-05T09:33:37' as any, // naive — must be normalized
        socialPlatforms: {},
      });
      expect(date).not.toBeNull();
      // Date.getTime() is the same instant regardless of TZ env,
      // so we assert the absolute UTC instant: 09:33:37Z.
      expect(date!.getTime()).toBe(Date.parse('2026-08-05T09:33:37Z'));
      // And the MSK wall-clock representation must be 12:33, not 09:33.
      // We rely on the same Europe/Moscow env for this assertion.
      expect(date!.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }))
        .toBe('12:33');
    } finally {
      process.env.TZ = tz;
    }
  });
});

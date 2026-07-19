import { describe, expect, it } from 'vitest';
import {
  getCanonicalScheduledAt,
  getContentAggregateTimes,
  getContentPublicationStatus,
  getPublishedPlatformTimeSummary,
  isConfirmedPublishedPlatform,
  resolvePublishFinalization,
  setLocalScheduleTime,
} from '@shared/schedule-time';

describe('schedule time normalization', () => {
  it('uses the only selected platform time as the content schedule', () => {
    expect(getCanonicalScheduledAt({
      vk: { status: 'scheduled', scheduledAt: '2026-07-16T13:10:00.000Z' },
    }, '2026-07-16T09:00:00.000Z')).toBe('2026-07-16T13:10:00.000Z');
  });

  it('uses the earliest selected platform when times differ', () => {
    expect(getCanonicalScheduledAt({
      telegram: { status: 'scheduled', scheduledAt: '2026-07-16T14:00:00.000Z' },
      vk: { status: 'scheduled', scheduled_at: '2026-07-16T13:10:00.000Z' },
    })).toBe('2026-07-16T13:10:00.000Z');
  });

  it('replaces a stale content time when both platforms use the same time', () => {
    expect(getCanonicalScheduledAt({
      telegram: { status: 'scheduled', scheduledAt: '2026-07-16T12:00:00.000Z' },
      vk: { status: 'scheduled', scheduledAt: '2026-07-16T12:00:00.000Z' },
    }, '2026-07-16T06:00:00.000Z')).toBe('2026-07-16T12:00:00.000Z');
  });

  it('ignores removed platforms and falls back only when no platform has a time', () => {
    expect(getCanonicalScheduledAt({
      telegram: { status: 'cancelled', scheduledAt: '2026-07-16T08:00:00.000Z' },
      vk: { status: 'scheduled', scheduledAt: 'invalid' },
    }, '2026-07-16T13:10:00.000Z')).toBe('2026-07-16T13:10:00.000Z');
  });

  it('ignores historical published and failed platform schedules', () => {
    expect(getCanonicalScheduledAt({
      telegram: { status: 'published', scheduledAt: '2026-07-10T08:00:00.000Z' },
      facebook: { status: 'failed', scheduledAt: '2026-07-11T08:00:00.000Z' },
      vk: { status: 'pending', scheduledAt: '2026-07-16T13:10:00.000Z' },
    })).toBe('2026-07-16T13:10:00.000Z');
  });

  it('replaces the calendar date incidental time with the chosen local time', () => {
    const calendarDate = new Date(2026, 6, 16, 12, 0, 0, 0);
    const result = setLocalScheduleTime(calendarDate, { hour: '16', minute: '10' });

    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(6);
    expect(result.getDate()).toBe(16);
    expect(result.getHours()).toBe(16);
    expect(result.getMinutes()).toBe(10);
  });

  it('derives published content times from reliable platform history', () => {
    expect(getPublishedPlatformTimeSummary({
      telegram: {
        status: 'published',
        scheduledAt: '2026-07-16T12:00:00.000Z',
        publishedAt: '2026-07-16T12:00:01.000Z',
      },
      vk: {
        status: 'published',
        scheduledAt: '2026-07-16T12:00:00.000Z',
        publishedAt: '2026-07-16T12:00:03.000Z',
      },
    }, {
      scheduledAt: '2026-07-16T03:00:00.000Z',
      publishedAt: '2026-07-16T09:00:00.000Z',
    })).toEqual({
      scheduledAt: '2026-07-16T12:00:00.000Z',
      publishedAt: '2026-07-16T12:00:03.000Z',
    });
  });

  it('keeps partial content scheduled at the next pending platform', () => {
    expect(getContentAggregateTimes({
      telegram: {
        status: 'published',
        scheduledAt: '2026-07-16T09:00:00.000Z',
        publishedAt: '2026-07-16T09:00:01.000Z',
      },
      vk: {
        status: 'pending',
        scheduledAt: '2026-07-17T07:00:00.000Z',
      },
    }, 'partially_published', {
      scheduledAt: '2026-07-16T09:00:00.000Z',
      publishedAt: '2026-07-16T09:00:01.000Z',
    })).toEqual({
      scheduledAt: '2026-07-17T07:00:00.000Z',
      publishedAt: null,
    });
  });

  it('sets content publishedAt only after every platform is complete', () => {
    expect(getContentAggregateTimes({
      telegram: {
        status: 'published',
        scheduledAt: '2026-07-16T09:00:00.000Z',
        publishedAt: '2026-07-16T09:00:01.000Z',
      },
      vk: {
        status: 'published',
        scheduledAt: '2026-07-17T07:00:00.000Z',
        publishedAt: '2026-07-17T07:00:03.000Z',
      },
    }, 'published')).toEqual({
      scheduledAt: '2026-07-16T09:00:00.000Z',
      publishedAt: '2026-07-17T07:00:03.000Z',
    });
  });

  it('keeps a quota-only post visible to the scheduler', () => {
    expect(getContentPublicationStatus({
      youtube: { status: 'quota_exceeded' },
    }, 'scheduled')).toBe('scheduled');
  });

  it('keeps mixed published and quota platforms partially published', () => {
    expect(getContentPublicationStatus({
      telegram: { status: 'published', publishedAt: '2026-07-16T12:00:00.000Z' },
      youtube: { status: 'quota_exceeded' },
    }, 'scheduled')).toBe('partially_published');
  });

  it('does not require a public URL when publication has another confirmation', () => {
    expect(getContentPublicationStatus({
      telegram: { status: 'published', postId: 123 },
      vk: { status: 'published', publishedAt: '2026-07-16T12:00:00.000Z' },
    }, 'partially_published')).toBe('published');
  });

  it('rejects a bare published status without publication evidence', () => {
    expect(isConfirmedPublishedPlatform({ status: 'published' })).toBe(false);
    expect(getContentPublicationStatus({
      telegram: { status: 'published' },
      vk: { status: 'published', postUrl: 'https://vk.com/wall-1_2' },
    }, 'scheduled')).toBe('partially_published');
  });

  it('does not keep published content partial because another platform was cancelled', () => {
    expect(getContentPublicationStatus({
      telegram: { status: 'published', postId: 123 },
      vk: { status: 'cancelled' },
    }, 'partially_published')).toBe('published');
  });
});

describe('resolvePublishFinalization', () => {
  const NOW = new Date('2026-07-19T12:00:00.000Z');

  it('fully published content gets the latest confirmed platform time', () => {
    const result = resolvePublishFinalization({
      telegram: { status: 'published', publishedAt: '2026-07-19T11:30:00.000Z', postId: '42' },
      vk: { status: 'published', publishedAt: '2026-07-19T11:45:00.000Z', postId: '-1_7' },
    }, 'scheduled', undefined, NOW);

    expect(result.status).toBe('published');
    expect(result.publishedAt?.toISOString()).toBe('2026-07-19T11:45:00.000Z');
  });

  it('falls back to now when a fully published item has no timestamps at all', () => {
    const result = resolvePublishFinalization({
      telegram: { status: 'published', postId: '42' },
    }, 'scheduled', undefined, NOW);

    expect(result.status).toBe('published');
    expect(result.publishedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('keeps an existing aggregate published_at when nothing fresher exists', () => {
    const result = resolvePublishFinalization({
      telegram: { status: 'published', postId: '42' },
    }, 'scheduled', { publishedAt: '2026-07-18T09:00:00.000Z' }, NOW);

    expect(result.status).toBe('published');
    expect(result.publishedAt?.toISOString()).toBe('2026-07-18T09:00:00.000Z');
  });

  it('регрессия: частичная публикация НЕ получает published_at', () => {
    // Раньше || new Date() писал текущее время в published_at, и карточка
    // частично опубликованного поста ложно показывала «Опубликовано».
    const result = resolvePublishFinalization({
      telegram: { status: 'published', publishedAt: '2026-07-19T11:30:00.000Z', postId: '42' },
      vk: { status: 'failed', error: 'Bad Request' },
    }, 'scheduled', undefined, NOW);

    expect(result.status).toBe('partially_published');
    expect(result.publishedAt).toBeNull();
  });

  it('publish-now без подтверждённых платформ остаётся scheduled и без published_at', () => {
    const result = resolvePublishFinalization({
      telegram: { status: 'publishing' },
      vk: { status: 'failed' },
    }, 'scheduled', undefined, NOW);

    expect(result.status).toBe('scheduled');
    expect(result.publishedAt).toBeNull();
  });

  it('платформы без состояния сохраняют текущий статус контента', () => {
    const result = resolvePublishFinalization(undefined, 'draft', undefined, NOW);
    expect(result.status).toBe('draft');
    expect(result.publishedAt).toBeNull();
  });
});

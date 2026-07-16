import { describe, expect, it } from 'vitest';
import {
  getCanonicalScheduledAt,
  getPublishedPlatformTimeSummary,
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
});

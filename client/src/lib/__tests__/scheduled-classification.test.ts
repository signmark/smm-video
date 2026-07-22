import { describe, expect, it } from 'vitest';
import type { CampaignContent } from '@/types';
import {
  classifyScheduled,
  countByBucket,
  splitScheduled,
} from '../scheduled-classification';

const NOW = new Date('2026-07-22T10:00:00.000Z');

function content(overrides: Partial<CampaignContent>): CampaignContent {
  return {
    id: 'content-1',
    title: 'Sample',
    content: '',
    contentType: 'text',
    campaignId: 'campaign-1',
    createdAt: '2026-07-01T00:00:00.000Z',
    status: 'scheduled',
    ...overrides,
  } as CampaignContent;
}

describe('classifyScheduled', () => {
  it('classifies a post dated today as upcoming', () => {
    const c = content({ scheduledAt: '2026-07-22T08:00:00.000Z' as any });
    expect(classifyScheduled(c, NOW).bucket).toBe('upcoming');
  });

  it('classifies a post dated tomorrow as upcoming', () => {
    const c = content({ scheduledAt: '2026-07-23T08:00:00.000Z' as any });
    expect(classifyScheduled(c, NOW).bucket).toBe('upcoming');
  });

  it('classifies a post dated yesterday as overdue', () => {
    // Use a date that is unambiguously before today in any reasonable
    // timezone. The function compares against local midnight, so we
    // offset the date by 25h to be safe regardless of host TZ.
    const yesterday = new Date(NOW);
    yesterday.setDate(yesterday.getDate() - 2);
    const c = content({ scheduledAt: yesterday.toISOString() as any });
    expect(classifyScheduled(c, NOW).bucket).toBe('overdue');
  });

  it('classifies a post dated years ago as overdue', () => {
    const c = content({ scheduledAt: '2025-12-01T08:00:00.000Z' as any });
    expect(classifyScheduled(c, NOW).bucket).toBe('overdue');
  });

  it('classifies a post without scheduledAt and no per-platform date as unscheduledDate', () => {
    const c = content({
      scheduledAt: undefined as any,
      socialPlatforms: {
        telegram: { status: 'scheduled' } as any,
      },
    });
    expect(classifyScheduled(c, NOW).bucket).toBe('unscheduledDate');
  });

  it('falls back to per-platform scheduledAt when aggregate is missing', () => {
    const c = content({
      scheduledAt: undefined as any,
      socialPlatforms: {
        telegram: { status: 'scheduled', scheduledAt: '2026-07-22T08:00:00.000Z' } as any,
      },
    });
    const cls = classifyScheduled(c, NOW);
    expect(cls.bucket).toBe('upcoming');
    expect(cls.hasParseableDate).toBe(true);
  });

  it('ignores per-platform scheduledAt when the platform is already published', () => {
    const c = content({
      scheduledAt: undefined as any,
      socialPlatforms: {
        telegram: { status: 'published', scheduledAt: '2026-07-22T08:00:00.000Z' } as any,
      },
    });
    expect(classifyScheduled(c, NOW).bucket).toBe('unscheduledDate');
  });

  it('classifies a post scheduled at exactly midnight today as upcoming (not overdue)', () => {
    // Build "local midnight today" so the test is timezone-independent:
    const localMidnight = new Date(NOW);
    localMidnight.setHours(0, 0, 0, 0);
    const c = content({ scheduledAt: localMidnight.toISOString() as any });
    expect(classifyScheduled(c, NOW).bucket).toBe('upcoming');
  });
});

describe('splitScheduled', () => {
  it('partitions a mixed sample into the three buckets', () => {
    const tomorrow = new Date(NOW);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const twoDaysAgo = new Date(NOW);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const longAgo = '2025-01-01T08:00:00.000Z';
    const items: CampaignContent[] = [
      content({ id: 'a', scheduledAt: NOW.toISOString() as any }),
      content({ id: 'b', scheduledAt: tomorrow.toISOString() as any }),
      content({ id: 'c', scheduledAt: twoDaysAgo.toISOString() as any }),
      content({ id: 'd', scheduledAt: longAgo as any }),
      content({ id: 'e' }),
    ];
    const split = splitScheduled(items, NOW);
    expect(split.upcoming.map((i) => i.id).sort()).toEqual(['a', 'b']);
    expect(split.overdue.map((i) => i.id).sort()).toEqual(['c', 'd']);
    expect(split.unscheduledDate.map((i) => i.id)).toEqual(['e']);
  });

  it('handles an empty array', () => {
    const split = splitScheduled([], NOW);
    expect(split).toEqual({ upcoming: [], overdue: [], unscheduledDate: [] });
  });
});

describe('countByBucket', () => {
  it('returns a total that matches the sum of the three buckets', () => {
    const twoDaysAgo = new Date(NOW);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const split = splitScheduled(
      [
        content({ id: 'a', scheduledAt: NOW.toISOString() as any }),
        content({ id: 'b', scheduledAt: twoDaysAgo.toISOString() as any }),
        content({ id: 'c' }),
      ],
      NOW,
    );
    const counts = countByBucket(split);
    expect(counts.total).toBe(counts.upcoming + counts.overdue + counts.unscheduledDate);
    expect(counts.upcoming).toBe(1);
    expect(counts.overdue).toBe(1);
    expect(counts.unscheduledDate).toBe(1);
  });
});

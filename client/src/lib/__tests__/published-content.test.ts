import { describe, expect, it } from 'vitest';
import type { CampaignContent, SocialPlatform } from '@/types';
import {
  countConfirmedPlatformPublications,
  getConfirmedPublicationEvents,
  getConfirmedPublicationDates,
  hasConfirmedPublication,
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
});

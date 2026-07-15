import { describe, expect, it } from 'vitest';
import { getPublishedPlatformIds, getVisibleCardPlatforms } from '../social-platforms';

describe('getVisibleCardPlatforms', () => {
  it('shows only the platforms selected for scheduled publication', () => {
    const stored = {
      telegram: { status: 'pending' },
      vk: { status: 'pending' },
    };

    const result = getVisibleCardPlatforms(stored, {
      status: 'scheduled',
      scheduledAt: '2026-07-15T13:00:00.000Z',
    });

    expect(Object.keys(result)).toEqual(['telegram', 'vk']);
  });

  it('does not show connected or adapted platforms before scheduling', () => {
    const result = getVisibleCardPlatforms({
      telegram: { status: 'pending' },
      vk: { status: 'pending' },
      youtube: { status: 'pending' },
    }, { status: 'draft', scheduledAt: null });

    expect(result).toEqual({});
  });

  it('does not show platform icons after scheduling is cancelled', () => {
    const result = getVisibleCardPlatforms({
      telegram: { status: 'cancelled' },
    }, { status: 'draft', scheduledAt: null });

    expect(result).toEqual({});
  });

  it('retains publication history for a platform disconnected later', () => {
    const result = getVisibleCardPlatforms({
      vk: { status: 'published', postUrl: 'https://vk.example/post/1' },
    }, { status: 'draft', scheduledAt: null });

    expect(Object.keys(result)).toEqual(['vk']);
    expect(result.vk.status).toBe('published');
  });

  it('keeps failed publication attempts visible', () => {
    const result = getVisibleCardPlatforms({
      telegram: { status: 'failed', error: 'Telegram error' },
    }, { status: 'draft', scheduledAt: null });

    expect(Object.keys(result)).toEqual(['telegram']);
  });
});

describe('getPublishedPlatformIds', () => {
  it('returns only platforms with a confirmed published status', () => {
    expect(getPublishedPlatformIds({
      telegram: { status: 'published' },
      vk: { status: 'pending' },
      youtube: { status: 'failed' },
    })).toEqual(['telegram']);
  });

  it('supports social platform data returned as JSON', () => {
    expect(getPublishedPlatformIds(JSON.stringify({
      telegram: { status: 'published' },
      vk: { status: 'published' },
    }))).toEqual(['telegram', 'vk']);
  });
});

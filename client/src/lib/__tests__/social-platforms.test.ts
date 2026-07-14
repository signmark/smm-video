import { describe, expect, it } from 'vitest';
import { getVisibleCardPlatforms } from '../social-platforms';

describe('getVisibleCardPlatforms', () => {
  it('shows only platforms connected to the campaign', () => {
    const stored = {
      telegram: { status: 'pending' },
      vk: { status: 'pending' },
      instagram: { status: 'pending' },
      facebook: { status: 'pending' },
      youtube: { status: 'pending' },
      threads: { status: 'pending' },
    };

    const result = getVisibleCardPlatforms(stored, {
      telegram: true,
      vk: false,
      instagram: false,
      facebook: false,
      youtube: false,
      threads: false,
    });

    expect(Object.keys(result)).toEqual(['telegram']);
  });

  it('keeps the connected platform visible after scheduling is cancelled', () => {
    const result = getVisibleCardPlatforms({}, { telegram: true });

    expect(result).toEqual({
      telegram: {
        platform: 'telegram',
        status: 'connected',
        publishedAt: null,
        selected: true,
      },
    });
  });

  it('does not flash stale platform icons while campaign settings are loading', () => {
    const result = getVisibleCardPlatforms({
      telegram: { status: 'pending' },
      vk: { status: 'pending' },
    }, null);

    expect(result).toEqual({});
  });

  it('retains publication history for a platform disconnected later', () => {
    const result = getVisibleCardPlatforms({
      vk: { status: 'published', postUrl: 'https://vk.example/post/1' },
    }, { telegram: true, vk: false });

    expect(Object.keys(result)).toEqual(['telegram', 'vk']);
    expect(result.vk.status).toBe('published');
  });
});

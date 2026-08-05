import { describe, expect, it } from 'vitest';
import {
  aggregateCampaignChannelPosts,
  groupChannelPostsIntoPublications,
} from '../services/analytics-aggregation';

// Real rows from prod channel mirgranita1 (SM-15). The publication stored
// postId=50; Telegram put the reaction on the album sibling /51.
const ALBUM_50_51 = [
  {
    platform_post_id: '50',
    published_date: '2026-08-04T14:00:47',
    captured_at: '2026-08-05T13:04:42',
    views: 2, likes: 0, comments: 0, shares: 0,
  },
  {
    platform_post_id: '51',
    published_date: '2026-08-04T14:00:47',
    captured_at: '2026-08-05T13:04:42',
    views: 2, likes: 1, comments: 0, shares: 0,
  },
];

describe('SM-15: album metrics', () => {
  it('counts the reaction that sits on the album sibling', () => {
    const result = aggregateCampaignChannelPosts(ALBUM_50_51, new Set(['50']));

    // Before the fix this was 0: only /50 matched and it carries no reaction.
    expect(result.likes).toBe(1);
  });

  it('does not double the reach of an album', () => {
    const result = aggregateCampaignChannelPosts(ALBUM_50_51, new Set(['50']));

    // Both messages report the same 2 views - summing them would inflate reach.
    expect(result.views).toBe(2);
    expect(result.posts).toBe(1);
  });

  it('groups siblings published a second apart', () => {
    // Prod pair /70 and /71 differ by one second, so exact timestamp equality
    // is not enough to recognise an album.
    const groups = groupChannelPostsIntoPublications([
      { platform_post_id: '70', published_date: '2026-08-05T09:26:06', views: 2, likes: 0 },
      { platform_post_id: '71', published_date: '2026-08-05T09:26:07', views: 2, likes: 1 },
    ]);

    expect(groups).toHaveLength(1);
  });

  it('keeps unrelated posts apart even when ids are consecutive', () => {
    // /63 and /64 are consecutive but 45s apart - separate publications.
    const groups = groupChannelPostsIntoPublications([
      { platform_post_id: '63', published_date: '2026-08-05T07:44:00', views: 2, likes: 0 },
      { platform_post_id: '64', published_date: '2026-08-05T07:44:45', views: 2, likes: 0 },
    ]);

    expect(groups).toHaveLength(2);
  });

  it('ignores albums that belong to no publication of this campaign', () => {
    // /17 carries a like but was posted manually - it is not ours to count.
    const result = aggregateCampaignChannelPosts(
      [{ platform_post_id: '17', published_date: '2026-07-31T09:00:19', views: 3, likes: 1 }],
      new Set(['50']),
    );

    expect(result.likes).toBe(0);
    expect(result.posts).toBe(0);
  });

  it('takes the latest snapshot of a post, not every capture', () => {
    const result = aggregateCampaignChannelPosts(
      [
        { platform_post_id: '90', published_date: '2026-08-05T10:00:00', captured_at: '2026-08-04T18:00:00', views: 100, likes: 1 },
        { platform_post_id: '90', published_date: '2026-08-05T10:00:00', captured_at: '2026-08-05T12:00:00', views: 250, likes: 4 },
      ],
      new Set(['90']),
    );

    expect(result.views).toBe(250);
    expect(result.likes).toBe(4);
    expect(result.posts).toBe(1);
  });
});

import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { updateContentCachesAfterMoveToDraft } from '../content-cache-updates';

describe('updateContentCachesAfterMoveToDraft', () => {
  it('moves content to draft in the main cache and removes it from scheduled cache', () => {
    const queryClient = new QueryClient();
    const content = {
      id: 'content-1',
      status: 'scheduled',
      scheduledAt: '2026-07-15T13:00:00.000Z',
      socialPlatforms: { telegram: { status: 'pending' } },
    };

    queryClient.setQueryData(['/api/campaign-content', 'campaign-1'], [content]);
    queryClient.setQueryData(['/api/campaign-content', 'campaign-1', 'scheduled'], [content]);

    updateContentCachesAfterMoveToDraft(queryClient, 'campaign-1', 'content-1');

    expect(queryClient.getQueryData(['/api/campaign-content', 'campaign-1']))
      .toEqual([expect.objectContaining({
        id: 'content-1',
        status: 'draft',
        scheduledAt: null,
        socialPlatforms: {},
      })]);
    expect(queryClient.getQueryData(['/api/campaign-content', 'campaign-1', 'scheduled']))
      .toEqual([]);
  });
});

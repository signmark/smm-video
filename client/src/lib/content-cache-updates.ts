import type { QueryClient } from '@tanstack/react-query';

type ContentCacheItem = {
  id: string | number;
  [key: string]: any;
};

export function updateContentCachesAfterMoveToDraft(
  queryClient: QueryClient,
  campaignId: string,
  contentId: string,
): void {
  const contentQueryKey = ['/api/campaign-content', campaignId] as const;
  const scheduledQueryKey = ['/api/campaign-content', campaignId, 'scheduled'] as const;

  queryClient.setQueryData<ContentCacheItem[]>(contentQueryKey, (current) =>
    current?.map((item) => String(item.id) === String(contentId)
      ? {
          ...item,
          status: 'draft',
          scheduledAt: null,
          socialPlatforms: {},
          scheduled_at: null,
          social_platforms: {},
        }
      : item)
  );

  queryClient.setQueryData<ContentCacheItem[]>(scheduledQueryKey, (current) =>
    current?.filter((item) => String(item.id) !== String(contentId))
  );
}

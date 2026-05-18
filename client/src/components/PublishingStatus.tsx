import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, AlertCircle, Clock, Settings, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { platformNames } from '@/lib/social-platforms';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';

interface PublishingStatusProps {
  contentId: string;
  className?: string;
}

interface PlatformStatus {
  status: 'pending' | 'publishing' | 'published' | 'failed';
  publishedAt?: string | null;
  postUrl?: string | null;
  error?: string | null;
  tokenExpired?: boolean;
  campaignId?: string;
}

interface StatusResponse {
  success: boolean;
  status: {
    platforms: Record<string, PlatformStatus>;
  };
  platforms: Record<string, PlatformStatus>;
}

const platformIcons: Record<string, string> = {
  instagram: '📸',
  telegram: '📱',
  vk: '💬',
  facebook: '👥',
  youtube: '📺',
  threads: '🧵'
};

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20',
  publishing: 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20',
  published: 'bg-green-500/10 text-green-500 hover:bg-green-500/20',
  failed: 'bg-red-500/10 text-red-500 hover:bg-red-500/20'
};

export function PublishingStatus({ contentId, className }: PublishingStatusProps) {
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['publishing-status', contentId],
    queryFn: async () => {
      const response = await fetch(`/api/content/${contentId}/publish-status`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });
      if (!response.ok) {
        throw new Error('Ошибка при получении статуса публикации');
      }
      return response.json() as Promise<StatusResponse>;
    },
    enabled: pollingEnabled,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true
  });

  useEffect(() => {
    if (data?.platforms) {
      const hasPublishingPlatforms = Object.values(data.platforms).some(
        platform => platform.status === 'publishing' || platform.status === 'pending'
      );
      setPollingEnabled(hasPublishingPlatforms);
    }
  }, [data]);

  const retryMutation = useMutation({
    mutationFn: async (platform: string) => {
      const response = await fetch('/api/retry-platform', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ contentId, platform })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Ошибка при повторной публикации');
      return { ...result, platform };
    },
    onMutate: (platform) => {
      // Optimistically set platform to 'publishing' in the cache
      queryClient.setQueryData(['publishing-status', contentId], (old: any) => {
        if (!old?.platforms) return old;
        return {
          ...old,
          platforms: {
            ...old.platforms,
            [platform]: { ...old.platforms[platform], status: 'publishing' }
          }
        };
      });
      setPollingEnabled(true);
    },
    onSuccess: (result) => {
      if (result.success) {
        toast({ title: 'Опубликовано', description: `Публикация в ${platformNames[result.platform as keyof typeof platformNames] || result.platform} выполнена успешно` });
      } else {
        toast({ title: 'Ошибка публикации', description: result.error || 'Не удалось опубликовать', variant: 'destructive' });
      }
      queryClient.invalidateQueries({ queryKey: ['publishing-status', contentId] });
    },
    onError: (error: Error) => {
      toast({ title: 'Ошибка', description: error.message, variant: 'destructive' });
      queryClient.invalidateQueries({ queryKey: ['publishing-status', contentId] });
    }
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (isError || !data) {
    return null;
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-4 w-4" />;
      case 'publishing':
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case 'published':
        return <CheckCircle2 className="h-4 w-4" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4" />;
      default:
        return null;
    }
  };

  return (
    <div className={cn("w-full", className)}>
      <div className="space-y-2">
        {Object.entries(data.platforms).map(([platform, status]) => {
          const isRetrying = retryMutation.isPending && retryMutation.variables === platform;
          return (
            <div key={platform} className="flex items-center justify-between bg-muted/30 dark:bg-muted/20 rounded p-1 px-2">
              <div className="flex items-center gap-1.5">
                <span>{platformIcons[platform]}</span>
                <span className="text-sm font-medium">{platformNames[platform as keyof typeof platformNames] || platform}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <Badge
                  variant="secondary"
                  className={cn(
                    "flex items-center gap-1 text-xs py-0 h-5",
                    statusColors[status.status]
                  )}
                >
                  {getStatusIcon(status.status)}
                  <span className="truncate">
                    {status.status === 'failed' && status.tokenExpired ? 'токен истёк' : status.status}
                  </span>
                </Badge>

                {status.postUrl && status.status === 'published' && (
                  <a
                    href={status.postUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-500 hover:underline"
                  >
                    Открыть
                  </a>
                )}

                {status.status === 'failed' && status.tokenExpired && status.campaignId && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-5 text-xs px-2 border-orange-400 text-orange-700 hover:bg-orange-50"
                    onClick={() => navigate(`/campaigns/${status.campaignId}/settings`)}
                    data-testid="button-vk-reauth"
                  >
                    <Settings className="h-3 w-3 mr-1" />
                    Обновить токен
                  </Button>
                )}

                {status.status === 'failed' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-5 text-xs px-2 border-blue-400 text-blue-700 hover:bg-blue-50"
                    onClick={() => retryMutation.mutate(platform)}
                    disabled={isRetrying}
                    data-testid={`button-retry-${platform}`}
                  >
                    {isRetrying
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <RefreshCw className="h-3 w-3 mr-1" />
                    }
                    {isRetrying ? '' : 'Повторить'}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

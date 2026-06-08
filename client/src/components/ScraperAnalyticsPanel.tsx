import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import {
  Hash, TrendingUp, Eye, MessageCircle, Share2, RefreshCw,
  Layers, Radio, AlertCircle, ChevronRight, ExternalLink
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';

interface TrendPost {
  id: number;
  text: string;
  date: string;
  views: number;
  reactions: number;
  comments: number;
  forwards: number;
  url?: string;
  platform?: string;
}

interface TrendHashtag {
  hashtag: string;
  count: number;
  total_views?: number;
}

interface MonitoredChannel {
  id: string;
  platform: string;
  platform_channel_id: string;
  name: string;
  is_active: boolean;
  last_parsed_at: string | null;
  metadata: Record<string, any>;
}

interface Props {
  campaignId?: string;
}

const PLATFORM_OPTIONS = [
  { value: 'all', label: 'Все платформы' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'vk', label: 'ВКонтакте' },
];

export function ScraperAnalyticsPanel({ campaignId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [platform, setPlatform] = useState('all');
  const [activeTab, setActiveTab] = useState<'posts' | 'hashtags' | 'channels'>('posts');

  const platformParam = platform !== 'all' ? platform : undefined;

  const { data: postsData, isLoading: postsLoading, error: postsError } = useQuery({
    queryKey: ['scraper-trend-posts', platform],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '20' });
      if (platformParam) params.set('platform', platformParam);
      const resp = await apiRequest(`/api/scraper/trends/posts?${params}`);
      return (resp?.data ?? []) as TrendPost[];
    },
    staleTime: 5 * 60 * 1000
  });

  const { data: hashtagsData, isLoading: hashtagsLoading } = useQuery({
    queryKey: ['scraper-trend-hashtags', platform],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '30' });
      if (platformParam) params.set('platform', platformParam);
      const resp = await apiRequest(`/api/scraper/trends/hashtags?${params}`);
      return (resp?.data ?? []) as TrendHashtag[];
    },
    staleTime: 5 * 60 * 1000
  });

  const { data: channelsData, isLoading: channelsLoading } = useQuery({
    queryKey: ['scraper-monitoring-channels'],
    queryFn: async () => {
      const resp = await apiRequest('/api/scraper/monitoring/channels');
      return (resp?.data ?? []) as MonitoredChannel[];
    },
    staleTime: 2 * 60 * 1000
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!campaignId) throw new Error('Не выбрана кампания');
      return apiRequest('/api/scraper/monitoring/sync-campaign', {
        method: 'POST',
        data: { campaignId }
      });
    },
    onSuccess: (data: any) => {
      toast({ title: '✅ Синхронизация завершена', description: data?.message || 'Каналы зарегистрированы в системе мониторинга' });
      queryClient.invalidateQueries({ queryKey: ['scraper-monitoring-channels'] });
    },
    onError: (err: any) => {
      toast({ title: '❌ Ошибка', description: err?.message || 'Не удалось синхронизировать каналы', variant: 'destructive' });
    }
  });

  const posts = postsData ?? [];
  const hashtags = hashtagsData ?? [];
  const channels = channelsData ?? [];

  const tabs = [
    { key: 'posts' as const, label: 'Топ постов', count: posts.length, icon: TrendingUp },
    { key: 'hashtags' as const, label: 'Хэштеги', count: hashtags.length, icon: Hash },
    { key: 'channels' as const, label: 'Каналы', count: channels.length, icon: Radio },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Layers className="h-5 w-5 text-blue-500" />
            Аналитика из скрейпера
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Данные из системы мониторинга (217.26.25.95)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLATFORM_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {campaignId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
              Синхронизировать
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              {tab.count > 0 && (
                <Badge variant="secondary" className="text-xs py-0 px-1.5">{tab.count}</Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'posts' && (
        <div className="space-y-3">
          {postsLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))
          ) : postsError ? (
            <div className="flex items-center gap-2 text-muted-foreground p-4 bg-muted/30 rounded-lg">
              <AlertCircle className="h-5 w-5 text-yellow-500 shrink-0" />
              <span className="text-sm">Нет данных о постах — возможно каналы ещё не зарегистрированы в системе мониторинга</span>
            </div>
          ) : posts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-10 gap-3 text-center">
                <TrendingUp className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Нет трендовых постов. Зарегистрируйте каналы через кнопку «Синхронизировать».</p>
              </CardContent>
            </Card>
          ) : (
            posts.map((post, i) => (
              <Card key={`${post.id}-${i}`} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm line-clamp-3 text-foreground">
                        {post.text || '(без текста)'}
                      </p>
                      <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Eye className="h-3 w-3" />
                          {(post.views || 0).toLocaleString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageCircle className="h-3 w-3" />
                          {(post.comments || 0).toLocaleString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <Share2 className="h-3 w-3" />
                          {(post.forwards || 0).toLocaleString()}
                        </span>
                        {post.date && (
                          <span className="text-muted-foreground/70">
                            {formatDistanceToNow(new Date(post.date), { addSuffix: true, locale: ru })}
                          </span>
                        )}
                        {post.platform && (
                          <Badge variant="outline" className="text-xs py-0">
                            {post.platform}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {post.url && (
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-primary shrink-0 mt-1"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {activeTab === 'hashtags' && (
        <div>
          {hashtagsLoading ? (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-24 rounded-full" />
              ))}
            </div>
          ) : hashtags.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-10 gap-3 text-center">
                <Hash className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Нет данных о хэштегах</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {hashtags.slice(0, 20).map((h, i) => (
                  <div
                    key={`${h.hashtag}-${i}`}
                    className="flex items-center gap-1.5 bg-muted px-3 py-1.5 rounded-full text-sm hover:bg-muted/80 cursor-default"
                  >
                    <Hash className="h-3 w-3 text-blue-500" />
                    <span className="font-medium">{h.hashtag.replace(/^#/, '')}</span>
                    <Badge variant="secondary" className="text-xs py-0 px-1.5 ml-1">
                      {h.count}
                    </Badge>
                  </div>
                ))}
              </div>
              {hashtags.length > 20 && (
                <p className="text-xs text-muted-foreground">
                  Показаны топ-20 из {hashtags.length} хэштегов
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'channels' && (
        <div className="space-y-3">
          {channelsLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))
          ) : channels.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-10 gap-3 text-center">
                <Radio className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Нет зарегистрированных каналов.{' '}
                  {campaignId && 'Нажмите «Синхронизировать», чтобы зарегистрировать каналы кампании.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            channels.map(channel => (
              <Card key={channel.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${channel.is_active ? 'bg-green-500' : 'bg-gray-400'}`} />
                      <div>
                        <p className="font-medium text-sm">{channel.name || channel.platform_channel_id}</p>
                        <p className="text-xs text-muted-foreground">
                          {channel.platform} · @{channel.platform_channel_id}
                          {channel.metadata?.subscribers_count != null && (
                            <> · {Number(channel.metadata.subscribers_count).toLocaleString()} подписчиков</>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {channel.last_parsed_at && (
                        <span className="text-xs text-muted-foreground hidden sm:block">
                          {formatDistanceToNow(new Date(channel.last_parsed_at), { addSuffix: true, locale: ru })}
                        </span>
                      )}
                      <Badge variant={channel.is_active ? 'default' : 'secondary'} className="text-xs">
                        {channel.is_active ? 'Активен' : 'Неактивен'}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}

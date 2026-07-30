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
  Radio, RefreshCw, AlertCircle, ExternalLink, BarChart2,
  Clock, Trash2, Zap, ChevronLeft, Layers
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';

interface MonitoredChannel {
  id: string;
  platform: string;
  platform_channel_id: string;
  name: string;
  is_active: boolean;
  last_parsed_at: string | null;
  metadata: { subscribers_count?: number; [key: string]: any };
}

interface EngagementChannel {
  channel_id: string;
  channel_name: string;
  platform: string;
  avg_engagement: number;
  posts_count: number;
  url: string;
}

interface BestTimesData {
  channel_id: string;
  best_days: string[];
  best_hours: number[];
  data: {
    by_day: Array<{ day: number; day_name: string; avg_engagement: number; posts_count: number }>;
    by_hour: Array<{ hour: number; avg_engagement: number; posts_count: number }>;
  };
}

interface Props {
  campaignId?: string;
}

const PLATFORM_OPTIONS = [
  { value: 'all', label: 'Все платформы' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'vk', label: 'ВКонтакте' },
];

function PlatformBadge({ platform }: { platform: string }) {
  const colors: Record<string, string> = {
    telegram: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    vk: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[platform] ?? 'bg-muted text-muted-foreground'}`}>
      {platform}
    </span>
  );
}

function EngagementBadge({ value }: { value: number }) {
  const color = value >= 3 ? 'text-green-600' : value >= 1 ? 'text-yellow-600' : 'text-muted-foreground';
  return <span className={`font-semibold tabular-nums ${color}`}>{value.toFixed(2)}%</span>;
}

function ChannelBestTimes({ channelId, onBack }: { channelId: string; onBack: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['scraper-best-times', channelId],
    queryFn: async () => {
      const resp = await apiRequest(`/api/scraper/channels/${channelId}/best-times`);
      return resp?.data as BestTimesData | null;
    },
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>;
  if (!data) return <p className="text-sm text-muted-foreground text-center py-6">Нет данных о лучшем времени</p>;

  const maxEngDay = Math.max(...data.data.by_day.map(d => d.avg_engagement), 0.01);
  const maxEngHour = Math.max(...data.data.by_hour.map(h => h.avg_engagement), 0.01);

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
        <ChevronLeft className="h-4 w-4" /> Назад
      </Button>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-500" /> Лучшие дни
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {data.data.by_day.sort((a, b) => b.avg_engagement - a.avg_engagement).map(d => (
              <div key={d.day} className="flex items-center gap-2">
                <span className="text-xs w-20 text-muted-foreground shrink-0">{d.day_name}</span>
                <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${(d.avg_engagement / maxEngDay) * 100}%` }}
                  />
                </div>
                <span className="text-xs tabular-nums w-10 text-right"><EngagementBadge value={d.avg_engagement} /></span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-purple-500" /> Лучшие часы
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {data.data.by_hour.sort((a, b) => b.avg_engagement - a.avg_engagement).slice(0, 8).map(h => (
              <div key={h.hour} className="flex items-center gap-2">
                <span className="text-xs w-10 text-muted-foreground shrink-0">{String(h.hour).padStart(2, '0')}:00</span>
                <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-purple-500 rounded-full transition-all"
                    style={{ width: `${(h.avg_engagement / maxEngHour) * 100}%` }}
                  />
                </div>
                <span className="text-xs tabular-nums w-10 text-right"><EngagementBadge value={h.avg_engagement} /></span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <span className="text-muted-foreground">Лучшие дни:</span>
        {data.best_days.slice(0, 3).map(d => <Badge key={d} variant="secondary">{d}</Badge>)}
        <span className="text-muted-foreground ml-2">Лучшие часы:</span>
        {data.best_hours.slice(0, 3).map(h => <Badge key={h} variant="outline">{h}:00</Badge>)}
      </div>
    </div>
  );
}

export function ScraperAnalyticsPanel({ campaignId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [platform, setPlatform] = useState('all');
  const [activeTab, setActiveTab] = useState<'channels' | 'engagement'>('channels');
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  const platformParam = platform !== 'all' ? platform : undefined;

  // Каналы — только собственные каналы кампании (фильтрация на сервере по campaignId)
  const { data: channelsData, isLoading: channelsLoading } = useQuery({
    queryKey: ['scraper-monitoring-channels', campaignId],
    queryFn: async () => {
      // campaignId обязателен: без него сервер отвечает 400 — выборка каналов
      // существует только в разрезе своей кампании.
      const params = new URLSearchParams({ page_size: '100', campaignId: campaignId! });
      const resp = await apiRequest(`/api/scraper/monitoring/channels?${params}`);
      return (resp?.data ?? []) as MonitoredChannel[];
    },
    enabled: Boolean(campaignId),
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // Engagement — только когда открыта эта вкладка, не поллим
  const { data: engagementData, isLoading: engagementLoading } = useQuery({
    queryKey: ['scraper-engagement', platform],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '20' });
      if (platformParam) params.set('platform', platformParam);
      const resp = await apiRequest(`/api/scraper/analytics/engagement?${params}`);
      return (resp?.data ?? []) as EngagementChannel[];
    },
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: activeTab === 'engagement',
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
      toast({ title: '✅ Синхронизация запущена', description: data?.message || 'Регистрация каналов идёт в фоне' });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['scraper-monitoring-channels'] });
      }, 5000);
    },
    onError: (err: any) => {
      toast({ title: '❌ Ошибка', description: err?.message || 'Не удалось синхронизировать каналы', variant: 'destructive' });
    }
  });

  const deleteChannelMutation = useMutation({
    mutationFn: async (channelId: string) => {
      return apiRequest(`/api/scraper/monitoring/channels/${channelId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      toast({ title: '✅ Канал удалён' });
      queryClient.invalidateQueries({ queryKey: ['scraper-monitoring-channels'] });
    },
    onError: (err: any) => {
      toast({ title: '❌ Ошибка', description: err?.message, variant: 'destructive' });
    }
  });

  const forceParseMutation = useMutation({
    mutationFn: async (channelId: string) => {
      return apiRequest(`/api/scraper/monitoring/channels/${channelId}/force-parse`, { method: 'POST' });
    },
    onSuccess: () => {
      toast({ title: '✅ Парсинг запущен', description: 'Данные обновятся в ближайшее время' });
    },
    onError: (err: any) => {
      toast({ title: '❌ Ошибка', description: err?.message, variant: 'destructive' });
    }
  });

  const channels = channelsData ?? [];
  const engagementChannels = engagementData ?? [];

  const tabs = [
    { key: 'channels' as const, label: 'Каналы', count: channels.length, icon: Radio },
    { key: 'engagement' as const, label: 'Engagement', count: engagementChannels.length, icon: BarChart2 },
  ];

  if (selectedChannelId && activeTab === 'channels') {
    return (
      <div className="space-y-4">
        <ChannelBestTimes channelId={selectedChannelId} onBack={() => setSelectedChannelId(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Layers className="h-5 w-5 text-blue-500" />
            Аналитика каналов
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Данные из системы мониторинга
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
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
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

      {/* Channels tab */}
      {activeTab === 'channels' && (
        <div className="space-y-3">
          {channelsLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)
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
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${channel.is_active ? 'bg-green-500' : 'bg-gray-400'}`} />
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{channel.name || channel.platform_channel_id}</p>
                        <p className="text-xs text-muted-foreground">
                          <PlatformBadge platform={channel.platform} /> · @{channel.platform_channel_id}
                          {channel.metadata?.subscribers_count != null && (
                            <> · {Number(channel.metadata.subscribers_count).toLocaleString()} подписчиков</>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {channel.last_parsed_at && (
                        <span className="text-xs text-muted-foreground hidden sm:block">
                          {formatDistanceToNow(new Date(channel.last_parsed_at), { addSuffix: true, locale: ru })}
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-blue-500"
                        title="Лучшее время"
                        onClick={() => setSelectedChannelId(channel.id)}
                      >
                        <Clock className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-orange-500"
                        title="Принудительный парсинг"
                        disabled={forceParseMutation.isPending}
                        onClick={() => forceParseMutation.mutate(channel.id)}
                      >
                        <Zap className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-red-500"
                        title="Удалить"
                        disabled={deleteChannelMutation.isPending}
                        onClick={() => {
                          if (confirm(`Удалить канал ${channel.name || channel.platform_channel_id}?`)) {
                            deleteChannelMutation.mutate(channel.id);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
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

      {/* Engagement tab */}
      {activeTab === 'engagement' && (
        <div className="space-y-3">
          {engagementLoading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)
          ) : engagementChannels.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-10 gap-3 text-center">
                <AlertCircle className="h-5 w-5 text-yellow-500" />
                <p className="text-sm text-muted-foreground">Нет данных об engagement</p>
              </CardContent>
            </Card>
          ) : (
            engagementChannels.map((ch, i) => {
              const maxEng = engagementChannels[0]?.avg_engagement || 1;
              return (
                <div
                  key={`${ch.channel_id}-${i}`}
                  className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:shadow-sm transition-shadow"
                >
                  <span className="text-xs text-muted-foreground w-5 text-right shrink-0 font-medium">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-sm truncate">{ch.channel_name}</p>
                      <PlatformBadge platform={ch.platform} />
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full"
                          style={{ width: `${(ch.avg_engagement / maxEng) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">{ch.posts_count} постов</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <EngagementBadge value={ch.avg_engagement} />
                    {ch.url && (
                      <a href={ch.url} target="_blank" rel="noopener noreferrer" className="block text-muted-foreground hover:text-primary mt-0.5">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

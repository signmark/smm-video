import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  channelBreakdownParts,
  hasMeaningfulBreakdown,
  type ChannelAttribution,
  type ChannelMetric,
} from '@/lib/channel-breakdown';
import { usePlan } from '@/hooks/use-plan';
import { Lock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Eye, Heart, Share2, MessageCircle, BarChart3, TrendingUp, TrendingDown, Target, Award } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useCampaignStore } from '@/lib/campaignStore';
import { ExportReportDialog } from '@/components/export-report-dialog';
import {
  getAnalyticsVerdict,
  getPlatformEfficiencyLevel,
  getSampleSummary,
} from '@/lib/analytics-verdict';
import { QueryErrorState } from '@/components/QueryErrorState';


interface AnalyticsData {
  totalPosts: number;
  totalViews: number;
  totalLikes: number;
  totalShares: number;
  totalComments: number;
  platforms: Array<{
    name: string;
    posts: number;
    views: number;
    likes: number;
    shares: number;
    comments: number;
    /**
     * AI-81: те же метрики по всему каналу за период, включая ручные и чужие
     * публикации. Приходит только там, где считали по постам; где атрибуции
     * нет, поля не будет вовсе -- показывать ноль значило бы выдумать число.
     */
    channelTotals?: {
      posts: number;
      views: number;
      likes: number;
      shares: number;
      comments: number;
    };
    /**
     * SM-15 (решение владельца 19.08): из чего складывается цифра по каналу.
     * Приходит только когда канал ведёт больше одной кампании — иначе
     * раскладывать нечего.
     */
    channelAttribution?: ChannelAttribution;
  }>;
}

/**
 * AI-81: вторая цифра — та же метрика по всему каналу за период.
 *
 * Показывается ТОЛЬКО когда она отличается от кампанийной. Если совпадает,
 * сравнивать не с чем, а лишнее число рядом с каждой метрикой читается как шум
 * и обесценивает те случаи, когда расхождение действительно есть.
 *
 * SM-15, 19.08. Подпись раньше объясняла расхождение ручными публикациями мимо
 * системы. Замер по боевой базе показал, что это третий по значимости источник
 * из трёх: шесть каналов ведут по две-три кампании сразу (посты соседней
 * кампании в эту аналитику не попадают, и правильно), а 67 опубликованных
 * записей из 2862 не сохранили идентификатор поста и уже не сопоставимы с
 * каналом никогда. Поэтому подпись перечисляет все три источника, а первая
 * цифра остаётся: она единственная говорит про САМУ кампанию.
 *
 * Отсутствие `channel` (нет пост-уровневой атрибуции) — тоже причина молчать:
 * подставить ноль или продублировать нашу цифру значило бы выдумать данные.
 */
function ChannelTotal({
  own,
  channel,
  metric,
  attribution,
}: {
  own: number;
  channel?: number;
  metric: ChannelMetric;
  attribution?: ChannelAttribution;
}) {
  const { t } = useTranslation();
  if (channel === undefined || channel === own) return null;

  // SM-15, решение владельца 19.08: «Хорошо бы написать, посты из какой
  // кампании учтены». Разница между цифрами была безымянной — теперь в
  // подсказке она разложена поимённо.
  const parts = hasMeaningfulBreakdown(metric, attribution)
    ? channelBreakdownParts(metric, attribution)
    : [];

  const hint = parts.length
    ? [t('analytics.channelBreakdownIntro'), ...parts.map(part => {
      const value = part.value.toLocaleString();
      if (part.kind === 'own') return t('analytics.channelBreakdownOwn', { value, name: part.name });
      if (part.kind === 'other') return t('analytics.channelBreakdownOther', { value, name: part.name });
      return t('analytics.channelBreakdownUnattributed', { value });
    })].join('\n')
    : t('analytics.channelHint');

  return (
    <span
      className="text-muted-foreground text-xs"
      title={hint}
      data-testid="channel-total"
    >
      ({t('analytics.channelValue', { value: channel.toLocaleString() })})
    </span>
  );
}

export default function AnalyticsPage() {
  const { t } = useTranslation();
  const { limits } = usePlan();
  const { selectedCampaignId } = useCampaignStore();

  const [selectedCampaign, setSelectedCampaign] = useState<string>(selectedCampaignId || '');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('7days');

  // Обновляем выбранную кампанию при изменении активной кампании
  useEffect(() => {
    if (selectedCampaignId && selectedCampaignId !== selectedCampaign) {
      setSelectedCampaign(selectedCampaignId);
      console.log('🔄 Переключение на активную кампанию:', selectedCampaignId);
    }
  }, [selectedCampaignId]);

  const { data: analyticsData, isLoading, isFetching, isError, error, refetch } = useQuery<AnalyticsData>({
    queryKey: ['analytics', selectedCampaign, selectedPeriod],
    enabled: !!selectedCampaign,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    staleTime: 0,
    queryFn: async () => {
      console.log('🎯 Загружаем аналитику для кампании:', selectedCampaign, 'период:', selectedPeriod);

      // Используем новый backend API endpoint
      const response = await apiRequest(`/api/analytics/${selectedCampaign}?period=${selectedPeriod}`);

      if (!response.success) {
        throw new Error(response.error || 'Failed to fetch analytics data');
      }

      console.log('📊 Получена аналитика:', response);

      return {
        totalPosts: response.totalPosts,
        totalViews: response.totalViews,
        totalLikes: response.totalLikes,
        totalShares: response.totalShares,
        totalComments: response.totalComments,
        platforms: response.platforms
      };
    },
  });

  // Функции для анализа эффективности
  const calculateEngagementRate = (platform: any): string => {
    if (platform.views === 0) return "0.0";
    const engagements = platform.likes + platform.comments + platform.shares;
    return ((engagements / platform.views) * 100).toFixed(1);
  };

  const getPlatformEfficiency = (platform: any) => {
    const engagementRate = parseFloat(calculateEngagementRate(platform));
    const level = getPlatformEfficiencyLevel({
      posts: platform.posts ?? 0,
      views: platform.views ?? 0,
    });
    // No-data platforms keep the existing palette but must NEVER carry a
    // judgemental "Низкая" label.
    if (level === 'no-data') {
      return {
        level: 'Нет данных',
        color: 'text-muted-foreground',
        icon: BarChart3,
        bgColor: 'platform-efficiency-empty',
      };
    }
    if (engagementRate >= 5) return { level: 'Отличная', color: 'text-green-600 dark:text-green-400', icon: TrendingUp, bgColor: 'platform-efficiency-excellent' };
    if (engagementRate >= 2) return { level: 'Хорошая', color: 'text-blue-600 dark:text-blue-400', icon: Target, bgColor: 'platform-efficiency-good' };
    if (engagementRate >= 1) return { level: 'Средняя', color: 'text-yellow-600 dark:text-yellow-400', icon: TrendingDown, bgColor: 'platform-efficiency-average' };
    return { level: 'Низкая', color: 'text-red-600 dark:text-red-400', icon: TrendingDown, bgColor: 'platform-efficiency-low' };
  };

  const getBestPlatform = () => {
    if (!analyticsData || analyticsData.platforms.length === 0) return null;
    let best = { name: '', engagement: 0 };
    analyticsData.platforms.forEach(platform => {
      const engagement = parseFloat(calculateEngagementRate(platform));
      if (engagement > best.engagement) {
        best = { name: platform.name, engagement };
      }
    });
    return best;
  };

  const getCampaignInsights = () => {
    if (!analyticsData) return [];

    const totalEngagement = analyticsData.totalLikes + analyticsData.totalComments + analyticsData.totalShares;
    const sample = {
      posts: analyticsData.totalPosts,
      views: analyticsData.totalViews,
      engagements: totalEngagement,
    };
    const verdict = getAnalyticsVerdict(sample);
    const summary = getSampleSummary(sample);
    const insights: any[] = [];

    // Single overall judgement, driven by the verdict so we never produce
    // contradictory zero-cards + "Низкая эффективность" on a no-data
    // campaign.
    if (verdict === 'high') {
      insights.push({
        type: 'success',
        title: t('analytics.highEfficiency'),
        description: summary.detail,
        icon: Award,
      });
    } else if (verdict === 'medium') {
      insights.push({
        type: 'info',
        title: t('analytics.averageEfficiency'),
        description: summary.detail,
        icon: Target,
      });
    } else if (verdict === 'low') {
      insights.push({
        type: 'warning',
        title: t('analytics.lowEfficiency'),
        description: summary.detail,
        icon: TrendingDown,
      });
    } else {
      // no-data and insufficient-views: emit a single neutral insight,
      // NOT a "low efficiency" warning.
      insights.push({
        type: 'info',
        title: summary.headline,
        description: summary.detail,
        icon: BarChart3,
      });
    }

    // Лучшая платформа — only meaningful when there is a real sample.
    if (verdict !== 'no-data' && verdict !== 'insufficient-views') {
      const bestPlatform = getBestPlatform();
      if (bestPlatform && bestPlatform.engagement > 0) {
        insights.push({
          type: 'success',
          title: t('analytics.leadingPlatform'),
          description: `${bestPlatform.name.toUpperCase()} ${t('analytics.showsBestResults')} (${bestPlatform.engagement}% ${t('analytics.engagement')})`,
          icon: TrendingUp
        });
      }
    }

    // Рекомендации по улучшению — only for platforms that actually have
    // data. No-data platforms are silently skipped, not labelled "low".
    const lowPerformingPlatforms = analyticsData.platforms.filter(p => {
      if ((p.posts ?? 0) <= 0 || (p.views ?? 0) <= 0) return false;
      return parseFloat(calculateEngagementRate(p)) < 1;
    });
    if (lowPerformingPlatforms.length > 0) {
      insights.push({
        type: 'warning',
        title: t('analytics.growthOpportunities'),
        description: `${t('analytics.platforms')} ${lowPerformingPlatforms.map(p => p.name.toUpperCase()).join(', ')} ${t('analytics.needContentOptimization')}`,
        icon: Target
      });
    }

    return insights;
  };

  const MetricCard = ({ title, value, icon: Icon, color }: { 
    title: string; 
    value: number; 
    icon: any; 
    color: string;
  }) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${color}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      </CardContent>
    </Card>
  );

  const PlatformCard = ({ platform }: { platform: AnalyticsData['platforms'][0] }) => {
    const efficiency = getPlatformEfficiency(platform);
    const engagementRate = calculateEngagementRate(platform);
    const EfficiencyIcon = efficiency.icon;
    
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            {platform.name.toUpperCase()}
            <Badge variant="secondary">{platform.posts} {t('analytics.posts')}</Badge>
          </CardTitle>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${efficiency.bgColor}`}>
            <EfficiencyIcon className={`h-4 w-4 ${efficiency.color}`} />
            <span className={`text-sm font-medium ${efficiency.color}`}>
              {efficiency.level} ({engagementRate}%)
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-blue-500" />
              <span>{platform.views.toLocaleString()} {t('analytics.viewsCount')}</span>
              <ChannelTotal own={platform.views} channel={platform.channelTotals?.views}
                metric="views" attribution={platform.channelAttribution} />
            </div>
            <div className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-red-500" />
              <span>{platform.likes.toLocaleString()} {t('analytics.likesCount')}</span>
              <ChannelTotal own={platform.likes} channel={platform.channelTotals?.likes}
                metric="likes" attribution={platform.channelAttribution} />
            </div>
            <div className="flex items-center gap-2">
              <Share2 className="h-4 w-4 text-green-500" />
              <span>{platform.shares.toLocaleString()} {t('analytics.sharesCount')}</span>
              <ChannelTotal own={platform.shares} channel={platform.channelTotals?.shares}
                metric="shares" attribution={platform.channelAttribution} />
            </div>
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-purple-500" />
              <span>{platform.comments.toLocaleString()} {t('analytics.commentsCount')}</span>
              <ChannelTotal own={platform.comments} channel={platform.channelTotals?.comments}
                metric="comments" attribution={platform.channelAttribution} />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (!limits.advancedAnalytics) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted mx-auto">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold">Аналитика недоступна</h2>
          <p className="text-muted-foreground text-sm">
            Раздел аналитики доступен на тарифах <strong>Pro</strong> и <strong>Корпоративный</strong>.
            Перейдите на Pro, чтобы видеть статистику по публикациям, охватам и вовлечённости.
          </p>
          <a
            href="/pricing"
            className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-6 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Посмотреть тарифы
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <BarChart3 className="h-8 w-8" />
              {t('analytics.title')}
            </h1>
            
            <div className="flex gap-3">
              <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Период" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7days">{t('analytics.7days')}</SelectItem>
                  <SelectItem value="30days">{t('analytics.30days')}</SelectItem>
                  <SelectItem value="thisMonth">Текущий месяц</SelectItem>
                </SelectContent>
              </Select>
              
              <ExportReportDialog
                campaignId={selectedCampaign}
                disabled={!selectedCampaign || isLoading}
                period={selectedPeriod}
              />
            </div>
          </div>

          {/* Error State — replaces the previous generic Alert so we never
              mix "0" counters with an "Ошибка загрузки" banner. */}
          {isError && (
            <QueryErrorState
              error={error}
              onRetry={() => !isFetching && refetch()}
              isRefetching={isFetching}
              title={t('analytics.errorLoading')}
              testId="analytics-query-error"
            />
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {[...Array(5)].map((_, i) => (
                  <Card key={i}>
                    <CardHeader>
                      <Skeleton className="h-4 w-24" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-8 w-16" />
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => (
                  <Card key={i}>
                    <CardHeader>
                      <Skeleton className="h-6 w-32" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-20 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Data Display — gated on BOTH data presence AND !isError so
              that a failed refetch (refetchOnWindowFocus: true with
              staleTime: 0 is the common trigger) does not leave the
              last successful metrics visible while the new error
              banner is also rendered. Plan Task 3 p.4: "При query
              error не показывать старые или нулевые выводы". */}
          {analyticsData && !isError && (
            <>
              {/* Overall Metrics */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <MetricCard
                  title={t('analytics.totalPosts')}
                  value={analyticsData.totalPosts}
                  icon={BarChart3}
                  color="text-indigo-500"
                />
                <MetricCard
                  title={t('analytics.views')}
                  value={analyticsData.totalViews}
                  icon={Eye}
                  color="text-blue-500"
                />
                <MetricCard
                  title={t('analytics.likes')}
                  value={analyticsData.totalLikes}
                  icon={Heart}
                  color="text-red-500"
                />
                <MetricCard
                  title={t('analytics.reposts')}
                  value={analyticsData.totalShares}
                  icon={Share2}
                  color="text-green-500"
                />
                <MetricCard
                  title={t('analytics.comments')}
                  value={analyticsData.totalComments}
                  icon={MessageCircle}
                  color="text-purple-500"
                />
              </div>

              {/* Platform Breakdown */}
              {analyticsData.platforms.length > 0 && (
                <div>
                  <h2 className="text-xl font-semibold mb-4">{t('analytics.platformStats')}</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {analyticsData.platforms.map((platform) => (
                      <PlatformCard key={platform.name} platform={platform} />
                    ))}
                  </div>
                </div>
              )}

              {/* Campaign Insights */}
              {getCampaignInsights().length > 0 && (
                <div>
                  <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                    <Award className="h-6 w-6 text-yellow-600" />
                    {t('analytics.campaignAnalysis')}
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {getCampaignInsights().map((insight, index) => {
                      const InsightIcon = insight.icon;
                      
                      // Используем CSS классы с токенами для правильной темной темы
                      const statusClass = `status-${insight.type === 'success' ? 'success' : insight.type === 'warning' ? 'warning' : 'info'}`;
                      
                      const iconColor = insight.type === 'success' ? 'text-green-600 dark:text-green-400' :
                                       insight.type === 'warning' ? 'text-yellow-600 dark:text-yellow-400' :
                                       'text-blue-600 dark:text-blue-400';
                      
                      return (
                        <Card key={index} className={`border ${statusClass}`}>
                          <CardHeader className="pb-3">
                            <CardTitle className="text-lg flex items-center gap-2">
                              <InsightIcon className={`h-5 w-5 ${iconColor}`} />
                              {insight.title}
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="text-sm text-muted-foreground">
                              {insight.description}
                            </p>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Empty State */}
              {analyticsData.platforms.length === 0 && (
                <Card>
                  <CardContent className="text-center py-8">
                    <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2">{t('analytics.noData')}</h3>
                    <p className="text-muted-foreground">
                      {t('analytics.noDataDesc')}
                    </p>
                  </CardContent>
                </Card>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
}

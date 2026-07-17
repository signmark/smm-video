import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { usePlan } from '@/hooks/use-plan';
import { Lock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Eye, Heart, Share2, MessageCircle, BarChart3, RefreshCw, Database, TrendingUp, TrendingDown, Target, Award } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useCampaignStore } from '@/lib/campaignStore';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { ExportReportDialog } from '@/components/export-report-dialog';


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
  }>;
}

export default function AnalyticsPage() {
  const { t } = useTranslation();
  const { limits } = usePlan();
  const { selectedCampaignId } = useCampaignStore();

  const [selectedCampaign, setSelectedCampaign] = useState<string>(selectedCampaignId || '');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('7days');
  const { toast } = useToast();

  // Обновляем выбранную кампанию при изменении активной кампании
  useEffect(() => {
    if (selectedCampaignId && selectedCampaignId !== selectedCampaign) {
      setSelectedCampaign(selectedCampaignId);
      console.log('🔄 Переключение на активную кампанию:', selectedCampaignId);
    }
  }, [selectedCampaignId]);

  // Мутация для обновления данных аналитики через backend
  const updateAnalyticsMutation = useMutation({
    mutationFn: async () => {
      const days = selectedPeriod === '30days'
        ? 30
        : selectedPeriod === 'thisMonth'
          ? Math.min(30, new Date().getDate())
          : 7;
      
      console.log('🔧 Запуск обновления аналитики через backend для кампании:', selectedCampaign);
      
      // Вызываем backend endpoint который вызовет N8N webhook
      const response = await apiRequest('/api/analytics/update', {
        method: 'POST',
        data: {
          campaignId: selectedCampaign,
          days: days
        }
      });

      if (!response.success) {
        throw new Error(response.error || response.message || 'Не удалось обновить аналитику');
      }
      
      console.log('📊 Backend ответ:', response);
      
      // После сбора данных через N8N, обновляем кэш для загрузки новых данных
      await queryClient.invalidateQueries({ queryKey: ['analytics', selectedCampaign, selectedPeriod] });
      
      return response;
    },
    onSuccess: (response) => {
      const isPartial = Number(response.failed || 0) > 0;
      toast({
        title: isPartial
          ? t('analytics.partiallyUpdated')
          : t('analytics.dataUpdated'),
        description: response.message || "Аналитика успешно обновлена из последних данных",
        variant: isPartial ? 'destructive' : 'default',
      });
    },
    onError: (error: Error) => {
      toast({
        title: "❌ Ошибка обновления", 
        description: error.message || "Не удалось обновить данные. Попробуйте позже.",
        variant: "destructive"
      });
    }
  });

  // Функция для пересборки данных из Directus
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const handleRefreshData = async () => {
    if (isRefreshing) return;
    
    setIsRefreshing(true);
    console.log('🔄 Пересобираем данные из Directus...');
    
    try {
      await refetch();
      toast({
        title: "🔄 Данные обновлены",
        description: "Аналитика успешно пересобрана из базы данных",
      });
    } catch (error) {
      toast({
        title: "❌ Ошибка обновления", 
        description: "Не удалось пересобрать данные. Попробуйте позже.",
        variant: "destructive"
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const { data: analyticsData, isLoading, error, refetch } = useQuery<AnalyticsData>({
    queryKey: ['analytics', selectedCampaign, selectedPeriod],
    enabled: !!selectedCampaign,
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
    const overallEngagementRate = analyticsData.totalViews > 0 
      ? ((totalEngagement / analyticsData.totalViews) * 100).toFixed(1) 
      : '0';
    
    const insights = [];
    
    // Общая эффективность
    if (parseFloat(overallEngagementRate) >= 3) {
      insights.push({
        type: 'success',
        title: t('analytics.highEfficiency'),
        description: `${t('analytics.overallEngagement')} ${overallEngagementRate}% - ${t('analytics.excellentResult')}`,
        icon: Award
      });
    } else if (parseFloat(overallEngagementRate) >= 1.5) {
      insights.push({
        type: 'info',
        title: t('analytics.averageEfficiency'),
        description: `${t('analytics.overallEngagement')} ${overallEngagementRate}% - ${t('analytics.growthPotential')}`,
        icon: Target
      });
    } else {
      insights.push({
        type: 'warning',
        title: t('analytics.lowEfficiency'),
        description: `${t('analytics.overallEngagement')} ${overallEngagementRate}% - ${t('analytics.contentOptimizationRequired')}`,
        icon: TrendingDown
      });
    }

    // Лучшая платформа
    const bestPlatform = getBestPlatform();
    if (bestPlatform && bestPlatform.engagement > 0) {
      insights.push({
        type: 'success',
        title: t('analytics.leadingPlatform'),
        description: `${bestPlatform.name.toUpperCase()} ${t('analytics.showsBestResults')} (${bestPlatform.engagement}% ${t('analytics.engagement')})`,
        icon: TrendingUp
      });
    }

    // Рекомендации по улучшению
    const lowPerformingPlatforms = analyticsData.platforms.filter(p => parseFloat(calculateEngagementRate(p)) < 1);
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
            </div>
            <div className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-red-500" />
              <span>{platform.likes.toLocaleString()} {t('analytics.likesCount')}</span>
            </div>
            <div className="flex items-center gap-2">
              <Share2 className="h-4 w-4 text-green-500" />
              <span>{platform.shares.toLocaleString()} {t('analytics.sharesCount')}</span>
            </div>
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-purple-500" />
              <span>{platform.comments.toLocaleString()} {t('analytics.commentsCount')}</span>
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
              
              <Button 
                onClick={() => updateAnalyticsMutation.mutate()}
                disabled={updateAnalyticsMutation.isPending || !selectedCampaign}
                variant="outline"
                size="default"
                className="flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${updateAnalyticsMutation.isPending ? 'animate-spin' : ''}`} />
                {updateAnalyticsMutation.isPending ? t('analytics.updating') : t('analytics.updateData')}
              </Button>
              
              <ExportReportDialog 
                campaignId={selectedCampaign}
                disabled={!selectedCampaign || isLoading}
              />
              
              <Button 
                onClick={handleRefreshData}
                disabled={isRefreshing || !selectedCampaign}
                variant="outline"
                size="default"
                className="flex items-center gap-2"
              >
                <Database className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? t('analytics.rebuilding') : t('analytics.rebuildData')}
              </Button>
            </div>
          </div>

          {/* Error State */}
          {error && (
            <Alert>
              <AlertDescription>
                {t('analytics.errorLoading')}
              </AlertDescription>
            </Alert>
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

          {/* Data Display */}
          {analyticsData && (
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

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useCampaignStore } from "@/lib/campaignStore";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, AlertCircle, BarChart3 } from "lucide-react";
import AnalyticsStatus from "./AnalyticsStatus";
import SocialPlatformStats, { PlatformAnalytics } from "./SocialPlatformStats";

export default function CampaignAnalyticsDashboard() {
  const { t } = useTranslation();
  // Глобальное состояние выбранной кампании
  const { selectedCampaign } = useCampaignStore();
  const campaignId = selectedCampaign?.id || "";
  const campaignName = selectedCampaign?.name || "";

  // Получение статистики по платформам
  const {
    data: platformsStatsData,
    isLoading: isPlatformsLoading,
    error: platformsError,
    refetch: refetchPlatforms,
  } = useQuery({
    queryKey: ["/api/analytics/platforms-stats", campaignId],
    queryFn: async () => {
      if (!campaignId) {
        throw new Error(t('analytics.dashboard.campaignNotSelected'));
      }
      const response = await api.get(`/analytics/platforms-stats?campaignId=${campaignId}&period=30`);
      return response.data;
    },
    enabled: !!campaignId,
  });
  
  // Получение топовых публикаций
  const {
    data: topPostsData,
    isLoading: isTopPostsLoading,
    error: topPostsError,
    refetch: refetchTopPosts,
  } = useQuery({
    queryKey: ["/api/analytics/top-posts", campaignId],
    queryFn: async () => {
      if (!campaignId) {
        throw new Error(t('analytics.dashboard.campaignNotSelected'));
      }
      const response = await api.get(`/analytics/top-posts?campaignId=${campaignId}&period=30`);
      return response.data;
    },
    enabled: !!campaignId,
  });

  // Обновляем данные при смене кампании
  useEffect(() => {
    if (campaignId) {
      refetchPlatforms();
      refetchTopPosts();
    }
  }, [campaignId, refetchPlatforms, refetchTopPosts]);

  // Обработка ошибок
  if (platformsError || topPostsError) {
    return (
      <Alert variant="destructive" className="mb-4">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {t('analytics.dashboard.loadingError')} {((platformsError || topPostsError) as Error).message}
        </AlertDescription>
      </Alert>
    );
  }

  // Преобразуем данные из API в формат для компонентов
  const analytics: PlatformAnalytics[] = platformsStatsData?.data?.platforms || [];
  const totals = platformsStatsData?.data?.totals || {
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    posts: 0,
  };

  // Ручное обновление данных
  const handleRefresh = () => {
    refetchPlatforms();
    refetchTopPosts();
  };

  return (
    <div className="space-y-6">
      {!campaignId ? (
        <Alert className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {t('analytics.dashboard.selectCampaign')}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {/* Заголовок с информацией о кампании */}
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold">{t('analytics.dashboard.campaignAnalytics')}</h1>
              <p className="text-muted-foreground">{campaignName}</p>
            </div>
            <button
              onClick={handleRefresh}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={isPlatformsLoading || isTopPostsLoading}
            >
              <RefreshCw className="h-4 w-4" />
              {t('analytics.dashboard.updateData')}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Компонент статуса аналитики */}
            <AnalyticsStatus
              campaignId={campaignId}
              onRefresh={handleRefresh}
            />

            {/* Общая статистика */}
            <Card>
              <CardHeader>
                <CardTitle>Общая статистика</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Всего просмотров</p>
                    <p className="text-2xl font-bold">{totals.views.toLocaleString()}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Всего постов</p>
                    <p className="text-2xl font-bold">{totals.posts}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Всего лайков</p>
                    <p className="text-2xl font-bold">{totals.likes.toLocaleString()}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Всего комментариев</p>
                    <p className="text-2xl font-bold">{totals.comments.toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Статистика по соц.сетям */}
          <SocialPlatformStats
            analytics={analytics}
            isLoading={isPlatformsLoading}
          />
        </>
      )}
    </div>
  );
}
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface AnalyticsStatusProps {
  campaignId: string;
  onRefresh?: () => void;
}

export default function AnalyticsStatus({ campaignId, onRefresh }: AnalyticsStatusProps) {
  const { t } = useTranslation();
  const { toast } = useToast();

  // Запрос статуса сбора аналитики
  const { 
    data: statusData, 
    isLoading: isStatusLoading,
    refetch: refetchStatus
  } = useQuery({
    queryKey: ["/api/analytics/status"],
    queryFn: async () => {
      const response = await api.get("/analytics/status");
      return response.data;
    },
    refetchInterval: 5000, // Обновляем каждые 5 секунд во время сбора данных
  });

  // Запрос для запуска сбора аналитики
  const { 
    refetch: collectAnalytics, 
    isRefetching: isCollecting
  } = useQuery({
    queryKey: ["collect-analytics", campaignId],
    queryFn: async () => {
      try {
        const response = await api.post("/analytics/collect", { campaignId });
        if (response.data.success) {
          toast({
            title: t('analytics.status.collectionStarted'),
            description: t('analytics.status.backgroundCollection'),
            variant: "default"
          });
          // Сразу обновляем статус после запуска
          refetchStatus();
          if (onRefresh) {
            onRefresh();
          }
        } else {
          toast({
            title: t('analytics.status.collectionError'),
            description: response.data.message || t('analytics.status.collectionErrorDesc'),
            variant: "destructive"
          });
        }
        return response.data;
      } catch (error) {
        console.error("Error collecting analytics:", error);
        toast({
          title: t('analytics.status.dataError'),
          description: t('analytics.status.dataErrorDesc'),
          variant: "destructive"
        });
        throw error;
      }
    },
    enabled: false, // Не запускаем автоматически
  });

  // Запускаем сбор аналитики вручную
  const handleCollectAnalytics = () => {
    if (!campaignId) {
      toast({
        title: t('analytics.status.selectCampaign'),
        description: t('analytics.status.selectCampaignDesc'),
        variant: "default"
      });
      return;
    }
    collectAnalytics();
  };

  // Обновляем данные при смене кампании
  useEffect(() => {
    if (campaignId) {
      refetchStatus();
    }
  }, [campaignId, refetchStatus]);

  // Определяем статусы и данные
  const isLoadingStatus = isStatusLoading;
  const analyticsStatus = statusData?.data || {};
  const { isCollecting: isActiveCollection, progress, lastCollectionTime, processedPosts, totalPosts } = analyticsStatus;

  // Форматируем дату последнего сбора
  const formatDateTime = (dateTimeStr: string) => {
    if (!dateTimeStr) return t('analytics.status.noData');
    const date = new Date(dateTimeStr);
    return date.toLocaleString('ru-RU', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric'
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('analytics.status.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoadingStatus ? (
          <div className="flex justify-center items-center h-32">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>{t('analytics.status.status')}</span>
                <span className={isActiveCollection ? "text-green-500 font-medium" : "text-muted-foreground"}>
                  {isActiveCollection ? t('analytics.status.collecting') : t('analytics.status.waiting')}
                </span>
              </div>
              <div className="flex justify-between">
                <span>{t('analytics.status.lastUpdate')}</span>
                <span className="text-muted-foreground">{formatDateTime(lastCollectionTime)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t('analytics.status.postsProcessed')}</span>
                <span>{processedPosts} {t('common.of')} {totalPosts}</span>
              </div>
            </div>

            {isActiveCollection && (
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{t('analytics.status.progress')}</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}
          </>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button 
          variant="outline" 
          onClick={() => refetchStatus()}
          disabled={isCollecting}
        >
          {t('analytics.status.updateStatus')}
        </Button>
        <Button 
          onClick={handleCollectAnalytics}
          disabled={isActiveCollection || isCollecting}
        >
          {isCollecting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('analytics.status.startingCollection')}
            </>
          ) : (
            t('analytics.status.collectAnalytics')
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
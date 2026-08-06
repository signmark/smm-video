import { useQuery } from "@tanstack/react-query";
import { toDisplayDateKey, isDisplayToday, isInDisplayWeek, formatDateWithTimezone } from '@/lib/date-utils';
import { authHeaders } from '@/lib/auth-headers';
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuthStore } from "@/lib/store";
import { useCampaignStore } from "@/lib/campaignStore";
import { BarChart3, Calendar, Hash, TrendingUp, Users, FileText, MessageCircle, Activity, ArrowRight, Plus, Zap, Settings, PenTool, ExternalLink, BookOpen, AlertTriangle, X, AlertCircle } from "lucide-react";
import { format, subDays, eachDayOfInterval, startOfDay } from "date-fns";
import { ru, enUS, es } from "date-fns/locale";
import { useLocation } from "wouter";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  CHART_TOOLTIP_CONTENT_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
} from '@/lib/chart-styles';
import { useTranslation } from 'react-i18next';

// Интерфейсы для типизации данных
interface UserCampaign {
  id: string;
  name?: string;
  description?: string;
  link?: string;
  trendAnalysisSettings?: any;
  socialMediaSettings?: any;
}

interface CampaignsResponse {
  data: UserCampaign[];
}

interface ContentItem {
  id: string;
  title: string;
  status: string;
  scheduledAt?: string;
  publishedAt?: string;
  createdAt: string;
  campaignId: string;
}

/**
 * Агрегаты по контенту пользователя. `recent` — только строки за окно графика
 * (по умолчанию 31 день), а не вся таблица: счётчики приходят уже посчитанными.
 */
interface ContentStatsResponse {
  data: {
    total: number;
    byStatus: Record<string, number>;
    published: number;
    scheduled: number;
    failed: number;
    draft: number;
    windowDays: number;
    /** Последние записи для карточки «Недавний контент». */
    latest: Array<Pick<ContentItem, 'id' | 'title' | 'status' | 'createdAt'>>;
    recent: Array<Pick<ContentItem, 'id' | 'status' | 'scheduledAt' | 'publishedAt'>>;
  };
}

interface TrendItem {
  id: string;
  title: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  platform?: string;
  url?: string;
  createdAt?: string;
}

interface TrendsResponse {
  data: TrendItem[];
}


export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { userId } = useAuthStore();
  const { selectedCampaignId } = useCampaignStore();
  const [, navigate] = useLocation();
  const [vkWarningDismissed, setVkWarningDismissed] = useState(false);
  // null = ещё не проверяли, [] = всё ок, [...] = список кампаний с плохим токеном
  const [invalidVkCampaigns, setInvalidVkCampaigns] = useState<UserCampaign[] | null>(null);
  
  // Функция для получения правильной локали date-fns
  const getDateLocale = () => {
    switch (i18n.language) {
      case 'en': return enUS;
      case 'es': return es;
      case 'ru':
      default: return ru;
    }
  };
  
  // Получаем все кампании с обработкой ошибок
  const { data: campaignsResponse, isLoading: campaignsLoading, isError: campaignsError, error: campaignsErrorMessage } = useQuery<CampaignsResponse>({
    queryKey: ["/api/campaigns", userId],
    enabled: !!userId,
  });

  // Агрегаты по контенту для плиток и графика.
  // История вопроса: сначала здесь был useQuery без queryFn — дефолтный берёт URL
  // из queryKey[0] и тянул ПОЛНУЮ выдачу пользователя со всеми текстами и
  // картинками (~5 МБ). Потом это заменили на `?summary=1`, но и он отдавал всю
  // таблицу целиком, просто урезанную по полям: 1422 объекта, 354 КБ, и объём рос
  // линейно с числом постов. Дашборду же нужны три числа и гистограмма по дням —
  // теперь их считает Directus, а сюда едут агрегаты и окно дат.
  // Свой queryFn здесь обязателен: ключ не совпадает с URL.
  const { data: contentStats, isLoading: contentLoading, isError: contentError } = useQuery<ContentStatsResponse>({
    queryKey: ["/api/campaign-content/stats", userId],
    enabled: !!userId,
    retry: 2,
    retryDelay: 1000,
    staleTime: 60000,
    queryFn: async () => {
      const response = await fetch('/api/campaign-content/stats', {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
      });
      if (!response.ok) throw new Error('Не удалось загрузить сводку по контенту');
      return response.json();
    },
  });

  // Строки за окно графика. Для «сегодня»/«на этой неделе»/гистограммы этого
  // достаточно, а «всего/опубликовано/запланировано» приходят агрегатами.
  const recentContent = contentStats?.data?.recent ?? [];
  // Последние записи для карточки «Недавний контент» (заголовок + дата создания).
  const latestContent = contentStats?.data?.latest ?? [];

  // Используем первую кампанию если нет selectedCampaignId
  const activeCampaignId = selectedCampaignId || campaignsResponse?.data?.[0]?.id;

  // Получаем тренды для виджета (только если есть активная кампания).
  // Виджет показывает топ-3, поэтому берём небольшую свежую выборку. Без queryFn
  // сработал бы дефолтный (голый GET по queryKey[0]) — а он раньше тянул ВСЕ тренды
  // кампании (сервер игнорировал period): ~4 МБ JSON на каждое открытие дашборда.
  const { data: trendsResponse, isLoading: trendsLoading } = useQuery<TrendsResponse>({
    queryKey: ["/api/campaign-trends", activeCampaignId, "dashboard-widget"],
    enabled: !!activeCampaignId && !!userId && !campaignsLoading,
    retry: false,
    queryFn: async () => {
      const response = await fetch(`/api/campaign-trends?campaignId=${activeCampaignId}&period=7days&limit=20`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
      });
      if (!response.ok) throw new Error('Не удалось загрузить тренды');
      return response.json();
    },
  });

  // Ключевые слова убраны с Dashboard так как они относятся к конкретной кампании
  // а Dashboard показывает общие метрики по всем кампаниям

  // Функция для определения активности кампании на основе ключевых разделов
  const isCampaignActive = (campaign: UserCampaign) => {
    // Кампания считается активной если:
    // 1. Есть базовая информация (название)
    // 2. Есть настройки анализа трендов ИЛИ настройки соцсетей ИЛИ ссылка на сайт
    const hasBasicInfo = Boolean(campaign.name && campaign.name.trim().length > 0);
    
    const hasTrendAnalysis = Boolean(
      campaign.trendAnalysisSettings && 
      typeof campaign.trendAnalysisSettings === 'object' &&
      Object.keys(campaign.trendAnalysisSettings).length > 0
    );
    
    const hasSocialMediaSettings = Boolean(
      campaign.socialMediaSettings && 
      typeof campaign.socialMediaSettings === 'object' &&
      Object.keys(campaign.socialMediaSettings).length > 0
    );
    
    const hasSiteLink = Boolean(campaign.link && campaign.link.trim().length > 0);
    
    // Кампания активна если есть базовая информация и хотя бы одна настройка
    return hasBasicInfo && (hasTrendAnalysis || hasSocialMediaSettings || hasSiteLink);
  };

  // Вычисляем метрики кампаний
  const campaignMetrics = {
    total: campaignsResponse?.data?.length || 0,
    active: campaignsResponse?.data?.filter(isCampaignActive).length || 0,
    draft: campaignsResponse?.data?.filter(c => !isCampaignActive(c)).length || 0,
  };

  // Метрики публикаций. Итоговые счётчики считает Directus и отдаёт числами —
  // раньше ради них с сервера выкачивалась вся таблица контента (354 КБ).
  // «Сегодня»/«на этой неделе» считаются на клиенте, но границы — МОСКОВСКИЕ,
  // а не по поясу браузера (SM-9). isToday/isThisWeek из date-fns брали
  // локальную полночь зрителя: у браузера в UTC публикация 01:00 МСК 29-го
  // (это 22:00Z 28-го) в «сегодня» не попадала вовсе. Неделя вдобавок
  // считалась с воскресенья — см. DISPLAY_WEEK_STARTS_ON_MONDAY.
  // Окно `recent` заведомо шире недели, поэтому результат тот же, что и по
  // полной выборке.
  const publicationMetrics = {
    today: recentContent.filter(item => {
      // Считаем публикации опубликованные сегодня или запланированные на сегодня
      const publishedToday = item.publishedAt && isDisplayToday(item.publishedAt);
      const scheduledToday = item.scheduledAt && isDisplayToday(item.scheduledAt) && item.status === 'scheduled';
      return publishedToday || scheduledToday;
    }).length,
    thisWeek: recentContent.filter(item => {
      // Считаем публикации опубликованные на этой неделе или запланированные на эту неделю
      const publishedThisWeek = item.publishedAt && isInDisplayWeek(item.publishedAt);
      const scheduledThisWeek = item.scheduledAt && isInDisplayWeek(item.scheduledAt) && item.status === 'scheduled';
      return publishedThisWeek || scheduledThisWeek;
    }).length,
    published: contentStats?.data?.published || 0,
    scheduled: contentStats?.data?.scheduled || 0,
    failed: contentStats?.data?.failed || 0,
    total: contentStats?.data?.total || 0,
  };

  // Получаем топовые тренды, сортированные по суммарной активности (лайки + просмотры + комментарии)
  const topTrends = (() => {
    if (!trendsResponse?.data?.length) return [];
    
    return trendsResponse.data
      .map(trend => ({
        ...trend,
        totalActivity: (trend.views || 0) + (trend.likes || 0) + (trend.comments || 0) + (trend.shares || 0)
      }))
      .sort((a, b) => b.totalActivity - a.totalActivity)
      .slice(0, 3); // Топ 3 тренда
  })();

  // Данные для графика активности за последние 7 дней
  const activityChartData = (() => {
    if (!contentStats?.data) return [];

    // Сутки считаем по МОСКОВСКОМУ календарю, а не по границам дня в поясе
    // браузера. Раньше startOfDay брал местную полночь, и у зрителя западнее
    // Москвы ночная публикация (01:00 МСК = 22:00Z предыдущих суток) попадала
    // в предыдущий столбец графика (SM-9).
    const todayKey = toDisplayDateKey(new Date())!;
    const last7Keys = Array.from({ length: 7 }, (_, i) => {
      // Арифметика по календарным суткам: ключ уже без времени и без пояса.
      const d = new Date(`${todayKey}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - (6 - i));
      return d.toISOString().slice(0, 10);
    });

    return last7Keys.map(dayKey => {
      const published = recentContent.filter(item =>
        item.publishedAt && toDisplayDateKey(item.publishedAt) === dayKey
      ).length;

      const scheduled = recentContent.filter(item =>
        item.scheduledAt && item.status === 'scheduled'
          && toDisplayDateKey(item.scheduledAt) === dayKey
      ).length;

      const [, month, day] = dayKey.split('-');
      return {
        date: `${day}.${month}`,
        published,
        scheduled,
        total: published + scheduled
      };
    });
  })();

  // Тренды доступны на отдельной странице с выбором кампании

  // Кампании с устаревшим VK-токеном (needanapp токены живут ~24ч, предупреждаем после 20ч)
  const staleVkCampaigns = (() => {
    if (!campaignsResponse?.data) return [];
    const threshold = 20 * 60 * 60 * 1000; // 20 часов в мс
    return campaignsResponse.data.filter(c => {
      const vk = c.socialMediaSettings?.vk;
      if (!vk?.token) return false;
      // Если есть refreshToken — это VK ID OAuth, не нужно предупреждать
      if (vk.refreshToken) return false;
      // Если tokenExpiresAt явно null — это offline токен (не истекает)
      if (vk.tokenExpiresAt === null && vk.setupCompletedAt) return false;
      const receivedAt = vk.tokenReceivedAt || vk.setupCompletedAt;
      if (!receivedAt) return false;
      return Date.now() - new Date(receivedAt).getTime() > threshold;
    });
  })();

  // Проверяем токены устаревших VK-кампаний через API ВКонтакте
  useEffect(() => {
    if (staleVkCampaigns.length === 0) {
      setInvalidVkCampaigns([]);
      return;
    }
    let cancelled = false;
    const checkTokens = async () => {
      const results = await Promise.all(
        staleVkCampaigns.map(async (campaign) => {
          const token = campaign.socialMediaSettings?.vk?.token;
          if (!token) return campaign;
          try {
            const resp = await fetch('/api/vk/validate', {
              method: 'POST',
              headers: { ...authHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ accessToken: token }),
            });
            const data = await resp.json();
            return data.valid ? null : campaign;
          } catch {
            return null; // при ошибке сети не беспокоим пользователя
          }
        })
      );
      if (!cancelled) {
        setInvalidVkCampaigns(results.filter(Boolean) as UserCampaign[]);
      }
    };
    checkTokens();
    return () => { cancelled = true; };
  }, [staleVkCampaigns.map(c => c.id).join(',')]);

  // Обработчики навигации
  const handleNavigateToCampaigns = () => navigate('/campaigns');
  const handleNavigateToPublish = () => navigate('/content');
  const handleNavigateToPosts = () => navigate('/posts');
  const handleNavigateToTrends = () => navigate('/trends');
  const handleNavigateToAnalytics = () => navigate('/analytics');
  const handleNavigateToKeywords = () => navigate('/keywords');

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('dashboard.title')}</h1>
        <p className="text-muted-foreground">
          {t('dashboard.subtitle')}
        </p>
      </div>

      {/* Предупреждение об устаревшем VK-токене (только если токен реально не работает) */}
      {!vkWarningDismissed && invalidVkCampaigns !== null && invalidVkCampaigns.length > 0 && (
        <Alert className="border-orange-300 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-700" data-testid="alert-vk-token-stale">
          <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400" />
          <AlertDescription className="flex items-start justify-between gap-2">
            <div className="space-y-1">
              <p className="text-orange-800 dark:text-orange-200 font-medium text-sm">
                Токен ВКонтакте устарел
              </p>
              <p className="text-orange-700 dark:text-orange-300 text-sm">
                Публикация в ВК не будет работать. Зайдите в настройки кампании и обновите токен через needanapp.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {invalidVkCampaigns.map(c => (
                  <Button
                    key={c.id}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-orange-400 text-orange-800 dark:text-orange-200 dark:border-orange-600 hover:bg-orange-100 dark:hover:bg-orange-900/40"
                    onClick={() => navigate(`/campaigns/${c.id}/settings`)}
                    data-testid={`button-vk-settings-${c.id}`}
                  >
                    <Settings className="h-3 w-3 mr-1" />
                    {c.name || 'Кампания'}
                  </Button>
                ))}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 shrink-0 text-orange-600 hover:text-orange-800 dark:text-orange-400"
              onClick={() => setVkWarningDismissed(true)}
              data-testid="button-dismiss-vk-warning"
            >
              <X className="h-4 w-4" />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Отображение ошибок */}
      {campaignsError && (
        <div className="space-y-2">
          <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-lg border">
            <strong>{t('dashboard.campaignsLoadError')}:</strong> {(campaignsErrorMessage as Error)?.message || t('common.error')}
          </div>
        </div>
      )}

      {/* Главные метрики */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Активные кампании */}
        <Card data-testid="card-active-campaigns" className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={handleNavigateToCampaigns}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('dashboard.activeCampaigns')}</CardTitle>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-active-campaigns-count">
              {campaignsLoading ? <Skeleton className="h-8 w-12" /> : campaignMetrics.active}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('dashboard.ofTotalCampaigns', { total: campaignMetrics.total })}
            </p>
          </CardContent>
        </Card>

        {/* Публикации сегодня */}
        <Card data-testid="card-publications-today" className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={handleNavigateToPosts}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('dashboard.publicationsToday')}</CardTitle>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-publications-today">
              {contentLoading ? <Skeleton className="h-8 w-12" /> : publicationMetrics.today}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('dashboard.thisWeek', { count: publicationMetrics.thisWeek })}
            </p>
          </CardContent>
        </Card>

        {/* Быстрая генерация контента */}
        <Card data-testid="card-quick-content" className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={handleNavigateToPublish}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('dashboard.createContent')}</CardTitle>
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-muted-foreground" />
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-center py-2">
              <Zap className="h-8 w-8 mx-auto mb-2 text-primary" />
              <p className="text-sm font-medium">{t('dashboard.aiGeneration')}</p>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              {t('dashboard.createPostsWithAI')}
            </p>
          </CardContent>
        </Card>

        {/* Ошибки публикации */}
        {publicationMetrics.failed > 0 && (
          <Card data-testid="card-failed-publications" className="cursor-pointer hover:bg-red-50 dark:hover:bg-red-950/20 border-red-200 dark:border-red-800 transition-colors" onClick={() => navigate('/content')}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-red-700 dark:text-red-400">Ошибки публикации</CardTitle>
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-500" />
                <ArrowRight className="h-3 w-3 text-red-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-failed-publications-count">
                {contentLoading ? <Skeleton className="h-8 w-12" /> : publicationMetrics.failed}
              </div>
              <p className="text-xs text-red-500 dark:text-red-400">
                Требуют повторной публикации
              </p>
            </CardContent>
          </Card>
        )}

        {/* Общая активность */}
        <Card data-testid="card-total-activity" className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={handleNavigateToPosts}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('dashboard.totalPublications')}</CardTitle>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-publications">
              {contentLoading ? <Skeleton className="h-8 w-12" /> : publicationMetrics.total}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('dashboard.publishedScheduled', { published: publicationMetrics.published, scheduled: publicationMetrics.scheduled })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Детальная информация */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">

        {/* Недавний контент */}
        <Card data-testid="card-recent-content" className="col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t('dashboard.recentContent')}
            </CardTitle>
            <CardDescription>
              {t('dashboard.recentContentDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {contentLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="border-l-2 border-muted pl-3">
                    <Skeleton className="h-4 w-24 mb-1" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                ))}
              </div>
            ) : latestContent.length > 0 ? (
              <div className="space-y-4">
                {latestContent.slice(0, 3).map((content) => (
                  <div key={content.id} className="border-l-2 border-muted pl-3" data-testid={`content-${content.id}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">{content.title || 'Без названия'}</span>
                      <Badge 
                        variant={content.status === 'published' ? "default" : content.status === 'scheduled' ? "secondary" : "outline"}
                        data-testid={`content-status-${content.id}`}
                      >
                        {content.status === 'published' ? t('dashboard.published') : content.status === 'scheduled' ? t('dashboard.scheduled') : t('dashboard.draft')}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDateWithTimezone(content.createdAt, "dd.MM.yyyy HH:mm")}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">{t('dashboard.contentNotFound')}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* График активности */}
        <Card data-testid="card-activity-chart" className="col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              {t('dashboard.activityChart')}
            </CardTitle>
            <CardDescription>
              {t('dashboard.activityChartDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {contentLoading ? (
              <div className="h-32 flex items-center justify-center">
                <Skeleton className="h-full w-full" />
              </div>
            ) : activityChartData.length > 0 ? (
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={activityChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10 }}
                    />
                    <YAxis 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10 }}
                      width={20}
                    />
                    <Tooltip 
                      labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                      itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                      contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                      formatter={(value: number, name: string) => [
                        value,
                        name === 'published' ? t('dashboard.published') : 
                        name === 'scheduled' ? t('dashboard.scheduled') : 
                        t('dashboard.totalPublications')
                      ]}
                    />
                    <Bar 
                      dataKey="published" 
                      fill="hsl(var(--primary))" 
                      radius={[2, 2, 0, 0]}
                      name="published"
                    />
                    <Bar 
                      dataKey="scheduled" 
                      fill="hsl(var(--muted-foreground))" 
                      radius={[2, 2, 0, 0]}
                      name="scheduled"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center bg-muted/20 rounded border-2 border-dashed border-muted">
                <div className="text-center text-muted-foreground">
                  <BarChart3 className="h-8 w-8 mx-auto mb-2" />
                  <p className="text-sm">{t('dashboard.noDataToDisplay')}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Дополнительные инструменты для СММ */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Планировщик публикаций */}
        <Card data-testid="card-scheduler" className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={handleNavigateToPublish}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4" />
              {t('dashboard.scheduler')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">
                {publicationMetrics.scheduled}
              </div>
              <p className="text-xs text-muted-foreground">
                {t('dashboard.scheduledCount')}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Аналитика */}
        <Card data-testid="card-analytics" className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={handleNavigateToAnalytics}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4" />
              {t('dashboard.analytics')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {publicationMetrics.published}
              </div>
              <p className="text-xs text-muted-foreground">
                {t('dashboard.publishedCount')}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Ключевые слова */}
        <Card data-testid="card-keywords" className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={handleNavigateToKeywords}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Hash className="h-4 w-4" />
              {t('dashboard.keywords')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center">
              <div className="text-lg font-bold text-blue-600">
                <PenTool className="h-6 w-6 mx-auto" />
              </div>
              <p className="text-xs text-muted-foreground">
                {t('dashboard.management')}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Тренды */}
        <Card data-testid="card-trends-mini" className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={handleNavigateToTrends}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4" />
              {t('dashboard.topTrends')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {trendsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ) : topTrends.length > 0 ? (
              <div className="space-y-2">
                {topTrends.map((trend, index) => (
                  <div key={trend.id} className="text-xs">
                    <div className="flex items-center gap-1">
                      <span className="font-medium text-purple-600">#{index + 1}</span>
                      <span className="truncate">{trend.title}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      👁 {trend.views || 0} • ❤️ {trend.likes || 0} • 💬 {trend.comments || 0}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-xs text-muted-foreground">
                <TrendingUp className="h-6 w-6 mx-auto mb-1 opacity-50" />
                <p>{t('dashboard.noTrends')}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Последние кампании */}
      <Card data-testid="card-recent-campaigns">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Недавние кампании
          </CardTitle>
          <CardDescription>
            Ваши последние активные проекты
          </CardDescription>
        </CardHeader>
        <CardContent>
          {campaignsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-6 w-16" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {campaignsResponse?.data?.slice(0, 5).map((campaign) => (
                <div key={campaign.id} className="flex items-center justify-between py-2 border-b border-muted last:border-0" data-testid={`campaign-item-${campaign.id}`}>
                  <div>
                    <p className="font-medium" data-testid={`campaign-name-${campaign.id}`}>{campaign.name || 'Без названия'}</p>
                    <p className="text-sm text-muted-foreground">
                      {campaign.description || "Без описания"}
                    </p>
                  </div>
                  <Badge 
                    variant={isCampaignActive(campaign) ? 'default' : 'secondary'}
                    data-testid={`campaign-status-${campaign.id}`}
                  >
                    {isCampaignActive(campaign) ? 'Активна' : 'Черновик'}
                  </Badge>
                </div>
              ))}
              
              {(!campaignsResponse?.data || campaignsResponse.data.length === 0) && (
                <div className="text-center py-8 px-6">
                  <FileText className="h-16 w-16 mx-auto mb-4 text-muted-foreground/50" />
                  <h3 className="text-lg font-semibold mb-2">Добро пожаловать в SMM Manager!</h3>
                  <div className="text-sm text-muted-foreground space-y-3 max-w-2xl mx-auto">
                    <p>
                      SMM Manager — это платформа для управления публикациями в социальных сетях с поддержкой AI-генерации контента.
                    </p>
                    <div className="text-left bg-muted/30 p-4 rounded-lg space-y-2">
                      <p className="font-medium text-foreground">Для начала работы:</p>
                      <ol className="list-decimal list-inside space-y-1 ml-2">
                        <li>Создайте <strong>кампанию</strong> — это проект для управления контентом одного бренда или темы</li>
                        <li>Настройте <strong>социальные сети</strong> — подключите Instagram, Facebook, VK, Telegram или YouTube</li>
                        <li>Добавьте <strong>анкету бизнеса</strong> — AI будет генерировать контент на основе ваших данных</li>
                        <li>Создавайте контент с помощью AI или вручную и публикуйте по расписанию</li>
                      </ol>
                    </div>
                    <div className="flex items-center justify-center gap-3 pt-2">
                      <Button 
                        variant="default" 
                        onClick={() => navigate('/campaigns')}
                        className="gap-2"
                      >
                        <Plus className="h-4 w-4" />
                        Создать кампанию
                      </Button>
                      <Button 
                        variant="outline" 
                        asChild
                      >
                        <a 
                          href="/help/tutorials" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="gap-2"
                        >
                          <BookOpen className="h-4 w-4" />
                          Видеоуроки
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
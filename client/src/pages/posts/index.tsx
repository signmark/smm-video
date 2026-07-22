import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCampaignStore } from "@/lib/campaignStore";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { PenLine, Send, Loader2, SortDesc, SortAsc, Eye, ExternalLink, RefreshCw, Copy, Clock } from "lucide-react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { endOfMonth, format, isSameDay, isSameMonth, parseISO, startOfDay, startOfMonth } from 'date-fns';
import { ru, enUS, es } from 'date-fns/locale';
import { formatInTimeZone } from 'date-fns-tz';
import { SiInstagram, SiTelegram, SiVk, SiFacebook, SiYoutube, SiThreads } from "react-icons/si";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/lib/store";
import { SocialPlatform, PlatformPublishInfo, CampaignContent } from "@/types";
import { platformNames } from "@/lib/social-platforms";
import {
  countConfirmedPlatformPublications,
  getConfirmedPublicationEvents,
  getFailedPlatforms,
  getFailedPublicationAttemptDate,
  getPublicationCardDates,
  isFullyFailedPublication,
} from "@/lib/published-content";
import { useTranslation } from 'react-i18next';
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getPublishedPlatformTimeSummary } from '@shared/schedule-time';
import { QueryErrorState } from '@/components/QueryErrorState';

function markdownToHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/\*\*\*(.+?)\*\*\*/gs, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>')
    .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
    .replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#{1}\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/\n/g, '<br>');
}

// Страница календаря публикаций
export default function Posts() {
  const { t, i18n } = useTranslation();
  const { selectedCampaign } = useCampaignStore();
  const userId = useAuthStore((state) => state.userId);
  const getAuthToken = useAuthStore((state) => state.getAuthToken);
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [retryingKey, setRetryingKey] = useState<string | null>(null);
  // Set of post IDs whose "Ошибки публикации → Повторить" is currently
  // firing. Replaces the previous behaviour where the same button
  // double-fired because forEach ran in parallel and the single
  // retryingKey state was overwritten by whichever Promise resolved
  // last, so the per-card "retrying" indicator was wrong.
  const [retryingPostIds, setRetryingPostIds] = useState<Set<string>>(() => new Set());
  const [reusingContentId, setReusingContentId] = useState<string | null>(null);

  // Sequential retry for fully-failed posts: one platform at a time so
  // a non-idempotent backend cannot be hit twice by a double-click. The
  // per-post set tracks the in-flight state; individual per-platform
  // buttons in the day's cards still use retryingKey for backward
  // compatibility.
  const retryFailedPlatformsSequentially = async (
    postId: string,
    platforms: Array<{ platform: string }>,
  ): Promise<void> => {
    if (retryingPostIds.has(postId)) return;
    if (platforms.length === 0) return;
    setRetryingPostIds((prev) => {
      const next = new Set(prev);
      next.add(postId);
      return next;
    });
    try {
      for (const { platform } of platforms) {
        try {
          await retryPlatformPublish(postId, platform);
        } catch (err) {
          console.warn('[posts] retry failed for', postId, platform, err);
        }
      }
    } finally {
      setRetryingPostIds((prev) => {
        const next = new Set(prev);
        next.delete(postId);
        return next;
      });
    }
  };

  const reusePost = async (contentId: string) => {
    setReusingContentId(contentId);
    try {
      const result = await apiRequest(`/api/clone-content/${contentId}`, { method: 'POST' });
      if (result?.success) {
        toast({ title: 'Копия создана', description: 'Пост скопирован в черновики — можно редактировать и публиковать заново' });
        queryClient.invalidateQueries({ queryKey: ['/api/campaign-content', selectedCampaign?.id] });
      } else {
        throw new Error(result?.error || 'Ошибка клонирования');
      }
    } catch (err: any) {
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    } finally {
      setReusingContentId(null);
    }
  };

  const retryPlatformPublish = async (contentId: string, platform: string) => {
    const key = `${contentId}:${platform}`;
    setRetryingKey(key);
    try {
      const response = await fetch('/api/retry-platform', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ contentId, platform })
      });
      const result = await response.json();
      if (result.success) {
        toast({ title: 'Опубликовано', description: `Успешно опубликовано в ${platformNames[platform as keyof typeof platformNames] || platform}` });
        // Обновляем кэш напрямую, не дожидаясь server-side кэша (60 сек TTL)
        queryClient.setQueryData(['/api/campaign-content', selectedCampaign?.id], (old: any) => {
          if (!old?.data) return old;
          return {
            ...old,
            data: old.data.map((item: any) => {
              if (item.id !== contentId) return item;
              const updatedPlatforms = {
                ...(item.socialPlatforms || {}),
                [platform]: {
                  ...(item.socialPlatforms?.[platform] || {}),
                  status: 'published',
                  postUrl: result.postUrl || item.socialPlatforms?.[platform]?.postUrl,
                  publishedAt: new Date().toISOString(),
                  error: undefined,
                  lastError: undefined
                }
              };
              return { ...item, socialPlatforms: updatedPlatforms };
            })
          };
        });
      } else {
        toast({ title: 'Ошибка публикации', description: result.error || 'Не удалось опубликовать', variant: 'destructive' });
        // При ошибке всё равно инвалидируем для актуального статуса
        queryClient.invalidateQueries({ queryKey: ['/api/campaign-content', selectedCampaign?.id] });
      }
    } catch (err: any) {
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    } finally {
      setRetryingKey(null);
    }
  };
  // Функция для получения правильной локали date-fns
  const getDateLocale = () => {
    switch (i18n.language) {
      case 'en': return enUS;
      case 'es': return es;
      case 'ru':
      default: return ru;
    }
  };
  
  // Функция для форматирования ЗАПЛАНИРОВАННОГО времени в локальном часовом поясе пользователя
  const formatScheduledTime = (dateString: string | Date): string => {
    if (!dateString) return '';
    try {
      const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const dateObj = typeof dateString === 'string' ? new Date(dateString) : dateString;
      return formatInTimeZone(dateObj, userTimeZone, 'dd MMMM yyyy, HH:mm', { locale: getDateLocale() });
    } catch (error) {
      console.error('Ошибка форматирования даты:', error);
      return '';
    }
  };

  // Функция для времени "Фактически опубликовано" в локальном часовом поясе пользователя
  const formatPublishedTime = (dateString: string | Date): string => {
    if (!dateString) return '';
    try {
      const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const dateObj = typeof dateString === 'string' ? new Date(dateString) : dateString;
      return formatInTimeZone(dateObj, userTimeZone, 'dd MMMM yyyy, HH:mm', { locale: getDateLocale() });
    } catch (error) {
      console.error('Ошибка форматирования даты:', error);
      return '';
    }
  };
  
  // Состояние для хранения данных публикаций
  
  // Запрос контента кампании для календаря
  const { data: campaignContentResponse, isLoading: isLoadingContent, isFetching: isFetchingContent, isError, error, refetch } = useQuery({
    queryKey: ['/api/campaign-content', selectedCampaign?.id],
    queryFn: async () => {
      if (!selectedCampaign?.id) return { data: [] };

      try {
        const responseData = await apiRequest(`/api/campaign-content?campaignId=${selectedCampaign.id}&_t=${Date.now()}`, {
          method: 'GET',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });

        return responseData;
      } catch (error) {
        console.error('Ошибка при загрузке контента:', error);
        throw error;
      }
    },
    enabled: !!selectedCampaign?.id && !!userId,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
    retry: (failureCount, error: any) => {
      if (error?.message?.includes('401') || error?.message?.includes('Invalid token')) {
        return false;
      }
      return failureCount < 3;
    }
  });

  const campaignContent: CampaignContent[] = campaignContentResponse?.data || [];

  // Авто-выбор последней даты с публикациями, если на текущей дате нет постов
  useEffect(() => {
    if (!campaignContent.length) return;

    // Собираем все даты публикаций
    const publishDates = campaignContent.flatMap(getPublicationCardDates);

    if (!publishDates.length) return;

    // Если на текущей выбранной дате нет постов — выбираем ближайшую дату с постами
    const todayHasPosts = publishDates.some(d => isSameDay(d, selectedDate));
    if (!todayHasPosts) {
      // Берём самую позднюю дату публикации
      const latestDate = new Date(Math.max(...publishDates.map(d => d.getTime())));
      setSelectedDate(startOfDay(latestDate));
      setVisibleMonth(startOfMonth(latestDate));
    }
  }, [campaignContentResponse]);

  const platformCounts = React.useMemo(() => countConfirmedPlatformPublications(
    campaignContent,
    ['instagram', 'telegram', 'vk', 'facebook', 'youtube'] as SocialPlatform[],
    { from: startOfMonth(visibleMonth), to: endOfMonth(visibleMonth) },
  ), [campaignContent, visibleMonth]);

  const dayKey = (date: Date) => format(date, 'yyyy-MM-dd');

  const publicationEventsByDay = React.useMemo(() => {
    const eventsByDay = new Map<string, ReturnType<typeof getConfirmedPublicationEvents>>();
    campaignContent.flatMap(getConfirmedPublicationEvents).forEach((event) => {
      const key = dayKey(event.date);
      eventsByDay.set(key, [...(eventsByDay.get(key) || []), event]);
    });
    return eventsByDay;
  }, [campaignContent]);

  const publicationCardsByDay = React.useMemo(() => {
    const cardsByDay = new Map<string, CampaignContent[]>();
    campaignContent.forEach((content) => {
      getPublicationCardDates(content).forEach((date) => {
        const key = dayKey(date);
        const cards = cardsByDay.get(key) || [];
        if (!cards.some((card) => card.id === content.id)) {
          cardsByDay.set(key, [...cards, content]);
        }
      });
    });
    return cardsByDay;
  }, [campaignContent]);

  const failedAttemptsByDay = React.useMemo(() => {
    const attemptsByDay = new Map<string, CampaignContent[]>();
    campaignContent.forEach((content) => {
      const date = getFailedPublicationAttemptDate(content);
      if (!date) return;
      const key = dayKey(date);
      attemptsByDay.set(key, [...(attemptsByDay.get(key) || []), content]);
    });
    return attemptsByDay;
  }, [campaignContent]);

  // Получение точек для календаря (публикации на каждый день)
  // Получение контента кампании
  const getContent = () => {
    return campaignContent;
  };

  // Вспомогательная функция для определения уникальных ЗАПЛАНИРОВАННЫХ постов на день
  const getUniquePostsForDay = (day: Date) => {
    // Создаем карту идентификаторов постов, чтобы избежать дублирования
    const uniquePosts = new Map<string, CampaignContent>();
    
    (publicationCardsByDay.get(dayKey(day)) || []).forEach((post) => uniquePosts.set(post.id, post));
    
    // Возвращаем массив уникальных опубликованных постов с сортировкой по времени публикации
    const postsArray = Array.from(uniquePosts.values());
    
    return postsArray.sort((a, b) => {
      // Получаем дату публикации для каждого поста
      const getPublicationDate = (post: CampaignContent): Date => {
        return getPublicationCardDates(post)[0] || new Date(0);
      };
      
      const dateA = getPublicationDate(a);
      const dateB = getPublicationDate(b);
      
      // Сортируем по времени публикации
      return sortOrder === 'desc' 
        ? dateB.getTime() - dateA.getTime() // Новые первыми
        : dateA.getTime() - dateB.getTime(); // Старые первыми
    });
  };

  // Посты с published/partially_published без каких-либо известных дат публикации
  const getUndatedPublishedPosts = (): CampaignContent[] => {
    const allContent = getContent();
    return allContent.filter(post => {
      if (post.status !== 'published' && post.status !== 'partially_published' && post.status !== 'partial') return false;
      if (post.publishedAt) return false;
      if (post.scheduledAt) return false;
      if (post.createdAt) return false; // посты с датой создания показываются в календаре
      const hasPlatformDate = post.socialPlatforms && Object.values(post.socialPlatforms).some((p: any) => p?.publishedAt);
      if (hasPlatformDate) return false;
      return true;
    });
  };

  // Полностью неуспешные посты — есть в календаре (красная точка) и в
  // platform counts НЕ входят, но в этой секции их можно открыть и
  // повторить.
  const fullyFailedPosts = React.useMemo(
    () => campaignContent.filter(isFullyFailedPublication),
    [campaignContent],
  );

  const getDayContent = (day: Date) => {
    const key = dayKey(day);
    const publicationsForDay = publicationEventsByDay.get(key) || [];
    const failedAttemptsForDay = failedAttemptsByDay.get(key) || [];

    if (!publicationsForDay.length && !failedAttemptsForDay.length) return null;

    // Получаем цвета для разных типов контента
    const getColorForType = (type: string): string => {
      switch (type) {
        case 'text': return 'bg-blue-500'; // Синий для текста
        case 'text-image': return 'bg-yellow-500'; // Желтый для картинки с текстом
        case 'video': 
        case 'video-text': return 'bg-red-500'; // Красный для видео
        default: return 'bg-gray-500';
      }
    };

    // Отображаем маркер для каждой подтверждённой публикации в соцсеть.
    return (
      <div className="flex justify-center flex-wrap gap-0.5 mt-1">
        {publicationsForDay.map((publication) => (
          <div 
            key={publication.key}
            className={`h-1.5 w-1.5 rounded-full ${getColorForType(publication.contentType || 'text')}`}
          ></div>
        ))}
        {failedAttemptsForDay.map((content) => (
          <div
            key={`${content.id}:failed`}
            className="h-1.5 w-1.5 rounded-full bg-red-500"
            title={t('publishing.published.publicationError')}
          />
        ))}
      </div>
    );
  };

  const renderPostCard = (content: CampaignContent) => {
    const summaryTimes = getPublishedPlatformTimeSummary(content.socialPlatforms, {
      scheduledAt: content.scheduledAt,
      publishedAt: content.publishedAt,
    });

    return (
    <Dialog key={content.id}>
      <DialogTrigger asChild>
        <Card className="cursor-pointer hover:bg-muted/50 transition-colors border border-border/50">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              {(() => {
                const generatedImage = content.contentType === 'story' && content.additionalMedia?.find(
                  item => item.type === 'generated_image' || (item as any).type === 'generated_image'
                );
                const displayImage = generatedImage ? generatedImage.url : content.imageUrl;
                const isValidUrl = displayImage &&
                  typeof displayImage === 'string' &&
                  displayImage.startsWith('http') &&
                  !displayImage.includes('[object');
                return isValidUrl && (
                  <div className="w-16 h-16 flex-shrink-0 rounded-md overflow-hidden bg-muted">
                    <img src={displayImage} alt={content.title} className="object-cover w-full h-full" />
                  </div>
                );
              })()}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm leading-tight line-clamp-1">{content.title}</h4>
                    {content.content ? (
                      <p className="text-xs text-muted-foreground line-clamp-3 mt-0.5">
                        {content.content
                          .replace(/<\/p>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '')
                          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
                          .replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
                          .replace(/__(.+?)__/g, '$1').replace(/_(.+?)_/g, '$1')
                          .replace(/^#{1,6}\s+/gm, '').replace(/`(.+?)`/g, '$1')
                          .replace(/\n+/g, ' ').trim()}
                      </p>
                    ) : null}
                  </div>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 flex-shrink-0">
                    <Eye className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {content.socialPlatforms && Object.entries(content.socialPlatforms).map(([platform, info]) => {
                    if (info.status === 'published' || info.status === 'failed' || (info.error || info.lastError)) {
                      let Icon = SiInstagram;
                      let color = 'text-pink-600';
                      if (platform === 'telegram') { Icon = SiTelegram; color = 'text-blue-500'; }
                      else if (platform === 'vk') { Icon = SiVk; color = 'text-blue-600'; }
                      else if (platform === 'facebook') { Icon = SiFacebook; color = 'text-indigo-600'; }
                      else if (platform === 'youtube') { Icon = SiYoutube; color = 'text-red-600'; }
                      else if (platform === 'threads') { Icon = SiThreads; color = 'text-black dark:text-white'; }
                      const isError = !!(info.postUrl && info.status === 'published') ? false : (info.status === 'failed' || !!(info.error || info.lastError));
                      const errorMsg = info.error || info.lastError || '';
                      return (
                        <div key={platform}
                          title={isError ? `${platformNames[platform as keyof typeof platformNames] || platform} — ошибка${errorMsg ? ': ' + errorMsg : ''}` : platformNames[platform as keyof typeof platformNames] || platform}
                          className="flex items-center justify-center h-6 w-6 rounded-full bg-muted"
                        >
                          <Icon className={`h-3.5 w-3.5 ${isError ? 'opacity-25 grayscale' : color}`} />
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </DialogTrigger>

      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">{content.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {(() => {
            const generatedImage = content.contentType === 'story' && content.additionalMedia?.find(
              item => item.type === 'generated_image' || (item as any).type === 'generated_image'
            );
            const displayImage = generatedImage ? generatedImage.url : content.imageUrl;
            const isValidUrl = displayImage &&
              typeof displayImage === 'string' &&
              displayImage.startsWith('http') &&
              !displayImage.includes('[object');
            return isValidUrl && (
              <div className="relative rounded-md overflow-hidden bg-muted">
                <img src={displayImage} alt={content.title} className="w-full h-auto max-h-96 object-contain" />
              </div>
            );
          })()}
          <div className="prose prose-sm max-w-none">
            <div dangerouslySetInnerHTML={{ __html: markdownToHtml(content.content) }} />
          </div>
          {content.keywords && content.keywords.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Ключевые слова:</h4>
              <div className="flex flex-wrap gap-1">
                {content.keywords.map((keyword, index) => (
                  <Badge key={index} variant="outline" className="text-xs">{keyword}</Badge>
                ))}
              </div>
            </div>
          )}
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium mb-3">Статус публикации:</h4>
            <div className="space-y-2">
              {content.socialPlatforms && Object.entries(content.socialPlatforms).map(([platform, info]) => {
                if (info.status === 'published' || info.status === 'failed' || (info.error || info.lastError)) {
                  let Icon = SiInstagram;
                  let color = 'text-pink-600';
                  let platformName = platform;
                  if (platform === 'telegram') { Icon = SiTelegram; color = 'text-blue-500'; platformName = 'Telegram'; }
                  else if (platform === 'vk') { Icon = SiVk; color = 'text-blue-600'; platformName = 'ВКонтакте'; }
                  else if (platform === 'facebook') { Icon = SiFacebook; color = 'text-indigo-600'; platformName = 'Facebook'; }
                  else if (platform === 'instagram') { platformName = 'Instagram'; }
                  else if (platform === 'youtube') { Icon = SiYoutube; color = 'text-red-600'; platformName = 'YouTube'; }
                  else if (platform === 'threads') { Icon = SiThreads; color = 'text-black dark:text-white'; platformName = 'Threads'; }
                  const isProperlyPublished = info.status === 'published' && !!info.postUrl;
                  const hasError = !isProperlyPublished && (info.status === 'failed' || !!(info.error || info.lastError));
                  return (
                    <div key={platform} className={`flex items-start justify-between gap-2 p-3 rounded-md ${hasError ? 'bg-red-50 border border-red-200' : 'bg-muted/50'}`}>
                      <div className="flex flex-col gap-2 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Icon className={`h-4 w-4 ${color} flex-shrink-0`} />
                          <span className="font-medium">{platformName}</span>
                          <Badge variant="default" className={hasError ? "bg-red-100 text-red-800 text-xs" : "bg-green-100 text-green-800 text-xs"}>
                            {hasError ? 'Ошибка' : 'Опубликовано'}
                          </Badge>
                        </div>
                        {info.scheduledAt && (
                          <div className="text-xs text-muted-foreground">
                            <strong>Время платформы:</strong> {formatScheduledTime(info.scheduledAt)}
                          </div>
                        )}
                        {info.publishedAt && (
                          <div className="text-xs text-muted-foreground">
                            <strong>Фактически опубликовано:</strong> {formatPublishedTime(info.publishedAt)}
                          </div>
                        )}
                        {(info.error || info.lastError) && (
                          <div className="text-xs text-red-600 bg-red-100 p-2 rounded border break-words">
                            <strong>Ошибка:</strong> {(info.error || info.lastError)}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5 flex-shrink-0 ml-2">
                        {info.postUrl && !hasError && (
                          <Button asChild size="sm" variant="outline" className="h-8">
                            <a href={info.postUrl} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3 w-3 mr-1" />
                              Открыть
                            </a>
                          </Button>
                        )}
                        {hasError && (() => {
                          const rKey = `${content.id}:${platform}`;
                          const isRetrying = retryingKey === rKey;
                          return (
                            <Button size="sm" variant="outline" className="h-8 border-blue-400 text-blue-700 hover:bg-blue-50"
                              disabled={isRetrying}
                              onClick={() => retryPlatformPublish(content.id, platform)}
                              data-testid={`button-retry-post-${content.id}-${platform}`}
                            >
                              {isRetrying ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                              {isRetrying ? 'Публикуем...' : 'Повторить'}
                            </Button>
                          );
                        })()}
                      </div>
                    </div>
                  );
                }
                return null;
              })}
            </div>
          </div>
          <div className="text-sm text-muted-foreground border-t pt-4 space-y-2">
            {summaryTimes.publishedAt && (
              <div><strong>Общее время публикации:</strong> {formatPublishedTime(summaryTimes.publishedAt)}</div>
            )}
            {summaryTimes.scheduledAt && (
              <div><strong>Запланировано на:</strong> {formatScheduledTime(summaryTimes.scheduledAt)}</div>
            )}
          </div>
          <div className="border-t pt-4">
            <Button variant="outline" size="sm" className="gap-2"
              disabled={reusingContentId === content.id}
              onClick={() => reusePost(content.id)}
              data-testid={`button-reuse-${content.id}`}
            >
              {reusingContentId === content.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              Переиспользовать (скопировать в черновики)
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold">{t('publishing.published.title')}</h1>
          <p className="text-muted-foreground mt-2">
            {t('publishing.published.subtitle')}
          </p>

        </div>
        
        {/* Кнопки управления */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => refetch()}
            disabled={isFetchingContent}
            title="Обновить"
            data-testid="button-refresh-posts"
          >
            <RefreshCw size={15} className={isFetchingContent ? 'animate-spin' : ''} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
          >
            {sortOrder === 'desc' ? (
              <>
                <SortDesc size={16} />
                <span>{t('common.sortNewest')}</span>
              </>
            ) : (
              <>
                <SortAsc size={16} />
                <span>{t('common.sortOldest')}</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {!selectedCampaign ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 space-y-4">
            <div className="text-center">
              <h3 className="text-lg font-medium text-muted-foreground mb-2">Выберите кампанию</h3>
              <p className="text-sm text-muted-foreground">
                Для просмотра публикаций выберите кампанию в селекторе выше
              </p>
            </div>
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <CardContent className="pt-6">
            <QueryErrorState
              error={error}
              onRetry={() => !isFetchingContent && refetch()}
              isRefetching={isFetchingContent}
              title="Не удалось загрузить публикации"
              testId="posts-query-error"
            />
          </CardContent>
        </Card>
      ) : (
        <Card>

          <CardContent className="pt-6">
            <div className="grid gap-6 md:grid-cols-[300px_1fr]">
              <div className="space-y-6">
                <Calendar
                  mode="single"
                  month={visibleMonth}
                  onMonthChange={(month) => setVisibleMonth(startOfMonth(month))}
                  selected={selectedDate}
                  onSelect={(date) => {
                    if (!date) return;
                    setSelectedDate(date);
                    setVisibleMonth(startOfMonth(date));
                  }}
                  className="rounded-md border"
                  locale={getDateLocale()}
                  weekStartsOn={i18n.language === 'en' ? 0 : 1}
                  labels={{
                    labelPrevious: () => t('publishing.published.calendarPrevMonth'),
                    labelNext: () => t('publishing.published.calendarNextMonth'),
                    labelMonthDropdown: () => t('publishing.published.calendarMonth'),
                    labelYearDropdown: () => t('publishing.published.calendarYear'),
                  }}
                  components={{
                    DayContent: ({ date }) => (
                      <div className="flex flex-col items-center">
                        <span>{date.getDate()}</span>
                        {isSameMonth(date, visibleMonth) ? getDayContent(date) : null}
                      </div>
                    )
                  }}
                  initialFocus
                />

                <div className="space-y-4">
                  <div>
                    <p className="mb-2 max-w-full leading-tight text-muted-foreground">
                      <span className="block text-sm">
                        {t('publishing.published.platformPublications')}
                      </span>
                      <span className="mt-0.5 block text-sm">
                        {t('publishing.published.forMonth', {
                          month: format(visibleMonth, 'LLLL yyyy', { locale: getDateLocale() }),
                        })}
                      </span>
                    </p>
                    <div className="space-y-1">
                      {[
                        { platform: 'instagram' as SocialPlatform, name: 'Instagram', icon: SiInstagram, color: 'text-pink-600' },
                        { platform: 'telegram' as SocialPlatform, name: 'Telegram', icon: SiTelegram, color: 'text-blue-500' },
                        { platform: 'vk' as SocialPlatform, name: 'ВКонтакте', icon: SiVk, color: 'text-blue-600' },
                        { platform: 'facebook' as SocialPlatform, name: 'Facebook', icon: SiFacebook, color: 'text-indigo-600' },
                        { platform: 'youtube' as SocialPlatform, name: 'YouTube', icon: SiYoutube, color: 'text-red-600' }
                      ].map(item => (
                        <div key={item.platform} className="flex items-center gap-2">
                          <div className="w-4 h-4">
                            <item.icon className={`h-4 w-4 ${item.color}`} />
                          </div>
                          <span>{item.name}</span>
                          <span className="ml-auto bg-muted text-xs px-2 py-0.5 rounded-md text-muted-foreground">
                            {platformCounts[item.platform] || 0}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>


                </div>

                {/* Оптимальное время публикации */}
                {(() => {
                  const hourCounts: Record<number, number> = {};
                  campaignContent.forEach(post => {
                    if (post.status !== 'published' && post.status !== 'partial' && post.status !== 'partially_published') return;
                    const date = post.scheduledAt || post.publishedAt;
                    if (!date) return;
                    try {
                      const h = new Date(date).getHours();
                      hourCounts[h] = (hourCounts[h] || 0) + 1;
                    } catch {}
                  });
                  const topHours = Object.entries(hourCounts)
                    .sort((a, b) => Number(b[1]) - Number(a[1]))
                    .slice(0, 3)
                    .map(([h, count]) => ({ hour: Number(h), count: Number(count) }));
                  if (topHours.length === 0) return null;
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        <p className="text-sm font-medium">Лучшее время публикации</p>
                      </div>
                      <div className="space-y-1">
                        {topHours.map(({ hour, count }) => (
                          <div key={hour} className="flex items-center justify-between text-xs">
                            <span className="font-mono text-foreground">{String(hour).padStart(2,'0')}:00 – {String(hour+1 < 24 ? hour+1 : 0).padStart(2,'0')}:00</span>
                            <span className="text-muted-foreground">{count} публ.</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground">На основе ваших публикаций</p>
                    </div>
                  );
                })()}

                <div className="mt-4 space-y-2">
                  <Button
                    onClick={() => setLocation('/content')}
                    className="w-full"
                    variant="default"
                  >
                    <PenLine className="mr-2 h-4 w-4" />
                    {t('publishing.published.contentManagement')}
                  </Button>
                </div>
              </div>

              <div>
                <h3 className="font-medium text-lg mb-4">
                  {t('publishing.published.postsOn', { date: format(selectedDate, 'dd MMMM yyyy', { locale: getDateLocale() }) })}
                </h3>

              {isLoadingContent ? (
                <div className="p-6 text-center">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                  <p>{t('common.loading')}</p>
                </div>
              ) : (
                <>
                  {getUniquePostsForDay(selectedDate).length > 0 ? (
                    <div className="grid gap-3">
                      {getUniquePostsForDay(selectedDate).map(renderPostCard)}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <p>{t('publishing.published.noPublished')}</p>
                      <p className="text-sm mt-2">{t('publishing.published.showOnly')}</p>
                    </div>
                  )}
                </>
              )}
              </div>
            </div>

            {/* Секция «Опубликованные (без даты)» — скрыта на error, чтобы не дублировать сообщение. */}
            {!isLoadingContent && getUndatedPublishedPosts().length > 0 ? (
              <div className="mt-6 border-t pt-6">
                <h3 className="font-medium text-lg mb-1">Опубликованные (без даты)</h3>
                <p className="text-sm text-muted-foreground mb-4">Посты, у которых не удалось определить дату публикации</p>
                <div className="grid gap-3">
                  {getUndatedPublishedPosts().map(renderPostCard)}
                </div>
              </div>
            ) : null}

            {/* Секция «Ошибки публикации» — fully-failed посты, которые
                НЕ должны считаться в платформенных счётчиках и в
                «лучшем времени», но должны быть доступны для повтора.
                Сами карточки уже добавлены в calendar с красной точкой
                (см. getDayContent), здесь мы выводим плоский список. */}
            {!isLoadingContent && fullyFailedPosts.length > 0 ? (
              <div className="mt-6 border-t pt-6" data-testid="posts-failed-section">
                <h3 className="font-medium text-lg mb-1 text-destructive">Ошибки публикации</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Эти посты полностью не опубликованы. Они не входят в счётчики
                  платформ и в «Лучшее время», но доступны для повтора.
                </p>
                <div className="space-y-2">
                  {fullyFailedPosts.map((post) => {
                    const failedPlatforms = getFailedPlatforms(post);
                    return (
                      <div
                        key={post.id}
                        className="p-3 border border-destructive/30 rounded-lg bg-destructive/5"
                        data-testid="posts-failed-row"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="font-medium">{post.title || 'Без названия'}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {failedPlatforms.length === 0
                                ? 'Не удалось опубликовать'
                                : failedPlatforms
                                    .map(
                                      (p) =>
                                        `${p.platform}: ${p.reasonLabel}`,
                                    )
                                    .join(', ')}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              // Sequential retry per platform: forEach fired
                              // them in parallel which (a) double-published on
                              // a rapid double-click and (b) made the per-
                              // post "retrying" state flicker because the
                              // single retryingKey useState was overwritten
                              // by whichever Promise resolved last. The
                              // platform-retry flow is also non-idempotent at
                              // the network level for some integrations.
                              void retryFailedPlatformsSequentially(
                                post.id,
                                failedPlatforms,
                              );
                            }}
                            disabled={isFetchingContent || retryingPostIds.has(post.id)}
                            data-testid="posts-failed-retry"
                          >
                            Повторить
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

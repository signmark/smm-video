import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CampaignContent, Campaign, SocialPlatform, PlatformPublishInfo } from '@/types';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { ru } from 'date-fns/locale';
import { useCampaignStore } from '@/lib/campaignStore';
import { useAuthStore } from '@/lib/store';
import { safeSocialPlatforms, platformNames, SocialPlatforms } from '@/lib/social-platforms';
import { Link } from 'wouter';
import { useWebSocket } from '@/hooks/use-websocket';
import { keysToCamel } from '@/lib/utils';
import { updateContentCachesAfterMoveToDraft } from '@/lib/content-cache-updates';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ScheduledPublicationDetails from '@/components/ScheduledPublicationDetails';
import { Badge } from '@/components/ui/badge';
import { Calendar, Clock, Search, RefreshCw, Filter, SortDesc, SortAsc, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

function markdownToHtml(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/gs, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>')
    .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
    .replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#{1}\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/\n/g, '<br>');
}

export default function ScheduledPublications() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);
  const [previewContent, setPreviewContent] = useState<CampaignContent | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc'); // По умолчанию сортировка от новых к старым
  
  // Мутация для перемещения контента в черновики
  const moveToDraftMutation = useMutation({
    mutationFn: async (contentId: string) => {
      return await apiRequest(`/api/publish/update-content/${contentId}`, {
        method: 'PATCH',
        data: {
          status: 'draft',
          scheduled_at: null,
          social_platforms: {}
        }
      });
    },
    onSuccess: async (_data, contentId) => {
      if (selectedCampaign?.id) {
        await queryClient.cancelQueries({
          queryKey: ['/api/campaign-content', selectedCampaign.id],
        });
        updateContentCachesAfterMoveToDraft(queryClient, selectedCampaign.id, contentId);
      }

      toast({
        title: "Перемещено в черновики",
        description: "Публикация была успешно перемещена в черновики",
        variant: "default"
      });
      if (selectedCampaign?.id) {
        void queryClient.invalidateQueries({ queryKey: ['/api/campaign-content', selectedCampaign.id] });
        void queryClient.invalidateQueries({ queryKey: ['/api/publish/scheduled'] });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: `Не удалось переместить публикацию в черновики: ${error.message || 'Неизвестная ошибка'}`,
        variant: "destructive"
      });
    }
  });
  
  // Используем глобальное состояние для получения текущей выбранной кампании
  const { selectedCampaign } = useCampaignStore();
  
  // Получаем информацию об авторизации из глобального хранилища
  const userId = useAuthStore((state) => state.userId);
  const getAuthToken = useAuthStore((state) => state.getAuthToken);
  
  // Получаем список кампаний пользователя (для отображения названия кампании)
  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ['/api/campaigns'],
    enabled: !!userId,
  });
  
  // Получаем запланированные публикации ТОЛЬКО для выбранной кампании
  const {
    data: scheduledContent = [],
    isLoading: scheduledLoading,
    isFetching: scheduledFetching,
    refetch: refetchScheduled,
  } = useQuery<CampaignContent[]>({
    queryKey: ['/api/campaign-content', selectedCampaign?.id, 'scheduled'],
    queryFn: async () => {
      // Запрос ТОЛЬКО для выбранной кампании — без кампании данные не загружаем
      const result = await apiRequest(
        `/api/campaign-content?campaignId=${selectedCampaign!.id}&limit=500`,
        { method: 'GET' }
      );
      
      // Преобразуем ключи из snake_case в camelCase
      const allContent = keysToCamel<CampaignContent[]>(result.data || []);
      
      // Показываем только посты со статусом 'scheduled'
      const scheduled = allContent.filter((content: any) => content.status === 'scheduled');
      
      console.log(`[scheduled] Кампания ${selectedCampaign!.id}: ${scheduled.length} запланированных`);
      return scheduled;
    },
    // Запрос активен ТОЛЬКО когда выбрана конкретная кампания
    enabled: !!userId && !!selectedCampaign?.id,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    staleTime: 0
  });
  
  // WebSocket для получения уведомлений о изменении статусов публикаций
  const ws = useWebSocket();
  
  // Обрабатываем WebSocket сообщения для обновления данных
  useEffect(() => {
    if (ws) {
      const handleMessage = (event: MessageEvent) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'publication_status_updated' || message.type === 'content_published') {
            console.log('Получено уведомление о обновлении статуса публикации:', message);
            // Обновляем данные запланированных публикаций при изменении статусов
            refetchScheduled();
          }
        } catch (error) {
          console.error('Ошибка обработки WebSocket сообщения:', error);
        }
      };

      ws.addEventListener('message', handleMessage);
      
      return () => {
        ws.removeEventListener('message', handleMessage);
      };
    }
  }, [ws, refetchScheduled]);

  // Обновляем данные при изменении выбранной кампании
  useEffect(() => {
    if (selectedCampaign?.id && userId) {
      refetchScheduled();
    }
  }, [selectedCampaign?.id, userId]); // eslint-disable-line react-hooks/exhaustive-deps
  
  // Фильтрация контента по поисковому запросу и платформе (кампания уже отфильтрована на сервере)
  const filteredContent = React.useMemo(() => {
    if (!scheduledContent) return [];
    
    return scheduledContent.filter((content: CampaignContent) => {
      // Фильтрация по поисковому запросу
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch = (
          (content.title && content.title.toLowerCase().includes(query)) ||
          (content.content && content.content.toLowerCase().includes(query)) ||
          (Array.isArray(content.keywords) && content.keywords.some(keyword => 
            typeof keyword === 'string' && keyword.toLowerCase().includes(query)
          ))
        );
        
        if (!matchesSearch) return false;
      }
      
      // Фильтрация по платформе
      if (selectedPlatform && selectedPlatform !== 'all') {
        // Проверяем наличие контента для выбранной платформы
        if (!content.socialPlatforms) return false;
        
        // Преобразуем объект socialPlatforms в массив для типизированного доступа
        const platformExists = Object.keys(content.socialPlatforms).includes(selectedPlatform);
        if (!platformExists) return false;
      }
      
      return true;
    });
  }, [scheduledContent, searchQuery, selectedPlatform]);
  
  // Разделение контента на предстоящие и прошедшие публикации
  const upcomingContent = React.useMemo(() => {
    if (!filteredContent) return [];
    
    // Начало сегодняшнего дня (00:00:00) — показываем все посты на сегодня и позже
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    
    // Показываем все запланированные посты: с датой >= сегодня или вообще без даты
    const upcoming = filteredContent.filter((content: CampaignContent) => {
      // Проверяем глобальную дату запланированной публикации
      if (content.scheduledAt) {
        const scheduledDate = new Date(content.scheduledAt);
        // Показываем посты начиная с начала сегодняшнего дня
        return scheduledDate >= startOfToday;
      }
      
      // Если нет глобальной даты, проверяем социальные платформы
      if (content.socialPlatforms && typeof content.socialPlatforms === 'object') {
        for (const platform in content.socialPlatforms) {
          const platformData = content.socialPlatforms[platform as SocialPlatform];
          if (platformData?.scheduledAt) {
            if ((platformData.status === 'pending' || platformData.status === 'scheduled')) {
              const platformScheduledDate = new Date(platformData.scheduledAt);
              if (platformScheduledDate >= startOfToday) return true;
            }
          }
        }
      }

      // Пост без даты публикации — не показываем в запланированных
      return false;
    });
    
    // Сортируем по дате (в зависимости от выбранного порядка сортировки)
    // Посты без даты идут в конец
    return upcoming.sort((a, b) => {
      const dateA = a.scheduledAt ? new Date(a.scheduledAt).getTime() : (sortOrder === 'desc' ? -Infinity : Infinity);
      const dateB = b.scheduledAt ? new Date(b.scheduledAt).getTime() : (sortOrder === 'desc' ? -Infinity : Infinity);
      
      return sortOrder === 'desc' 
        ? dateB - dateA 
        : dateA - dateB;
    });
  }, [filteredContent, sortOrder]);
  
  
  // Обработчики событий
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };
  
  const handleRefresh = () => {
    refetchScheduled();
    toast({
      title: "Обновление",
      description: "Список запланированных публикаций обновлен",
    });
  };
  
  const handleCancelSuccess = (contentId: string) => {
    toast({
      title: "Публикация отменена",
      description: "Запланированная публикация была успешно отменена",
    });
    if (selectedCampaign?.id) {
      const scheduledQueryKey = ['/api/campaign-content', selectedCampaign.id, 'scheduled'] as const;

      // Убираем карточку сразу после успешной отмены, не дожидаясь сети.
      queryClient.setQueryData<CampaignContent[]>(scheduledQueryKey, (current = []) =>
        current.filter((item) => item.id !== contentId)
      );

      // Фоновая сверка с сервером обновит остальные представления контента.
      void queryClient.invalidateQueries({
        queryKey: ['/api/campaign-content', selectedCampaign.id],
      });
    }
  };

  const handleContentChanged = () => {
    if (selectedCampaign?.id) {
      void queryClient.invalidateQueries({
        queryKey: ['/api/campaign-content', selectedCampaign.id],
      });
    }
  };
  
  const handleViewDetails = (content: CampaignContent) => {
    setPreviewContent(content);
    setIsPreviewOpen(true);
  };
  
  // Функция форматирования даты публикации в локальном часовом поясе пользователя
  const formatScheduledDate = (date: string | Date | null | undefined) => {
    if (!date) return "Не запланировано";
    
    try {
      // Получаем часовой пояс пользователя
      const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      
      // ИСПРАВЛЕНИЕ: Если строка без timezone (без Z), добавляем Z чтобы парсить как UTC
      let dateStr = typeof date === 'string' ? date : date.toISOString();
      if (typeof date === 'string' && !date.endsWith('Z') && !date.includes('+')) {
        dateStr = dateStr + 'Z'; // Принудительно считаем UTC
      }
      
      // Конвертируем строку в объект Date если нужно
      const dateObj = typeof date === 'string' ? new Date(dateStr) : date;
      
      // Проверяем валидность даты
      if (isNaN(dateObj.getTime())) {
        console.warn('Невалидная дата:', date);
        return "Некорректная дата";
      }
      
      // Форматируем дату с использованием часового пояса пользователя
      return formatInTimeZone(dateObj, userTimeZone, 'dd MMMM yyyy, HH:mm', { locale: ru });
    } catch (error) {
      console.error("Ошибка форматирования даты:", error);
      return "Некорректная дата";
    }
  };
  
  // Функция получения названия кампании по ID
  const getCampaignName = (campaignId: string): string => {
    if (!campaigns || !Array.isArray(campaigns) || campaigns.length === 0) return "Неизвестная кампания";
    
    const campaign = campaigns.find((c) => c.id === campaignId);
    return campaign ? campaign.name : "Неизвестная кампания";
  };
  
  // Расчет количества публикаций для каждой платформы
  const platformCounts = React.useMemo(() => {
    const counts: Record<string, number> = {
      all: filteredContent.length
    };
    
    // Инициализируем счетчики для всех платформ
    safeSocialPlatforms.forEach(platform => {
      counts[platform] = 0;
    });
    
    // Подсчитываем количество публикаций для каждой платформы
    filteredContent.forEach(content => {
      if (content.socialPlatforms) {
        Object.keys(content.socialPlatforms).forEach(platform => {
          if (counts[platform] !== undefined) {
            counts[platform]++;
          }
        });
      }
    });
    
    return counts;
  }, [filteredContent]);
  
  // Всегда отображаем только предстоящие публикации
  const contentToDisplay = upcomingContent;
  
  return (
    <div className="container py-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">{t('publishing.scheduled.title')}</h1>
        <p className="text-muted-foreground mb-4">
          {t('publishing.scheduled.subtitle')}
        </p>
        

      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
          <Input
            className="pl-9"
            placeholder={t('publish.scheduled.searchPlaceholder')}
            value={searchQuery}
            onChange={handleSearchChange}
          />
        </div>
        
        <div>
          <Select 
            value={selectedPlatform}
            onValueChange={setSelectedPlatform}
          >
            <SelectTrigger className="w-full">
              <div className="flex items-center">
                <Filter size={16} className="mr-2 text-muted-foreground" />
                <SelectValue placeholder={t('publish.scheduled.allPlatforms')} />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                <div className="flex justify-between w-full">
                  <span>{t('publish.scheduled.allPlatforms')}</span>
                  <span className="ml-2 text-xs px-2 py-0.5 bg-muted rounded-full">
                    {platformCounts.all}
                  </span>
                </div>
              </SelectItem>
              {safeSocialPlatforms.map(platform => (
                <SelectItem key={platform} value={platform}>
                  <div className="flex justify-between w-full">
                    <span>{platformNames[platform]}</span>
                    <span className="ml-2 text-xs px-2 py-0.5 bg-muted rounded-full">
                      {platformCounts[platform]}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div className="flex justify-end gap-2">
          <Button asChild variant="outline">
            <Link href="/publish/calendar">
              <Calendar size={16} className="mr-2" />
              <span>{t('publish.scheduled.calendar')}</span>
            </Link>
          </Button>
          <Button onClick={handleRefresh} variant="outline" className="gap-2">
            <RefreshCw size={16} />
            <span>{t('publish.scheduled.refresh')}</span>
          </Button>
        </div>
      </div>

      <div className="flex justify-between items-center mb-4">
        <div className="flex-1">
          <div className="flex items-center">
            <h3 className="text-lg font-semibold">{t('publishing.scheduled.upcoming')}</h3>
            <Badge variant="outline" className="ml-2">{upcomingContent.length}</Badge>
          </div>
        </div>
        
        <Button
          variant="outline"
          size="sm"
          className="gap-2 ml-4"
          onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
        >
          {sortOrder === 'desc' ? (
            <>
              <SortDesc size={16} />
              <span>{t('publish.scheduled.sortNewest')}</span>
            </>
          ) : (
            <>
              <SortAsc size={16} />
              <span>{t('publish.scheduled.sortOldest')}</span>
            </>
          )}
        </Button>
      </div>

      <div>
        {!selectedCampaign ? (
          <div className="text-center py-16">
            <Calendar className="mx-auto mb-4 text-muted-foreground" size={48} />
            <h3 className="text-xl font-medium text-muted-foreground">Кампания не выбрана</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Выберите кампанию в верхней панели, чтобы увидеть запланированные публикации
            </p>
          </div>
        ) : scheduledLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2 mt-2" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </CardContent>
                <CardFooter>
                  <Skeleton className="h-10 w-[120px]" />
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : upcomingContent.length === 0 ? (
          <div className="text-center py-12">
            <h3 className="text-xl font-medium text-muted-foreground">{t('publishing.scheduled.noScheduled')}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('publishing.scheduled.scheduledWillShow')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {upcomingContent.map((content: CampaignContent) => (
              <ScheduledPublicationDetails 
                key={content.id}
                content={content}
                onCancelSuccess={handleCancelSuccess}
                onContentChanged={handleContentChanged}
                onViewDetails={handleViewDetails}
              />
            ))}
          </div>
        )}
      </div>
      
      {/* Диалог для просмотра деталей публикации */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] w-[95vw] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold break-words">{previewContent?.title || 'Без названия'}</DialogTitle>
            <DialogDescription>
              {previewContent?.campaignId ? getCampaignName(previewContent.campaignId) : 'Кампания не указана'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="mt-4">
            {previewContent?.scheduledAt && (
              <div className="flex items-center mb-3">
                <Clock className="mr-2" size={16} />
                <span className="text-sm">
                  Запланировано на: {formatScheduledDate(previewContent.scheduledAt)}
                </span>
              </div>
            )}
            
            <div className="mt-4 prose max-w-none overflow-hidden">
              <div 
                className="break-words overflow-wrap-anywhere"
                dangerouslySetInnerHTML={{ __html: markdownToHtml(previewContent?.content || '') }} 
              />
            </div>
            
            {previewContent?.imageUrl && 
             typeof previewContent.imageUrl === 'string' && 
             previewContent.imageUrl.startsWith('http') && 
             !previewContent.imageUrl.includes('[object') && (
              <div className="mt-4 flex justify-center w-full">
                <div className="max-w-full max-h-[400px] overflow-hidden rounded-md border">
                  <img 
                    src={previewContent.imageUrl || ''} 
                    alt={previewContent.title || 'Content image'} 
                    className="w-full h-auto max-h-[400px] object-contain"
                    style={{ maxWidth: '100%', height: 'auto' }}
                    onLoad={(e) => {
                      const img = e.target as HTMLImageElement;
                      if (img.naturalWidth > 700) {
                        img.style.width = '100%';
                        img.style.maxWidth = '700px';
                      }
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/placeholder-image.jpg';
                    }}
                  />
                </div>
              </div>
            )}
            
            {previewContent?.videoUrl && (
              <div className="mt-4 flex justify-center w-full">
                <div className="max-w-full max-h-[400px] overflow-hidden rounded-md border">
                  <video 
                    src={previewContent.videoUrl || ''}
                    controls
                    className="w-full h-auto max-h-[400px] object-contain"
                    style={{ maxWidth: '100%', height: 'auto' }}
                  />
                </div>
              </div>
            )}
            
            {previewContent?.keywords && Array.isArray(previewContent.keywords) && previewContent.keywords.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium mb-2">Ключевые слова:</h4>
                <div className="flex flex-wrap gap-2">
                  {previewContent.keywords.map((keyword, idx) => (
                    <Badge key={idx} variant="secondary">{keyword}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

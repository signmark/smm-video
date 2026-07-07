import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Bookmark, BookmarkCheck, ImageOff, ExternalLink, ThumbsUp, Eye, MessageSquare, Calendar, Clock, Flame, Video, Check } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { createProxyImageUrl, createVideoThumbnailUrl, isVideoUrl } from "@/utils/media";
import { TrendDetailDialog } from "./TrendDetailDialog";
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';

interface TrendsListProps {
  campaignId: string;
  onSelectTrends?: (trends: TrendTopic[]) => void;
  onSelectTrend?: (trend: TrendTopic) => void;
  selectable?: boolean;
}

type Period = "3days" | "7days" | "14days" | "30days";

interface Post {
  id: string;
  title: string;
  image_url?: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
}

// Интерфейс для работы с данными, приходящими с API
interface ApiTrendTopic {
  id: string;
  title: string;
  sourceId?: string;
  source_id?: string;
  sourceName?: string;
  sourceUrl?: string;
  url?: string;
  reactions?: number;
  comments?: number;
  description?: string;
  views?: number;
  createdAt?: string;
  created_at?: string;
  isBookmarked?: boolean;
  is_bookmarked?: boolean;
  campaignId?: string;
  campaign_id?: string;
  mediaLinks?: string | any[];
  media_links?: any[];
  trendScore?: number;
  trend_score?: number;
  accountUrl?: string;
  urlPost?: string;
  [key: string]: any; // Для других полей, которые могут встретиться
}

// Интерфейс для внутреннего использования в компоненте (чистый camelCase)
interface TrendTopic {
  id: string;
  title: string;
  sourceId: string;
  sourceName?: string;
  sourceUrl?: string;
  url?: string; // URL оригинальной публикации
  reactions: number;
  comments: number;
  description?: string;
  views: number;
  createdAt: string;
  isBookmarked: boolean;
  campaignId: string;
  mediaLinks?: string | any[]; // Может быть JSON строкой или массивом
  media_links?: Post[]; // Сохраняем это поле для совместимости
  trendScore?: number;
  accountUrl?: string;
  urlPost?: string;
  
  // Поля для видео контента
  hasVideo?: boolean;
  hasVideos?: boolean;
  
  // Дополнительное поле для описания источника
  sourceDescription?: string;
}

// Используем импортированную функцию createProxyImageUrl из utils/media

export function TrendsList({ campaignId, onSelectTrends, onSelectTrend, selectable = false }: TrendsListProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<Period>("7days");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  // Используем тип any для selectedTrend, поскольку требуется совместимость с форматом из TrendDetailDialog
  const [selectedTrend, setSelectedTrend] = useState<any>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedTrends, setSelectedTrends] = useState<TrendTopic[]>([]);

  const { data: trends = [], isLoading: isLoadingTrends } = useQuery({
    queryKey: ["campaign-trends", campaignId, selectedPeriod],
    queryFn: async () => {
      try {
        // Получаем токен авторизации из localStorage
        const authToken = localStorage.getItem('auth_token');
        if (!authToken) {
          throw new Error("Требуется авторизация");
        }
        


        // Используем fetch вместо axios/api для обеспечения одинакового поведения с страницей трендов
        const response = await fetch(`/api/campaign-trends?campaignId=${campaignId}&period=${selectedPeriod}`, {
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        });
        
        if (!response.ok) {
          console.error("Error fetching trends:", response.status, response.statusText);
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || "Failed to fetch trends");
        }
        
        const data = await response.json();
        
        // Отладочный вывод для первого элемента
        if (data && data.data && data.data.length > 0) {

        }
        
        // Преобразуем полученные данные в правильный формат
        const trendTopics = (data?.data || []).map((trend: any) => {
          // Выводим значение created_at для отладки
          if (trend.id === data.data[0].id) {



          }

          const result = {
            id: trend.id,
            title: trend.title,
            sourceId: trend.source_id || trend.sourceId, // Поддержка обоих форматов
            sourceName: trend.sourceName || 'Источник',
            sourceUrl: trend.sourceUrl,
            url: trend.urlPost || trend.url_post || trend.url, // URL поста — из поля "URL Post"
            reactions: trend.reactions || 0,
            comments: trend.comments || 0,
            views: trend.views || 0,
            // Поддерживаем оба формата даты (snake_case и camelCase)
            createdAt: trend.created_at || trend.createdAt, 
            created_at: trend.created_at, // Сохраняем для обратной совместимости
            isBookmarked: trend.is_bookmarked || trend.isBookmarked || false,
            campaignId: trend.campaignId,
            mediaLinks: trend.mediaLinks,
            media_links: trend.media_links,
            description: trend.description,
            // Добавляем показатель trendScore из API
            trendScore: trend.trendScore,
            // Добавляем URL аккаунта и поста в их оригинальном snake_case формате
            accountUrl: trend.accountUrl,
            urlPost: trend.urlPost
          };
          
          // Отладочная информация доступна через React DevTools
          
          return result;
        });

        return trendTopics;
      } catch (error) {
        console.error("Error fetching trends:", error);
        toast({
          title: "Ошибка",
          description: "Не удалось загрузить трендовые темы",
          variant: "destructive",
        });
        return [];
      }
    },
    enabled: !!campaignId,
    staleTime: 5 * 60 * 1000,
  });
  
  // Мутация для управления закладками
  const bookmarkMutation = useMutation({
    mutationFn: async ({ id, isBookmarked }: { id: string; isBookmarked: boolean }) => {
      // Получаем токен авторизации из localStorage
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) {
        throw new Error("Требуется авторизация");
      }
      


      // Используем fetch вместо axios/api для обеспечения одинакового поведения с страницей трендов
      return await fetch(`/api/campaign-trends/${id}/bookmark`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ isBookmarked })
      }).then(response => {
        if (!response.ok) {
          return response.json().then(data => {
            throw new Error(data.message || 'Ошибка при обновлении закладки');
          });
        }
        return response.json();
      });
    },
    onSuccess: () => {
      // Инвалидируем кеш после успешного изменения закладки
      queryClient.invalidateQueries({ queryKey: ["campaign-trends", campaignId] });
      toast({
        title: "Закладка обновлена",
        description: "Статус закладки успешно изменен",
      });
    },
    onError: (error: Error) => {
      console.error("Error updating bookmark:", error);
      toast({
        title: "Ошибка",
        description: "Не удалось обновить статус закладки",
        variant: "destructive",
      });
    }
  });

  // Обработчик ошибки загрузки изображения
  const handleImageError = (imageUrl: string) => {

    setFailedImages(prev => new Set(prev).add(imageUrl));
  };

  if (isLoadingTrends) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!trends?.length) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center mb-4">
          <Select
            value={selectedPeriod}
            onValueChange={(value: Period) => setSelectedPeriod(value)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Выберите период" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3days">За 3 дня</SelectItem>
              <SelectItem value="7days">За неделю</SelectItem>
              <SelectItem value="14days">За 2 недели</SelectItem>
              <SelectItem value="30days">За месяц</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Card className="shadow-sm">
          <CardContent className="text-center p-8">
            <div className="flex flex-col items-center gap-2">
              <Flame className="h-10 w-10 text-muted-foreground mb-2" />
              <h3 className="text-lg font-semibold">Нет актуальных трендов</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                Чтобы найти тренды, перейдите на страницу "Тренды" и нажмите на кнопку "Собрать тренды". 
                Найденные тренды автоматически появятся здесь.
              </p>
              <Button 
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => window.location.href = '/trends'}
              >
                Перейти к трендам
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Обработчик выбора тренда
  const handleTrendSelect = (trend: TrendTopic, e?: React.MouseEvent) => {
    if (!selectable) return;
    
    // Если передано событие, предотвращаем всплытие, чтобы не открывался диалог
    if (e) {
      e.stopPropagation();
    }
    
    // Теперь вызываем callback прямо здесь, а не через useEffect
    setSelectedTrends(prevSelected => {
      const isSelected = prevSelected.some(t => t.id === trend.id);
      
      let newSelectedTrends;
      if (isSelected) {
        // Если тренд уже выбран, удаляем его из выбранных
        newSelectedTrends = prevSelected.filter(t => t.id !== trend.id);
      } else {
        // Иначе добавляем его к выбранным
        newSelectedTrends = [...prevSelected, trend];
      }
      
      // ВАЖНО: Вызываем callback напрямую после обновления состояния
      // Это решает проблему с условным вызовом хуков
      if (onSelectTrends) {
        setTimeout(() => {
          try {
            onSelectTrends(newSelectedTrends);
          } catch (error) {
            console.error("Error in onSelectTrends callback:", error);
          }
        }, 0);
      }
      
      return newSelectedTrends;
    });
  };
  
  // Проверка, выбран ли тренд
  const isTrendSelected = (trendId: string): boolean => {
    return selectedTrends.some(t => t.id === trendId);
  };
  
  // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Полностью отказываемся от useEffect
  // вместо этого используем прямой вызов коллбэка в handleTrendSelect
  // Это решает проблему с условными хуками, которая вызывает
  // ошибку "Rendered more hooks than during the previous render"

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <Select
          value={selectedPeriod}
          onValueChange={(value: Period) => setSelectedPeriod(value)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Выберите период" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3days">За 3 дня</SelectItem>
            <SelectItem value="7days">За неделю</SelectItem>
            <SelectItem value="14days">За 2 недели</SelectItem>
            <SelectItem value="30days">За месяц</SelectItem>
          </SelectContent>
        </Select>
        
        {selectable && selectedTrends.length > 0 && (
          <div className="flex items-center">
            <span className="text-sm mr-2">Выбрано: {selectedTrends.length}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Очищаем выбранные тренды и вызываем коллбэк
                setSelectedTrends([]);
                
                // Вызываем callback напрямую
                if (onSelectTrends) {
                  setTimeout(() => {
                    try {
                      onSelectTrends([]);
                    } catch (error) {
                      console.error("Error in onSelectTrends callback:", error);
                    }
                  }, 0);
                }
              }}
            >
              Очистить
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 pr-2 pb-4 max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
        {trends.map((trend: TrendTopic) => {
          // Получаем URL изображения из различных форматов данных
          let previewImageUrl = null;
          let hasVideos = false;
          
          // Обрабатываем mediaLinks (может быть строкой JSON или объектом)
          if (trend.mediaLinks || trend.media_links) {
            try {
              // Определяем исходный формат данных
              const mediaLinksSource = trend.mediaLinks || trend.media_links;
              let mediaData;
              
              if (typeof mediaLinksSource === 'string') {
                // Это JSON строка
                mediaData = JSON.parse(mediaLinksSource);
              } else {
                // Это уже объект
                mediaData = mediaLinksSource;
              }
              
              // Проверяем наличие видео для генерации превью
              let videoUrl: string | null = null;
              
              // Ищем первое изображение или видео
              if (mediaData.images && Array.isArray(mediaData.images) && mediaData.images.length > 0) {
                const imageUrl = mediaData.images[0];
                if (imageUrl && typeof imageUrl === 'string' && imageUrl.trim()) {
                  previewImageUrl = createProxyImageUrl(imageUrl, trend.id);
                }
                
                // Проверяем наличие видео
                if (mediaData.videos && Array.isArray(mediaData.videos) && mediaData.videos.length > 0) {
                  hasVideos = true;
                  videoUrl = mediaData.videos[0];
                  
                  // Устанавливаем флаги наличия видео в тренде
                  trend.hasVideos = true;
                  trend.hasVideo = true;
                }
              } else if (mediaData.posts && Array.isArray(mediaData.posts) && mediaData.posts.length > 0) {
                // Формат с постами
                const post = mediaData.posts[0];
                
                // Проверяем видео сначала, чтобы дать ему приоритет
                if (post && post.video_url) {
                  hasVideos = true;
                  videoUrl = post.video_url;
                  
                  // Устанавливаем флаги наличия видео в тренде
                  trend.hasVideos = true;
                  trend.hasVideo = true;
                  
                  // Если есть видео, но мы не можем получить изображение,
                  // генерируем превью из видео
                  if (!previewImageUrl && videoUrl) {
                    previewImageUrl = createVideoThumbnailUrl(videoUrl, trend.id);
                  }
                }
                
                // Если нет видео или у нас есть изображение для поста с видео
                if (post && post.image_url && !previewImageUrl) {
                  previewImageUrl = createProxyImageUrl(post.image_url, trend.id);
                }
              }
              
              // Если нашли видео, устанавливаем информацию о нём в самом тренде
              if (hasVideos && videoUrl) {
                // Сохраняем ссылку на видео в mediaLinks, если mediaLinks это строка
                // преобразуем её в объект, добавляем видео и сериализуем обратно
                if (typeof mediaLinksSource === 'string') {
                  try {
                    const mediaObj = JSON.parse(mediaLinksSource);
                    if (!mediaObj.videos || !Array.isArray(mediaObj.videos)) {
                      mediaObj.videos = [];
                    }
                    if (!mediaObj.videos.includes(videoUrl)) {
                      mediaObj.videos.push(videoUrl);
                    }
                    // Заменяем строку с mediaLinks
                    trend.mediaLinks = JSON.stringify(mediaObj);
                  } catch (e) {
                    console.error("Ошибка при обновлении mediaLinks с видео:", e);
                  }
                }
              }
              
              // Если есть видео, но нет превью - создаем превью из видео
              if (hasVideos && !previewImageUrl && videoUrl) {
                previewImageUrl = createVideoThumbnailUrl(videoUrl, trend.id);
              }
            } catch (e) {
              console.error(`[Trend ${trend.id}] Error processing media data:`, e);
            }
          }
            
          return (
            <Card 
              key={trend.id} 
              className={`shadow hover:shadow-md transition-shadow cursor-pointer ${trend.isBookmarked ? "border-primary" : ""}`}
              onClick={() => {
                if (onSelectTrend) {
                  // Вызываем callback для выбора тренда (без открытия диалога)
                  const transformedTrend: any = {
                    ...trend,
                    source_id: trend.sourceId,
                    created_at: trend.createdAt,
                    is_bookmarked: trend.isBookmarked,
                    campaign_id: trend.campaignId || campaignId,
                    media_links: typeof trend.mediaLinks === 'string' ? trend.mediaLinks : 
                                (trend.media_links ? JSON.stringify(trend.media_links) : undefined)
                  };
                  onSelectTrend(transformedTrend);
                } else {
                  // Fallback: открываем диалог
                  const transformedTrend: any = {
                    ...trend,
                    source_id: trend.sourceId,
                    created_at: trend.createdAt,
                    is_bookmarked: trend.isBookmarked,
                    campaign_id: trend.campaignId || campaignId,
                    media_links: typeof trend.mediaLinks === 'string' ? trend.mediaLinks : 
                                (trend.media_links ? JSON.stringify(trend.media_links) : undefined)
                  };
                  setSelectedTrend(transformedTrend);
                  setDetailDialogOpen(true);
                }
              }}
            >
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-3">
                  {/* Чекбокс для выбора тренда */}
                  {selectable && (
                    <div 
                      className="flex-shrink-0 mt-1"
                    >
                      <div className="flex items-center gap-1.5 p-1 rounded hover:bg-accent cursor-pointer">
                        <Checkbox 
                          checked={isTrendSelected(trend.id)}
                          onCheckedChange={(checked) => {
                            handleTrendSelect(trend);
                          }}
                           className="h-4 w-4"
                          id={`trend-checkbox-${trend.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        />
                      </div>
                    </div>
                  )}
                
                  {/* Превью изображения с увеличенным размером */}
                  {previewImageUrl && !failedImages.has(previewImageUrl) ? (
                    <div className="flex-shrink-0 relative">
                      <img 
                        src={previewImageUrl} 
                        alt="Миниатюра поста" 
                        className="h-20 w-20 object-cover rounded-md"
                        loading="lazy"
                        crossOrigin="anonymous"
                        onError={() => handleImageError(previewImageUrl)}
                      />
                      {hasVideos && (
                        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-black/60 rounded-full p-1">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M8 5.14V19.14L19 12.14L8 5.14Z" fill="white" />
                          </svg>
                        </div>
                      )}
                    </div>
                  ) : previewImageUrl ? (
                    <div className="flex-shrink-0 h-20 w-20 flex items-center justify-center bg-muted rounded-md">
                      <ImageOff className="h-8 w-8 text-muted-foreground" />
                    </div>
                  ) : null}
                  
                  <div className="flex-1 min-w-0">
                    {/* Верхняя строка с бейджем и датой */}
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs py-0 h-5">
                          {hasVideos ? "Видео" : previewImageUrl ? "Фото" : "Текст"}
                        </Badge>
                      </div>
                      
                      {trend.url && (
                        <a
                          href={trend.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-3 w-3" />
                          <span>Источник</span>
                        </a>
                      )}
                    </div>
                    
                    {/* Название источника, если оно есть */}
                    {trend.sourceName && (
                      <div className="text-xs text-muted-foreground font-medium mb-1">
                        {trend.sourceName}
                      </div>
                    )}
                    
                    {/* Заголовок с датой */}
                    <div className="text-sm font-medium overflow-hidden" style={{ 
                      display: '-webkit-box', 
                      WebkitLineClamp: 1, 
                      WebkitBoxOrient: 'vertical',
                      textOverflow: 'ellipsis'
                    }}>
                      {(trend.createdAt) && (
                        <span className="inline-block bg-red-500 text-white px-2 py-1 rounded mr-2 text-xs">
                          {new Date(trend.createdAt).toLocaleDateString('ru-RU', { 
                            day: 'numeric', 
                            month: 'long'
                          }).toUpperCase()}
                        </span>
                      )}
                      {trend.title?.trim()}
                    </div>
                    
                    {/* Только первая строка описания */}
                    {trend.description && (
                      <div className="text-xs mt-1 overflow-hidden">
                        {trend.description.split('\n')[0]}
                      </div>
                    )}
                    
                    {/* Статистика */}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
                      {/* Показатель трендовости */}
                      {trend.trendScore && (
                        <div className="flex items-center gap-1">
                          <Flame className="h-3 w-3 text-orange-500" />
                          <span className="text-orange-500 font-medium">{Math.round(trend.trendScore)}</span>
                        </div>
                      )}

                      <div className="flex items-center gap-1">
                        <ThumbsUp className="h-3 w-3" />
                        <span>{typeof trend.reactions === 'number' ? Math.round(trend.reactions).toLocaleString('ru-RU') : (trend.reactions ?? 0)}</span>
                      </div>
                      
                      <div className="flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        <span>{typeof trend.comments === 'number' ? Math.round(trend.comments).toLocaleString('ru-RU') : (trend.comments ?? 0)}</span>
                      </div>
                      
                      <div className="flex items-center gap-1">
                        <Eye className="h-3 w-3" />
                        <span>{typeof trend.views === 'number' ? Math.round(trend.views).toLocaleString('ru-RU') : (trend.views ?? 0)}</span>
                      </div>
                      
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span>{trend.createdAt ? formatDistanceToNow(new Date(trend.createdAt), { locale: ru, addSuffix: true }) : 'неизвестно'}</span>
                      </div>
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 ml-auto"
                        onClick={(e) => {
                          e.stopPropagation();
                          bookmarkMutation.mutate({ id: trend.id, isBookmarked: !trend.isBookmarked });
                        }}
                        disabled={bookmarkMutation.isPending}
                      >
                        {trend.isBookmarked ? (
                          <BookmarkCheck className="h-3 w-3 text-primary" />
                        ) : (
                          <Bookmark className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                    
                    {/* Удаляем нижний дублирующий блок с датой */}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Диалог с подробной информацией о тренде */}
      {selectedTrend && (
        <TrendDetailDialog
          topic={selectedTrend}
          isOpen={detailDialogOpen}
          onClose={() => setDetailDialogOpen(false)}
          onBookmark={(id, isBookmarked) => {
            bookmarkMutation.mutate({ id, isBookmarked });
          }}
          sourceName={selectedTrend.sourceName}
        />
      )}
    </div>
  );
}
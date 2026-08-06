import React, { useState, useEffect } from 'react';
import { DISPLAY_TIME_ZONE, displayToday, displayTodayKey, formatTimeWithTimezone } from '@/lib/date-utils';
import { Calendar } from '@/components/ui/calendar';
import { format, addDays, startOfMonth, parseISO } from 'date-fns';
import {
  matchesDisplayDay,
  hasAnyDisplayDay,
  platformsOnDisplayDay,
  toWallDateKey,
} from '@/lib/publication-day';
import { formatInTimeZone } from 'date-fns-tz';
import { ru } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { CampaignContent, SocialPlatform } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Calendar as CalendarIcon, Clock, ArrowLeft, ArrowRight, SortDesc, SortAsc, Maximize2, Minimize2, Check } from 'lucide-react';
import SocialMediaFilter from './SocialMediaFilter';
import SocialMediaIcon from './SocialMediaIcon';
import { DndProvider, useDrop, useDrag } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useToast } from '@/hooks/use-toast';

interface PublicationCalendarProps {
  content: CampaignContent[];
  isLoading?: boolean;
  onCreateClick?: () => void;
  onViewPost?: (post: CampaignContent) => void;
  initialSortOrder?: 'asc' | 'desc';
  onSortOrderChange?: (order: 'asc' | 'desc') => void;
  onReschedulePost?: (postId: string, newDate: Date, newTime: string) => void;
}

// Типы для drag and drop
const ItemTypes = {
  POST: 'post'
};

interface DraggedPost {
  id: string;
}

// Компонент перетаскиваемого поста
interface DraggablePostProps {
  post: CampaignContent;
  children: React.ReactNode;
}

const DraggablePost: React.FC<DraggablePostProps> = ({ post, children }) => {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: ItemTypes.POST,
    item: { id: post.id, post },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }));

  return (
    <div
      ref={drag}
      style={{
        opacity: isDragging ? 0.5 : 1,
        cursor: 'move',
      }}
    >
      {children}
    </div>
  );
};

// Компонент зоны сброса для календарной ячейки
interface DroppableCalendarCellProps {
  date: Date;
  children: React.ReactNode;
  onDropPost: (postId: string, newDate: Date) => void;
  canDrop?: boolean;
}

const DroppableCalendarCell: React.FC<DroppableCalendarCellProps> = ({ 
  date, 
  children, 
  onDropPost,
  canDrop = true 
}) => {
  const [{ isOver, canDropHere }, drop] = useDrop(() => ({
    accept: ItemTypes.POST,
    drop: (item: { id: string; post: CampaignContent }) => {
      if (canDrop) {
        onDropPost(item.id, date);
      }
    },
    canDrop: () => canDrop,
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDropHere: monitor.canDrop(),
    }),
  }));

  return (
    <div
      ref={drop}
      className={`
        ${isOver && canDropHere ? 'bg-blue-50 border-blue-200' : ''}
        ${isOver && !canDropHere ? 'bg-red-50 border-red-200' : ''}
        ${canDropHere ? 'border-dashed border-2 border-transparent' : ''}
        transition-colors duration-200
      `}
    >
      {children}
    </div>
  );
};



// Компонент для зоны сброса (дня в календаре)
const DroppableDay = ({ 
  day, 
  children, 
  onDropPost 
}: { 
  day: Date; 
  children: React.ReactNode;
  onDropPost: (postId: string, newDate: Date) => void;
}) => {
  const [{ isOver }, drop] = useDrop({
    accept: ItemTypes.POST,
    drop: (item: DraggedPost) => {
      onDropPost(item.id, day);
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  });

  return (
    <div
      ref={drop}
      style={{
        backgroundColor: isOver ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
      }}
    >
      {children}
    </div>
  );
};

export default function PublicationCalendar({
  content,
  isLoading = false,
  onCreateClick,
  onViewPost,
  initialSortOrder = 'desc',
  onSortOrderChange,
  onReschedulePost
}: PublicationCalendarProps) {
  // Календарь открывается на МОСКОВСКОМ сегодня: около полуночи браузерное
  // «сегодня» у зрителя в другом поясе — уже/ещё другой день.
  const [selectedDate, setSelectedDate] = useState<Date>(() => displayToday());
  const [filteredPlatforms, setFilteredPlatforms] = useState<SocialPlatform[]>([]);
  const [isPostDetailOpen, setIsPostDetailOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<CampaignContent | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(initialSortOrder); // Используем initialSortOrder
  const { toast } = useToast();

  // Обработчик перетаскивания поста на новую дату
  const handleDropPost = (postId: string, newDate: Date) => {
    if (!onReschedulePost) {
      toast({
        title: "Ошибка",
        description: "Функция перепланирования недоступна",
        variant: "destructive"
      });
      return;
    }

    // Используем время из существующего поста или устанавливаем время по умолчанию
    const existingPost = content.find(post => post.id === postId);
    let newTime = "12:00";
    
    if (existingPost?.scheduledAt) {
      // Время берём ПО МОСКВЕ, а не локальными getHours/getMinutes: перенос
      // сохраняет час публикации, и у зрителя в другом поясе локальное чтение
      // сдвигало его на разницу поясов. Пост, стоявший на 15:00 МСК, у зрителя
      // в UTC переезжал на 12:00 МСК — молча, при обычном перетаскивании.
      const moscowTime = formatTimeWithTimezone(existingPost.scheduledAt);
      if (/^\d{2}:\d{2}$/.test(moscowTime)) newTime = moscowTime;
    }

    onReschedulePost(postId, newDate, newTime);
    
    toast({
      title: "Публикация перенесена",
      description: `Публикация перенесена на ${format(newDate, 'dd MMMM yyyy', { locale: ru })} в ${newTime}`,
    });
  };

  // Получаем количество постов для каждой платформы
  const platformCounts = content.reduce((counts, post) => {
    if (post.socialPlatforms) {
      Object.keys(post.socialPlatforms).forEach(platform => {
        if (post.socialPlatforms && 
            post.socialPlatforms[platform as SocialPlatform] && 
            post.socialPlatforms[platform as SocialPlatform].status !== 'cancelled') {
          counts[platform as SocialPlatform] = (counts[platform as SocialPlatform] || 0) + 1;
        }
      });
    }
    return counts;
  }, {} as Record<SocialPlatform, number>);

  // startOfDay из date-fns используется для корректного сравнения дат
  // без учета времени (сбрасывает время до 00:00:00)
  
  // Получаем публикации для выбранной даты
  const getContentForSelectedDate = () => {
    const filteredContentMap = new Map<string, CampaignContent>();
    // Выбранная клетка — стенная дата, публикации — моменты времени. Обе
    // приводятся к ключу YYYY-MM-DD, каждая своим способом (см. publication-day.ts).
    const selectedKey = toWallDateKey(selectedDate);
    const isSelectedDateToday = selectedKey === displayTodayKey();
    
    // Фильтруем содержимое для выбранной даты
    content.forEach(post => {
      // Пропускаем посты без social_platforms
      if (!post.socialPlatforms || typeof post.socialPlatforms !== 'object' || Object.keys(post.socialPlatforms).length === 0) {
        // Если выбрана сегодняшняя дата, показываем также контент без платформ (черновики)
        if (isSelectedDateToday) {
          // Проверяем фильтр платформ - если фильтр не установлен, показываем
          if (filteredPlatforms.length === 0) {
            filteredContentMap.set(post.id, post);
          }
        }
        return;
      }
      
      // 1-2. Совпадение по МОСКОВСКИМ суткам: и собственные даты поста, и
      // платформенные. Раньше здесь стояло шесть сравнений через
      // isSameDay(startOfDay(...)) — то есть по локальной полуночи зрителя.
      const platformsWithDates: Set<SocialPlatform> = new Set(
        platformsOnDisplayDay(post as any, selectedKey) as SocialPlatform[],
      );
      const hasAnyDates = hasAnyDisplayDay(post as any);
      const hasMatchingDate = matchesDisplayDay(post as any, selectedKey);

      // 3. Если нет дат, но выбрана сегодняшняя дата - показываем контент (черновики)
      const shouldShowAsToday = !hasAnyDates && isSelectedDateToday;
      
      // 4. Применяем фильтрацию по платформам, если необходимо
      if (hasMatchingDate || shouldShowAsToday) {
        if (filteredPlatforms.length === 0) {
          // Если фильтр не выбран, показываем пост
          filteredContentMap.set(post.id, post);
          return;
        }
        
        // Проверяем, есть ли какая-либо из выбранных платформ у поста
        if (post.socialPlatforms) {
          // Если платформы фильтруются, проверяем, есть ли выбранные платформы среди тех, что имеют даты на выбранный день
          const hasFilteredPlatform = Array.from(platformsWithDates).some(platform => 
            filteredPlatforms.includes(platform)
          ) || Object.keys(post.socialPlatforms).some(platform => 
            filteredPlatforms.includes(platform as SocialPlatform)
          );
          
          if (hasFilteredPlatform) {
            filteredContentMap.set(post.id, post);
            return;
          }
          
          // Если нет совпадений по платформам, проверяем общую дату поста (scheduledAt/publishedAt)
          // и показываем пост, только если платформы вообще не выбраны
          const hasMatchingGeneralDate = matchesDisplayDay(
            { scheduledAt: post.scheduledAt, publishedAt: post.publishedAt },
            selectedKey,
          );
          
          if (hasMatchingGeneralDate && filteredPlatforms.length === 0) {
            filteredContentMap.set(post.id, post);
          }
        }
      }
    });
    
    return Array.from(filteredContentMap.values());
  };
  
  // Получаем отфильтрованный контент для выбранной даты
  const filteredContent = getContentForSelectedDate()
    .sort((a, b) => {
      // Сортировка по времени публикации
      const timeA = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
      const timeB = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0;
      
      // В зависимости от выбранного порядка сортировки
      return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
    });

  // Обработчик изменения фильтра платформ
  const handleFilterChange = (selected: SocialPlatform[]) => {
    setFilteredPlatforms(selected);
  };

  // Добавляем анализ данных один раз
  React.useEffect(() => {
    if (content.length > 0) {
      const withSocialPlatforms = content.filter(post => 
        post.socialPlatforms && 
        typeof post.socialPlatforms === 'object' && 
        Object.keys(post.socialPlatforms).length > 0
      );
      
      const scheduledPosts = content.filter(post => post.status === 'scheduled');
      const publishedPosts = content.filter(post => post.status === 'published' || post.status === 'partial' || post.status === 'partially_published');
      




      
      if (scheduledPosts.length > 0) {

        scheduledPosts.slice(0, 3).forEach((post, i) => {

          
          // Подробная информация о платформах
          if (post.socialPlatforms) {
            Object.entries(post.socialPlatforms).forEach(([platform, data]) => {

            });
          }
        });
      }
      
      if (withSocialPlatforms.length > 0) {

        withSocialPlatforms.slice(0, 3).forEach((post, i) => {

        });
      }
    }
  }, [content]);

  // Индикатор публикаций на дату в календаре
  const getDayContent = (day: Date) => {
    // Используем Map для хранения уникальных постов по ID, чтобы избежать дублирования
    const uniquePostsMap = new Map<string, CampaignContent>();
    
    // Проходим ТОЛЬКО по запланированным постам, исключая частично опубликованные
    const scheduledPosts = content.filter(post => {
      if (post.status !== 'scheduled') return false;
      
      // Дополнительная проверка: исключаем контент с частично опубликованными платформами
      if (post.socialPlatforms && typeof post.socialPlatforms === 'object') {
        const platforms = Object.values(post.socialPlatforms);
        const hasPublishedPlatforms = platforms.some(platform => platform?.status === 'published');
        const hasFailedPlatforms = platforms.some(platform => 
          platform?.status === 'failed' || platform?.status === 'error'
        );
        
        // Если есть как опубликованные, так и неуспешные платформы - это частично опубликованный контент
        // Не показываем его в календаре как запланированный
        if (hasPublishedPlatforms && hasFailedPlatforms) {
          return false;
        }
      }
      
      return true;
    });
    
    scheduledPosts.forEach((post) => {
      // Проверяем наличие socialPlatforms
      if (!post.socialPlatforms || typeof post.socialPlatforms !== 'object' || Object.keys(post.socialPlatforms).length === 0) {
        return;
      }

      // Для запланированных постов смотрим ТОЛЬКО scheduledAt: платформенные
      // даты у них могут расходиться между собой.
      //
      // Совпадение с клеткой — по московским суткам, а не по локальным.
      const isRelevantForDay = matchesDisplayDay({ scheduledAt: post.scheduledAt }, toWallDateKey(day));
      
      // Если пост относится к этому дню, добавляем его в Map
      if (isRelevantForDay) {
        uniquePostsMap.set(post.id, post);
      }
    });
    
    // Преобразуем Map в массив уникальных постов
    const postsForDay = Array.from(uniquePostsMap.values());

    if (!postsForDay.length) return null;

    // Группируем посты по статусу и типу содержимого
    const contentByStatus = postsForDay.reduce((result, post) => {
      // Определяем статус поста
      const status = post.status || 'draft';
      const type = post.contentType || 'text';
      
      // Отладочная информация для первых 5 постов
      if (postsForDay.length <= 5 && day.getDate() === 13) {

      }
      
      // Инициализация записи, если она еще не существует
      if (!result[status]) {
        result[status] = {};
      }
      
      // Увеличиваем счетчик для этого типа и статуса
      result[status][type] = (result[status][type] || 0) + 1;
      
      return result;
    }, {} as Record<string, Record<string, number>>);

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
    
    // Получаем стили для разных статусов
    const getStatusStyle = (status: string): { opacity: string, ring?: string } => {
      switch (status) {
        case 'published': 
          return { opacity: '1', ring: 'ring-2 ring-green-500' }; // Опубликованные с зеленой рамкой
        case 'scheduled': 
          return { opacity: '1', ring: 'ring-2 ring-green-400' }; // Запланированные тоже с зеленой рамкой (немного светлее)
        case 'draft': 
          return { opacity: '0.4' }; // Черновики полупрозрачные
        default: 
          return { opacity: '0.6' };
      }
    };

    // Отображаем только цветные точки для типов контента (макс 4 + счётчик)
    const MAX_VISIBLE_DOTS = 4;
    const allDots: { status: string; type: string }[] = [];
    Object.entries(contentByStatus).forEach(([status, typesCounts]) => {
      Object.entries(typesCounts).forEach(([type, count]) => {
        for (let i = 0; i < count; i++) {
          allDots.push({ status, type });
        }
      });
    });
    const remaining = allDots.length - MAX_VISIBLE_DOTS;
    const visibleDots = allDots.slice(0, MAX_VISIBLE_DOTS);

    return (
      <div className="flex justify-center items-center gap-0.5 mt-0.5 overflow-hidden max-w-full">
        {visibleDots.map(({ status, type }, idx) => {
          const { opacity, ring } = getStatusStyle(status);
          return (
            <div 
              key={idx} 
              className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${getColorForType(type)} ${ring || ''}`}
              style={{ opacity }}
              title={`${status}: ${type}`}
            ></div>
          );
        })}
        {remaining > 0 && (
          <span className="text-[8px] leading-none text-muted-foreground flex-shrink-0">+{remaining}</span>
        )}
      </div>
    );
  };

  // Обработчик просмотра деталей поста
  const handleViewPost = (post: CampaignContent) => {
    setSelectedPost(post);
    setIsPostDetailOpen(true);
    
    if (onViewPost) {
      onViewPost(post);
    }
  };

  // Форматирование даты публикации в локальном часовом поясе пользователя
  const formatScheduledTime = (date: string | Date | null | undefined, showFullDate: boolean = false) => {
    if (!date) return "--:--";
    
    try {
      // Получаем часовой пояс пользователя
      const userTimeZone = DISPLAY_TIME_ZONE;
      
      // ИСПРАВЛЕНИЕ: Если строка без timezone (без Z), добавляем Z чтобы парсить как UTC
      let dateStr = typeof date === 'string' ? date : date.toISOString();
      if (typeof date === 'string' && !date.endsWith('Z') && !date.includes('+')) {
        dateStr = dateStr + 'Z'; // Принудительно считаем UTC
      }
      
      // Парсим дату из строки ISO или используем объект Date
      const dateObj = typeof date === 'string' ? parseISO(dateStr) : date;
      if (!dateObj || isNaN(dateObj.getTime())) return "--:--";
      
      // Используем локальный часовой пояс пользователя с formatInTimeZone
      if (showFullDate) {
        // Форматируем полную дату с временем
        return formatInTimeZone(dateObj, userTimeZone, 'dd MMMM yyyy, HH:mm', { locale: ru });
      } else {
        // Форматируем только время
        return formatInTimeZone(dateObj, userTimeZone, 'HH:mm', { locale: ru });
      }
    } catch (error) {
      console.error('Error formatting date:', error);
      return "--:--";
    }
  };



  return (
    <DndProvider backend={HTML5Backend}>
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-6 md:grid-cols-[300px_1fr]">
            <div className="space-y-4 flex flex-col h-full min-h-0">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => date && setSelectedDate(date)}
              className="rounded-md border flex-shrink-0"
              components={{
                DayContent: ({ date }) => (
                  <DroppableDay day={date} onDropPost={handleDropPost}>
                    <div className="flex flex-col items-center overflow-hidden">
                      <span>{date.getDate()}</span>
                      {getDayContent(date)}
                    </div>
                  </DroppableDay>
                )
              }}
              initialFocus
            />
            
            <div className="flex-shrink-0">
              <SocialMediaFilter 
                onFilterChange={handleFilterChange}
                showCounts
                platformCounts={platformCounts}
              />
            </div>
            
            {onCreateClick && (
              <Button 
                onClick={onCreateClick} 
                className="w-full mt-auto flex-shrink-0"
              >
                Создать пост
              </Button>
            )}
          </div>
          
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-medium text-lg">
                Посты на {format(selectedDate, 'dd MMMM yyyy', { locale: ru })}:
              </h3>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => {
                  const newSortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
                  setSortOrder(newSortOrder);
                  if (onSortOrderChange) {
                    onSortOrderChange(newSortOrder);
                  }
                }}
              >
                {sortOrder === 'desc' ? (
                  <>
                    <SortDesc size={16} />
                    <span>Сначала новые</span>
                  </>
                ) : (
                  <>
                    <SortAsc size={16} />
                    <span>Сначала старые</span>
                  </>
                )}
              </Button>
            </div>
            
            {isLoading ? (
              <div className="text-center py-6">
                <p className="text-muted-foreground">Загрузка публикаций...</p>
              </div>
            ) : filteredContent.length === 0 ? (
              <div className="text-center py-12 border rounded-lg">
                <p className="text-muted-foreground">Нет запланированных публикаций</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredContent.map(post => (
                  <div 
                    key={post.id}
                    className="p-4 border rounded-lg hover:bg-muted/40 transition-colors cursor-pointer"
                    onClick={() => handleViewPost(post)}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-medium">{post.title || 'Без названия'}</h4>
                        <div className="flex items-center mt-1 text-sm text-muted-foreground">
                          <Clock className="h-3.5 w-3.5 mr-1" />
                          <span>{formatScheduledTime(post.scheduledAt || null)}</span>
                        </div>
                      </div>
                      
                      <div className="flex gap-1">
                        {post.socialPlatforms && Object.keys(post.socialPlatforms).map(platform => {
                          if (post.socialPlatforms && post.socialPlatforms[platform as SocialPlatform].status !== 'cancelled') {
                            return (
                              <div key={platform} className="rounded-full p-1.5 bg-muted/60">
                                <SocialMediaIcon platform={platform as SocialPlatform} className="h-3.5 w-3.5" />
                              </div>
                            );
                          }
                          return null;
                        })}
                      </div>
                    </div>
                    
                    {post.content && (
                      <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                        {post.content.replace(/<[^>]*>/g, '')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>
        </CardContent>
      
      {/* Диалог с деталями поста */}
      <Dialog open={isPostDetailOpen} onOpenChange={setIsPostDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] w-[95vw] overflow-y-auto overflow-x-hidden">
          {selectedPost && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg font-semibold break-words">{selectedPost.title || 'Без названия'}</DialogTitle>
                <DialogDescription>
                  <div className="flex items-center mt-1">
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    <span>
                      {selectedPost.scheduledAt 
                        ? formatScheduledTime(selectedPost.scheduledAt, true)
                        : 'Не запланировано'}
                    </span>
                  </div>
                </DialogDescription>
              </DialogHeader>
              
              {selectedPost.socialPlatforms && Object.keys(selectedPost.socialPlatforms).length > 0 && (
                <div className="flex flex-wrap gap-2 mt-4">
                  {Object.entries(selectedPost.socialPlatforms).map(([platform, data]) => {
                    if (data.status === 'cancelled') return null;
                    
                    const getStatusColor = () => {
                      switch (data.status) {
                        case 'published': return 'bg-green-100 text-green-800 border-green-200';
                        case 'failed': return 'bg-red-100 text-red-800 border-red-200';
                        default: return 'bg-yellow-100 text-yellow-800 border-yellow-200';
                      }
                    };
                    
                    const getStatusText = () => {
                      switch (data.status) {
                        case 'published': return 'Опубликовано';
                        case 'failed': return 'Ошибка';
                        case 'scheduled': return 'Запланировано';
                        default: return 'В ожидании';
                      }
                    };
                    
                    return (
                      <Badge 
                        key={platform} 
                        variant="outline" 
                        className={`flex items-center gap-1.5 ${getStatusColor()}`}
                      >
                        <SocialMediaIcon platform={platform as SocialPlatform} className="h-3.5 w-3.5" />
                        <span>{getStatusText()}</span>
                      </Badge>
                    );
                  })}
                </div>
              )}
              
              <div className="mt-4 prose prose-sm max-w-none overflow-hidden">
                <div 
                  className="break-words overflow-wrap-anywhere"
                  dangerouslySetInnerHTML={{ __html: selectedPost.content || '' }} 
                />
              </div>
              
              {selectedPost.imageUrl && 
               typeof selectedPost.imageUrl === 'string' && 
               selectedPost.imageUrl.startsWith('http') && 
               !selectedPost.imageUrl.includes('[object') && (
                <div className="mt-4 flex justify-center w-full">
                  <div className="max-w-full max-h-[300px] overflow-hidden rounded-md border">
                    <img 
                      src={selectedPost.imageUrl} 
                      alt={selectedPost.title || 'Content image'} 
                      className="w-full h-auto max-h-[300px] object-contain"
                      style={{ maxWidth: '100%', height: 'auto' }}
                      onLoad={(e) => {
                        // Принудительно ограничиваем размер после загрузки
                        const img = e.target as HTMLImageElement;
                        if (img.naturalWidth > 600) {
                          img.style.width = '100%';
                          img.style.maxWidth = '600px';
                        }
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/placeholder-image.jpg';
                      }}
                    />
                  </div>
                </div>
              )}
              
              {selectedPost.keywords && selectedPost.keywords.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium mb-2">Ключевые слова:</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedPost.keywords.map((keyword, idx) => (
                      <Badge key={idx} variant="secondary">{keyword}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      </Card>
    </DndProvider>
  );
}
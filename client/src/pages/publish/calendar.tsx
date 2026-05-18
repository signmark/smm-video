import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useCampaignStore } from '@/lib/campaignStore';
import { useAuthStore } from '@/lib/store';
import { CampaignContent } from '@/types';
import PublicationCalendar from '@/components/PublicationCalendar';
import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { PenLine, ArrowLeft, SortDesc, SortAsc, Loader2 } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

export default function CalendarView() {
  const { t } = useTranslation();
  const { selectedCampaign } = useCampaignStore();
  const userId = useAuthStore((state) => state.userId);
  const getAuthToken = useAuthStore((state) => state.getAuthToken);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc'); // По умолчанию сортировка от новых к старым
  const [, setLocation] = useLocation();
  
  // Запрос контента кампании для календаря
  const { data: campaignContentResponse, isLoading: isLoadingContent, isFetching: isFetchingContent } = useQuery({
    queryKey: ['/api/campaign-content', selectedCampaign?.id],
    queryFn: async () => {
      if (!selectedCampaign?.id) return { data: [] };

      try {
        console.log('Загрузка публикаций для кампании:', selectedCampaign.id);

        const responseData = await apiRequest(`/api/campaign-content?campaignId=${selectedCampaign.id}`, {
          method: 'GET'
        });

        return responseData;
      } catch (error) {
        console.error('Ошибка при загрузке контента:', error);
        return { data: [] };
      }
    },
    enabled: !!selectedCampaign?.id,
    refetchOnMount: true,
    staleTime: 0, // Всегда считаем данные устаревшими и перезагружаем
    refetchInterval: 10000, // Автоматически обновляем данные каждые 10 секунд
    refetchIntervalInBackground: true // Обновляем даже если вкладка не активна
  });

  // Фильтруем только действительно запланированные публикации
  const allContent: CampaignContent[] = campaignContentResponse?.data || [];
  const campaignContent: CampaignContent[] = allContent.filter(content => {
    // Только статус 'scheduled'
    if (content.status !== 'scheduled') return false;
    
    // Дополнительная проверка: исключаем контент с опубликованными платформами
    if (content.socialPlatforms && typeof content.socialPlatforms === 'object') {
      const platforms = Object.values(content.socialPlatforms);
      const hasPublishedPlatforms = platforms.some(platform => platform?.status === 'published');
      
      // Если есть опубликованные платформы - не показываем в календаре запланированных
      if (hasPublishedPlatforms) {
        return false;
      }
    }
    
    return true;
  });

  // Отладка данных календаря
  useEffect(() => {
    if (campaignContent.length > 0) {
      console.log(`СТРАНИЦА КАЛЕНДАРЯ: Получено ${campaignContent.length} публикаций`);
      
      const withSocialPlatforms = campaignContent.filter(post => 
        post.socialPlatforms && 
        typeof post.socialPlatforms === 'object' && 
        Object.keys(post.socialPlatforms).length > 0
      );
      
      console.log(`СТРАНИЦА КАЛЕНДАРЯ: С социальными платформами: ${withSocialPlatforms.length}`);
      
      if (withSocialPlatforms.length > 0) {
        console.log('СТРАНИЦА КАЛЕНДАРЯ: Первые 5 публикаций с платформами:');
        withSocialPlatforms.slice(0, 5).forEach((post, i) => {
          console.log(`  ${i + 1}. Title: "${post.title}", publishedAt: ${post.publishedAt}, scheduledAt: ${post.scheduledAt}, platforms: ${Object.keys(post.socialPlatforms || {}).join(', ')}`);
        });
      }
    }
  }, [campaignContent]);

  const handleCreateClick = () => {
    // Используем SPA навигацию через wouter
    setLocation('/content');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('publishing.scheduled.calendar')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('publishing.published.subtitle')}
          </p>
          

        </div>
        <div className="flex gap-2">
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
          <Button variant="outline" asChild>
            <Link to="/publish/scheduled">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('publishing.scheduled.backToList')}
            </Link>
          </Button>
          <Button onClick={handleCreateClick}>
            <PenLine className="mr-2 h-4 w-4" />
            {t('publishing.scheduled.createPublication')}
          </Button>
        </div>
      </div>

      {selectedCampaign ? (
        <>
          {isLoadingContent ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Загружаем публикации для календаря...</p>
            </div>
          ) : (
            <PublicationCalendar 
              content={campaignContent} 
              isLoading={isLoadingContent}
              onCreateClick={handleCreateClick}
              onViewPost={(post) => console.log('View post details:', post)}
              initialSortOrder={sortOrder}
              onSortOrderChange={setSortOrder}
            />
          )}
        </>
      ) : (
        <div className="text-center py-10 text-muted-foreground">
          Пожалуйста, выберите кампанию в селекторе сверху
        </div>
      )}
    </div>
  );
}
import { useEffect, useState } from "react";
import { useCampaignsList } from "@/hooks/use-campaigns";
import {
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { useCampaignStore } from "@/lib/campaignStore";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

// Интерфейс для кампании
export interface Campaign {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
}

interface CampaignSelectorProps {
  /**
   * Если true, компонент будет сохранять текущий выбор кампании и не будет
   * автоматически менять его даже если в ответе от API есть другая кампания первой
   */
  persistSelection?: boolean;
}

export function CampaignSelector({ persistSelection = false }: CampaignSelectorProps) {
  const { t } = useTranslation();
  const { selectedCampaignId, selectedCampaignName, setSelectedCampaign } = useCampaignStore();
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [initiallySelectedId, setInitiallySelectedId] = useState<string | null>(null);

  // Сохраняем ID выбранной кампании при первом рендере
  useEffect(() => {
    if (persistSelection && selectedCampaignId && !initiallySelectedId) {
      setInitiallySelectedId(selectedCampaignId);

    }
  }, [persistSelection, selectedCampaignId, initiallySelectedId]);

  // Получаем список всех кампаний.
  // Запрос общий на всё приложение — см. hooks/use-campaigns.
  const { data: campaignsResponse, isLoading, isError, error } = useCampaignsList();

  // При первой загрузке, проверяем:
  // 1. Если persistSelection=true и у нас уже есть сохраненный ID, используем его
  // 2. Если есть сохранённая кампания в сторе и она существует — пропускаем авто-выбор
  // 3. Если сохранённая кампания не существует — выбираем первую из списка
  // 4. Если нет сохранённой — выбираем первую из списка
  useEffect(() => {
    if (!campaignsResponse?.data?.length || !isFirstLoad) return;

    // Если мы хотим сохранить текущий выбор и у нас есть сохраненный ID
    if (persistSelection && initiallySelectedId) {
      const savedCampaign = campaignsResponse.data.find((c: Campaign) => c.id === initiallySelectedId);
      if (savedCampaign) {
        setSelectedCampaign(savedCampaign.id, savedCampaign.name);
        setIsFirstLoad(false);
        return;
      }
    }

    // Если кампания уже выбрана в сторе — проверяем существует ли она
    if (selectedCampaignId) {
      const exists = campaignsResponse.data.some((c: Campaign) => c.id === selectedCampaignId);
      if (exists) {
        // Обновляем название если его нет (legacy данные)
        if (!selectedCampaignName) {
          const existingCampaign = campaignsResponse.data.find((c: Campaign) => c.id === selectedCampaignId);
          if (existingCampaign) {
            setSelectedCampaign(existingCampaign.id, existingCampaign.name);
          }
        }
        setIsFirstLoad(false);
        return;
      }
      // Сохранённая кампания не существует — выберем первую доступную
    }

    // Выбираем первую из списка
    const firstCampaign = campaignsResponse.data[0];
    setSelectedCampaign(firstCampaign.id, firstCampaign.name);
    setIsFirstLoad(false);
  }, [campaignsResponse, selectedCampaignId, selectedCampaignName, setSelectedCampaign, isFirstLoad, persistSelection, initiallySelectedId]);

  const handleCampaignChange = (campaignId: string) => {
    const campaign = campaignsResponse?.data?.find((c: Campaign) => c.id === campaignId);
    if (campaign) {

      setSelectedCampaign(campaign.id, campaign.name);
      
      // Если используется режим сохранения выбора, обновляем сохраненный ID
      if (persistSelection) {
        setInitiallySelectedId(campaign.id);
      }
      
      // Перенаправляем на страницу кампании, если мы находимся на странице кампаний
      const currentPath = window.location.pathname;
      if (currentPath.includes('/campaigns/')) {
        // Извлекаем текущий ID кампании из URL
        const urlParts = currentPath.split('/');
        const campaignIndexInUrl = urlParts.findIndex(part => part === 'campaigns');
        
        if (campaignIndexInUrl !== -1 && urlParts[campaignIndexInUrl + 1]) {
          // Заменяем ID кампании в URL
          urlParts[campaignIndexInUrl + 1] = campaign.id;
          const newPath = urlParts.join('/');
          
          // Используем history API для изменения URL без перезагрузки страницы
          window.history.pushState({}, '', newPath);
          
          // Вызываем событие изменения URL, чтобы компоненты могли среагировать
          window.dispatchEvent(new Event('popstate'));
        }
      }
    }
  };

  if (isError) {
    return (
      <div className="flex items-center text-red-500">
        <span className="text-sm">
          {t('common.error')}: {error instanceof Error ? error.message : t('campaigns.loadError')}
        </span>
      </div>
    );
  }

  // Определяем значение для отображения в селекторе
  const displayValue = persistSelection && initiallySelectedId ? initiallySelectedId : selectedCampaignId;

  // Получаем имя активной кампании для отображения статичного текста
  const activeCampaignName = campaignsResponse?.data?.find(
    (c: Campaign) => c.id === selectedCampaignId
  )?.name || selectedCampaignName;

  return (
    <div className="flex items-center py-2">
      <span className="mr-2 text-sm font-medium">{t('campaigns.selectorLabel')}</span>
      <div className="w-[250px]">
        {isLoading ? (
          <div className="flex items-center space-x-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm text-muted-foreground">{t('campaigns.loadingList')}</span>
          </div>
        ) : campaignsResponse?.data?.length === 1 ? (
          // Если есть только одна кампания - показываем статичную надпись
          <div className="px-3 py-2 border rounded-md text-sm">
            {activeCampaignName || t('campaigns.noActive')}
          </div>
        ) : (
          // Если есть более одной кампании - показываем селектор
          <Select
            value={displayValue || undefined}
            onValueChange={handleCampaignChange}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('campaigns.selectPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {campaignsResponse?.data
                ?.sort((a: Campaign, b: Campaign) => {
                  // Сортируем как и на странице кампаний - сначала новые, потом старые
                  if (!a.createdAt) return 1;
                  if (!b.createdAt) return -1;
                  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                })
                .map((campaign: Campaign) => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
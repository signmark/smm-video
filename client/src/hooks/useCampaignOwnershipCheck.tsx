import { useEffect } from 'react';
import { useCampaignStore } from '@/lib/campaignStore';
import { useAuthStore } from '@/lib/store';
import { useCampaignDetail } from '@/hooks/use-campaigns';

/**
 * Хук для проверки принадлежности выбранной кампании текущему пользователю.
 * Если кампания недоступна — молча сбрасывает выбор.
 *
 * Раньше делал императивный `api.campaigns.get(id)` в useEffect, чем на каждый
 * монтаж слал ещё один `GET /api/campaigns/:id` мимо кэша (дубль с
 * useCampaignDetail). Теперь читает тем же query-ключом, что и существующий
 * `useCampaignDetail`, так что карточка кампании и проверка принадлежности
 * делят один запрос и один кэш (task #81/A).
 */
function useCampaignOwnershipCheck() {
  const { selectedCampaignId, clearSelectedCampaign } = useCampaignStore();
  const userId = useAuthStore((state) => state.userId);

  // Читаем кампанию тем же ключом, что и useCampaignDetail. Признак 404/ошибки
  // берём из isError, а не из брошенного promise — императивного get больше нет.
  const { isError } = useCampaignDetail(selectedCampaignId || undefined);

  useEffect(() => {
    if (isError && selectedCampaignId && userId) {
      // Молча сбрасываем выбор, если кампания недоступна.
      clearSelectedCampaign();
    }
  }, [isError, selectedCampaignId, userId, clearSelectedCampaign]);

  return null;
}

export default useCampaignOwnershipCheck;

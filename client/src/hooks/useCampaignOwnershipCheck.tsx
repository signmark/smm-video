import { useEffect } from 'react';
import { useCampaignStore } from '@/lib/campaignStore';
import { useAuthStore } from '@/lib/store';
import { api } from '@/lib/api-client';

/**
 * Хук для проверки принадлежности выбранной кампании текущему пользователю
 * Если кампания недоступна - молча сбрасывает выбор
 */
function useCampaignOwnershipCheck() {
  const { selectedCampaignId, selectedCampaignName, clearSelectedCampaign } = useCampaignStore();
  const userId = useAuthStore(state => state.userId);

  useEffect(() => {
    const checkCampaignOwnership = async () => {
      if (selectedCampaignId && userId) {
        try {
          await api.campaigns.get(selectedCampaignId);
        } catch (error) {
          // Молча сбрасываем выбор если кампания недоступна
          clearSelectedCampaign();
        }
      }
    };
    
    checkCampaignOwnership();
  }, [selectedCampaignId, userId, selectedCampaignName, clearSelectedCampaign]);

  return null;
}

export default useCampaignOwnershipCheck;

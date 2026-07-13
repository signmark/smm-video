import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { queryClient } from '@/lib/queryClient';

interface Campaign {
  id: string;
  name: string;
  description?: string;
}

interface CampaignState {
  // Старые поля для поддержки существующих компонентов
  selectedCampaign: Campaign | null;

  // Новые поля для более простого доступа
  selectedCampaignId: string | null;
  selectedCampaignName: string | null;

  // Список ID удаленных кампаний
  deletedCampaignIds: string[];

  // Функции для изменения состояния
  setSelectedCampaign: (campaignIdOrObj: string | Campaign | null, name?: string) => void;
  clearSelectedCampaign: () => void;
  markCampaignAsDeleted: (id: string, remainingCampaigns?: Campaign[]) => void;
  isDeleted: (id: string) => boolean;
  selectFirstAvailable: (campaigns: Campaign[]) => void;
}

export const useCampaignStore = create<CampaignState>()(
  persist(
    (set, get) => ({
      // Начальные значения
      selectedCampaign: null,
      selectedCampaignId: localStorage.getItem('selected_campaign_id') || null,
      selectedCampaignName: localStorage.getItem('selected_campaign_name') || null,
      deletedCampaignIds: [], // Инициализируем пустым массивом
      
      // Обновленная функция для поддержки обоих интерфейсов
      setSelectedCampaign: (campaignIdOrObj, name) => {
        // Если передали объект кампании (старый способ)
        if (typeof campaignIdOrObj === 'object') {
          const campaign = campaignIdOrObj;
          if (campaign === null) {
            // Очистка выбранной кампании
            localStorage.removeItem('selected_campaign_id');
            localStorage.removeItem('selected_campaign_name');
            set({ 
              selectedCampaign: null,
              selectedCampaignId: null, 
              selectedCampaignName: null 
            });
            return;
          }
          
          // Проверяем, не удалена ли кампания
          const { isDeleted } = get();
          if (isDeleted(campaign.id)) {
            return;
          }
          
          // Сохраняем данные кампании
          localStorage.setItem('selected_campaign_id', campaign.id);
          localStorage.setItem('selected_campaign_name', campaign.name);
          
          set({ 
            selectedCampaign: campaign,
            selectedCampaignId: campaign.id, 
            selectedCampaignName: campaign.name 
          });
        } 
        // Если передали только id (без name)
        else if (typeof campaignIdOrObj === 'string') {
          const id = campaignIdOrObj;
          
          // Проверяем, не удалена ли кампания
          const { isDeleted } = get();
          if (isDeleted(id)) {
            return;
          }
          
          // Сохраняем ID кампании
          localStorage.setItem('selected_campaign_id', id);
          
          // Если name передан, сохраняем его тоже
          if (name) {
            localStorage.setItem('selected_campaign_name', name);
            set({ 
              selectedCampaign: { id, name },
              selectedCampaignId: id, 
              selectedCampaignName: name 
            });
          } else {
            // Если name не передан, сохраняем только ID
            set({ 
              selectedCampaign: { id, name: id }, // используем ID как временное имя
              selectedCampaignId: id, 
              selectedCampaignName: null 
            });
          }
        }
      },
      
      clearSelectedCampaign: () => {
        localStorage.removeItem('selected_campaign_id');
        localStorage.removeItem('selected_campaign_name');
        set({ 
          selectedCampaign: null,
          selectedCampaignId: null, 
          selectedCampaignName: null 
        });
      },
      
      // Отметка кампании как удаленной + автовыбор следующей
      markCampaignAsDeleted: (id: string, remainingCampaigns?: Campaign[]) => {
        const { deletedCampaignIds, selectedCampaignId } = get();

        // Добавляем ID в список удаленных
        const newDeletedIds = [...deletedCampaignIds, id];
        set({ deletedCampaignIds: newDeletedIds });

        // Обновляем кэш React Query
        try {
          const userId = localStorage.getItem('user_id');
          queryClient.setQueryData(['/api/campaigns', userId], (oldData: any) => {
            if (!oldData || !oldData.data) return oldData;
            return { ...oldData, data: oldData.data.filter((c: any) => c.id !== id) };
          });
          queryClient.setQueryData(['/api/campaigns'], (oldData: any) => {
            if (!oldData || !oldData.data) return oldData;
            return { ...oldData, data: oldData.data.filter((c: any) => c.id !== id) };
          });
        } catch (err) {
          console.error('Ошибка при обновлении кэша React Query:', err);
        }

        // Если удаленная кампания была выбрана — выбираем следующую
        if (selectedCampaignId === id) {
          const available = (remainingCampaigns || []).filter(
            c => c.id !== id && !newDeletedIds.includes(c.id)
          );
          if (available.length > 0) {
            const next = available[0];
            localStorage.setItem('selected_campaign_id', next.id);
            localStorage.setItem('selected_campaign_name', next.name);
            set({
              selectedCampaign: next,
              selectedCampaignId: next.id,
              selectedCampaignName: next.name
            });
          } else {
            localStorage.removeItem('selected_campaign_id');
            localStorage.removeItem('selected_campaign_name');
            set({
              selectedCampaign: null,
              selectedCampaignId: null,
              selectedCampaignName: null
            });
          }
        }
      },

      // Выбрать первую доступную кампанию из списка
      selectFirstAvailable: (campaigns: Campaign[]) => {
        const { deletedCampaignIds } = get();
        const available = campaigns.filter(c => !deletedCampaignIds.includes(c.id));
        if (available.length > 0) {
          const first = available[0];
          localStorage.setItem('selected_campaign_id', first.id);
          localStorage.setItem('selected_campaign_name', first.name);
          set({
            selectedCampaign: first,
            selectedCampaignId: first.id,
            selectedCampaignName: first.name
          });
        }
      },
      
      // Функция для проверки, удалена ли кампания
      isDeleted: (id: string) => {
        return get().deletedCampaignIds.includes(id);
      }
    }),
    {
      name: 'campaign-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ 
        selectedCampaign: state.selectedCampaign,
        selectedCampaignId: state.selectedCampaignId,
        selectedCampaignName: state.selectedCampaignName
      }),
    }
  )
);
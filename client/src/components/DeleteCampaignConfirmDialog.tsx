import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Trash } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useCampaignStore } from "@/lib/campaignStore";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Интерфейс для информации о связанных данных кампании
interface RelatedDataInfo {
  hasContent: boolean;
  hasKeywords: boolean;
  hasTrends: boolean;
  totalItems: {
    content: number;
    keywords: number;
    trends: number;
  };
}

// Интерфейс для кампании
interface Campaign {
  id: string;
  name: string;
}

interface DeleteCampaignConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign | null;
  onDelete?: () => void;
}

export function DeleteCampaignConfirmDialog({
  open,
  onOpenChange,
  campaign,
  onDelete
}: DeleteCampaignConfirmDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const markCampaignAsDeleted = useCampaignStore(s => s.markCampaignAsDeleted);
  const [isCheckingData, setIsCheckingData] = useState(false);
  const [relatedData, setRelatedData] = useState<RelatedDataInfo | null>(null);
  const userId = localStorage.getItem('user_id') || '';

  // Мутация для удаления кампании
  const { mutate: deleteCampaign, isPending } = useMutation({
    mutationFn: async (params: { id: string; forceDelete: boolean }) => {
      const { id, forceDelete } = params;
      const token = localStorage.getItem('auth_token');
      
      if (!token) {
        throw new Error("Отсутствует токен авторизации");
      }
      
      // Если первый раз и не forceDelete, сначала проверяем наличие связанных данных
      if (!forceDelete && !relatedData) {
        setIsCheckingData(true);
        
        try {
          // Собираем информацию о связанных данных
          const relatedDataCounts = {
            keywords: 0,
            trends: 0,
            content: 0
          };
          
          let hasRelatedData = false;
          
          // Проверяем наличие ключевых слов
          try {
            const keywordsCheckResponse = await fetch(`/api/keywords?campaignId=${id}`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (keywordsCheckResponse.ok) {
              const keywordsData = await keywordsCheckResponse.json();
              relatedDataCounts.keywords = keywordsData.data?.length || 0;
              if (relatedDataCounts.keywords > 0) hasRelatedData = true;

            }
          } catch (e) {
            console.error('[УДАЛЕНИЕ] Ошибка при проверке ключевых слов:', e);
          }
          
          // Проверяем наличие трендов
          try {
            const trendsCheckResponse = await fetch(`/api/campaign-trends/${id}`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (trendsCheckResponse.ok) {
              const trendsData = await trendsCheckResponse.json();
              relatedDataCounts.trends = trendsData.data?.length || 0;
              if (relatedDataCounts.trends > 0) hasRelatedData = true;

            }
          } catch (e) {
            console.error('[УДАЛЕНИЕ] Ошибка при проверке трендов:', e);
          }
          
          // Проверяем наличие контента
          try {
            const contentData = await apiRequest(`/api/campaign-content?campaignId=${id}`, {
              method: 'GET'
            });
            
            relatedDataCounts.content = contentData.data?.length || 0;
            if (relatedDataCounts.content > 0) hasRelatedData = true;
          } catch (e) {
            console.error('[УДАЛЕНИЕ] Ошибка при проверке контента:', e);
          }
          
          setIsCheckingData(false);
          
          // Если есть связанные данные, сохраняем их и требуем подтверждения
          if (hasRelatedData) {
            const data = {
              hasContent: relatedDataCounts.content > 0,
              hasKeywords: relatedDataCounts.keywords > 0,
              hasTrends: relatedDataCounts.trends > 0,
              totalItems: relatedDataCounts
            };
            
            setRelatedData(data);
            return { requireConfirmation: true, relatedData: data };
          }
        } catch (error) {
          setIsCheckingData(false);
          console.error('[УДАЛЕНИЕ] Ошибка при проверке связанных данных:', error);
        }
      }
      
      // Если подтверждено или нет связанных данных, удаляем кампанию

      
      const deleteUrl = `/api/campaigns/${id}${forceDelete ? '?forceDelete=true' : ''}`;
      
      const response = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        // Если возникла ошибка, бросаем исключение
        const errorText = await response.text();
        try {
          const errorData = JSON.parse(errorText);
          throw new Error(errorData.error || errorData.message || `Не удалось удалить кампанию (${response.status})`);
        } catch (e) {
          throw new Error(`Не удалось удалить кампанию: ${response.statusText} (${response.status})`);
        }
      }
      
      // Если операция выполнена успешно
      return { success: true };
    },
    onSuccess: (data) => {
      if (data.requireConfirmation) return;

      // Получаем текущий список кампаний из кэша перед инвалидацией
      const cachedData = queryClient.getQueryData(['/api/campaigns', userId]) as any;
      const remainingCampaigns = (cachedData?.data || []).filter((c: any) => c.id !== campaign?.id);

      // Инвалидируем кэш
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", userId] });

      // Отмечаем как удалённую + автовыбор следующей
      if (campaign?.id) {
        markCampaignAsDeleted(campaign.id, remainingCampaigns);
      }

      toast({ title: "Успешно", description: "Кампания успешно удалена" });

      onOpenChange(false);
      if (onDelete) onDelete();
    },
    onError: (error: Error) => {
      console.error('[УДАЛЕНИЕ] Ошибка при удалении:', error);
      
      // Показываем сообщение об ошибке
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: error.message || "Не удалось удалить кампанию"
      });
    }
  });

  // Обработчик для подтверждения удаления кампании
  const handleConfirmDelete = () => {
    if (!campaign) return;
    
    // Если есть связанные данные и пользователь подтвердил удаление, 
    // удаляем кампанию с принудительным удалением связанных данных
    deleteCampaign({ id: campaign.id, forceDelete: true });
  };

  // Обработчик для запроса удаления кампании (первый шаг)
  const handleDeleteRequest = () => {
    if (!campaign) return;
    
    // Запускаем процесс удаления без принудительного удаления связанных данных
    deleteCampaign({ id: campaign.id, forceDelete: false });
  };

  // Обработчик для отмены удаления
  const handleCancel = () => {
    // Сбрасываем состояние и закрываем диалог
    setRelatedData(null);
    onOpenChange(false);
  };

  // Если диалог только что открылся и еще нет данных о связанных данных, 
  // запускаем проверку наличия связанных данных
  if (open && campaign && !relatedData && !isCheckingData && !isPending) {
    handleDeleteRequest();
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-white border border-gray-200 shadow-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-xl font-bold">
            {relatedData 
              ? "Внимание: будут удалены связанные данные" 
              : `Удалить кампанию "${campaign?.name || ''}"`}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-gray-700">
            {isCheckingData || isPending ? (
              <div className="text-center py-4">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto mb-2"></div>
                <p>{isCheckingData ? "Проверка связанных данных..." : "Удаление..."}</p>
              </div>
            ) : relatedData ? (
              <div>
                <p className="mb-2">
                  Кампания "{campaign?.name}" содержит следующие связанные данные, 
                  которые также будут удалены:
                </p>
                <ul className="list-disc pl-6 mb-4">
                  {relatedData.hasContent && (
                    <li>Контент{relatedData.totalItems.content > 0 ? `: ${relatedData.totalItems.content} шт.` : ""}</li>
                  )}
                  {relatedData.hasKeywords && (
                    <li>Ключевые слова{relatedData.totalItems.keywords > 0 ? `: ${relatedData.totalItems.keywords} шт.` : ""}</li>
                  )}
                  {relatedData.hasTrends && (
                    <li>Темы трендов{relatedData.totalItems.trends > 0 ? `: ${relatedData.totalItems.trends} шт.` : ""}</li>
                  )}
                </ul>
                <p className="text-amber-600 font-medium">
                  Это действие невозможно отменить. Удаленные данные будут потеряны безвозвратно.
                </p>
              </div>
            ) : (
              <p>
                Вы действительно хотите удалить кампанию? Это действие нельзя отменить.
              </p>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            style={{ backgroundColor: "#f3f4f6" }}
            className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded font-medium"
            onClick={handleCancel}
            disabled={isCheckingData || isPending}
          >
            Отмена
          </AlertDialogCancel>
          
          {relatedData ? (
            <AlertDialogAction
              style={{ backgroundColor: "#dc2626" }}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded flex items-center"
              onClick={handleConfirmDelete}
              disabled={isCheckingData || isPending}
            >
              <Trash className="h-4 w-4 mr-2" />
              Удалить со всеми данными
            </AlertDialogAction>
          ) : (
            <AlertDialogAction
              style={{ backgroundColor: "#dc2626" }}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded flex items-center"
              onClick={handleDeleteRequest}
              disabled={isCheckingData || isPending}
            >
              <Trash className="h-4 w-4 mr-2" />
              Удалить
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
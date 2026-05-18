import { useState, useEffect } from "react";
import { DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api-client";
import { queryClient } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendAnalysisSettings } from "@/components/TrendAnalysisSettings";
import { SocialMediaSettings } from "@/components/SocialMediaSettings";
import { useQuery } from "@tanstack/react-query";

interface EditCampaignDialogProps {
  campaignId: string;
  currentName: string;
  onClose: () => void;
}

export function EditCampaignDialog({ campaignId, currentName, onClose }: EditCampaignDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState(currentName);
  const [description, setDescription] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [trendSettings, setTrendSettings] = useState<any>(undefined);
  const [socialSettings, setSocialSettings] = useState<any>(undefined);

  // Получаем полные данные о кампании
  const { data: campaignData, isLoading } = useQuery({
    queryKey: ["/api/campaigns", campaignId],
    queryFn: async () => {
      try {
        const response = await api.campaigns.get(campaignId);
        return response.data;
      } catch (error) {
        console.error('Error fetching campaign details:', error);
        throw error;
      }
    },
    refetchOnMount: "always" // Всегда перезапрашивать при открытии диалога
  });

  useEffect(() => {
    if (campaignData) {
      // Загружаем данные кампании
      setName(campaignData.name || currentName);
      setDescription(campaignData.description || "");
      
      // Загружаем настройки из полученных данных
      if (campaignData.trend_analysis_settings) {
        setTrendSettings(campaignData.trend_analysis_settings);
      }
      if (campaignData.social_media_settings) {
        setSocialSettings(campaignData.social_media_settings);
      }
    }
  }, [campaignData, currentName]);

  const updateCampaign = async () => {
    if (!name.trim()) {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: "Введите название кампании"
      });
      return;
    }

    setIsUpdating(true);
    try {
      await api.campaigns.update(campaignId, {
        name: name.trim(),
        description: description ? description.trim() : ""
      });

      // Инвалидируем все запросы начинающиеся с /api/campaigns (список + детали)
      // Список кэшируется с userId в ключе, поэтому используем точное совпадение prefix
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"], exact: false });

      toast({
        title: "Успешно",
        description: "Кампания обновлена"
      });

      // Закрываем диалог после успешного сохранения
      onClose();
    } catch (error: any) {
      console.error('Error updating campaign:', error);
      toast({
        variant: "destructive",
        title: "Ошибка", 
        description: error.message || "Не удалось обновить кампанию"
      });
    } finally {
      setIsUpdating(false);
    }
  };

  if (isLoading) {
    return (
      <DialogContent>
        <div className="flex justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle>Редактировать кампанию</DialogTitle>
      </DialogHeader>

      <Tabs defaultValue="general" className="mt-4 flex-1 overflow-hidden flex flex-col">
        <TabsList className="mb-4">
          <TabsTrigger value="general">Основные настройки</TabsTrigger>
          <TabsTrigger value="trend-analysis">Анализ трендов</TabsTrigger>
          <TabsTrigger value="social-media">Социальные сети</TabsTrigger>
        </TabsList>
        
        <TabsContent value="general" className="space-y-4 py-2 overflow-y-auto flex-1">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Название кампании</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Введите новое название"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Описание кампании</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Введите описание кампании (необязательно)"
                rows={3}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Отмена
              </Button>
              <Button 
                onClick={updateCampaign}
                disabled={isUpdating || !name.trim()}
              >
                {isUpdating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Сохранение...
                  </>
                ) : (
                  'Сохранить'
                )}
              </Button>
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="trend-analysis" className="space-y-4 py-2 overflow-y-auto flex-1">
          <TrendAnalysisSettings 
            campaignId={campaignId} 
            initialSettings={trendSettings}
            onSettingsUpdated={() => {
              // После обновления настроек обновляем кэш
              queryClient.invalidateQueries({ queryKey: [`campaign-details-${campaignId}`] });
            }}
          />
        </TabsContent>

        <TabsContent value="social-media" className="space-y-4 py-2 overflow-y-auto flex-1">
          <SocialMediaSettings 
            campaignId={campaignId} 
            initialSettings={socialSettings}
            onSettingsUpdated={() => {
              // После обновления настроек обновляем кэш
              queryClient.invalidateQueries({ queryKey: [`campaign-details-${campaignId}`] });
            }}
          />
        </TabsContent>
      </Tabs>
    </DialogContent>
  );
}

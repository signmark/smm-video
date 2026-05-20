import { useState } from "react";
import { TrendAnalysisSettings as TrendSettings } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { queryClient } from "@/lib/queryClient";

interface TrendAnalysisSettingsProps {
  campaignId: string;
  initialSettings?: TrendSettings;
  onSettingsUpdated?: () => void;
}

export function TrendAnalysisSettings({
  campaignId,
  initialSettings,
  onSettingsUpdated
}: TrendAnalysisSettingsProps) {
  const { toast } = useToast();
  const [isUpdating, setIsUpdating] = useState(false);
  
  const defaultSettings: TrendSettings = {
    minFollowers: {
      instagram: 5000,
      telegram: 2000,
      vk: 3000,
      facebook: 5000,
      youtube: 10000
    },
    maxSourcesPerPlatform: 10,
    maxTrendsPerSource: 5,
    minViews: 500,
    collectionDays: 7 // По умолчанию 7 дней
  };
  
  const [settings, setSettings] = useState<TrendSettings>(
    initialSettings
      ? {
          ...defaultSettings,
          ...initialSettings,
          minFollowers: {
            ...defaultSettings.minFollowers,
            ...(initialSettings.minFollowers || {})
          }
        }
      : defaultSettings
  );
  
  const handleFollowersChange = (platform: keyof TrendSettings['minFollowers'], value: string) => {
    const numValue = parseInt(value) || 0;
    setSettings({
      ...settings,
      minFollowers: {
        ...settings.minFollowers,
        [platform]: numValue
      }
    });
  };
  
  const handleMaxSourcesChange = (value: string) => {
    const numValue = parseInt(value) || 0;
    setSettings({
      ...settings,
      maxSourcesPerPlatform: numValue
    });
  };
  
  const handleMaxTrendsChange = (value: string) => {
    const numValue = parseInt(value) || 0;
    setSettings({
      ...settings,
      maxTrendsPerSource: numValue
    });
  };

  const handleMinViewsChange = (value: string) => {
    const numValue = parseInt(value) || 0;
    setSettings({
      ...settings,
      minViews: numValue
    });
  };

  const handleCollectionDaysChange = (value: string) => {
    const numValue = parseInt(value) || 1;
    setSettings({
      ...settings,
      collectionDays: numValue
    });
  };
  
  const saveSettings = async () => {
    setIsUpdating(true);
    try {
      // Получаем токен авторизации из localStorage
      const token = localStorage.getItem('auth_token');
      if (!token) {
        throw new Error('Необходима авторизация');
      }
      
      // Используем наш API endpoint вместо прямого обращения к Directus
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          trend_analysis_settings: settings
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Не удалось сохранить настройки');
      }
      
      // Инвалидируем кэш для обновления данных после сохранения
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["/api/proxy/campaign", campaignId] });
      
      toast({
        title: "Успешно",
        description: "Настройки анализа трендов обновлены"
      });
      
      if (onSettingsUpdated) {
        onSettingsUpdated();
      }
    } catch (error) {
      console.error('Error updating trend analysis settings:', error);
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: error instanceof Error ? error.message : "Не удалось обновить настройки анализа трендов"
      });
    } finally {
      setIsUpdating(false);
    }
  };
  
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 p-4 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>
        <div>
          <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
            Для чего нужны настройки анализа трендов?
          </p>
          <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
            Эти настройки определяют, какие источники и посты будут анализироваться для поиска актуальных трендов в вашей нише. На основе собранных трендов ИИ генерирует контент-план — без них создание контент-плана будет невозможно. Настройте параметры под вашу аудиторию для лучших результатов.
          </p>
        </div>
      </div>
      <div>
        <div className="space-y-6">
          <div className="bg-muted/50 p-4 rounded-lg border">
            <h4 className="text-base font-medium mb-3">Минимальное количество подписчиков по платформам</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Укажите минимальное количество подписчиков, которое должно быть у источника, чтобы он был включен в анализ трендов. Это поможет отфильтровать малозначимые источники.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
              <div className="space-y-2 bg-background p-3 rounded-md border">
                <Label htmlFor="instagram-followers" className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="20" height="20" x="2" y="2" rx="5" ry="5"></rect>
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
                  </svg>
                  Instagram
                </Label>
                <Input 
                  id="instagram-followers"
                  type="number" 
                  value={settings.minFollowers.instagram} 
                  onChange={(e) => handleFollowersChange('instagram', e.target.value)}
                  min={0}
                />
                <p className="text-xs text-muted-foreground">
                  Рекомендуется: от 5000
                </p>
              </div>
              
              <div className="space-y-2 bg-background p-3 rounded-md border">
                <Label htmlFor="telegram-followers" className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.17 8.25 12 2.41a1.36 1.36 0 0 0-1.3-.06L2.17 8.25a1.33 1.33 0 0 0 .46 2.43l2.12.44a2.86 2.86 0 0 0 0 .76L4.75 19a1.4 1.4 0 0 0 2.13 1.33l1.94-1.12a2.13 2.13 0 0 0 2.35 0L13.12 18A1.4 1.4 0 0 0 15.25 19l2.12-7a2.86 2.86 0 0 0 0-.76l2.12-.44a1.33 1.33 0 0 0 .46-2.43z"></path>
                  </svg>
                  Telegram
                </Label>
                <Input 
                  id="telegram-followers"
                  type="number" 
                  value={settings.minFollowers.telegram} 
                  onChange={(e) => handleFollowersChange('telegram', e.target.value)}
                  min={0}
                />
                <p className="text-xs text-muted-foreground">
                  Рекомендуется: от 2000
                </p>
              </div>
              
              <div className="space-y-2 bg-background p-3 rounded-md border">
                <Label htmlFor="vk-followers" className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M6 12.5L9 15.5L10.5 14L12 12.5L15 15.5L18 12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  VK
                </Label>
                <Input 
                  id="vk-followers"
                  type="number" 
                  value={settings.minFollowers.vk} 
                  onChange={(e) => handleFollowersChange('vk', e.target.value)}
                  min={0}
                />
                <p className="text-xs text-muted-foreground">
                  Рекомендуется: от 3000
                </p>
              </div>
              
              <div className="space-y-2 bg-background p-3 rounded-md border">
                <Label htmlFor="facebook-followers" className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path>
                  </svg>
                  Facebook
                </Label>
                <Input 
                  id="facebook-followers"
                  type="number" 
                  value={settings.minFollowers.facebook} 
                  onChange={(e) => handleFollowersChange('facebook', e.target.value)}
                  min={0}
                />
                <p className="text-xs text-muted-foreground">
                  Рекомендуется: от 5000
                </p>
              </div>
              
              <div className="space-y-2 bg-background p-3 rounded-md border">
                <Label htmlFor="youtube-followers" className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"></path>
                    <path d="m10 15 5-3-5-3z"></path>
                  </svg>
                  YouTube
                </Label>
                <Input 
                  id="youtube-followers"
                  type="number" 
                  value={settings.minFollowers.youtube} 
                  onChange={(e) => handleFollowersChange('youtube', e.target.value)}
                  min={0}
                />
                <p className="text-xs text-muted-foreground">
                  Рекомендуется: от 10000
                </p>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2 bg-muted/50 p-4 rounded-lg border">
              <Label htmlFor="collection-days" className="text-base font-medium">Период сбора данных</Label>
              <div className="mt-2">
                <div className="mb-4">
                  <Label htmlFor="collection-days" className="text-sm">Количество дней для сбора постов</Label>
                  <Input 
                    id="collection-days"
                    type="number" 
                    value={settings.collectionDays || 7} 
                    onChange={(e) => handleCollectionDaysChange(e.target.value)}
                    min={1}
                    max={30}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    За сколько дней назад собирать посты для анализа трендов
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2 bg-muted/50 p-4 rounded-lg border">
              <Label htmlFor="max-sources" className="text-base font-medium">Лимиты источников</Label>
              <div className="mt-2">
                <div className="mb-4">
                  <Label htmlFor="max-sources" className="text-sm">Количество источников на платформу</Label>
                  <Input 
                    id="max-sources"
                    type="number" 
                    value={settings.maxSourcesPerPlatform} 
                    onChange={(e) => handleMaxSourcesChange(e.target.value)}
                    min={1}
                    max={100}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Максимальное количество источников, которые будут проанализированы для каждой платформы
                  </p>
                </div>
              </div>
            </div>
            
            <div className="space-y-2 bg-muted/50 p-4 rounded-lg border">
              <Label htmlFor="max-trends" className="text-base font-medium">Лимиты трендов</Label>
              <div className="mt-2">
                <div className="mb-4">
                  <Label htmlFor="max-trends" className="text-sm">Количество трендов из источника</Label>
                  <Input 
                    id="max-trends"
                    type="number" 
                    value={settings.maxTrendsPerSource} 
                    onChange={(e) => handleMaxTrendsChange(e.target.value)}
                    min={1}
                    max={50}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Максимальное количество трендов, которые будут извлечены из каждого источника
                  </p>
                </div>
                
                <div>
                  <Label htmlFor="min-views" className="text-sm">Минимальное количество просмотров</Label>
                  <Input 
                    id="min-views"
                    type="number" 
                    value={settings.minViews || 0} 
                    onChange={(e) => handleMinViewsChange(e.target.value)}
                    min={0}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Тренды с меньшим количеством просмотров будут игнорироваться
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="flex justify-end">
        <Button
          onClick={saveSettings}
          disabled={isUpdating}
        >
          {isUpdating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Сохранение...
            </>
          ) : (
            'Сохранить настройки'
          )}
        </Button>
      </div>
    </div>
  );
}
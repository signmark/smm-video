import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { KeywordTable } from "@/components/KeywordTable";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, RefreshCw } from "lucide-react";
import { api } from "@/lib/api-client";
import { campaignsListQueryOptions } from "@/lib/campaigns-query";
import { useCampaignStore } from "@/lib/campaignStore"; // Используем общее хранилище
import { useAuthStore } from "@/lib/store"; // Импортируем хранилище авторизации
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WebsiteKeywordAnalyzer } from "@/components/WebsiteKeywordAnalyzer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from 'react-i18next';

interface Campaign {
  id: string;
  name: string;
}

export default function Keywords() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Используем глобальное состояние кампании из общего хранилища
  const { selectedCampaignId, selectedCampaignName } = useCampaignStore();
  // userId нужен раньше: см. shared queryKey ниже.
  const userId = useAuthStore(state => state.userId);
  const { data: campaignsResponse, isLoading: isLoadingCampaigns } = useQuery({
    ...campaignsListQueryOptions({ userId, queryFn: () => api.campaigns.list() })
  });

  const campaigns = campaignsResponse?.data || [];

  // Получаем ID выбранной кампании из глобального хранилища
  const campaignId = selectedCampaignId || "";
  const clearSelectedCampaign = useCampaignStore(state => state.clearSelectedCampaign);

  // Проверяем принадлежность кампании текущему пользователю
  useEffect(() => {
    const checkCampaignOwnership = async () => {
      if (selectedCampaignId && userId) {
        console.log("Проверка принадлежности кампании пользователю:", {campaignId: selectedCampaignId, userId});
        
        try {
          await api.campaigns.get(selectedCampaignId);
          console.log("Используем глобально выбранную кампанию:", selectedCampaignName);
        } catch (error) {
          console.error("Ошибка при проверке кампании:", error);
          toast({
            title: t('keywords.messages.accessDenied'),
            description: t('keywords.messages.campaignUnavailable'),
            variant: "destructive"
          });
          clearSelectedCampaign();
        }
      }
    };
    
    checkCampaignOwnership();
  }, [selectedCampaignId, userId, selectedCampaignName, clearSelectedCampaign, toast, t]);

  const { data: keywordsResponse, isLoading: isLoadingKeywords } = useQuery({
    queryKey: ["/api/proxy/keywords", campaignId],
    queryFn: () => api.keywords.list(campaignId),
    enabled: !!campaignId,
    refetchOnMount: true,
    staleTime: 10000
  });
  
  const keywords = keywordsResponse?.data || [];

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);

    try {
      // Используем новый универсальный API endpoint для поиска ключевых слов
      const authToken = localStorage.getItem('auth_token');
      const response = await fetch('/api/keywords/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          keyword: searchQuery.trim()
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        if (data.key_missing) {
          toast({
            variant: "destructive",
            title: t('keywords.messages.apiKeyRequired'),
            description: t('keywords.messages.apiKeyMissing', { service: data.service })
          });
          return;
        }
        
        throw new Error(data.message || data.error || t('keywords.messages.searchError'));
      }

      if (!data?.data?.keywords?.length) {
        toast({ 
          title: t('common.search'),
          description: t('keywords.noKeywords')
        });
        return;
      }

      const formattedResults = data.data.keywords.map((kw: any) => ({
        keyword: kw.keyword,
        trend: parseInt(kw.trend) || 0,
        competition: parseInt(kw.competition || 0),
        selected: false
      }));

      setSearchResults(formattedResults);
      setSearchQuery("");
      toast({ 
        title: t('common.success'),
        description: t('keywords.messages.added', { count: formattedResults.length })
      });
    } catch (error) {
      console.error("Search error:", error);
      toast({
        variant: "destructive",
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('keywords.messages.searchError')
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeywordToggle = (index: number) => {
    setSearchResults(prev =>
      prev.map((kw, i) => i === index ? { ...kw, selected: !kw.selected } : kw)
    );
  };

  const handleSelectAll = (checked: boolean) => {
    setSearchResults(prev => prev.map(kw => ({ ...kw, selected: checked })));
  };

  const handleSaveSelected = async () => {
    if (!selectedCampaignId || !campaignId) {
      toast({
        variant: "destructive",
        title: t('common.error'),
        description: t('keywords.selectCampaign')
      });
      return;
    }

    const selectedKeywords = searchResults.filter(kw => kw.selected);
    if (!selectedKeywords.length) {
      toast({
        variant: "destructive",
        title: t('common.error'),
        description: t('keywords.messages.selectKeywords')
      });
      return;
    }

    try {
      const now = new Date().toISOString();
      let addedCount = 0;
      let skippedCount = 0;

      // Получаем существующие ключевые слова для проверки дубликатов
      const existingKeywordsResponse = await api.keywords.list(campaignId);
      
      const existingKeywords = existingKeywordsResponse.data || [];
      const existingKeywordsLower = existingKeywords.map(k => k.keyword.toLowerCase());

      for (const keyword of selectedKeywords) {
        // Проверка, существует ли ключевое слово (case-insensitive)
        if (existingKeywordsLower.includes(keyword.keyword.toLowerCase())) {
          console.log(`Ключевое слово "${keyword.keyword}" уже существует - пропускаем`);
          skippedCount++;
          continue;
        }

        const data = {
          keyword: keyword.keyword,
          campaign_id: campaignId,
          trend_score: keyword.trend,
          mentions_count: keyword.competition,
          date_created: now,
          last_checked: now
        };

        try {
          console.log(`[KEYWORDS-SEARCH] Сохраняем ключевое слово "${keyword.keyword}" в кампанию ${campaignId}:`, data);
          console.log(`[KEYWORDS-SEARCH] Используемый токен:`, localStorage.getItem('auth_token')?.substring(0, 20) + '...');
          const response = await api.keywords.create(data);
          console.log(`[KEYWORDS-SEARCH] Успешно добавлено ключевое слово "${keyword.keyword}", ответ:`, response.data);
          addedCount++;
        } catch (err: any) {
          console.log(`[KEYWORDS-SEARCH] ПОЛНАЯ ОШИБКА для "${keyword.keyword}":`, {
            status: err.response?.status,
            statusText: err.response?.statusText,
            data: err.response?.data,
            config: {
              url: err.config?.url,
              method: err.config?.method,
              headers: err.config?.headers
            }
          });
          
          // Проверяем, связана ли ошибка с дубликатом
          const errorMessage = err.response?.data?.errors?.[0]?.message || '';
          if (errorMessage.includes('Дубликат ключевого слова') || 
              errorMessage.includes('duplicate') || 
              errorMessage.includes('unique')) {
            console.log(`Ключевое слово "${keyword.keyword}" вызвало ошибку дубликата - пропускаем`);
            skippedCount++;
          } else {
            // Если это другая ошибка, пробрасываем её выше
            throw err;
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/proxy/keywords", campaignId] });
      setSearchResults([]);
      
      const description = skippedCount > 0
        ? t('keywords.messages.addedWithSkipped', { added: addedCount, skipped: skippedCount })
        : t('keywords.messages.added', { count: addedCount });
      
      toast({ 
        title: t('common.success'),
        description: description
      });
    } catch (error) {
      console.error('Error saving keywords:', error);
      toast({
        variant: "destructive",
        title: t('common.error'),
        description: t('keywords.messages.saveError')
      });
    }
  };

  // Получаем функцию выбора кампании из глобального хранилища
  const { setSelectedCampaign } = useCampaignStore();

  // Функция для обновления выбранной кампании
  const handleCampaignSelect = (campaignId: string) => {
    const campaign = campaigns?.find((c: Campaign) => String(c.id) === campaignId);
    if (campaign) {
      setSelectedCampaign(campaign.id, campaign.name);
    }
  };

  // Функция для обработки выбранных ключевых слов из анализатора сайта
  const handleWebsiteKeywordsSelected = async (selectedKeywords: any[]) => {
    if (!selectedCampaignId || !campaignId) {
      toast({
        variant: "destructive",
        title: t('common.error'),
        description: t('keywords.messages.selectCampaignFirst')
      });
      return;
    }

    try {
      const now = new Date().toISOString();
      let addedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      // Получаем существующие ключевые слова для проверки дубликатов
      const existingKeywordsResponse = await api.keywords.list(campaignId);
      
      const existingKeywords = existingKeywordsResponse.data || [];
      const existingKeywordsLower = existingKeywords.map(k => k.keyword.toLowerCase());
      
      // Добавляем выбранные ключевые слова в кампанию
      for (const keywordObj of selectedKeywords) {
        const keyword = typeof keywordObj === 'string' ? keywordObj : keywordObj.keyword;
        
        // Проверка, существует ли ключевое слово (case-insensitive)
        if (existingKeywordsLower.includes(keyword.toLowerCase())) {
          console.log(`Ключевое слово "${keyword}" уже существует - пропускаем`);
          skippedCount++;
          continue;
        }
        
        // Используем реальные значения метрик из анализа сайта
        const data = {
          keyword: keyword,
          campaign_id: campaignId,
          trend_score: typeof keywordObj === 'string' ? 500 : keywordObj.trend,
          mentions_count: typeof keywordObj === 'string' ? 50 : keywordObj.competition,
          date_created: now,
          last_checked: now
        };

        try {
          await api.keywords.create(data);
          addedCount++;
        } catch (err: any) {
          // Проверяем, связана ли ошибка с дубликатом
          const errorMessage = err.response?.data?.errors?.[0]?.message || '';
          if (errorMessage.includes('Дубликат ключевого слова') || 
              errorMessage.includes('duplicate') || 
              errorMessage.includes('unique') || 
              errorMessage.includes('already exists')) {
            console.log(`Ключевое слово "${keyword}" вызвало ошибку дубликата - пропускаем`);
            skippedCount++;
          } else {
            // Если это другая ошибка, логируем ее и продолжаем с остальными ключевыми словами
            console.error(`Ошибка при добавлении ключевого слова "${keyword}":`, err);
            errorCount++;
          }
        }
      }

      // Обновляем данные в кэше
      queryClient.invalidateQueries({ queryKey: ["/api/proxy/keywords", campaignId] });
      
      let message = "";
      let description = "";
      let variant: "default" | "destructive" = "default";
      
      if (addedCount > 0) {
        message = t('common.success');
        
        if (skippedCount > 0 && errorCount === 0) {
          description = t('keywords.messages.addedWithSkipped', { added: addedCount, skipped: skippedCount });
        } else if (skippedCount > 0 && errorCount > 0) {
          description = `${t('keywords.messages.addedWithSkipped', { added: addedCount, skipped: skippedCount })}. ${t('keywords.messages.saveError')}`;
        } else if (errorCount > 0) {
          description = `${t('keywords.messages.added', { count: addedCount })}. ${t('keywords.messages.saveError')}`;
        } else {
          description = t('keywords.messages.added', { count: addedCount });
        }
      } else if (skippedCount > 0 && errorCount === 0) {
        message = t('keywords.messages.information');
        description = t('keywords.messages.allExist', { count: skippedCount });
      } else if (errorCount > 0) {
        if (skippedCount > 0) {
          message = t('keywords.messages.partialError');
          description = t('keywords.messages.partialErrorDesc', { skipped: skippedCount, errors: errorCount });
        } else {
          message = t('common.error');
          description = t('keywords.messages.saveAllError');
        }
        variant = "destructive";
      }
      
      toast({ 
        title: message,
        description: description,
        variant: variant
      });
    } catch (error) {
      console.error('Error saving website keywords:', error);
      
      const errorMessage = typeof error === 'object' && error !== null 
        ? ((error as any).message || error.toString()) 
        : String(error);
      
      if (errorMessage.toLowerCase().includes('дубликат') || 
          errorMessage.toLowerCase().includes('duplicate') || 
          errorMessage.toLowerCase().includes('already exists')) {
        toast({
          variant: "destructive",
          title: t('keywords.messages.duplicateTitle'),
          description: t('keywords.messages.duplicateDesc')
        });
      } else {
        toast({
          variant: "destructive",
          title: t('common.error'),
          description: t('keywords.messages.saveAllError')
        });
      }
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-col">
        <h1 className="text-2xl font-bold">{t('keywords.title')}</h1>
        <p className="text-muted-foreground mt-2">
          {selectedCampaignId && selectedCampaignName
            ? `${t('keywords.subtitle')} "${selectedCampaignName}"` 
            : t('keywords.selectCampaign')}
        </p>
      </div>

      <div className="flex items-start gap-3 p-4 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30">
        <Search className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
            Зачем нужны ключевые слова?
          </p>
          <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
            Ключевые слова помогают ИИ генерировать более точный и релевантный контент для ваших социальных сетей. Они используются при создании контент-плана, генерации постов и подборе трендов — чем точнее подобраны ключевые слова, тем качественнее будет результат.
          </p>
        </div>
      </div>

      {!(selectedCampaignId && selectedCampaignName) && (
        <Card>
          <CardContent className="p-6">
            <div className="text-center">
              <p className="mb-4">{t('keywords.selectCampaign')}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {selectedCampaignId && selectedCampaignName && (
        <Tabs defaultValue="search" className="w-full">
          <TabsList className="grid w-full grid-cols-1 mb-4">
            <TabsTrigger value="search">{t('keywords.search')}</TabsTrigger>
            {/* <TabsTrigger value="website">{t('keywords.analyze')}</TabsTrigger> */}
          </TabsList>
          
          <TabsContent value="search">
            <Card>
              <CardContent className="p-6">
                <div className="flex gap-2">
                  <Input
                    placeholder={t('keywords.searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                    className="flex-1"
                  />
                  <Button onClick={handleSearch} disabled={isSearching}>
                    {isSearching ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t('common.loading')}
                      </>
                    ) : (
                      <>
                        <Search className="mr-2 h-4 w-4" />
                        {t('common.search')}
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* 
          <TabsContent value="website">
            <WebsiteKeywordAnalyzer 
              campaignId={campaignId} 
              onKeywordsSelected={handleWebsiteKeywordsSelected}
            />
          </TabsContent>
          */}
        </Tabs>
      )}

      <Card>
        <CardContent className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">{t('keywords.title')}</h2>
          </div>
          <KeywordTable
            keywords={keywords}
            searchResults={searchResults}
            isLoading={isLoadingCampaigns || isLoadingKeywords || isSearching}
            onDelete={async (id) => {
              try {
                await api.keywords.delete(id);
                queryClient.invalidateQueries({ queryKey: ["/api/proxy/keywords", campaignId] });
                queryClient.invalidateQueries({ queryKey: ["/api/proxy/keywords", campaignId] });
                toast({ 
                  title: t('common.success'),
                  description: t('keywords.messages.deleteSuccess')
                });
              } catch (error) {
                console.error("Error deleting keyword:", error);
                toast({
                  variant: "destructive",
                  title: t('common.error'),
                  description: t('keywords.messages.deleteError')
                });
              } finally {
                queryClient.invalidateQueries({ queryKey: ["/api/proxy/keywords", campaignId] });
                queryClient.invalidateQueries({ queryKey: ["/api/keywords", campaignId] });
              }
            }}
            onKeywordToggle={handleKeywordToggle}
            onSelectAll={handleSelectAll}
            onSaveSelected={handleSaveSelected}
          />
        </CardContent>
      </Card>
    </div>
  );
}
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Search, Users, TrendingUp, ExternalLink, Plus, Loader2, AlertCircle, ArrowUpDown, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/lib/store";
import { useCampaignStore } from "@/lib/campaignStore";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface TelegramCategory {
  id: string;
  name: string;
  name_ru: string;
  name_en: string;
  name_es: string;
  description: string;
  icon: string;
}

interface TelegramChannel {
  id: string;
  title: string;
  username: string;
  link: string;
  subscribers: number;
  description: string;
  language: string;
  is_verified: boolean;
  avg_post_reach: number;
  engagement_rate: number;
  category_id: any;
}

const CHANNELS_PER_PAGE = 20;

export default function TelegramChannelsPage() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { checkIsAdmin } = useAuthStore();
  const { selectedCampaignId, selectedCampaignName } = useCampaignStore();
  const [adminChecked, setAdminChecked] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("categories");
  const [sortBy, setSortBy] = useState<'subscribers' | 'reach' | 'er'>('subscribers');
  const [offset, setOffset] = useState(0);
  const [allChannels, setAllChannels] = useState<TelegramChannel[]>([]);

  useEffect(() => {
    const verifyAdmin = async () => {
      try {
        const isAdminResult = await checkIsAdmin();
        setAdminChecked(true);
        setHasAccess(isAdminResult);
      } catch (err) {
        console.error('Ошибка при проверке прав администратора:', err);
        setAdminChecked(true);
        setHasAccess(false);
      }
    };
    verifyAdmin();
  }, [checkIsAdmin]);

  useEffect(() => {
    setOffset(0);
    setAllChannels([]);
  }, [selectedCategory, sortBy]);

  const { data: categoriesData, isLoading: categoriesLoading } = useQuery<{ success: boolean; data: TelegramCategory[] }>({
    queryKey: ['/api/telegram-channels/categories'],
    enabled: adminChecked && hasAccess,
  });

  const categories: TelegramCategory[] = categoriesData?.data || [];

  const { data: topChannelsData, isLoading: topChannelsLoading } = useQuery<{ success: boolean; data: TelegramChannel[] }>({
    queryKey: ['/api/telegram-channels/top', { limit: 50 }],
    enabled: adminChecked && hasAccess && activeTab === 'top',
  });

  const topChannels: TelegramChannel[] = topChannelsData?.data || [];

  const { data: categoryChannelsData, isLoading: categoryChannelsLoading, isFetching } = useQuery<{ 
    success: boolean; 
    data: { category: TelegramCategory; channels: TelegramChannel[]; total: number } 
  }>({
    queryKey: ['/api/telegram-channels/by-category', selectedCategory, sortBy, offset],
    queryFn: async ({ queryKey }) => {
      const [, categoryName, sort, off] = queryKey;
      return apiRequest(`/api/telegram-channels/by-category/${categoryName}?sortBy=${sort}&offset=${off}&limit=${CHANNELS_PER_PAGE}`);
    },
    enabled: adminChecked && hasAccess && !!selectedCategory && activeTab === 'categories',
  });

  useEffect(() => {
    if (categoryChannelsData?.data?.channels) {
      if (offset === 0) {
        setAllChannels(categoryChannelsData.data.channels);
      } else {
        setAllChannels(prev => [...prev, ...categoryChannelsData.data.channels]);
      }
    }
  }, [categoryChannelsData, offset]);

  const totalChannels = categoryChannelsData?.data?.total || 0;
  const hasMore = allChannels.length < totalChannels;

  const { data: searchResults, isLoading: searchLoading, refetch: searchChannels } = useQuery<{ success: boolean; data: TelegramChannel[] }>({
    queryKey: ['/api/telegram-channels/search', { q: searchQuery }],
    enabled: false,
  });

  const searchedChannels: TelegramChannel[] = searchResults?.data || [];

  const addToSourcesMutation = useMutation({
    mutationFn: async ({ channelId, campaignId }: { channelId: string; campaignId: string }) => {
      return apiRequest('/api/campaigns/sources', {
        method: 'POST',
        data: { channelId, campaignId, type: 'telegram' },
      });
    },
    onSuccess: () => {
      toast({
        title: "Добавлено",
        description: "Канал добавлен в источники кампании",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['/api/proxy/sources'] });
    },
    onError: (error: any) => {
      toast({
        title: "Ошибка",
        description: error.message || "Не удалось добавить канал",
        variant: "destructive",
      });
    },
  });

  const handleSearch = () => {
    if (searchQuery.trim().length > 0) {
      setActiveTab('search');
      searchChannels();
    }
  };

  const handleLoadMore = () => {
    setOffset(prev => prev + CHANNELS_PER_PAGE);
  };

  const handleAddToSources = (channelId: string) => {
    if (selectedCampaignId) {
      addToSourcesMutation.mutate({ channelId, campaignId: selectedCampaignId });
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num?.toString() || '0';
  };

  const getCategoryName = (category: TelegramCategory) => {
    if (i18n.language === 'ru') return category.name_ru;
    if (i18n.language === 'es') return category.name_es;
    return category.name_en;
  };

  const renderCompactChannel = (channel: TelegramChannel) => {
    const subscribers = Number(channel.subscribers) || 0;
    const avgReach = Number(channel.avg_post_reach) || 0;
    const er = Number(channel.engagement_rate) || 0;
    
    return (
      <div 
        key={channel.id} 
        className="p-2 bg-card border rounded-md hover:shadow-sm transition-shadow"
        data-testid={`card-channel-${channel.id}`}
      >
        <div className="flex items-start justify-between gap-1 mb-1">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="font-medium text-xs truncate" data-testid={`text-channel-title-${channel.id}`}>
                {channel.title}
              </span>
              {channel.is_verified && (
                <Badge variant="default" className="text-[8px] px-0.5 py-0 h-3">✓</Badge>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground truncate" data-testid={`text-channel-username-${channel.id}`}>
              @{channel.username}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 shrink-0"
            onClick={() => window.open(channel.link, '_blank')}
            data-testid={`button-open-channel-${channel.id}`}
          >
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
        
        <div className="flex items-center gap-2 text-[10px] mb-1.5">
          <div className="flex items-center gap-0.5" data-testid={`text-channel-subscribers-${channel.id}`}>
            <Users className="h-2.5 w-2.5 text-blue-500" />
            <span className="font-medium">{formatNumber(subscribers)}</span>
          </div>
          {avgReach > 0 && (
            <div className="flex items-center gap-0.5 text-muted-foreground" data-testid={`text-channel-reach-${channel.id}`}>
              <TrendingUp className="h-2.5 w-2.5 text-green-500" />
              <span>{formatNumber(avgReach)}</span>
            </div>
          )}
          {er > 0 && (
            <span className="text-muted-foreground" data-testid={`text-channel-er-${channel.id}`}>
              ER {er.toFixed(1)}%
            </span>
          )}
        </div>

        <Button
          size="sm"
          variant={selectedCampaignId ? "default" : "secondary"}
          className="h-6 w-full text-[10px]"
          disabled={!selectedCampaignId || addToSourcesMutation.isPending}
          onClick={() => handleAddToSources(channel.id)}
          data-testid={`button-add-source-${channel.id}`}
        >
          <Plus className="h-2.5 w-2.5 mr-0.5" />
          В источники
        </Button>
      </div>
    );
  };

  if (!adminChecked) {
    return (
      <div className="container mx-auto p-6 max-w-7xl flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-muted-foreground">Проверка прав доступа...</p>
        </div>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Доступ запрещен</AlertTitle>
          <AlertDescription>
            У вас недостаточно прав для управления каталогом Telegram-каналов. 
            Эта функция доступна только администраторам системы.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 max-w-7xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold mb-1">
          Каталог Telegram-каналов
        </h1>
        <p className="text-sm text-muted-foreground">
          Более 100,000 каналов по 54 категориям из базы TGStat
          {selectedCampaignId && (
            <span className="ml-2 text-primary">
              • Кампания: {selectedCampaignName || 'выбрана'}
            </span>
          )}
        </p>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex gap-2 flex-1 min-w-[250px]">
          <Input
            placeholder="Поиск каналов..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1 h-9"
            data-testid="input-search-channels"
          />
          <Button 
            onClick={handleSearch}
            disabled={searchLoading || searchQuery.trim().length === 0}
            size="sm"
            className="h-9"
            data-testid="button-search"
          >
            {searchLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>
        
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
          <SelectTrigger className="w-[150px] h-9" data-testid="select-sort">
            <ArrowUpDown className="h-3.5 w-3.5 mr-1.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="subscribers">Подписчики</SelectItem>
            <SelectItem value="reach">Охват</SelectItem>
            <SelectItem value="er">ER</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-3 h-9">
          <TabsTrigger value="categories" className="text-sm" data-testid="tab-categories">
            По категориям
          </TabsTrigger>
          <TabsTrigger value="top" className="text-sm" data-testid="tab-top">
            Топ каналов
          </TabsTrigger>
          {searchedChannels.length > 0 && (
            <TabsTrigger value="search" className="text-sm" data-testid="tab-search">
              Результаты ({searchedChannels.length})
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="categories">
          {categoriesLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="grid md:grid-cols-5 gap-3">
              <div className="md:col-span-1">
                <Card className="sticky top-4">
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-sm">Категории</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[calc(100vh-280px)]">
                      <div className="space-y-0.5 p-1.5">
                        {categories.map((category) => (
                          <Button
                            key={category.id}
                            variant={selectedCategory === category.name ? "default" : "ghost"}
                            className="w-full justify-start text-xs h-7 px-2"
                            onClick={() => setSelectedCategory(category.name)}
                            data-testid={`button-category-${category.name}`}
                          >
                            {getCategoryName(category)}
                          </Button>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>

              <div className="md:col-span-4">
                {!selectedCategory ? (
                  <Card className="h-64 flex items-center justify-center">
                    <CardContent className="text-center py-8">
                      <p className="text-muted-foreground">
                        Выберите категорию слева
                      </p>
                    </CardContent>
                  </Card>
                ) : categoryChannelsLoading && offset === 0 ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                      <span>Показано {allChannels.length} из {totalChannels} каналов</span>
                      {!selectedCampaignId && (
                        <span className="text-amber-600">Выберите кампанию в шапке для добавления в источники</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                      {allChannels.map(renderCompactChannel)}
                    </div>
                    
                    {hasMore && (
                      <div className="flex justify-center pt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleLoadMore}
                          disabled={isFetching}
                          className="w-full max-w-xs h-8"
                          data-testid="button-load-more"
                        >
                          {isFetching ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <ChevronDown className="h-4 w-4 mr-2" />
                          )}
                          Показать ещё {CHANNELS_PER_PAGE}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="top">
          {topChannelsLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              {topChannels.map(renderCompactChannel)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="search">
          {searchedChannels.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <p className="text-muted-foreground">
                  {searchLoading ? "Поиск..." : "Ничего не найдено"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              {searchedChannels.map(renderCompactChannel)}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

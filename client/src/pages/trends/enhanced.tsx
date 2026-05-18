import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Search, Filter } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCampaignStore } from "@/lib/campaignStore";
import { TrendCard } from "@/components/trends/TrendCard";
import { TrendsCollection } from "@/components/trends/TrendsCollection";

interface TrendTopic {
  id: string;
  title: string;
  description?: string;
  sentiment_analysis?: string;
  date_created?: string;
  created_at?: string;
  reactions?: number;
  comments?: number;
  views?: number;
  url?: string;
  sourceName?: string;
  campaign_id?: string;
}

type SentimentFilter = "all" | "positive" | "negative" | "neutral" | "unknown";
type SortBy = "date" | "reactions" | "comments" | "views";
type SortOrder = "asc" | "desc";

export default function EnhancedTrends() {
  const { selectedCampaign } = useCampaignStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [selectedTrend, setSelectedTrend] = useState<TrendTopic | null>(null);

  // Автоматически выбираем кампанию
  const campaignId = selectedCampaign?.id;

  // Запрос данных трендов
  const { data: trendsData, isLoading, error, refetch } = useQuery({
    queryKey: ["campaign-trend-topics", campaignId],
    queryFn: async () => {
      if (!campaignId) throw new Error("Campaign ID is required");
      
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) throw new Error("Требуется авторизация");

      const response = await fetch(`/api/campaign-trend-topics?campaignId=${campaignId}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (!response.ok) {
        throw new Error('Ошибка загрузки трендов');
      }

      const result = await response.json();
      return result.data || [];
    },
    enabled: !!campaignId,
    refetchInterval: 2 * 60 * 1000, // Автообновление каждые 2 минуты
  });

  const trends = trendsData || [];

  // Функция для определения тональности
  const getSentimentCategory = (sentimentAnalysis?: string): SentimentFilter => {
    if (!sentimentAnalysis) return "unknown";
    
    const text = sentimentAnalysis.toLowerCase();
    
    const positiveKeywords = [
      "положительн", "позитивн", "хорош", "отличн", "прекрасн", 
      "великолепн", "успешн", "выгодн", "перспективн", "многообещающ"
    ];
    
    const negativeKeywords = [
      "негативн", "отрицательн", "плох", "ужасн", "проблемн",
      "рискованн", "опасн", "неудачн"
    ];
    
    const neutralKeywords = [
      "нейтральн", "сбалансированн", "умеренн", "стабильн",
      "обычн", "средн", "стандартн"
    ];
    
    if (positiveKeywords.some(keyword => text.includes(keyword))) {
      return "positive";
    }
    
    if (negativeKeywords.some(keyword => text.includes(keyword))) {
      return "negative";
    }
    
    if (neutralKeywords.some(keyword => text.includes(keyword))) {
      return "neutral";
    }
    
    return "unknown";
  };

  // Фильтрация и сортировка трендов
  const filteredAndSortedTrends = trends
    .filter((trend: TrendTopic) => {
      // Фильтр по поисковому запросу
      const matchesSearch = !searchQuery || 
        trend.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (trend.description && trend.description.toLowerCase().includes(searchQuery.toLowerCase()));

      // Фильтр по тональности
      const matchesSentiment = sentimentFilter === "all" || 
        getSentimentCategory(trend.sentiment_analysis) === sentimentFilter;

      return matchesSearch && matchesSentiment;
    })
    .sort((a: TrendTopic, b: TrendTopic) => {
      let aValue: any, bValue: any;

      switch (sortBy) {
        case "date":
          aValue = new Date(a.date_created || a.created_at || 0).getTime();
          bValue = new Date(b.date_created || b.created_at || 0).getTime();
          break;
        case "reactions":
          aValue = a.reactions || 0;
          bValue = b.reactions || 0;
          break;
        case "comments":
          aValue = a.comments || 0;
          bValue = b.comments || 0;
          break;
        case "views":
          aValue = a.views || 0;
          bValue = b.views || 0;
          break;
        default:
          return 0;
      }

      return sortOrder === "asc" ? aValue - bValue : bValue - aValue;
    });

  // Подсчет трендов по тональности
  const sentimentCounts = trends.reduce((acc: Record<SentimentFilter, number>, trend: TrendTopic) => {
    const category = getSentimentCategory(trend.sentiment_analysis);
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, { all: trends.length, positive: 0, negative: 0, neutral: 0, unknown: 0 });

  if (!campaignId) {
    return (
      <div className="container mx-auto p-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Выберите кампанию для просмотра трендов
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Заголовок */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Тренды для кампании</h1>
        <p className="text-muted-foreground">
          {selectedCampaign?.name || "Без названия"}
        </p>
      </div>

      {/* Кнопка сбора трендов */}
      <TrendsCollection 
        campaignId={campaignId} 
        selectedSourcesForComments={new Set()} 
        trendAnalysisSettings={selectedCampaign?.trend_analysis_settings || (selectedCampaign as any)?.trendAnalysisSettings}
      />

      {/* Статистика */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{sentimentCounts.all}</div>
            <div className="text-sm text-muted-foreground">Всего</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-green-600">{sentimentCounts.positive}</div>
            <div className="text-sm text-muted-foreground">😊 Позитивных</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-gray-600">{sentimentCounts.neutral}</div>
            <div className="text-sm text-muted-foreground">😐 Нейтральных</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-red-600">{sentimentCounts.negative}</div>
            <div className="text-sm text-muted-foreground">😞 Негативных</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-yellow-600">{sentimentCounts.unknown}</div>
            <div className="text-sm text-muted-foreground">❓ Неопределенных</div>
          </CardContent>
        </Card>
      </div>

      {/* Фильтры и поиск */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Поиск */}
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск по заголовку и описанию..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Фильтр по тональности */}
            <Select value={sentimentFilter} onValueChange={(value: SentimentFilter) => setSentimentFilter(value)}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Фильтр по тональности" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все ({sentimentCounts.all})</SelectItem>
                <SelectItem value="positive">😊 Позитивные ({sentimentCounts.positive})</SelectItem>
                <SelectItem value="neutral">😐 Нейтральные ({sentimentCounts.neutral})</SelectItem>
                <SelectItem value="negative">😞 Негативные ({sentimentCounts.negative})</SelectItem>
                <SelectItem value="unknown">❓ Неопределенные ({sentimentCounts.unknown})</SelectItem>
              </SelectContent>
            </Select>

            {/* Сортировка */}
            <Select value={sortBy} onValueChange={(value: SortBy) => setSortBy(value)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Сортировка" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">По дате</SelectItem>
                <SelectItem value="reactions">По лайкам</SelectItem>
                <SelectItem value="comments">По комментариям</SelectItem>
                <SelectItem value="views">По просмотрам</SelectItem>
              </SelectContent>
            </Select>

            {/* Порядок сортировки */}
            <Select value={sortOrder} onValueChange={(value: SortOrder) => setSortOrder(value)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">По убыванию</SelectItem>
                <SelectItem value="asc">По возрастанию</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Список трендов */}
      <div className="space-y-4">
        {isLoading ? (
          /* Skeleton loader */
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Card key={index}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Skeleton className="w-6 h-6 rounded" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-full" />
                      <div className="flex gap-4 mt-2">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-3 w-16" />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : error ? (
          /* Ошибка загрузки */
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Ошибка загрузки трендов: {error.message}
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => refetch()}
                className="ml-2"
              >
                Попробовать снова
              </Button>
            </AlertDescription>
          </Alert>
        ) : filteredAndSortedTrends.length === 0 ? (
          /* Пустой список */
          <Card>
            <CardContent className="p-8 text-center">
              <div className="text-muted-foreground">
                {trends.length === 0 
                  ? "Нет доступных трендов. Нажмите 'Собрать тренды' для начала сбора."
                  : "Не найдено трендов, соответствующих выбранным фильтрам."
                }
              </div>
            </CardContent>
          </Card>
        ) : (
          /* Список трендов */
          <div className="grid gap-4">
            {filteredAndSortedTrends.map((trend: TrendTopic) => (
              <TrendCard
                key={trend.id}
                trend={trend}
                onClick={() => setSelectedTrend(trend)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Информация о результатах */}
      {filteredAndSortedTrends.length > 0 && (
        <div className="text-sm text-muted-foreground text-center">
          Показано {filteredAndSortedTrends.length} из {trends.length} трендов
        </div>
      )}
    </div>
  );
}
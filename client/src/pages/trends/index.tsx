import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { ArrowUpIcon, ArrowDownIcon, Globe, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { useTranslation } from "react-i18next";

/**
 * Создает проксированный URL для загрузки изображений/видео через серверный прокси
 * с учетом специфики разных источников (Instagram, VK, Telegram)
 */
function createProxyImageUrl(imageUrl: string, itemId: string): string {
  // Если URL пустой или undefined, возвращаем пустую строку
  if (!imageUrl) return '';

  // Добавляем cache-busting параметр
  const timestamp = Date.now();

  // Определяем тип источника (Instagram, VK, etc)
  const isInstagram = imageUrl.includes('instagram.') ||
    imageUrl.includes('fbcdn.net') ||
    imageUrl.includes('cdninstagram.com');

  const isVk = imageUrl.includes('vk.com') ||
    imageUrl.includes('vk.me') ||
    imageUrl.includes('userapi.com');

  const isTelegram = imageUrl.includes('tgcnt.ru') ||
    imageUrl.includes('t.me');

  // Формируем параметры для прокси
  let forcedType = isInstagram ? 'instagram' :
    isVk ? 'vk' :
      isTelegram ? 'telegram' : null;

  // Базовый URL прокси с параметрами
  return `/api/proxy-image?url=${encodeURIComponent(imageUrl)}&_t=${timestamp}${forcedType ? '&forceType=' + forcedType : ''}&itemId=${itemId}`;
}

/**
 * Определяет платформу по полю sourceType
 */
function detectPlatform(sourceType: string): string {
  if (!sourceType) return 'unknown';
  const normalized = sourceType.toLowerCase().trim();
  if (normalized === 'instagram') return 'instagram';
  if (normalized === 'vk' || normalized === 'vkontakte') return 'vk';
  if (normalized === 'telegram') return 'telegram';
  if (normalized === 'facebook') return 'facebook';
  return 'unknown';
}

import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api-client";
import { SourcePostsList } from "@/components/SourcePostsList";
import { SourcePostsSearchForm } from "@/components/SourcePostsSearchForm";
import { Loader2, Search, Plus, RefreshCw, Bot, Trash2, CheckCircle, Clock, AlertCircle, FileText, ThumbsUp, MessageSquare, Eye, Bookmark, Flame, Download, ExternalLink, BarChart, Target, Building, TrendingUp, EyeOff, Link2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TrendDetailDialog } from "@/components/TrendDetailDialog";
import { Dialog } from "@/components/ui/dialog";
import { AddSourceDialog } from "@/components/AddSourceDialog";
import { NewSourcesDialog } from "@/components/NewSourcesDialog";
import { ContentGenerationPanel } from "@/components/ContentGenerationPanel";
import { SocialNetworkSelectorDialog } from "@/components/SocialNetworkSelectorDialog";
import { SourcesSearchDialog } from "@/components/SourcesSearchDialog";
import { Badge } from "@/components/ui/badge";
import { getSentimentEmoji, getSentimentCategory, formatNumber } from "@/lib/trends-utils";
import { BulkSourcesImportDialog } from "@/components/BulkSourcesImportDialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TrendCard } from "@/components/trends/TrendCard";
import { SentimentEmoji } from "@/components/trends/SentimentEmoji";
import { TrendsCollection } from "@/components/trends/TrendsCollection";
import { SourceCollectionDialog } from "@/components/SourceCollectionDialog";

// Определение интерфейсов для типизации
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { useCampaignStore } from "@/lib/campaignStore";

// Интерфейс для анализа данных
interface Analysis {
  характеристики_аудитории?: string;
  поведение_и_вовлеченность?: string;
  популярные_темы?: string;
  настроение?: string;
  экспертность?: string;
  общие_тенденции?: string;
  detailed_summary?: string;
  summary?: string;
  sentiment?: string;
  confidence?: number;
  engagement?: string;
  viral_potential?: string;
  themes?: string[];
  source_reputation?: string;
  audience_trust?: string;
  // Для поддержки индексирования строками
  [key: string]: any;
}

// Интерфейс для комментариев
interface Comment {
  id: string;
  content?: string;
  text?: string;
  author?: string;
  author_name?: string;
  author_url?: string;
  platform?: string;
  date?: string;
  published_at?: string;
  created_at?: string;
  likes?: number;
  replies?: Comment[];
  [key: string]: any;
}

// Интерфейс для анализа тональности
interface SentimentAnalysis {
  sentiment?: string;
  score?: number;
  confidence?: number;
  overall_sentiment?: string;
  average_score?: number;
  emoji?: string;
  total_trends?: number;
  analyzed_trends?: number;
  positive_percentage?: number;
  negative_percentage?: number;
  neutral_percentage?: number;
  analyzed_at?: string;
  details?: {
    positive?: number;
    negative?: number;
    neutral?: number;
  };
  summary?: string;
}

// Функция для рендеринга простого Markdown форматирования
function renderMarkdownText(text: string | Analysis | null | undefined): React.ReactNode {
  if (!text) return null;

  // Обрабатываем разные типы данных
  let stringText: string = '';
  let analysisObject: Analysis | null = null;

  if (typeof text === 'string') {
    // Пытаемся парсить JSON строку
    try {
      analysisObject = JSON.parse(text);
    } catch (e) {
      stringText = text;
    }
  } else if (typeof text === 'object' && text !== null) {
    analysisObject = text;
  } else {
    stringText = String(text);
  }

  // Если у нас есть объект анализа, обрабатываем его
  if (analysisObject) {
    const analysisFields = {
      'характеристики_аудитории': 'Характеристики аудитории',
      'поведение_и_вовлеченность': 'Поведение и вовлеченность',
      'популярные_темы': 'Популярные темы',
      'настроение': 'Настроение',
      'экспертность': 'Экспертность',
      'общие_тенденции': 'Общие тенденции'
    };

    const parts = [];
    for (const [key, title] of Object.entries(analysisFields)) {
      if (analysisObject[key]) {
        parts.push(`**${title}:**\n${analysisObject[key]}`);
      }
    }

    if (parts.length > 0) {
      stringText = parts.join('\n\n');
    } else if (analysisObject.detailed_summary) {
      stringText = analysisObject.detailed_summary;
    } else if (analysisObject.summary) {
      stringText = analysisObject.summary;
    } else {
      stringText = 'Данные анализа недоступны в читаемом формате';
    }
  }

  // Если получился [object Object], возвращаем простое сообщение
  if (stringText === '[object Object]') {
    return <div className="text-gray-500 dark:text-gray-400 italic">Данные анализа недоступны</div>;
  }

  // Разбиваем на части по переносам строк
  const lines = stringText.split('\n');

  return (
    <div className="space-y-2">
      {lines.map((line, index) => {
        if (!line.trim()) {
          return <br key={index} />;
        }

        // Заменяем **текст** на жирный текст
        const parts = line.split(/(\*\*[^*]+\*\*)/g);

        return (
          <div key={index}>
            {parts.map((part, partIndex) => {
              if (part.startsWith('**') && part.endsWith('**')) {
                const boldText = part.slice(2, -2);
                return <strong key={partIndex} className="font-semibold text-purple-800 dark:text-purple-200">{boldText}</strong>;
              }
              return <span key={partIndex}>{part}</span>;
            })}
          </div>
        );
      })}
    </div>
  );
}

interface Campaign {
  id: string;
  name: string;
  description: string;
  link: string | null;
  created_at: string;
  updated_at: string;
}

interface ContentSource {
  id: string;
  name: string;
  url: string;
  type: string;
  is_active: boolean;
  campaign_id: string;
  created_at: string;
  status: string | null;
  description?: string;
  sentiment_analysis?: SentimentAnalysis;
}

interface TrendTopic {
  id: string;
  title: string;
  source_id?: string;  // Версия с подчеркиванием (snake_case)
  sourceId?: string;   // Версия в camelCase
  sourceName?: string; // Имя источника, может приходить напрямую от API
  sourceUrl?: string;  // URL источника (аккаунта или страницы)
  url?: string;        // URL оригинальной публикации
  reactions: number;
  comments: number;
  views: number;
  created_at?: string; // Версия с подчеркиванием (snake_case)
  createdAt?: string;  // Версия в camelCase
  is_bookmarked?: boolean; // Версия с подчеркиванием (snake_case)
  isBookmarked?: boolean;  // Версия в camelCase
  campaign_id?: string;    // Версия с подчеркиванием (snake_case)
  campaignId?: string;     // Версия в camelCase
  media_links?: string;    // JSON строка с медиа-данными
  mediaLinks?: string;     // Альтернативное имя поля
  description?: string;    // Описание или контент тренда
  accountUrl?: string;     // URL аккаунта источника
  urlPost?: string;        // URL оригинального поста
  sourceDescription?: string; // Описание источника
  trendScore?: number;     // Оценка тренда
  sentiment_analysis?: SentimentAnalysis; // Данные анализа тональности
}

interface SourcePost {
  id: string;
  post_content: string | null;
  image_url: string | null;
  likes: number | null;
  views: number | null;
  comments: number | null;
  shares: number | null;
  source_id: string;
  campaign_id: string;
  url: string | null;
  link: string | null;
  post_type: string | null;
  video_url: string | null;
  date: string | null;
  metadata: Record<string, unknown> | null;
}

type Period = "3days" | "7days" | "14days" | "30days" | "all";

const isValidPeriod = (period: string): period is Period => {
  return ['3days', '7days', '14days', '30days'].includes(period);
};


// Функция форматирования относительного времени (например, "2 часа назад")
const formatRelativeTime = (date: Date): string => {
  try {
    return formatDistanceToNow(date, {
      addSuffix: true,
      locale: ru
    });
  } catch (error) {
    console.error('Error formatting date:', error);
    return 'Н/Д';
  }
};

export default function Trends() {
  const { t, i18n } = useTranslation();
  const [selectedPeriod, setSelectedPeriod] = useState<Period>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSearchingNewSources, setIsSearchingNewSources] = useState(false);
  const [foundSourcesData, setFoundSourcesData] = useState<{
    success: boolean;
    data: {
      sources: {
        url: string;
        name: string;
        followers: number;
        platform: string;
        description: string;
        rank: number;
      }[];
    };
  } | null>(null);
  const [selectedTopics, setSelectedTopics] = useState<TrendTopic[]>([]);

  // Состояния для сортировки
  type SortField = 'reactions' | 'comments' | 'views' | 'trendScore' | 'date' | 'platform' | 'none';
  const [sortField, setSortField] = useState<SortField>('none');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Состояние для фильтра по соцсетям
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  // Используем глобальный стор кампаний
  const { selectedCampaign } = useCampaignStore();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(selectedCampaign?.id || "");

  const [activeTab, setActiveTab] = useState('trends');
  const [isSocialNetworkDialogOpen, setIsSocialNetworkDialogOpen] = useState(false);
  const [isSourceSearchDialogOpen, setIsSourceSearchDialogOpen] = useState(false);
  const [isBulkImportDialogOpen, setIsBulkImportDialogOpen] = useState(false);
  const [isSourceCollectionDialogOpen, setIsSourceCollectionDialogOpen] = useState(false);
  const [isSuggestingChannels, setIsSuggestingChannels] = useState(false);
  const [suggestLimit, setSuggestLimit] = useState(30);
  const [tgstatSearchQuery, setTgstatSearchQuery] = useState('');
  const [hiddenTrendIds, setHiddenTrendIds] = useState<Set<string>>(new Set());
  const [selectedTrendTopic, setSelectedTrendTopic] = useState<TrendTopic | null>(null);
  const [previewTrendTopic, setPreviewTrendTopic] = useState<TrendTopic | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Состояния для комментариев
  const [trendComments, setTrendComments] = useState<Comment[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [collectingCommentsForTrend, setCollectingCommentsForTrend] = useState<string | null>(null);

  // Состояние для анализа настроения
  const [sentimentData, setSentimentData] = useState<SentimentAnalysis | null>(null);
  const [isAnalyzingSentiment, setIsAnalyzingSentiment] = useState(false);



  // Состояние для результатов анализа комментариев
  const [commentsAnalysisData, setCommentsAnalysisData] = useState<{
    trend_level?: Analysis;
    source_level?: Analysis;
  }>({});

  // Состояние для анализа источников
  const [sourceAnalysisData, setSourceAnalysisData] = useState<{
    [sourceId: string]: {
      sentiment: string;
      confidence: number;
      summary: string;
    }
  }>({});
  const [analyzingSourceId, setAnalyzingSourceId] = useState<string | null>(null);

  // Состояние для отображения детального анализа источника
  const [selectedSourceForAnalysis, setSelectedSourceForAnalysis] = useState<string | null>(null);

  // Состояние для выбора источников для массового сбора комментариев
  const [selectedSourcesForComments, setSelectedSourcesForComments] = useState<Set<string>>(new Set());
  const [isCollectingBulkComments, setIsCollectingBulkComments] = useState(false);
  const [isCollectingTrendComments, setIsCollectingTrendComments] = useState(false);
  const [sourcesPollingFast, setSourcesPollingFast] = useState(false);

  // Состояние для выбора трендов для массового сбора комментариев
  const [selectedTrendsForComments, setSelectedTrendsForComments] = useState<Set<string>>(new Set());
  const commentsRequestIdRef = useRef(0);


  const isValidCampaignSelected = selectedCampaignId &&
    selectedCampaignId !== "loading" &&
    selectedCampaignId !== "empty";

  // --- ЗАПРОСЫ ДАННЫХ (Перенесены вверх для предотвращения ReferenceError) ---

  const { data: userDataResponse, isLoading: isLoadingUser } = useQuery({
    queryKey: ["/api/proxy/me"],
    queryFn: () => api.user.me()
  });

  const userData = userDataResponse?.data;

  const { data: campaignsResponse, isLoading: isLoadingCampaigns } = useQuery<{ data: Campaign[] }>({
    queryKey: ["/api/proxy/campaigns", userData?.id],
    queryFn: () => api.campaigns.listForUser(),
    enabled: Boolean(userData?.id),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: false
  });

  const campaigns = campaignsResponse?.data || [];
  const campaign = campaigns.find((c: any) => c.id === selectedCampaignId);

  const { data: sourcesResponse, isLoading: isLoadingSources } = useQuery<{ data: ContentSource[] }>({
    queryKey: ["/api/proxy/sources", selectedCampaignId],
    queryFn: async () => {
      if (!selectedCampaignId) return { data: [] };

      try {
        const response = await api.sources.list(selectedCampaignId);
        return response;
      } catch (error) {
        console.error("Error fetching sources:", error);
        return { data: [] };
      }
    },
    enabled: !!selectedCampaignId,
    refetchInterval: sourcesPollingFast ? 5000 : 30000,
    retry: 1
  });

  const sources = sourcesResponse?.data || [];

  const { data: trends = [], isLoading: isLoadingTrends, isError: isTrendsError, error: trendsError } = useQuery({
    queryKey: ["trends", selectedPeriod, selectedCampaignId],
    staleTime: 0, // Принудительно загружаем свежие данные
    gcTime: 0, // Не кэшируем данные
    queryFn: async () => {
      if (!selectedCampaignId) return [];

      const authToken = localStorage.getItem('auth_token');
      if (!authToken) {
        throw new Error(t("trends.toasts.authRequired"));
      }

      // Используем наш собственный API эндпоинт вместо прямого обращения к Directus
      const response = await fetch(`/api/campaign-trends?campaignId=${selectedCampaignId}&period=${selectedPeriod}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (!response.ok) {
        console.error("Error fetching trends:", response.status, response.statusText);
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to fetch trends");
      }

      const data = await response.json();
      console.log("Fetched trends data:", data);

      const processedTrends = (data.data || []).map((trend: any) => {
        const rawSourceId = trend.source_id || trend.sourceId;
        const normalizedSourceId = typeof rawSourceId === 'object' && rawSourceId !== null
          ? (rawSourceId.id || rawSourceId.key || String(rawSourceId))
          : rawSourceId ? String(rawSourceId) : '';
        return {
          ...trend,
          source_id: normalizedSourceId,
          sourceId: normalizedSourceId,
          url: trend.urlPost || trend.url_post || trend.url || trend.original_url || trend.originalUrl,
          sourceUrl: trend.sourceUrl || trend.source_url || trend.source?.url,
          sourceType: trend.sourceType || trend.source_type || '',
        };
      });

      // Для периода "all" возвращаем все данные без дополнительной фильтрации
      if (selectedPeriod === 'all') {
        return processedTrends;
      }

      // Фильтруем тренды по выбранному периоду на клиентской стороне
      const now = new Date();
      const filterDate = new Date();

      switch (selectedPeriod) {
        case '3days':
          filterDate.setDate(now.getDate() - 3);
          break;
        case '7days':
          filterDate.setDate(now.getDate() - 7);
          break;
        case '14days':
          filterDate.setDate(now.getDate() - 14);
          break;
        case '30days':
          filterDate.setDate(now.getDate() - 30);
          break;
        default:
          return processedTrends; // Для неизвестных периодов возвращаем все данные
      }

      // Фильтруем тренды по дате
      const filteredTrends = processedTrends.filter((trend: any) => {
        if (!trend.created_at && !trend.createdAt) return true; // Показываем тренды без даты

        const trendDate = new Date(trend.created_at || trend.createdAt);
        return trendDate >= filterDate;
      });

      return filteredTrends;
    },
    enabled: !!selectedCampaignId
  });


  // Состояния для сворачивания/разворачивания секций
  const [isDataSourcesExpanded, setIsDataSourcesExpanded] = useState(false); // По умолчанию свернута
  const [isTrendsExpanded, setIsTrendsExpanded] = useState(false); // По умолчанию свернута
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null); // Выбранный источник для фильтрации трендов (НЕ влияет на отображение трендов)

  const [selectedKeyword, setSelectedKeyword] = useState<string>("");

  // Вычисляем отфильтрованные и отсортированные тренды
  const filteredTrends = useMemo(() => {
    if (!trends || !Array.isArray(trends)) return [];

    return trends
      .filter((topic: TrendTopic) => {
        const sourceType = (topic as any).sourceType || (topic as any).source_type || '';
        if (sourceType.toString().startsWith('AI:')) return false;

        if (selectedSourceId) {
          const trendSourceId = (topic as any).sourceId || (topic as any).source_id || '';
          const trendSourceIdStr = typeof trendSourceId === 'object' ? (trendSourceId?.id || trendSourceId?.key || JSON.stringify(trendSourceId)) : String(trendSourceId);
          if (trendSourceIdStr !== String(selectedSourceId)) return false;
        }

        const platform = detectPlatform((topic as any).sourceType || (topic as any).source_type || '');
        const matchesSearch = topic.title.toLowerCase().includes(searchQuery.toLowerCase());

        let platformMatches = false;
        if (selectedPlatform === 'all') {
          platformMatches = true;
        } else {
          platformMatches = platform === selectedPlatform;
        }

        return matchesSearch && platformMatches;
      })
      .sort((a: TrendTopic, b: TrendTopic) => {
        if (sortField === 'none') return 0;

        let valueA: any, valueB: any;
        switch (sortField) {
          case 'reactions': valueA = a.reactions || 0; valueB = b.reactions || 0; break;
          case 'comments': valueA = a.comments || 0; valueB = b.comments || 0; break;
          case 'views': valueA = a.views || 0; valueB = b.views || 0; break;
          case 'trendScore': valueA = a.trendScore || 0; valueB = b.trendScore || 0; break;
          case 'date':
            valueA = new Date(a.created_at || a.createdAt || 0).getTime();
            valueB = new Date(b.created_at || b.createdAt || 0).getTime();
            break;
          case 'platform':
            valueA = detectPlatform((a as any).sourceType || '');
            valueB = detectPlatform((b as any).sourceType || '');
            break;
          default: return 0;
        }

        if (valueA < valueB) return sortDirection === 'asc' ? -1 : 1;
        if (valueA > valueB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
  }, [trends, searchQuery, selectedPlatform, sortField, sortDirection, selectedSourceId]);

  // Refs для автоматического скролла к элементам
  const sourcesRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const sourcesContainerRef = useRef<HTMLDivElement | null>(null);

  // Функция syncTrendWithSource ОТКЛЮЧЕНА - пользователь управляет выбором источников вручную
  const syncTrendWithSource = (trendTopic: TrendTopic) => {
    // Функция оставлена пустой для обратной совместимости
    // Раньше автоматически выбирала источник тренда, разворачивала секцию и скроллила
    // Теперь пользователь сам выбирает источник при необходимости
  };

  // Загрузка состояния из localStorage при инициализации
  useEffect(() => {
    const savedDataSourcesExpanded = localStorage.getItem('trends_data_sources_expanded');
    const savedTrendsExpanded = localStorage.getItem('trends_trends_expanded');
    // НЕ восстанавливаем selectedSourceId - пользователь сам выбирает фильтр при необходимости

    if (savedDataSourcesExpanded !== null) {
      setIsDataSourcesExpanded(JSON.parse(savedDataSourcesExpanded));
    }
    if (savedTrendsExpanded !== null) {
      setIsTrendsExpanded(JSON.parse(savedTrendsExpanded));
    }
    // Очищаем сохраненный фильтр источника при каждой загрузке
    localStorage.removeItem('trends_selected_source_id');
  }, []);

  // Сохранение состояния в localStorage при изменении
  useEffect(() => {
    localStorage.setItem('trends_data_sources_expanded', JSON.stringify(isDataSourcesExpanded));
  }, [isDataSourcesExpanded]);

  useEffect(() => {
    localStorage.setItem('trends_trends_expanded', JSON.stringify(isTrendsExpanded));
  }, [isTrendsExpanded]);

  // НЕ сохраняем selectedSourceId в localStorage
  // Фильтр источника сбрасывается при каждой загрузке страницы
  // useEffect(() => {
  //   localStorage.setItem('trends_selected_source_id', selectedSourceId || 'null');
  // }, [selectedSourceId]);

  // useEffect для автовыбора источника ОТКЛЮЧЕН
  // Раньше автоматически устанавливал selectedSourceId из selectedTrendTopic
  // Теперь пользователь сам управляет фильтром источников

  // Функция для загрузки комментариев выбранного тренда
  const loadTrendComments = async (trendId: string) => {
    const requestId = ++commentsRequestIdRef.current;
    try {
      setIsLoadingComments(true);
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) {
        throw new Error(t("trends.toasts.authRequired"));
      }

      const response = await fetch(`/api/trend-comments/${trendId}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (requestId !== commentsRequestIdRef.current) return;

      if (response.ok) {
        const data = await response.json();
        setTrendComments(data.data || []);
      } else {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || t("trends.toasts.loadCommentsError"));
      }
    } catch (error) {
      if (requestId !== commentsRequestIdRef.current) return;
      console.error('Error loading trend comments:', error);
      setTrendComments([]);
      toast({
        variant: "destructive",
        title: t('trends.toasts.loadCommentsError'),
        description: (error as Error).message || t('trends.toasts.loadCommentsErrorDesc')
      });
    } finally {
      if (requestId === commentsRequestIdRef.current) {
        setIsLoadingComments(false);
      }
    }
  };

  // Функция для сбора комментариев к тренду
  const collectTrendComments = async (trendId: string, trendUrl: string) => {
    try {
      setCollectingCommentsForTrend(trendId);

      const authToken = localStorage.getItem('auth_token');
      if (!authToken) {
        throw new Error(t("trends.toasts.authRequired"));
      }

      const response = await fetch('/api/trends/collect-comments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          trendIds: [trendId],
          campaignId: selectedCampaignId
        })
      });

      if (response.ok) {
        toast({
          title: t('trends.toasts.collectingStarted'),
          description: t('trends.toasts.collectingStartedDesc'),
        });

        // Автоматически проверяем комментарии через интервалы


        // Если тренд выбран - сразу загружаем комментарии
        if (selectedTrendTopic?.id === trendId) {

          loadTrendComments(trendId);
        }

        // Проверяем комментарии несколько раз через интервалы
        const checkIntervals = [5000, 15000, 30000]; // 5, 15, 30 секунд

        checkIntervals.forEach((delay, index) => {
          setTimeout(() => {
            // Если этот тренд сейчас выбран - загружаем комментарии
            if (selectedTrendTopic?.id === trendId) {
              loadTrendComments(trendId);

            } else {

            }
          }, delay);
        });
      } else {
        throw new Error('Failed to start comment collection');
      }
    } catch (error) {
      toast({
        title: t('trends.toasts.collectCommentsError'),
        description: t('trends.toasts.collectCommentsErrorDesc'),
        variant: "destructive",
      });
    } finally {
      setCollectingCommentsForTrend(null);
    }
  };


  // Мутация для анализа комментариев
  const analyzeCommentsMutation = useMutation({
    mutationFn: async ({ trendId, level }: { trendId: string, level: 'trend' | 'source' }) => {
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) {
        throw new Error(t("trends.toasts.authRequired"));
      }

      const response = await fetch('/api/analyze-comments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          trendId,
          level,
          campaignId: selectedCampaignId
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || t('trends.toasts.analysisError'));
      }

      return await response.json();
    },
    onSuccess: (data, { level }) => {
      toast({
        title: t('trends.toasts.analysisDone'),
        description: t('trends.toasts.analysisDoneDesc', { level: level === 'trend' ? t('trends.toasts.levelTrend') : t('trends.toasts.levelSource') }),
      });

      // Сохраняем результаты анализа в состояние
      setCommentsAnalysisData(prev => ({
        ...prev,
        [level + '_level']: data.data?.analysis
      }));

      // Перезагружаем комментарии для обновления данных
      if (selectedTrendTopic) {
        loadTrendComments(selectedTrendTopic.id);
      }

      // Обновляем данные трендов для получения новой аналитики
      queryClient.invalidateQueries({ queryKey: ["trends", selectedPeriod, selectedCampaignId] });
    },
    onError: (error: any) => {
      console.error('Ошибка анализа комментариев:', error);
      toast({
        title: t('trends.toasts.analysisError'),
        description: error.message || t('trends.toasts.analysisErrorDesc'),
        variant: "destructive",
      });
    }
  });

  // Обновляем локальный ID кампании когда меняется глобальный выбор
  useEffect(() => {
    if (selectedCampaign?.id) {
      setSelectedCampaignId(selectedCampaign.id);
      // Принудительно обновляем данные трендов для получения sentiment_analysis
      queryClient.invalidateQueries({ queryKey: ["trends"] });
    }
  }, [selectedCampaign, queryClient]);

  // Загрузка существующего анализа настроения для тренда из кэшированных данных
  const loadExistingSentimentAnalysis = (selectedTrend: TrendTopic | null) => {
    if (selectedTrend && (selectedTrend as any).sentiment_analysis) {
      setSentimentData((selectedTrend as any).sentiment_analysis);

      // Проверяем наличие многоуровневого анализа комментариев в sentiment_analysis
      const sentimentAnalysis = (selectedTrend as any).sentiment_analysis;
      if (sentimentAnalysis && (sentimentAnalysis.trend_level || sentimentAnalysis.source_level)) {
        setCommentsAnalysisData({
          trend_level: sentimentAnalysis.trend_level,
          source_level: sentimentAnalysis.source_level
        });
      } else {
        setCommentsAnalysisData({});
      }
    } else {
      setSentimentData(null);
      setCommentsAnalysisData({});
    }
  };

  useEffect(() => {
    if (selectedTrendTopic) {
      loadTrendComments(selectedTrendTopic.id);
      loadExistingSentimentAnalysis(selectedTrendTopic);
    } else {
      setTrendComments([]);
      setSentimentData(null);
    }
  }, [selectedTrendTopic]);

  // Функции для работы с выбором всех трендов
  const selectAllVisibleTrends = () => {
    setSelectedTopics(filteredTrends);
  };

  const deselectAllTrends = () => {
    setSelectedTopics([]);
  };

  const areAllVisibleTrendsSelected = () => {
    return filteredTrends.length > 0 && filteredTrends.every((trend: any) =>
      selectedTopics.some(t => t.id === trend.id)
    );
  };



  // --- ФУНКЦИИ МАССОВЫХ ДЕЙСТВИЙ ---

  // Функция для массового сбора комментариев для выбранных источников
  const collectBulkComments = async () => {
    if (selectedSourcesForComments.size === 0) {
      toast({
        variant: "destructive",
        title: t('trends.toasts.error'),
        description: t('trends.toasts.selectAtLeastOneSource')
      });
      return;
    }

    if (!selectedCampaignId) {
      toast({
        variant: "destructive",
        title: t('trends.toasts.error'),
        description: t('trends.toasts.selectCampaign')
      });
      return;
    }

    setIsCollectingBulkComments(true);
    const authToken = localStorage.getItem('auth_token');

    try {
      // Получаем все тренды для выбранных источников
      const selectedSourcesList = Array.from(selectedSourcesForComments);
      const sourceTrends = trends.filter((trend: TrendTopic) =>
        selectedSourcesList.includes(trend.sourceId || trend.source_id || '')
      );

      if (sourceTrends.length === 0) {
        toast({
          variant: "destructive",
          title: t('trends.toasts.noTrends'),
          description: t('trends.toasts.noTrendsForSources')
        });
        return;
      }

      toast({
        title: t('trends.toasts.launchingCollection'),
        description: t('trends.toasts.launchingCollectionDesc', { trends: sourceTrends.length, sources: selectedSourcesList.length })
      });

      // Собираем все ID трендов и отправляем одним запросом
      const trendIds = sourceTrends.map((trend: TrendTopic) => trend.id);


      try {
        const response = await fetch('/api/trends/collect-comments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({
            trendIds,
            campaignId: selectedCampaignId
          })
        });

        const responseData = await response.json();

        if (response.ok) {
          const successCount = responseData.data?.successCount || 0;
          const errorCount = responseData.data?.errorCount || 0;

        } else {

          throw new Error(responseData.message || 'API error');
        }
      } catch (error) {

        throw error;
      }

      toast({
        title: t('trends.toasts.collectingDone'),
        description: t('trends.toasts.collectingDoneDesc', { count: trendIds.length })
      });

      // Обновляем данные трендов
      queryClient.invalidateQueries({ queryKey: ["trends"] });

    } catch (error) {
      console.error('Ошибка массового сбора комментариев:', error);
      toast({
        variant: "destructive",
        title: t('trends.toasts.error'),
        description: t('trends.toasts.bulkCollectError')
      });
    } finally {
      setIsCollectingBulkComments(false);
    }
  }

  // Функция для массового сбора комментариев для выбранных трендов
  const collectSelectedTrendsComments = async () => {
    if (selectedTopics.length === 0) {
      toast({
        variant: "destructive",
        title: t('trends.toasts.error'),
        description: t('trends.toasts.selectAtLeastOneTrend')
      });
      return;
    }

    if (!selectedCampaignId) {
      toast({
        variant: "destructive",
        title: t('trends.toasts.error'),
        description: t('trends.toasts.selectCampaign')
      });
      return;
    }

    setIsCollectingTrendComments(true);
    const authToken = localStorage.getItem('auth_token');

    try {
      toast({
        title: t('trends.toasts.launchingCollection'),
        description: t('trends.toasts.launchingCollectionTrendsDesc', { count: selectedTopics.length })
      });

      // Собираем все ID выбранных трендов и отправляем запрос с campaignId
      const trendIds = selectedTopics.map(trend => trend.id);


      const response = await fetch('/api/trends/collect-comments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          trendIds,
          campaignId: selectedCampaignId
        })
      });

      const responseData = await response.json();

      if (response.ok) {
        const successCount = responseData.data?.successCount || 0;
        const errorCount = responseData.data?.errorCount || 0;


        toast({
          title: t('trends.toasts.collectingDone'),
          description: t('trends.toasts.collectingDoneDescTrends', { count: trendIds.length })
        });
      } else {

        throw new Error(responseData.message || 'API error');
      }

      // Обновляем данные трендов
      queryClient.invalidateQueries({ queryKey: ["trends"] });

    } catch (error) {

      toast({
        variant: "destructive",
        title: t('trends.toasts.error'),
        description: t('trends.toasts.bulkCollectError')
      });
    } finally {
      setIsCollectingTrendComments(false);
    }
  }

  // Функции для работы с выбором источников
  const toggleSourceSelection = (sourceId: string) => {
    setSelectedSourcesForComments(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sourceId)) {
        newSet.delete(sourceId);
      } else {
        newSet.add(sourceId);
      }
      return newSet;
    });
  };

  const selectAllSources = () => {
    if (selectedSourcesForComments.size === sources.length) {
      // Если все выбраны, снимаем выбор
      setSelectedSourcesForComments(new Set());
    } else {
      // Выбираем все источники
      setSelectedSourcesForComments(new Set(sources.map(s => s.id)));
    }
  };


  const { mutate: searchNewSourcesExecute, isPending: isSearching } = useMutation({
    mutationFn: async (params: { keyword: string; platforms: string[]; customPrompt?: string }) => {
      if (!selectedCampaignId) {
        throw new Error(t("trends.toasts.selectCampaign"));
      }

      const authToken = localStorage.getItem('auth_token');
      if (!authToken) {
        throw new Error(t("trends.toasts.authRequired"));
      }

      try {
        const res = await fetch('/api/sources/collect', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({
            keywords: [params.keyword],
            platforms: params.platforms,
            customPrompt: params.customPrompt
          })
        });

        // Проверяем тип контента
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          return res.json();
        } else {
          console.error(`Неверный тип контента для ключевого слова ${params.keyword}:`, contentType);
          const text = await res.text();
          console.error('Полученный ответ:', text.substring(0, 200) + '...');
          throw new Error(t('trends.toasts.invalidResponseFormat', { keyword: params.keyword }));
        }
      } catch (error) {
        console.error(`Ошибка при поиске источников для ключевого слова "${params.keyword}":`, error);
        throw error;
      }
    },
    onSuccess: (data) => {

      setFoundSourcesData(data);
      setIsSearchingNewSources(true);
      toast({
        title: t('trends.toasts.sourcesFound'),
        description: t('trends.toasts.sourcesFoundDesc', { count: data.data.sources.length })
      });
    },
    onError: (error: Error) => {
      console.error('Search Error:', error);
      toast({
        variant: "destructive",
        title: t('trends.toasts.error'),
        description: error.message
      });
    }
  });

  // Функция, открывающая диалог выбора платформ для поиска
  const searchNewSources = () => {
    if (!selectedCampaignId) {
      toast({
        variant: "destructive",
        title: t('trends.toasts.error'),
        description: t('trends.toasts.selectCampaign')
      });
      return;
    }

    if (!keywords?.length) {
      toast({
        variant: "destructive",
        title: t('trends.toasts.error'),
        description: t('trends.toasts.addKeywords')
      });
      return;
    }

    // Выбираем случайное ключевое слово из списка
    const randomIndex = Math.floor(Math.random() * keywords.length);
    const keyword = keywords[randomIndex]?.keyword || "";
    setSelectedKeyword(keyword);

    // Открываем диалог выбора платформ
    setIsSourceSearchDialogOpen(true);
  };

  // Запрос для получения постов из источников
  const { data: sourcePostsResponse, isLoading: isLoadingSourcePosts } = useQuery<{ data: SourcePost[] }>({
    queryKey: ['/api/proxy/trends', selectedCampaignId, selectedPeriod],
    queryFn: async () => {
      if (!selectedCampaignId) return { data: [] };

      try {
        let dateFrom: string | undefined;
        if (isValidPeriod(selectedPeriod)) {
          const from = new Date();
          switch (selectedPeriod) {
            case '3days':
              from.setDate(from.getDate() - 3);
              break;
            case '14days':
              from.setDate(from.getDate() - 14);
              break;
            case '30days':
              from.setDate(from.getDate() - 30);
              break;
            default: // '7days'
              from.setDate(from.getDate() - 7);
          }
          dateFrom = from.toISOString();
        }

        return api.trends.list(selectedCampaignId, {
          date_from: dateFrom,
          limit: 50
        });
      } catch (error) {
        console.error("Error fetching source posts:", error);
        toast({
          variant: "destructive",
          description: t('trends.toasts.loadSourcePostsError')
        });
        return { data: [] };
      }
    },
    enabled: !!selectedCampaignId,
    retry: 1,
    staleTime: 1000 * 60 * 5
  });

  const sourcePosts = sourcePostsResponse?.data || [];


  const { mutate: collectTrendsWithPlatforms, isPending: isCollecting } = useMutation({
    mutationFn: async ({ platforms, collectSources, collectComments }: { platforms: string[], collectSources?: boolean, collectComments?: string[] }) => {
      if (!selectedCampaignId) {
        throw new Error(t("trends.toasts.selectCampaign"));
      }

      if (!collectSources && selectedSourcesForComments.size === 0) {
        throw new Error(t("trends.toasts.selectAtLeastOneSource"));
      }

      if (!keywords?.length) {
        throw new Error(t("trends.toasts.addKeywords"));
      }

      const authToken = localStorage.getItem('auth_token');
      if (!authToken) {
        throw new Error(t("trends.toasts.authRequired"));
      }

      // Показываем уведомление о начале сбора сразу после валидации
      toast({
        title: t('trends.toasts.collectionStarted'),
        description: collectSources
          ? t('trends.toasts.collectionStartedSources', { withComments: collectComments && collectComments.length > 0 ? t('trends.toasts.andComments') : '' })
          : t('trends.toasts.collectionStartedTrends')
      });

      // Логика отправки данных:
      // 1. Если выбраны источники - ищем тренды в этих источниках (отправляем ID источников)
      // 2. Если источники не выбраны - ищем новые источники по ключевым словам
      let dataToSend;
      const selectedSourcesList = Array.from(selectedSourcesForComments);

      // Определяем данные для отправки

      if (collectSources) {
        const keywordsList = keywords.map((k: { keyword: string }) => k.keyword);
        dataToSend = {
          campaignId: selectedCampaignId,
          keywords: keywordsList,
          platforms: platforms,
          collectSources: true,
          collectComments: collectComments
        };
      } else if (selectedSourcesList.length > 0) {
        dataToSend = {
          campaignId: selectedCampaignId,
          sourcesList: selectedSourcesList,
          userID: authToken,
          platforms: platforms,
          collectSources: false,
          collectComments: collectComments
        };
      } else {
        const keywordsList = keywords.map((k: { keyword: string }) => k.keyword);
        dataToSend = {
          campaignId: selectedCampaignId,
          keywords: keywordsList,
          platforms: platforms,
          collectSources: false,
          collectComments: collectComments
        };
      }

      // Send request to our API endpoint which will forward to n8n webhook
      const webhookResponse = await fetch('/api/trends/collect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(dataToSend)
      });

      if (!webhookResponse.ok) {
        throw new Error(t("trends.toasts.launchCollectionError"));
      }

      const trendData = await webhookResponse.json();
      console.log('Received trend data:', trendData);

      // If the webhook returns trend posts directly, save them to the database
      if (trendData?.trendTopics && Array.isArray(trendData.trendTopics)) {
        // Save trend topics через backend proxy
        for (const topic of trendData.trendTopics) {
          await api.trends.createTopic({
            title: topic.title,
            campaign_id: selectedCampaignId,
            source_id: topic.sourceId,
            reactions: topic.reactions || 0,
            comments: topic.comments || 0,
            views: topic.views || 0,
            is_bookmarked: false
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ["trends", selectedPeriod, selectedCampaignId] });
      return trendData;
    },
    onSuccess: (data, { platforms, collectSources, collectComments }) => {
      toast({
        title: t('trends.toasts.collectionSuccess'),
        description: collectSources
          ? t('trends.toasts.collectionSuccessSources', { withComments: collectComments && collectComments.length > 0 ? t('trends.toasts.andComments') : '' })
          : t('trends.toasts.collectionSuccessTrends')
      });

      // Refresh the trend topics list и источники (делаем это только один раз)
      queryClient.invalidateQueries({ queryKey: ["trends", selectedPeriod, selectedCampaignId] });
      if (collectSources) {
        queryClient.invalidateQueries({ queryKey: ["campaign_content_sources"] });
        queryClient.invalidateQueries({ queryKey: ["/api/proxy/sources", selectedCampaignId] });
        // Keep fast polling for 2 minutes while webhook saves sources
        setTimeout(() => setSourcesPollingFast(false), 120000);
      }

      // Если запущен сбор комментариев
      if (collectComments && collectComments.length > 0) {
        console.log('🔄 Запущен сбор комментариев через основной диалог');

        if (selectedTrendTopic) {
          console.log('🔄 Выбран тренд:', selectedTrendTopic.id, '- загружаем комментарии');
          loadTrendComments(selectedTrendTopic.id);

          // Одна дополнительная проверка через 30 секунд
          setTimeout(() => {
            if (selectedTrendTopic) {
              loadTrendComments(selectedTrendTopic.id);
              console.log(`🔄 Повторная проверка комментариев для выбранного тренда ${selectedTrendTopic.id}`);
            }
          }, 30000);
        } else {
          console.log('⚠️ Тренд не выбран - комментарии будут загружены при выборе тренда');
          // Убираем немедленный совет - пользователь только что запустил сбор
          // Совет может появиться позже, если пользователь не выберет тренд в течение минуты
          setTimeout(() => {
            // Показываем совет только если есть тренды, но ни один не выбран
            if (!selectedTrendTopic && collectComments && collectComments.length > 0 && trends && trends.length > 0) {
              toast({
                title: t('trends.toasts.tip'),
                description: t('trends.toasts.tipSelectTrend')
              });
            }
          }, 60000); // 1 минута задержка
        }
      }
    },
    onError: (error: Error) => {
      console.error('Error collecting trends:', error);
      toast({
        variant: "destructive",
        title: t('trends.toasts.error'),
        description: error.message || t('trends.toasts.launchCollectionError')
      });
    }
  });

  // Функция для открытия диалога выбора социальных сетей
  const collectTrends = () => {
    setIsSocialNetworkDialogOpen(true);
  };


  // Мониторинг данных о постах из источников (только для диагностики)
  useEffect(() => {
    if (sourcePosts?.length > 0) {
      console.log("sourcePosts loaded:", sourcePosts.length, "posts");
    }
  }, [sourcePosts?.length]);





  const toggleTopicSelection = (topic: TrendTopic) => {
    setSelectedTopics(prev => {
      const isSelected = prev.some(t => t.id === topic.id);
      if (isSelected) {
        return prev.filter(t => t.id !== topic.id);
      } else {
        return [...prev, topic];
      }
    });
  };

  // Мутация для обновления статуса закладки
  const { mutate: updateTrendBookmark } = useMutation({
    mutationFn: async ({ id, isBookmarked }: { id: string, isBookmarked: boolean }) => {
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) {
        throw new Error(t("trends.toasts.authRequired"));
      }

      return await fetch(`/api/campaign-trends/${id}/bookmark`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ isBookmarked })
      }).then(response => {
        if (!response.ok) {
          return response.json().then(data => {
            throw new Error(data.message || t('trends.toasts.bookmarkError'));
          });
        }
        return response.json();
      });
    },
    onSuccess: (data) => {
      console.log('Bookmark updated:', data);

      // Обновляем данные в кеше
      queryClient.setQueryData(
        ["trends", selectedPeriod, selectedCampaignId],
        (old: TrendTopic[] | undefined) => {
          if (!old) return [];
          return old.map(topic =>
            topic.id === data.id
              ? { ...topic, is_bookmarked: data.is_bookmarked }
              : topic
          );
        }
      );

      // Обновляем выбранный тренд, если это тот же самый
      if (selectedTrendTopic && selectedTrendTopic.id === data.id) {
        setSelectedTrendTopic({
          ...selectedTrendTopic,
          is_bookmarked: data.is_bookmarked
        });
      }

      toast({
        title: data.is_bookmarked ? t('trends.toasts.bookmarkSaved') : t('trends.toasts.bookmarkRemoved'),
        description: data.is_bookmarked ? t('trends.toasts.bookmarkSavedDesc') : t('trends.toasts.bookmarkRemovedDesc'),
      });
    },
    onError: (error: Error) => {
      console.error("Error updating bookmark:", error);
      toast({
        title: t('trends.toasts.error'),
        description: error.message || t('trends.toasts.bookmarkError'),
        variant: "destructive",
      });
    }
  });

  const deleteSource = async (sourceId: string) => {
    try {
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) {
        toast({ title: t('trends.toasts.error'), description: t('trends.toasts.authRequired'), variant: "destructive" });
        return;
      }
      const response = await fetch(`/api/proxy/sources/${sourceId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'x-user-id': localStorage.getItem('user_id') || ''
        }
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || t('trends.toasts.sourceDeleteError'));
      }
      queryClient.invalidateQueries({ queryKey: ["/api/proxy/sources", selectedCampaignId] });
      toast({ title: t('trends.toasts.sourceDeleted'), description: t('trends.toasts.sourceDeletedDesc') });
    } catch (error: any) {
      console.error("Error deleting source:", error);
      toast({ title: t('trends.toasts.error'), description: error.message || t('trends.toasts.sourceDeleteError'), variant: "destructive" });
    }
  };

  // Функция для анализа источника
  const analyzeSource = async (sourceId: string, sourceName: string) => {
    try {
      setAnalyzingSourceId(sourceId);
      const authToken = localStorage.getItem('auth_token');

      const response = await fetch(`/api/sources/${sourceId}/analyze`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          campaignId: selectedCampaignId
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Результат анализа источника:', data);

        // Сохраняем результат анализа
        setSourceAnalysisData(prev => ({
          ...prev,
          [sourceId]: data.data
        }));

        // Принудительно обновляем кэш источников для отображения emoji
        queryClient.invalidateQueries({ queryKey: ["campaign_content_sources", selectedCampaignId] });
        queryClient.refetchQueries({ queryKey: ["campaign_content_sources", selectedCampaignId] });

        toast({
          title: t('trends.toasts.sourceAnalysisDone'),
          description: `${sourceName}: ${data.data.summary}`,
        });
      } else {
        const errorText = await response.text();
        console.error('Ошибка анализа источника:', response.status, errorText);
        toast({
          title: t('trends.toasts.analysisError'),
          description: t('trends.toasts.sourceAnalysisError', { status: response.status }),
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Ошибка анализа источника:', error);
      toast({
        title: t('trends.toasts.analysisError'),
        description: t('trends.toasts.connectionError', { error: (error as Error).message }),
        variant: "destructive"
      });
    } finally {
      setAnalyzingSourceId(null);
    }
  };

  // Функция для пересчета анализа настроения источника на основе трендов
  const recalculateSourceSentiment = async (sourceId: string, sourceName: string) => {
    try {
      setAnalyzingSourceId(sourceId);

      // Сначала запускаем полноценный анализ источника через backend (который собирает комментарии)
      const authToken = localStorage.getItem('auth_token');
      const response = await fetch(`/api/sources/${sourceId}/analyze`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          campaignId: selectedCampaignId
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Результат анализа источника:', data);

        // Принудительно обновляем локальные данные
        queryClient.invalidateQueries({ queryKey: ["campaign_content_sources", selectedCampaignId] });
        queryClient.refetchQueries({ queryKey: ["campaign_content_sources", selectedCampaignId] });

        toast({
          title: t('trends.toasts.sourceAnalysisDone'),
          description: `${sourceName}: ${data.data.summary}`,
        });
        return; // Выходим, так как полный анализ уже выполнен
      } else {
        console.log('Backend анализ не сработал, выполняем клиентский пересчет...');
      }

      // FALLBACK: если backend анализ не сработал, делаем клиентский пересчет существующих данных
      const sourcesTrends = trends.filter((t: TrendTopic) =>
        t.sourceId === sourceId || t.source_id === sourceId
      );
      const analyzedTrends = sourcesTrends.filter((t: TrendTopic) =>
        t.sentiment_analysis?.sentiment
      );

      if (analyzedTrends.length === 0) {
        toast({
          title: t('trends.toasts.noAnalysisData'),
          description: t('trends.toasts.noAnalysisDataDesc'),
          variant: "destructive"
        });
        return;
      }

      // Вычисляем статистику
      const positiveCount = analyzedTrends.filter((t: TrendTopic) =>
        t.sentiment_analysis?.sentiment === 'positive'
      ).length;
      const negativeCount = analyzedTrends.filter((t: TrendTopic) =>
        t.sentiment_analysis?.sentiment === 'negative'
      ).length;
      const neutralCount = analyzedTrends.filter((t: TrendTopic) =>
        t.sentiment_analysis?.sentiment === 'neutral'
      ).length;

      const totalTrends = analyzedTrends.length;
      const positivePercentage = (positiveCount / totalTrends) * 100;
      const negativePercentage = (negativeCount / totalTrends) * 100;
      const neutralPercentage = (neutralCount / totalTrends) * 100;

      // Определяем общее настроение
      const maxCount = Math.max(positiveCount, negativeCount, neutralCount);
      let overallSentiment = 'neutral';
      let emoji = '😐';
      if (maxCount === positiveCount) {
        overallSentiment = 'positive';
        emoji = '😊';
      } else if (maxCount === negativeCount) {
        overallSentiment = 'negative';
        emoji = '😞';
      }

      // Вычисляем средний score (если есть)
      const scoresWithValues = analyzedTrends
        .map((t: TrendTopic) => t.sentiment_analysis?.score)
        .filter((score: number | undefined): score is number => score !== undefined && score !== null);

      const averageScore = scoresWithValues.length > 0
        ? scoresWithValues.reduce((sum: number, score: number) => sum + score, 0) / scoresWithValues.length
        : 5; // Дефолтный средний score

      // Создаем объект анализа источника
      const analysisData = {
        total_trends: sourcesTrends.length,
        analyzed_trends: analyzedTrends.length,
        positive_percentage: Math.round(positivePercentage),
        negative_percentage: Math.round(negativePercentage),
        neutral_percentage: Math.round(neutralPercentage),
        overall_sentiment: overallSentiment,
        average_score: Math.round(averageScore * 10) / 10,
        emoji: emoji,
        analyzed_at: new Date().toISOString()
      };

      // Сохраняем анализ источника
      const updateResponse = await fetch(`/api/sources/${sourceId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sentiment_analysis: analysisData
        })
      });

      if (updateResponse.ok) {
        // Обновляем кэш источников
        queryClient.invalidateQueries({ queryKey: ["campaign_content_sources", selectedCampaignId] });

        toast({
          title: t('trends.toasts.sourceAnalysisDone'),
          description: `${sourceName}: ${overallSentiment === 'positive' ? t('trends.sentimentAnalysis.positiveSentiment') : overallSentiment === 'negative' ? t('trends.sentimentAnalysis.negativeSentiment') : t('trends.sentimentAnalysis.neutralSentiment')} ${t('trends.toasts.sentimentSuffix')}`,
        });
      } else {
        throw new Error(t('trends.toasts.sourceAnalysisError'));
      }
    } catch (error) {
      console.error('Ошибка анализа источника:', error);
      toast({
        title: t('trends.toasts.analysisError'),
        description: t('trends.toasts.connectionError', { error: (error as Error).message }),
        variant: "destructive"
      });
    } finally {
      setAnalyzingSourceId(null);
    }
  };



  // Функция автоподбора каналов из каталога TGStat по ключевым словам
  const suggestChannelsFromCatalog = async () => {
    if (!selectedCampaignId) return;

    setIsSuggestingChannels(true);
    toast({
      title: t('trends.toasts.suggestingChannels'),
      description: tgstatSearchQuery.trim()
        ? t('trends.toasts.suggestingChannelsQuery', { query: tgstatSearchQuery.trim() })
        : t('trends.toasts.suggestingChannelsKeywords'),
    });

    const pollInterval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['/api/proxy/sources'] });
    }, 2000);

    try {
      const authToken = localStorage.getItem('auth_token');
      const body: Record<string, any> = { limit: suggestLimit, addToSources: true };
      if (tgstatSearchQuery.trim()) {
        body.query = tgstatSearchQuery.trim();
      }

      const response = await fetch(`/api/campaigns/${selectedCampaignId}/suggest-sources`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const result = await response.json();

      if (result.success && result.data) {
        const added = result.data.added ?? 0;
        const skipped = result.data.skippedDuplicates ?? 0;
        const terms = result.data.searchTerms?.join(', ') || '';

        const totalFound = result.data.totalFound ?? 0;

        if (totalFound === 0) {
          toast({
            title: t('trends.toasts.channelsNotFound'),
            description: t('trends.toasts.channelsNotFoundDesc', { terms }),
            variant: "destructive",
          });
        } else if (added === 0 && skipped > 0) {
          toast({
            title: t('trends.toasts.channelsAlreadyAdded'),
            description: t('trends.toasts.channelsAlreadyAddedDesc', { total: totalFound, skipped, terms }),
          });
        } else {
          toast({
            title: t('trends.toasts.channelsFound'),
            description: t('trends.toasts.channelsFoundDesc', { added, skipped, terms }),
          });
        }
      } else if (!result.success) {
        toast({
          title: t('trends.toasts.channelSearchError'),
          description: result.error || t('trends.toasts.channelSearchErrorDesc'),
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Error suggesting channels:', error);
      toast({
        title: t('trends.toasts.error'),
        description: t('trends.toasts.channelSearchErrorDesc'),
        variant: "destructive"
      });
    } finally {
      clearInterval(pollInterval);
      queryClient.invalidateQueries({ queryKey: ['/api/proxy/sources'] });
      setIsSuggestingChannels(false);
    }
  };


  console.log('[Trends] Rendering state:', {
    selectedCampaignId,
    isValidCampaignSelected,
    isLoadingUser,
    isLoadingCampaigns,
    isLoadingTrends,
    trendsCount: trends?.length,
    isTrendsError
  });

  if (isLoadingUser || isLoadingCampaigns) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center bg-background pb-4">
        <div>
          <h1 className="text-2xl font-bold">{t('app.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('app.trendsDescription')}
          </p>
        </div>
        <div className="flex gap-2">
          {isValidCampaignSelected && (
            <TrendsCollection
              campaignId={selectedCampaignId}
              selectedSourcesForComments={selectedSourcesForComments}
              trendAnalysisSettings={campaign?.trend_analysis_settings || campaign?.trendAnalysisSettings}
            />
          )}
          <Button
            variant="outline"
            onClick={() => setIsSourceCollectionDialogOpen(true)}
            disabled={!isValidCampaignSelected}
          >
            <Search className="mr-2 h-4 w-4" />
            {t('sources.collectSources')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={!isValidCampaignSelected} data-testid="button-add-sources">
                <Plus className="mr-2 h-4 w-4" />
                {t('trends.page.addSources')}
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setIsDialogOpen(true)} data-testid="menu-item-manual">
                <Link2 className="mr-2 h-4 w-4" />
                {t('trends.page.addManual')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsBulkImportDialogOpen(true)} data-testid="menu-item-bulk">
                <FileText className="mr-2 h-4 w-4" />
                {t('trends.page.importList')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={isSuggestingChannels}
                data-testid="menu-item-tgstat"
                onClick={suggestChannelsFromCatalog}
              >
                {isSuggestingChannels ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Bot className="mr-2 h-4 w-4" />
                )}
                {t('trends.page.fromTGStat')}
                <span className="ml-auto text-xs text-muted-foreground">{suggestLimit}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Select
            value={String(suggestLimit)}
            onValueChange={(v) => setSuggestLimit(Number(v))}
            disabled={!isValidCampaignSelected || isSuggestingChannels}
          >
            <SelectTrigger className="h-9 w-20" data-testid="select-suggest-limit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="30">30</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {isValidCampaignSelected && (
        <div className="flex gap-2 items-center pb-4">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={tgstatSearchQuery}
            onChange={(e) => setTgstatSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isSuggestingChannels && suggestChannelsFromCatalog()}
            placeholder={t('trends.page.tgstatPlaceholder')}
            disabled={isSuggestingChannels}
            data-testid="input-tgstat-query"
            className="h-9 w-full text-sm border border-input rounded-md px-3 bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
        </div>
      )}

      <div className="space-y-6">
        {isValidCampaignSelected && (
          <div className="flex items-start gap-3 p-4 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30">
            <Globe className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                {t('trends.page.howItWorks')}
              </p>
              <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                {t('trends.page.howItWorksDesc')}
              </p>
            </div>
          </div>
        )}
        {isValidCampaignSelected && trends.length === 0 && !isLoadingTrends && (
          <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                {t('trends.page.noTrendsTitle')}
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                {t('trends.page.noTrendsDesc')}
              </p>
            </div>
          </div>
        )}

        {isValidCampaignSelected && (
          <>
            <Card className="bg-card text-card-foreground shadow-md border border-border">
              <Collapsible open={isDataSourcesExpanded} onOpenChange={setIsDataSourcesExpanded}>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <h2 className="text-lg font-semibold">{t('sources.title')}</h2>
                      {sources.length > 0 && (
                        <>
                          <Button
                            variant={selectedSourceId === null ? "default" : "outline"}
                            size="sm"
                            onClick={() => {
                              setSelectedSourceId(null);
                              setIsTrendsExpanded(true);
                            }}
                            className="h-7 px-2 text-xs"
                          >
                            {t('sources.allSources')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={selectAllSources}
                            className="h-7 px-2 text-xs"
                          >
                            {selectedSourcesForComments.size === sources.length ? t('sources.deselectAll') : t('sources.selectAll')}
                          </Button>


                        </>
                      )}
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="p-1 h-auto">
                        {isDataSourcesExpanded ?
                          <ChevronUp className="h-4 w-4" /> :
                          <ChevronDown className="h-4 w-4" />
                        }
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    {isLoadingSources ? (
                      <div className="flex justify-center p-4">
                        <Loader2 className="h-6 w-6 animate-spin" />
                      </div>
                    ) : !sources.length ? (
                      <p className="text-center text-muted-foreground">
                        {t('sources.noSources')}
                      </p>
                    ) : (
                      <div ref={sourcesContainerRef} className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                        {(() => {
                          // Логируем все дубликаты для анализа
                          const duplicates = sources.filter((source, index, array) => {
                            return array.findIndex(s => s.url === source.url) !== index;
                          });

                          if (duplicates.length > 0) {
                            console.log('⚠️ Найдены дубликаты источников:', duplicates.map(d => ({
                              id: d.id,
                              name: d.name,
                              url: d.url
                            })));
                          }

                          // Возвращаем только уникальные источники по URL
                          return sources.filter((source, index, array) => {
                            return array.findIndex(s => s.url === source.url) === index;
                          });
                        })()
                          .sort((a, b) => {
                            // Сортировка по типу источника в алфавитном порядке
                            const typeA = a.type === 'website' ? t('trends.sourceTypes.website') :
                              a.type === 'telegram' ? t('trends.sourceTypes.telegram') :
                                a.type === 'vk' ? t('trends.sourceTypes.vk') :
                                  a.type === 'instagram' ? t('trends.sourceTypes.instagram') : a.type;
                            const typeB = b.type === 'website' ? t('trends.sourceTypes.website') :
                              b.type === 'telegram' ? t('trends.sourceTypes.telegram') :
                                b.type === 'vk' ? t('trends.sourceTypes.vk') :
                                  b.type === 'instagram' ? t('trends.sourceTypes.instagram') : b.type;
                            return typeA.localeCompare(typeB);
                          })
                          .map((source) => (
                            <div
                              key={source.id}
                              data-source-id={source.id}
                              ref={(el) => {
                                if (el) {
                                  sourcesRefs.current[source.id] = el;
                                }
                              }}
                              className={`flex items-center justify-between p-2 rounded-lg border transition-colors ${selectedSourceId === source.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50 dark:hover:bg-muted/20'
                                }`}
                            >
                              <div className="flex items-center gap-2 flex-1">
                                <Checkbox
                                  checked={selectedSourcesForComments.has(source.id)}
                                  onCheckedChange={() => toggleSourceSelection(source.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="flex-shrink-0 border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                                />
                                <div
                                  className="cursor-pointer flex-1"
                                  onClick={() => {
                                    setSelectedSourceId(selectedSourceId === source.id ? null : source.id);
                                    setIsTrendsExpanded(true);
                                  }}
                                >
                                  <div>
                                    <h3 className="font-medium">{source.name}</h3>
                                    <p className="text-sm text-muted-foreground">
                                      <a
                                        href={source.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-500 hover:underline"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {source.url}
                                      </a>
                                    </p>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-sm text-muted-foreground">
                                  {source.type === 'website' ? t('trends.sourceTypes.website') :
                                    source.type === 'telegram' ? t('trends.sourceTypes.telegram') :
                                      source.type === 'vk' ? t('trends.sourceTypes.vk') :
                                        source.type === 'instagram' ? t('trends.sourceTypes.instagram') : source.type}
                                </div>

                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    analyzeSource(source.id, source.name);
                                  }}
                                  title={t('trends.sourceAnalysis.analyzeTitle')}
                                  disabled={analyzingSourceId === source.id}
                                >
                                  {analyzingSourceId === source.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : sourceAnalysisData[source.id] ? (
                                    <SentimentEmoji
                                      sentiment={{ sentiment: sourceAnalysisData[source.id].sentiment || 'unknown', score: (sourceAnalysisData[source.id] as any).score || 5, confidence: sourceAnalysisData[source.id].confidence }}
                                      className="text-lg"
                                    />
                                  ) : (() => {
                                    // Используем сохраненные данные анализа настроения источника
                                    if (source.sentiment_analysis) {
                                      // Если есть готовое emoji в данных
                                      if (source.sentiment_analysis.emoji) {
                                        return (
                                          <span
                                            className="text-lg select-none"
                                            title={`${t('trends.sourceAnalysis.overallMood')} ${source.sentiment_analysis.overall_sentiment || source.sentiment_analysis.sentiment || t('trends.sourceAnalysis.neutral')}`}
                                          >
                                            {source.sentiment_analysis.emoji}
                                          </span>
                                        );
                                      }
                                      // Используем sentiment для создания emoji  
                                      else if (source.sentiment_analysis.overall_sentiment || source.sentiment_analysis.sentiment) {
                                        return (
                                          <SentimentEmoji
                                            sentiment={{
                                              sentiment: source.sentiment_analysis.overall_sentiment || source.sentiment_analysis.sentiment || 'neutral',
                                              score: source.sentiment_analysis.score || source.sentiment_analysis.average_score || 5,
                                              confidence: source.sentiment_analysis.confidence || 0.5
                                            }}
                                            className="text-lg"
                                          />
                                        );
                                      }
                                    }

                                    return <BarChart className="h-4 w-4 text-blue-500 dark:text-blue-400" />;
                                  })()}
                                </Button>

                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteSource(source.id);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </div>
                          ))}

                      </div>
                    )}
                  </CollapsibleContent>
                </CardContent>
              </Collapsible>
            </Card>

            <Card className="bg-card text-card-foreground shadow-md border border-border">
              <Collapsible open={isTrendsExpanded} onOpenChange={setIsTrendsExpanded}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">
                      {t('trends.trendsSection.title')}{selectedSourceId ? ` - ${sources.find(s => s.id === selectedSourceId)?.name || t('trends.trendsSection.selectedSource')}` : ''}
                    </h2>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="p-1 h-auto">
                        {isTrendsExpanded ?
                          <ChevronUp className="h-4 w-4" /> :
                          <ChevronDown className="h-4 w-4" />
                        }
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    <div className="space-y-4">
                      {/* Статистика по тональности */}
                      {(() => {
                        // Получаем тренды для статистики (учитывая выбранный источник)
                        const statsData = selectedSourceId
                          ? trends.filter((t: any) => t.sourceId === selectedSourceId || t.source_id === selectedSourceId)
                          : trends;

                        // Собираем статистику по сентиментам - проверяем как анализ тренда, так и источника
                        const sourcesSentimentStats = statsData.reduce((acc: any, trend: any) => {
                          let sentiment = null;

                          // Сначала проверяем анализ на уровне тренда
                          if (trend.sentiment_analysis?.sentiment) {
                            sentiment = trend.sentiment_analysis.sentiment;
                          } else {
                            // Если нет анализа тренда, проверяем источник
                            const sourceId = trend.sourceId || trend.source_id;
                            const source = sources.find(s => s.id === sourceId);
                            if (source?.sentiment_analysis?.sentiment) {
                              sentiment = source.sentiment_analysis.sentiment;
                            }
                          }

                          switch (sentiment) {
                            case 'positive':
                              acc.positive += 1;
                              break;
                            case 'negative':
                              acc.negative += 1;
                              break;
                            case 'neutral':
                              acc.neutral += 1;
                              break;
                            default:
                              acc.unknown += 1;
                          }

                          return acc;
                        }, { positive: 0, negative: 0, neutral: 0, unknown: 0 });

                        return statsData.length > 0 && (
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                            <Card>
                              <CardContent className="p-3 text-center">
                                <div className="text-lg font-bold">{statsData.length}</div>
                                <div className="text-xs text-muted-foreground">{t('trends.stats.total')}</div>
                              </CardContent>
                            </Card>
                            <Card>
                              <CardContent className="p-3 text-center">
                                <div className="text-lg font-bold text-green-600 dark:text-green-400">
                                  {sourcesSentimentStats.positive}
                                </div>
                                <div className="text-xs text-muted-foreground">😊 {t('trends.stats.positive')}</div>
                              </CardContent>
                            </Card>
                            <Card>
                              <CardContent className="p-3 text-center">
                                <div className="text-lg font-bold text-gray-600">
                                  {sourcesSentimentStats.neutral}
                                </div>
                                <div className="text-xs text-muted-foreground">😐 {t('trends.stats.neutral')}</div>
                              </CardContent>
                            </Card>
                            <Card>
                              <CardContent className="p-3 text-center">
                                <div className="text-lg font-bold text-red-600">
                                  {sourcesSentimentStats.negative}
                                </div>
                                <div className="text-xs text-muted-foreground">😞 {t('trends.stats.negative')}</div>
                              </CardContent>
                            </Card>
                            <Card>
                              <CardContent className="p-3 text-center">
                                <div className="text-lg font-bold text-yellow-600">
                                  {sourcesSentimentStats.unknown}
                                </div>
                                <div className="text-xs text-muted-foreground">❓ {t('trends.stats.unknown')}</div>
                              </CardContent>
                            </Card>
                          </div>
                        );
                      })()}

                      <div className="border-b mb-4">
                        <div className="flex">
                          <button
                            className={`px-4 py-2 border-b-2 ${activeTab === 'trends' ? 'border-primary font-medium text-primary' : 'border-transparent text-muted-foreground'}`}
                            onClick={() => setActiveTab('trends')}
                          >
                            {t('trends.tabs.trends')}
                          </button>
                          {selectedTrendTopic && (
                            <button
                              className={`px-4 py-2 border-b-2 ${activeTab === 'comments' ? 'border-primary font-medium text-primary' : 'border-transparent text-muted-foreground'}`}
                              onClick={() => {
                                setActiveTab('comments');
                                if (selectedTrendTopic) {
                                  loadTrendComments(selectedTrendTopic.id);
                                }
                              }}
                            >
                              {t('trends.tabs.comments')}
                            </button>
                          )}
                          <button
                            className={`px-4 py-2 border-b-2 ${activeTab === 'generation' ? 'border-primary font-medium text-primary' : 'border-transparent text-muted-foreground'}`}
                            onClick={() => setActiveTab('generation')}
                            data-testid="tab-generation"
                          >
                            {t('trends.tabs.generation')}
                          </button>
                        </div>
                      </div>

                      {activeTab === 'trends' ? (
                        <>
                          <div className="flex items-center flex-wrap gap-4 mb-4">
                            <div className="flex items-center gap-2">
                              <div className="text-sm text-muted-foreground mr-1">{t('trends.filters.period')}</div>
                              <Select
                                value={selectedPeriod}
                                onValueChange={(value: Period) => setSelectedPeriod(value)}
                              >
                                <SelectTrigger className="w-[150px] bg-background text-foreground border-border">
                                  <SelectValue placeholder={t('trends.filters.periodPlaceholder')} />
                                </SelectTrigger>
                                <SelectContent className="bg-background text-foreground border-border">
                                  <SelectItem value="3days">{t('trends.filters.period3days')}</SelectItem>
                                  <SelectItem value="7days">{t('trends.filters.period7days')}</SelectItem>
                                  <SelectItem value="14days">{t('trends.filters.period14days')}</SelectItem>
                                  <SelectItem value="30days">{t('trends.filters.period30days')}</SelectItem>
                                  <SelectItem value="all">{t('trends.filters.periodAll')}</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="flex items-center gap-2">
                              <div className="text-sm text-muted-foreground mr-1">{t('trends.filters.platform')}</div>
                              <Select
                                value={selectedPlatform}
                                onValueChange={(value: string) => setSelectedPlatform(value)}
                              >
                                <SelectTrigger className="w-[150px] bg-background text-foreground border-border">
                                  <SelectValue placeholder={t('trends.filters.platformAll')} />
                                </SelectTrigger>
                                <SelectContent className="bg-background text-foreground border-border">
                                  <SelectItem value="all">{t('trends.filters.platformAll')}</SelectItem>
                                  <SelectItem value="instagram">Instagram</SelectItem>
                                  <SelectItem value="vk">VKontakte</SelectItem>
                                  <SelectItem value="telegram">Telegram</SelectItem>
                                  <SelectItem value="facebook">Facebook</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>



                            <div className="flex items-center gap-2">
                              <div className="text-sm text-muted-foreground mr-1">{t('trends.filters.sort')}</div>
                              {/* Force update - platform sorting added */}
                              <Select
                                defaultValue="none"
                                value={sortField}
                                onValueChange={(value) => setSortField(value as SortField)}
                              >
                                <SelectTrigger className="h-9 w-[180px] bg-background text-foreground border-border">
                                  <SelectValue placeholder={t('trends.filters.sortDefault')}>
                                    {sortField === 'none' && (
                                      <div className="flex items-center gap-2">
                                        <CheckCircle className="h-4 w-4 text-muted-foreground" />
                                        <span>{t('trends.filters.sortDefault')}</span>
                                      </div>
                                    )}
                                    {sortField === 'reactions' && (
                                      <div className="flex items-center gap-2">
                                        <ThumbsUp className="h-4 w-4 text-blue-500" />
                                        <span>{t('trends.filters.sortLikes')}</span>
                                      </div>
                                    )}
                                    {sortField === 'comments' && (
                                      <div className="flex items-center gap-2">
                                        <MessageSquare className="h-4 w-4 text-green-500 dark:text-green-400" />
                                        <span>{t('trends.filters.sortComments')}</span>
                                      </div>
                                    )}
                                    {sortField === 'views' && (
                                      <div className="flex items-center gap-2">
                                        <Eye className="h-4 w-4 text-purple-500" />
                                        <span>{t('trends.filters.sortViews')}</span>
                                      </div>
                                    )}
                                    {sortField === 'trendScore' && (
                                      <div className="flex items-center gap-2">
                                        <Flame className="h-4 w-4 text-orange-500" />
                                        <span>{t('trends.filters.sortTrend')}</span>
                                      </div>
                                    )}
                                    {sortField === 'date' && (
                                      <div className="flex items-center gap-2">
                                        <Clock className="h-4 w-4 text-gray-500" />
                                        <span>{t('trends.filters.sortDate')}</span>
                                      </div>
                                    )}
                                    {sortField === 'platform' && (
                                      <div className="flex items-center gap-2">
                                        <Globe className="h-4 w-4 text-indigo-500" />
                                        <span>{t('trends.filters.sortPlatform')}</span>
                                      </div>
                                    )}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent className="bg-background text-foreground border-border">
                                  <SelectItem value="none">
                                    <div className="flex items-center gap-2">
                                      <CheckCircle className="h-4 w-4 text-muted-foreground" />
                                      <span>{t('trends.filters.sortDefault')}</span>
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="reactions">
                                    <div className="flex items-center gap-2">
                                      <ThumbsUp className="h-4 w-4 text-blue-500" />
                                      <span>{t('trends.filters.sortLikes')}</span>
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="comments">
                                    <div className="flex items-center gap-2">
                                      <MessageSquare className="h-4 w-4 text-green-500 dark:text-green-400" />
                                      <span>{t('trends.filters.sortComments')}</span>
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="views">
                                    <div className="flex items-center gap-2">
                                      <Eye className="h-4 w-4 text-purple-500" />
                                      <span>{t('trends.filters.sortViews')}</span>
                                    </div>
                                  </SelectItem>
                                  {activeTab === 'trends' && (
                                    <SelectItem value="trendScore">
                                      <div className="flex items-center gap-2">
                                        <Flame className="h-4 w-4 text-orange-500" />
                                        <span>{t('trends.filters.sortTrend')}</span>
                                      </div>
                                    </SelectItem>
                                  )}
                                  <SelectItem value="date">
                                    <div className="flex items-center gap-2">
                                      <Clock className="h-4 w-4 text-gray-500" />
                                      <span>{t('trends.filters.sortDate')}</span>
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="platform">
                                    <div className="flex items-center gap-2">
                                      <Globe className="h-4 w-4 text-indigo-500" />
                                      <span>{t('trends.filters.sortPlatform')}</span>
                                    </div>
                                  </SelectItem>
                                </SelectContent>
                              </Select>

                              {sortField !== 'none' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                                  className="h-9 px-2"
                                >
                                  {sortDirection === 'asc' ? (
                                    <ArrowUpIcon className="h-4 w-4" />
                                  ) : (
                                    <ArrowDownIcon className="h-4 w-4" />
                                  )}
                                </Button>
                              )}
                            </div>

                            <Input
                              placeholder={t('trends.filters.searchPlaceholder')}
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="flex-1 bg-muted text-foreground border-border"
                            />
                          </div>

                          {isLoadingTrends ? (
                            <div className="flex justify-center py-8">
                              <Loader2 className="h-8 w-8 animate-spin" />
                            </div>
                          ) : (
                            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                              <div className="flex items-center justify-between mb-3 border-b pb-2">
                                <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                                  <span>{t('trends.trendList.totalCount', { count: trends.length })}</span>
                                  {selectedSourceId && (
                                    <>
                                      <span>|</span>
                                      <span className="text-primary font-medium">
                                        {t('trends.trendList.filterBySource')} {sources.find(s => s.id === selectedSourceId)?.name || t('trends.trendList.unknown')}
                                      </span>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setSelectedSourceId(null)}
                                        className="h-5 px-2 text-xs"
                                      >
                                        {t('trends.trendList.showAllSources')}
                                      </Button>
                                    </>
                                  )}
                                  <span>|</span>
                                  <span>{t('trends.trendList.period')} {selectedPeriod}</span>
                                  <span>| {t('trends.trendList.platform')} {selectedPlatform}</span>
                                  {selectedPeriod === 'all' && <span className="text-green-600 dark:text-green-400"> {t('trends.trendList.allLoaded')}</span>}
                                  {sortField !== 'none' && (
                                    <>
                                      <span>|</span>
                                      <span className="text-purple-600">
                                        {t('trends.filters.sort')} {sortField === 'comments' ? t('trends.trendList.sortByComments') :
                                          sortField === 'reactions' ? t('trends.trendList.sortByReactions') :
                                            sortField === 'views' ? t('trends.trendList.sortByViews') :
                                              sortField === 'date' ? t('trends.trendList.sortByDate') :
                                                sortField === 'platform' ? t('trends.trendList.sortByPlatform') : sortField}
                                        ({sortDirection === 'asc' ? '↑' : '↓'})
                                      </span>
                                    </>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <Checkbox
                                    checked={areAllVisibleTrendsSelected()}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        selectAllVisibleTrends();
                                      } else {
                                        deselectAllTrends();
                                      }
                                    }}
                                    className="h-4 w-4 border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                                  />
                                  <span className="text-xs text-gray-600 cursor-pointer"
                                    onClick={() => {
                                      if (areAllVisibleTrendsSelected()) {
                                        deselectAllTrends();
                                      } else {
                                        selectAllVisibleTrends();
                                      }
                                    }}
                                  >
                                    {t('trends.trendList.selectAll')}
                                  </span>
                                  {selectedTopics.length > 0 && (
                                    <>
                                      <span className="text-xs text-primary ml-2">
                                        {t('trends.trendList.selectedCount', { count: selectedTopics.length })}
                                      </span>
                                      <Button
                                        variant="default"
                                        size="sm"
                                        onClick={collectSelectedTrendsComments}
                                        disabled={isCollectingTrendComments}
                                        className="h-7 px-2 text-xs ml-2"
                                      >
                                        {isCollectingTrendComments ? (
                                          <>
                                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                            {t('trends.trendList.collecting')}
                                          </>
                                        ) : (
                                          <>
                                            <MessageSquare className="mr-1 h-3 w-3" />
                                            {t('trends.trendList.collectComments')}
                                          </>
                                        )}
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </div>
                              {trends
                                .filter((topic: TrendTopic) => !hiddenTrendIds.has(topic.id))
                                .filter((topic: TrendTopic) => {
                                  // Определяем платформу ТОЛЬКО по полю sourceType
                                  const detectPlatform = () => {
                                    const sourceType = (topic as any).sourceType || '';
                                    if (!sourceType) return 'unknown';

                                    const normalized = sourceType.toLowerCase().trim();
                                    if (normalized === 'instagram') return 'instagram';
                                    if (normalized === 'vk' || normalized === 'vkontakte') return 'vk';
                                    if (normalized === 'telegram') return 'telegram';
                                    if (normalized === 'facebook') return 'facebook';

                                    return 'unknown';
                                  };

                                  const detectedPlatform = detectPlatform();

                                  // Фильтр по периоду времени - сервер уже отфильтровал данные по периоду
                                  // Показываем ВСЕ полученные от сервера записи
                                  const withinPeriod = true;

                                  // Фильтр по поисковому запросу
                                  const matchesSearch = topic.title.toLowerCase().includes(searchQuery.toLowerCase());

                                  // Фильтр по соцсети
                                  let platformMatches = false;
                                  if (selectedPlatform === 'all') {
                                    platformMatches = true;
                                  } else {
                                    switch (selectedPlatform) {
                                      case 'instagram':
                                        platformMatches = detectedPlatform === 'instagram';
                                        break;
                                      case 'vk':
                                        platformMatches = detectedPlatform === 'vk';
                                        break;
                                      case 'telegram':
                                        platformMatches = detectedPlatform === 'telegram';
                                        break;
                                      case 'facebook':
                                        platformMatches = detectedPlatform === 'facebook';
                                        break;
                                      default:
                                        platformMatches = true;
                                    }
                                  }

                                  let sourceMatches = true;
                                  if (selectedSourceId) {
                                    const trendSrcId = (topic as any).sourceId || (topic as any).source_id || '';
                                    const trendSrcIdStr = typeof trendSrcId === 'object' ? (trendSrcId?.id || String(trendSrcId)) : String(trendSrcId);
                                    sourceMatches = trendSrcIdStr === String(selectedSourceId);
                                  }

                                  const finalResult = withinPeriod && matchesSearch && platformMatches && sourceMatches;



                                  return finalResult;
                                })
                                // Сортировка трендов
                                .sort((a: TrendTopic, b: TrendTopic) => {
                                  if (sortField === 'none') return 0;

                                  let valueA, valueB;

                                  // Определяем значения для сравнения в зависимости от выбранного поля сортировки
                                  switch (sortField) {
                                    case 'reactions':
                                      valueA = a.reactions || 0;
                                      valueB = b.reactions || 0;
                                      break;
                                    case 'comments':
                                      valueA = a.comments || 0;
                                      valueB = b.comments || 0;
                                      break;
                                    case 'views':
                                      valueA = a.views || 0;
                                      valueB = b.views || 0;
                                      break;
                                    case 'trendScore':
                                      valueA = a.trendScore || 0;
                                      valueB = b.trendScore || 0;
                                      break;
                                    case 'date':
                                      valueA = new Date(a.created_at || a.createdAt || 0).getTime();
                                      valueB = new Date(b.created_at || b.createdAt || 0).getTime();
                                      break;
                                    case 'platform': {
                                      // Определяем платформу по источнику
                                      const sourceA = sources.find(s => s.id === a.source_id || s.id === a.sourceId);
                                      const sourceB = sources.find(s => s.id === b.source_id || s.id === b.sourceId);

                                      const getPlatform = (source: any) => {
                                        if (!source) return 'zz_unknown'; // Неизвестные в конце
                                        const url = source.url.toLowerCase();
                                        if (url.includes('instagram.com')) return 'instagram';
                                        if (url.includes('vk.com') || url.includes('vkontakte.ru')) return 'vk';
                                        if (url.includes('t.me') || url.includes('telegram.org')) return 'telegram';
                                        if (url.includes('facebook.com') || url.includes('fb.com')) return 'facebook';
                                        return 'zz_other';
                                      };

                                      valueA = getPlatform(sourceA);
                                      valueB = getPlatform(sourceB);

                                      // Для строковых значений используем localeCompare
                                      return sortDirection === 'asc'
                                        ? valueA.localeCompare(valueB)
                                        : valueB.localeCompare(valueA);
                                    }
                                    default:
                                      return 0;
                                  }

                                  // Применяем выбранное направление сортировки
                                  const valA = typeof valueA === 'number' ? valueA : 0;
                                  const valB = typeof valueB === 'number' ? valueB : 0;

                                  return sortDirection === 'asc'
                                    ? valA - valB
                                    : valB - valA;
                                })
                                .map((topic: TrendTopic) => {
                                  const sourceType = (topic as any).sourceType || (topic as any).source_type || '';
                                  const isAiTrend = sourceType.toString().startsWith('AI:');
                                  const topicSourceId = topic.source_id || topic.sourceId;
                                  const foundSource = sources.find(s => s.id === topicSourceId);
                                  const sourceName = isAiTrend
                                    ? sourceType.replace('AI: ', '')
                                    : foundSource?.name
                                    || topic.sourceName || (topic as any).source_name
                                    || (sourceType ? sourceType.charAt(0).toUpperCase() + sourceType.slice(1) : null)
                                    || (topicSourceId ? t('trends.trendList.deletedSource') : t('trends.trendList.generalTrends'));

                                  // Разбор JSON из поля media_links для превью (в реальном режиме)
                                  let mediaData: { images: string[], videos: string[] } = {
                                    images: [],  // Пустой массив, если нет реальных изображений 
                                    videos: []
                                  };

                                  // Проверяем разные варианты имен полей (snake_case и camelCase)
                                  const mediaLinksStr = topic.media_links || topic.mediaLinks;

                                  if (mediaLinksStr) {
                                    try {
                                      if (typeof mediaLinksStr === 'string') {
                                        const parsed = JSON.parse(mediaLinksStr);
                                        if (parsed.images && Array.isArray(parsed.images) && parsed.images.length > 0) {
                                          mediaData = parsed;
                                        }
                                      } else if (typeof mediaLinksStr === 'object') {
                                        // Может прийти уже распарсенным
                                        if ((mediaLinksStr as any).images && Array.isArray((mediaLinksStr as any).images) && (mediaLinksStr as any).images.length > 0) {
                                          mediaData = mediaLinksStr as { images: string[], videos: string[] };
                                        }
                                      }
                                    } catch (e) {
                                      // Ошибка парсинга
                                    }
                                  }

                                  // Первое изображение для отображения (если есть)
                                  const firstImage = mediaData.images && mediaData.images.length > 0 ? mediaData.images[0] : undefined;

                                   return (
                                    <Card
                                      key={topic.id}
                                      className={`hover:shadow-md transition-shadow cursor-pointer ${selectedTrendTopic?.id === topic.id ? 'ring-2 ring-primary bg-accent/20 dark:bg-accent/30' : ''
                                        }`}
                                      onClick={() => {
                                        setSelectedTrendTopic(topic);
                                        setActiveTab('comments');
                                        loadTrendComments(topic.id);
                                      }}
                                    >
                                      <CardContent className="py-3 px-4">
                                        <div className="flex items-start gap-3">
                                          {/* Чекбокс для пакетного сбора */}
                                          <div className="flex-shrink-0 mt-1">
                                            <div className="flex items-center gap-1 p-0.5 rounded hover:bg-accent cursor-pointer">
                                              <Checkbox
                                                checked={selectedTopics.some(t => t.id === topic.id)}
                                                onCheckedChange={() => toggleTopicSelection(topic)}
                                                className="h-4 w-4"
                                                aria-label={t('trends.trendCard.selectTrend')}
                                                onClick={(e) => e.stopPropagation()}
                                              />
                                            </div>
                                          </div>

                                          {/* Изображение из media_links */}
                                          {firstImage ? (
                                            <div className="flex-shrink-0">
                                              <img
                                                src={createProxyImageUrl(firstImage, topic.id)}
                                                alt={t('trends.globalTrends.thumbnail')}
                                                className="h-16 w-16 object-cover rounded-md"
                                                onError={(e) => {
                                                  e.currentTarget.onerror = null;
                                                  // Пробуем повторную загрузку с прямой ссылкой если это не Instagram
                                                  if (firstImage.includes('instagram') ||
                                                    firstImage.includes('fbcdn') ||
                                                    firstImage.includes('cdninstagram')) {
                                                    const retryUrl = createProxyImageUrl(firstImage, topic.id) + "&_retry=true";
                                                    e.currentTarget.src = retryUrl;
                                                  } else {
                                                    e.currentTarget.src = 'https://placehold.co/100x100/jpeg?text=Нет+фото';
                                                  }
                                                }}
                                                loading="lazy"
                                                referrerPolicy="no-referrer"
                                                crossOrigin="anonymous"
                                              />
                                            </div>
                                          ) : null}

                                          <div className="flex-1 min-w-0">
                                            {/* Название канала вверху — ссылка на пост (urlPost) */}
                                            {(() => {
                                              const postUrl = (topic as any).urlPost || topic.url || "";
                                              // URL канала: берём из источника или убираем ID поста из URL
                                              const src = sources.find((s: any) => s.id === topic.source_id || s.id === (topic as any).sourceId);
                                              const channelUrl = src?.url
                                                || postUrl.replace(/\/(c\/\d+|\d+)$/, '')
                                                || postUrl;
                                              return (
                                                <>
                                                  <div className="mb-1 font-medium">
                                                    <a
                                                      href={postUrl}
                                                      target="_blank"
                                                      rel="noopener noreferrer"
                                                      className="text-primary hover:underline"
                                                      onClick={(e) => e.stopPropagation()}
                                                    >
                                                      {sourceName}
                                                    </a>
                                                  </div>
                                                  {/* URL поста (urlPost) */}
                                                  <div className="text-xs mb-2 text-muted-foreground truncate" title={postUrl || channelUrl}>
                                                    {postUrl || channelUrl}
                                                  </div>
                                                </>
                                              );
                                            })()}

                                            {/* Первая строка описания поста (если есть) */}
                                            <div
                                              className="text-sm line-clamp-2 flex items-start gap-2"
                                            >
                                              <SentimentEmoji sentiment={topic.sentiment_analysis} className="text-sm" />
                                              <span className="flex-1">
                                                {topic.description ? topic.description.split('\n')[0] : topic.title}
                                              </span>
                                            </div>

                                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                              <div className="flex items-center gap-1">
                                                <ThumbsUp className="h-3 w-3" />
                                                <span>{typeof topic.reactions === 'number' ? Math.round(topic.reactions).toLocaleString('ru-RU') : (topic.reactions ?? 0)}</span>
                                              </div>
                                              <div className="flex items-center gap-1">
                                                <MessageSquare className="h-3 w-3" />
                                                <span>{typeof topic.comments === 'number' ? Math.round(topic.comments).toLocaleString('ru-RU') : (topic.comments ?? 0)}</span>
                                              </div>
                                              <div className="flex items-center gap-1">
                                                <Eye className="h-3 w-3" />
                                                <span>{typeof topic.views === 'number' ? Math.round(topic.views).toLocaleString('ru-RU') : (topic.views ?? 0)}</span>
                                              </div>
                                              {/* Показываем trendScore - показатель трендовости */}
                                              <div className="flex items-center gap-1">
                                                <Flame className="h-3 w-3 text-orange-500" />
                                                <span>{typeof topic.trendScore === 'number' ? Math.round(topic.trendScore).toLocaleString('ru-RU') : (topic.trendScore ?? 0)}</span>
                                              </div>
                                              {topic.is_bookmarked && (
                                                <div className="flex items-center gap-1">
                                                  <Bookmark className="h-3 w-3 text-primary" />
                                                </div>
                                              )}
                                              <div className="flex items-center gap-1">
                                                <Clock className="h-3 w-3" />
                                                <span>
                                                  {/* Удаляем многоточие - показываем только дату */}
                                                  {topic.created_at
                                                    ? formatRelativeTime(new Date(topic.created_at))
                                                    : topic.createdAt
                                                      ? formatRelativeTime(new Date(topic.createdAt))
                                                      : formatRelativeTime(new Date())}
                                                </span>
                                              </div>

                                              {/* Кнопка превью поста */}
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  console.log('Открываем превью тренда:', topic.id, topic.title);
                                                  setPreviewTrendTopic(topic);
                                                }}
                                                className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300"
                                                title={t('trends.trendCard.preview')}
                                              >
                                                <ExternalLink className="h-3 w-3" />
                                                <span>{t('trends.trendCard.preview')}</span>
                                              </button>

                                              {/* Кнопка скрыть пост из ленты */}
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setHiddenTrendIds(prev => new Set([...prev, topic.id]));
                                                }}
                                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                                                title={t('trends.trendCard.hide')}
                                              >
                                                <EyeOff className="h-3 w-3" />
                                                <span>{t('trends.trendCard.hide')}</span>
                                              </button>

                                              {/* Кнопка перехода на вкладку комментариев */}
                                              {(topic.urlPost?.includes('vk.com') || topic.urlPost?.includes('t.me') ||
                                                topic.accountUrl?.includes('vk.com') || topic.accountUrl?.includes('t.me')) && (
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setSelectedTrendTopic(topic);
                                                      setActiveTab('comments');
                                                    }}
                                                    className="flex items-center gap-1 text-xs text-primary hover:text-blue-800"
                                                    title={t('trends.trendCard.comments')}
                                                  >
                                                    <MessageSquare className="h-3 w-3" />
                                                    <span>{t('trends.trendCard.comments')}</span>
                                                  </button>
                                                )}
                                            </div>
                                          </div>
                                        </div>
                                      </CardContent>
                                    </Card>
                                  );
                                })
                              }
                            </div>
                          )}
                        </>
                      ) : activeTab === 'comments' ? (
                        <>
                          <div className="mb-4">
                            {selectedTrendTopic ? (
                              <div className="bg-muted/50 dark:bg-muted/20 p-4 rounded-lg mb-4 border border-border">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <h3 className="font-medium text-sm text-foreground mb-2">
                                      {t('trends.commentsTab.trendTitle')} {selectedTrendTopic.title}
                                    </h3>
                                    <p className="text-xs text-muted-foreground">
                                      {t('trends.commentsTab.source')} {selectedTrendTopic.accountUrl || selectedTrendTopic.urlPost}
                                    </p>
                                  </div>
                                  {/* Кнопка для сбора комментариев если это ВК или ТГ тренд */}
                                  {(selectedTrendTopic.urlPost?.includes('vk.com') || selectedTrendTopic.urlPost?.includes('t.me') ||
                                    selectedTrendTopic.accountUrl?.includes('vk.com') || selectedTrendTopic.accountUrl?.includes('t.me')) && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                          collectTrendComments(selectedTrendTopic.id, selectedTrendTopic.urlPost || selectedTrendTopic.accountUrl || '');
                                        }}
                                        disabled={collectingCommentsForTrend === selectedTrendTopic.id}
                                        className="text-xs"
                                      >
                                        {collectingCommentsForTrend === selectedTrendTopic.id ? (
                                          <>
                                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                            {t('trends.commentsTab.collecting')}
                                          </>
                                        ) : (
                                          <>
                                            <Download className="h-3 w-3 mr-1" />
                                            {t('trends.commentsTab.collectComments')}
                                          </>
                                        )}
                                      </Button>
                                    )}
                                </div>
                              </div>
                            ) : (
                              <div className="text-center text-muted-foreground py-8">
                                <MessageSquare className="h-12 w-12 mx-auto mb-2 text-muted-foreground/50" />
                                <p>{t('trends.commentsTab.selectTrend')}</p>
                                <p className="text-xs mt-1 mb-2">
                                  {t('trends.commentsTab.availableFor')}
                                </p>
                                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-left max-w-md mx-auto">
                                  <p className="text-xs text-yellow-800 font-medium mb-1">💡 {t('trends.commentsTab.tipTitle')}</p>
                                  <p className="text-xs text-yellow-700 whitespace-pre-line">
                                    {t('trends.commentsTab.tipSteps')}
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Блок детального анализа источника */}
                          {selectedTrendTopic && (() => {
                            const sourceId = selectedTrendTopic.source_id || selectedTrendTopic.sourceId;
                            const source = sources.find(s => s.id === sourceId);
                            const sourceAnalysis = source?.sentiment_analysis;

                            return sourceAnalysis && (
                              <div className="mb-6 p-4 bg-accent/10 dark:bg-accent/20 border border-border rounded-lg">
                                <div className="flex items-center gap-2 mb-3">
                                  <Building className="h-5 w-5 text-indigo-600" />
                                  <h5 className="font-medium text-foreground">{t('trends.sourceAnalysis.title')} {source?.name}</h5>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                                  <div className="text-center p-2 bg-muted text-muted-foreground rounded border border-border">
                                    <div className="text-lg font-semibold text-primary">
                                      {(sourceAnalysis as any).score != null ? `${(sourceAnalysis as any).score}/10` :
                                        (sourceAnalysis as any).average_score != null ? `${(sourceAnalysis as any).average_score}/10` : 'N/A'}
                                    </div>
                                    <div className="text-xs text-muted-foreground">{t('trends.sourceAnalysis.rating')}</div>
                                  </div>
                                  <div className="text-center p-2 bg-muted text-muted-foreground rounded border border-border">
                                    <div className="text-lg font-semibold text-purple-600">
                                      {(() => {
                                        const conf = (sourceAnalysis as any).confidence;
                                        if (conf == null) return '0%';
                                        return conf <= 1 ? `${Math.round(conf * 100)}%` : `${Math.round(conf)}%`;
                                      })()}
                                    </div>
                                    <div className="text-xs text-muted-foreground">{t('trends.sourceAnalysis.accuracy')}</div>
                                  </div>
                                  <div className="text-center p-2 bg-muted text-muted-foreground rounded border border-border">
                                    <div className="text-lg font-semibold text-orange-600">
                                      {(sourceAnalysis as any).totalComments || (sourceAnalysis as any).commentsAnalyzed || (sourceAnalysis as any).total_comments || 0}
                                    </div>
                                    <div className="text-xs text-muted-foreground">{t('trends.sourceAnalysis.comments')}</div>
                                  </div>
                                  <div className="text-center p-2 bg-muted text-muted-foreground rounded border border-border">
                                    <div className="text-lg font-semibold text-teal-600">
                                      {(sourceAnalysis as any).avgCommentsPerTrend || Math.round(((sourceAnalysis as any).totalComments || (sourceAnalysis as any).total_comments || 0) / Math.max((sourceAnalysis as any).trendsAnalyzed || (sourceAnalysis as any).analyzed_trends || 1, 1))}
                                    </div>
                                    <div className="text-xs text-gray-600">{t('trends.sourceAnalysis.perPost')}</div>
                                  </div>
                                </div>

                                {/* Дополнительная статистика если есть детальные данные */}
                                {(sourceAnalysis.positive_percentage || sourceAnalysis.negative_percentage || sourceAnalysis.neutral_percentage) && (
                                  <div className="grid grid-cols-3 gap-2 mb-3">
                                    <div className="text-center p-2 bg-green-50 dark:bg-green-900/20 rounded border border-green-200 dark:border-green-800">
                                      <div className="text-sm font-semibold text-green-700 dark:text-green-400">
                                        {sourceAnalysis.positive_percentage || 0}%
                                      </div>
                                      <div className="text-xs text-green-600 dark:text-green-300">{t('trends.sourceAnalysis.positive')}</div>
                                    </div>
                                    <div className="text-center p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
                                      <div className="text-sm font-semibold text-red-700 dark:text-red-400">
                                        {sourceAnalysis.negative_percentage || 0}%
                                      </div>
                                      <div className="text-xs text-red-600 dark:text-red-300">{t('trends.sourceAnalysis.negative')}</div>
                                    </div>
                                    <div className="text-center p-2 bg-gray-50 dark:bg-gray-800/50 rounded border border-gray-200 dark:border-gray-700">
                                      <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        {sourceAnalysis.neutral_percentage || 0}%
                                      </div>
                                      <div className="text-xs text-gray-600 dark:text-gray-400">{t('trends.sourceAnalysis.neutral')}</div>
                                    </div>
                                  </div>
                                )}

                                <div className="text-sm text-muted-foreground bg-muted p-3 rounded border">
                                  <div className="flex items-center gap-2 mb-3">
                                    <span className="text-lg">{sourceAnalysis.emoji || '😐'}</span>
                                    <strong>{t('trends.sourceAnalysis.overallMood')}</strong>
                                    <span className={`font-medium ${(sourceAnalysis as any).overall_sentiment === 'positive' ? 'text-green-600' :
                                        (sourceAnalysis as any).overall_sentiment === 'negative' ? 'text-red-600' : 'text-gray-600'
                                      }`}>
                                      {(sourceAnalysis as any).overall_sentiment === 'positive' ? t('trends.sourceAnalysis.positiveSentiment') :
                                        (sourceAnalysis as any).overall_sentiment === 'negative' ? t('trends.sourceAnalysis.negativeSentiment') : t('trends.sourceAnalysis.neutralSentiment')}
                                    </span>
                                  </div>

                                  {/* Основной summary - всегда показываем */}
                                  <div className="mb-3 p-2 bg-muted/30 dark:bg-muted/10 rounded border-l-4 border-primary">
                                    <strong className="text-primary">{t('trends.sourceAnalysis.analysisLabel')}</strong>
                                    <p className="mt-1 text-muted-foreground text-sm">{(sourceAnalysis as any).summary}</p>
                                  </div>

                                  {/* Детальное описание аудитории от AI */}
                                  {(sourceAnalysis as any).detailed_summary && (
                                    <div className="mb-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded border-l-4 border-purple-400 dark:border-purple-600">
                                      <div className="text-purple-700 dark:text-purple-200 text-sm">
                                        {renderMarkdownText((sourceAnalysis as any).detailed_summary)}
                                      </div>
                                    </div>
                                  )}

                                  {/* Темы обсуждения */}
                                  {(sourceAnalysis as any).themes && (sourceAnalysis as any).themes.length > 0 && (
                                    <div className="mb-3">
                                      <strong className="text-xs text-muted-foreground">{t('trends.sourceAnalysis.discussionTopics')}</strong>
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {(sourceAnalysis as any).themes.map((theme: string, i: number) => (
                                          <span key={i} className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
                                            {theme}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {(sourceAnalysis as any).top_trends && (sourceAnalysis as any).top_trends.length > 0 && (
                                    <div className="mb-3">
                                      <strong className="text-xs text-muted-foreground">{t('trends.sourceAnalysis.topTrends')}</strong>
                                      <div className="mt-1 space-y-1">
                                        {(sourceAnalysis as any).top_trends.map((trend: any, i: number) => (
                                          <div key={i} className="flex items-center justify-between text-xs p-1.5 bg-muted/30 dark:bg-muted/10 rounded hover:bg-muted/50 transition-colors">
                                            {trend.urlPost ? (
                                              <a
                                                href={trend.urlPost}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-primary hover:underline truncate max-w-[60%]"
                                                title={trend.title}
                                              >
                                                {i + 1}. {trend.title}
                                              </a>
                                            ) : (
                                              <span className="text-muted-foreground truncate max-w-[60%]">{i + 1}. {trend.title}</span>
                                            )}
                                            <div className="flex items-center gap-2 shrink-0">
                                              <span className="text-muted-foreground">{trend.comments} {t('trends.sourceAnalysis.commentsShort')}</span>
                                              <span className={`font-medium ${trend.sentiment === 'positive' ? 'text-green-600' : trend.sentiment === 'negative' ? 'text-red-600' : 'text-gray-500'}`}>
                                                {trend.score}/10
                                              </span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  <div className="flex justify-between items-center text-xs text-gray-500 pt-2 border-t">
                                    <div>
                                      {t('trends.sourceAnalysis.trendsCount')} {(sourceAnalysis as any).trendsAnalyzed || (sourceAnalysis as any).analyzed_trends || 0}/{(sourceAnalysis as any).totalTrends || (sourceAnalysis as any).total_trends || 0}
                                      <span className="ml-2">
                                        • {t('trends.sourceAnalysis.method')} {(sourceAnalysis as any).analysisMethod === 'ai' ? `🤖 ${t('trends.sourceAnalysis.methodAi')}` :
                                          (sourceAnalysis as any).analysisMethod === 'keywords' ? `🔤 ${t('trends.sourceAnalysis.methodKeywords')}` :
                                          (sourceAnalysis as any).analysisMethod === 'keywords_fallback' ? `🔤 ${t('trends.sourceAnalysis.methodKeywordsFallback')}` : `📊 ${t('trends.sourceAnalysis.methodBasic')}`}
                                      </span>
                                    </div>
                                    {((sourceAnalysis as any).analyzedAt || (sourceAnalysis as any).analyzed_at) && (
                                      <div>
                                        {new Date((sourceAnalysis as any).analyzedAt || (sourceAnalysis as any).analyzed_at).toLocaleString('ru-RU', {
                                          day: '2-digit',
                                          month: '2-digit',
                                          hour: '2-digit',
                                          minute: '2-digit'
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

                          {selectedTrendTopic && (
                            <div className="max-h-[400px] overflow-y-auto pr-2">
                              {isLoadingComments ? (
                                <div className="flex items-center justify-center py-8">
                                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                                  <span>{t('trends.commentsTab.loading')}</span>
                                </div>
                              ) : trendComments.length > 0 ? (
                                <div>
                                  <div className="mb-4 flex justify-between items-center">
                                    <h4 className="font-medium text-foreground">
                                      {t('trends.commentsTab.commentsCount', { count: trendComments.length })}
                                    </h4>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={isAnalyzingSentiment}
                                      onClick={() => {
                                        const analyzeSentiment = async () => {
                                          try {
                                            setIsAnalyzingSentiment(true);
                                            const authToken = localStorage.getItem('auth_token');
                                            const response = await fetch(`/api/trend-sentiment/${selectedTrendTopic.id}`, {
                                              method: 'POST',
                                              headers: {
                                                'Authorization': `Bearer ${authToken}`,
                                                'Content-Type': 'application/json'
                                              }
                                            });

                                            if (response.ok) {
                                              const data = await response.json();
                                              console.log('Результат анализа настроения (JSON):', JSON.stringify(data, null, 2));
                                              setSentimentData(data.data);
                                              toast({
                                                title: t('trends.toasts.sentimentDone'),
                                                description: t('trends.toasts.sentimentDoneDesc', { count: data.commentsAnalyzed || trendComments.length }),
                                              });
                                              // Обновляем данные после анализа настроения (без интервалов)
                                              console.log('✅ Анализ настроения завершен, данные обновлены локально');
                                              queryClient.invalidateQueries({ queryKey: ["trends", selectedPeriod, selectedCampaignId] });

                                              // Обновляем локальные данные тренда, чтобы анализ сохранился
                                              if (selectedTrendTopic) {
                                                (selectedTrendTopic as any).sentiment_analysis = data.data;
                                              }
                                            } else {
                                              const errorText = await response.text();
                                              console.error('Ошибка сервера:', response.status, errorText);
                                              toast({
                                                title: t('trends.toasts.analysisError'),
                                                description: t('trends.toasts.serverError', { status: response.status }),
                                                variant: "destructive"
                                              });
                                            }
                                          } catch (error) {
                                            console.error('Ошибка анализа:', error);
                                            toast({
                                              title: t('trends.toasts.analysisError'),
                                              description: t('trends.toasts.connectionError', { error: (error as Error).message }),
                                              variant: "destructive"
                                            });
                                          } finally {
                                            setIsAnalyzingSentiment(false);
                                          }
                                        };
                                        analyzeSentiment();
                                      }}
                                      className="gap-2"
                                    >
                                      {isAnalyzingSentiment ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <BarChart className="h-4 w-4" />
                                      )}
                                      {isAnalyzingSentiment ? t('trends.toasts.analyzing') : t('trends.sentimentAnalysis.analyzeBtn')}
                                    </Button>


                                    <Button
                                      onClick={() => {
                                        // Получаем sourceId для текущего тренда
                                        const sourceId = selectedTrendTopic.source_id || selectedTrendTopic.sourceId;
                                        const source = sources.find(s => s.id === sourceId);
                                        const sourceName = source?.name || t('trends.sourceAnalysis.defaultSourceName');

                                        if (sourceId) {
                                          analyzeSource(sourceId, sourceName);
                                        } else {
                                          toast({
                                            title: t('trends.toasts.error'),
                                            description: t('trends.toasts.sourceNotFound'),
                                            variant: "destructive"
                                          });
                                        }
                                      }}
                                      disabled={analyzingSourceId !== null}
                                      size="sm"
                                      variant="outline"
                                      className="gap-2"
                                    >
                                      {analyzingSourceId !== null ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Building className="h-4 w-4" />
                                      )}
                                      {analyzingSourceId !== null ? t('trends.toasts.analyzing') : t('trends.sentimentAnalysis.analyzeSourceBtn')}
                                    </Button>
                                  </div>

                                  {/* Блок результатов анализа настроения */}
                                  {sentimentData && (
                                    <div className="mb-4 p-4 bg-accent/10 dark:bg-accent/20 border border-border rounded-lg">
                                      <div className="flex items-center gap-2 mb-3">
                                        <BarChart className="h-5 w-5 text-primary" />
                                        <h5 className="font-medium text-foreground">{t('trends.sentimentAnalysis.title')}</h5>
                                      </div>
                                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                                        <div className="text-center">
                                          <div className="text-lg font-semibold text-green-600 dark:text-green-400">
                                            {sentimentData.details?.positive || 0}%
                                          </div>
                                          <div className="text-xs text-muted-foreground">{t('trends.sentimentAnalysis.positive')}</div>
                                        </div>
                                        <div className="text-center">
                                          <div className="text-lg font-semibold text-red-600 dark:text-red-400">
                                            {sentimentData.details?.negative || 0}%
                                          </div>
                                          <div className="text-xs text-muted-foreground">{t('trends.sentimentAnalysis.negative')}</div>
                                        </div>
                                        <div className="text-center">
                                          <div className="text-lg font-semibold text-gray-600 dark:text-gray-400">
                                            {sentimentData.details?.neutral || 0}%
                                          </div>
                                          <div className="text-xs text-muted-foreground">{t('trends.sentimentAnalysis.neutral')}</div>
                                        </div>
                                        <div className="text-center">
                                          <div className="text-lg font-semibold text-primary">
                                            {sentimentData.confidence || 0}%
                                          </div>
                                          <div className="text-xs text-gray-600">{t('trends.sentimentAnalysis.confidence')}</div>
                                        </div>
                                      </div>
                                      <div className="text-sm text-muted-foreground bg-muted p-2 rounded border">
                                        <strong>{t('trends.sentimentAnalysis.overallMood')}</strong> {sentimentData.sentiment === 'positive' ? `😊 ${t('trends.sentimentAnalysis.positiveSentiment')}` : sentimentData.sentiment === 'negative' ? `😔 ${t('trends.sentimentAnalysis.negativeSentiment')}` : `😐 ${t('trends.sentimentAnalysis.neutralSentiment')}`}
                                        {sentimentData.summary && (
                                          <>
                                            <br />
                                            <strong>{t('trends.sentimentAnalysis.description')}</strong> {sentimentData.summary}
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {/* Блок результатов многоуровневого анализа комментариев */}
                                  {(commentsAnalysisData.trend_level || commentsAnalysisData.source_level) && (
                                    <div className="mb-4 space-y-4">
                                      {/* Анализ на уровне тренда */}
                                      {commentsAnalysisData.trend_level && (
                                        <div className="p-4 bg-secondary/10 dark:bg-secondary/20 border border-border rounded-lg">
                                          <div className="flex items-center gap-2 mb-3">
                                            <Target className="h-5 w-5 text-green-600" />
                                            <h5 className="font-medium text-gray-900">{t('trends.trendAnalysis.trendTitle')}</h5>
                                          </div>
                                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                                            <div className="text-center">
                                              <div className="text-lg font-semibold text-green-600">
                                                {commentsAnalysisData.trend_level.sentiment === 'positive' ? '😊' :
                                                  commentsAnalysisData.trend_level.sentiment === 'negative' ? '😔' : '😐'}
                                              </div>
                                              <div className="text-xs text-gray-600">{t('trends.trendAnalysis.sentiment')}</div>
                                            </div>
                                            <div className="text-center">
                                              <div className="text-lg font-semibold text-primary">
                                                {commentsAnalysisData.trend_level.confidence || 0}%
                                              </div>
                                              <div className="text-xs text-gray-600">{t('trends.trendAnalysis.confidence')}</div>
                                            </div>
                                            <div className="text-center">
                                              <div className="text-lg font-semibold text-purple-600">
                                                {commentsAnalysisData.trend_level.engagement || 'N/A'}
                                              </div>
                                              <div className="text-xs text-gray-600">{t('trends.trendAnalysis.engagement')}</div>
                                            </div>
                                            <div className="text-center">
                                              <div className="text-lg font-semibold text-orange-600">
                                                {commentsAnalysisData.trend_level.viral_potential || 0}%
                                              </div>
                                              <div className="text-xs text-gray-600">{t('trends.trendAnalysis.viralPotential')}</div>
                                            </div>
                                          </div>
                                          {commentsAnalysisData.trend_level.themes && commentsAnalysisData.trend_level.themes.length > 0 && (
                                            <div className="mb-3">
                                              <div className="text-xs text-gray-600 mb-1">{t('trends.trendAnalysis.mainTopics')}</div>
                                              <div className="flex flex-wrap gap-1">
                                                {commentsAnalysisData.trend_level.themes.map((theme: string, index: number) => (
                                                  <span key={index} className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                                                    {theme}
                                                  </span>
                                                ))}
                                              </div>
                                            </div>
                                          )}
                                          <div className="text-sm text-muted-foreground bg-muted p-2 rounded border">
                                            <strong>{t('trends.trendAnalysis.trendLabel')}</strong> {commentsAnalysisData.trend_level.summary}
                                          </div>
                                        </div>
                                      )}

                                      {/* Анализ на уровне источника */}
                                      {commentsAnalysisData.source_level && (
                                        <div className="p-4 bg-muted/30 dark:bg-muted/20 border border-border rounded-lg">
                                          <div className="flex items-center gap-2 mb-3">
                                            <Building className="h-5 w-5 text-amber-600" />
                                            <h5 className="font-medium text-foreground">{t('trends.trendAnalysis.sourceTitle')}</h5>
                                          </div>
                                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                                            <div className="text-center">
                                              <div className="text-lg font-semibold text-amber-600">
                                                {commentsAnalysisData.source_level.sentiment === 'positive' ? '😊' :
                                                  commentsAnalysisData.source_level.sentiment === 'negative' ? '😔' : '😐'}
                                              </div>
                                              <div className="text-xs text-gray-600">{t('trends.trendAnalysis.sentiment')}</div>
                                            </div>
                                            <div className="text-center">
                                              <div className="text-lg font-semibold text-primary">
                                                {commentsAnalysisData.source_level.confidence || 0}%
                                              </div>
                                              <div className="text-xs text-gray-600">{t('trends.trendAnalysis.confidence')}</div>
                                            </div>
                                            <div className="text-center">
                                              <div className="text-lg font-semibold text-purple-600">
                                                {commentsAnalysisData.source_level.source_reputation || 'N/A'}
                                              </div>
                                              <div className="text-xs text-gray-600">{t('trends.trendAnalysis.reputation')}</div>
                                            </div>
                                            <div className="text-center">
                                              <div className="text-lg font-semibold text-green-600">
                                                {commentsAnalysisData.source_level.audience_trust || 0}%
                                              </div>
                                              <div className="text-xs text-gray-600">{t('trends.trendAnalysis.trust')}</div>
                                            </div>
                                          </div>
                                          {commentsAnalysisData.source_level.themes && commentsAnalysisData.source_level.themes.length > 0 && (
                                            <div className="mb-3">
                                              <div className="text-xs text-gray-600 mb-1">{t('trends.trendAnalysis.mainTopics')}</div>
                                              <div className="flex flex-wrap gap-1">
                                                {commentsAnalysisData.source_level.themes.map((theme: string, index: number) => (
                                                  <span key={index} className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">
                                                    {theme}
                                                  </span>
                                                ))}
                                              </div>
                                            </div>
                                          )}
                                          <div className="text-sm text-muted-foreground bg-muted p-2 rounded border">
                                            <strong>{t('trends.trendAnalysis.sourceLabel')}</strong> {commentsAnalysisData.source_level.summary}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  <div className="space-y-3">
                                    {trendComments.map((comment, index) => (
                                      <Card key={comment.id || index} className="p-3">
                                        <div className="flex items-start gap-3">
                                          <div className="flex-shrink-0">
                                            <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                                              <span className="text-xs font-medium text-muted-foreground">
                                                👤
                                              </span>
                                            </div>
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                              <span className="font-medium text-sm text-foreground">
                                                {comment.author_name || comment.author || t('trends.commentsTab.unknownAuthor')}
                                              </span>
                                              {comment.platform && (
                                                <span className="text-xs text-muted-foreground">
                                                  {comment.platform.toUpperCase()}
                                                </span>
                                              )}
                                              {(comment.published_at || comment.date) && (
                                                <span className="text-xs text-muted-foreground/70">
                                                  {new Date(comment.published_at || comment.date!).toLocaleDateString('ru-RU')}
                                                </span>
                                              )}
                                            </div>
                                            <p className="text-sm text-foreground whitespace-pre-wrap">
                                              {comment.content || comment.text}
                                            </p>
                                          </div>
                                        </div>
                                      </Card>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <div className="text-center text-muted-foreground py-8">
                                  <MessageSquare className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                                  <p>{t('trends.commentsTab.notCollected')}</p>
                                  <p className="text-xs mt-1 mb-3">
                                    {t('trends.commentsTab.clickToCollect')}
                                  </p>
                                  {(selectedTrendTopic?.urlPost?.includes('vk.com') || selectedTrendTopic?.urlPost?.includes('t.me') ||
                                    selectedTrendTopic?.accountUrl?.includes('vk.com') || selectedTrendTopic?.accountUrl?.includes('t.me')) && (
                                    <Button
                                      size="sm"
                                      variant="default"
                                      onClick={() => {
                                        if (selectedTrendTopic) {
                                          collectTrendComments(selectedTrendTopic.id, selectedTrendTopic.urlPost || selectedTrendTopic.accountUrl || '');
                                        }
                                      }}
                                      disabled={collectingCommentsForTrend === selectedTrendTopic?.id}
                                      className="gap-2"
                                    >
                                      {collectingCommentsForTrend === selectedTrendTopic?.id ? (
                                        <>
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                          {t('trends.commentsTab.collecting')}
                                        </>
                                      ) : (
                                        <>
                                          <Download className="h-4 w-4" />
                                          {t('trends.commentsTab.collectComments')}
                                        </>
                                      )}
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      ) : activeTab === 'generation' ? (
                        <>
                          <div className="mb-4">
                            {selectedTopics.length > 0 ? (
                              <div className="space-y-4">
                                <div className="bg-muted/50 dark:bg-muted/20 p-4 rounded-lg border border-border">
                                  <div className="flex items-center justify-between mb-3">
                                    <div>
                                      <h3 className="font-medium text-sm text-foreground mb-1">
                                        {t('trends.generation.title')}
                                      </h3>
                                      <p className="text-xs text-muted-foreground">
                                        {t('trends.generation.selectedCount', { count: selectedTopics.length })}
                                      </p>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setSelectedTopics([])}
                                      className="text-xs"
                                    >
                                      {t('trends.generation.resetSelection')}
                                    </Button>
                                  </div>
                                  <div className="flex flex-wrap gap-2 mb-3">
                                    {selectedTopics.slice(0, 5).map((trend) => (
                                      <Badge key={trend.id} variant="secondary" className="text-xs">
                                        {trend.title?.slice(0, 30)}{trend.title && trend.title.length > 30 ? '...' : ''}
                                      </Badge>
                                    ))}
                                    {selectedTopics.length > 5 && (
                                      <Badge variant="outline" className="text-xs">
                                        +{selectedTopics.length - 5} {t('trends.generation.moreCount')}
                                      </Badge>
                                    )}
                                  </div>
                                </div>

                                <ContentGenerationPanel
                                  selectedTopics={selectedTopics}
                                  onGenerated={() => {
                                    toast({
                                      title: t('trends.toasts.contentCreated'),
                                      description: t('trends.toasts.contentCreatedDesc'),
                                    });
                                    setSelectedTopics([]);
                                  }}
                                />
                              </div>
                            ) : (
                              <div className="text-center text-muted-foreground py-8">
                                <Target className="h-12 w-12 mx-auto mb-2 text-muted-foreground/50" />
                                <p>{t('trends.generation.selectTrends')}</p>
                                <p className="text-xs mt-1 mb-2">
                                  {t('trends.generation.useCheckboxes')}
                                </p>
                                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-left max-w-md mx-auto">
                                  <p className="text-xs text-blue-800 dark:text-blue-200 font-medium mb-1">{t('trends.generation.howToGenerate')}</p>
                                  <p className="text-xs text-blue-700 dark:text-blue-300 whitespace-pre-line">
                                    {t('trends.generation.steps')}
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        </>
                      ) : null}
                    </div>
                  </CollapsibleContent>
                </CardContent>
              </Collapsible>
            </Card>

          </>
        )}
      </div>


      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        {selectedCampaignId && (
          <AddSourceDialog
            campaignId={selectedCampaignId}
            onClose={() => setIsDialogOpen(false)}
          />
        )}
      </Dialog>

      <Dialog open={isSearchingNewSources} onOpenChange={setIsSearchingNewSources}>
        {selectedCampaignId && foundSourcesData && (
          <NewSourcesDialog
            campaignId={selectedCampaignId}
            onClose={() => {
              setIsSearchingNewSources(false);
              setFoundSourcesData(null);
            }}
            sourcesData={foundSourcesData}
          />
        )}
      </Dialog>

      <Dialog open={isBulkImportDialogOpen} onOpenChange={setIsBulkImportDialogOpen}>
        {selectedCampaignId && (
          <BulkSourcesImportDialog
            campaignId={selectedCampaignId}
            onClose={() => setIsBulkImportDialogOpen(false)}
          />
        )}
      </Dialog>

      {/* Диалог сбора источников */}
      <SourceCollectionDialog
        isOpen={isSourceCollectionDialogOpen}
        onClose={() => setIsSourceCollectionDialogOpen(false)}
        campaignId={selectedCampaignId || ''}
        onCollect={() => {
          setSourcesPollingFast(true);
          setTimeout(() => setSourcesPollingFast(false), 120000);
        }}
      />

      {/* Диалог поиска источников */}
      {selectedKeyword && (
        <SourcesSearchDialog
          open={isSourceSearchDialogOpen}
          onOpenChange={setIsSourceSearchDialogOpen}
          campaignId={selectedCampaignId}
          keyword={selectedKeyword}
          onClose={() => setIsSourceSearchDialogOpen(false)}
          onSearch={(sources) => {
            setFoundSourcesData({ success: true, data: { sources } });
            setIsSearchingNewSources(true);
            setIsSourceSearchDialogOpen(false);
          }}
        />
      )}

      {/* Диалог выбора социальных сетей для сбора трендов */}
      <SocialNetworkSelectorDialog
        isOpen={isSocialNetworkDialogOpen}
        onClose={() => setIsSocialNetworkDialogOpen(false)}
        onConfirm={(platforms, collectSources, collectComments) => {
          setIsSocialNetworkDialogOpen(false);
          if (collectSources) {
            setSourcesPollingFast(true);
          }
          collectTrendsWithPlatforms({ platforms, collectSources, collectComments });
        }}
        isLoading={isCollecting}
      />

      {/* Модальное окно для детального просмотра тренда */}
      {previewTrendTopic && (
        <TrendDetailDialog
          topic={previewTrendTopic}
          isOpen={!!previewTrendTopic}
          onClose={() => setPreviewTrendTopic(null)}
          onBookmark={(id, isBookmarked) => updateTrendBookmark({ id, isBookmarked })}
          sourceName={sources.find(s => s.id === previewTrendTopic.source_id || s.id === previewTrendTopic.sourceId)?.name || previewTrendTopic.sourceName}
        />
      )}
    </div>
  );
}
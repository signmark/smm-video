import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Calendar, CheckCircle2, Clock, FileText, Image, Video, CheckSquare, XCircle, Smartphone, Layers, Brain, Sparkles, Database } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuthStore } from "@/lib/store";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

const MAX_TRENDS = 20;

interface CampaignTrendTopic {
  id: string;
  title: string;
  sourceName?: string;
  sourceUrl?: string;
  reactions: number;
  comments: number;
  views: number;
  createdAt: string;
  isBookmarked: boolean;
  campaignId: string;
  mediaLinks?: string;
  description?: string;
}

interface BusinessQuestionnaire {
  id: string;
  campaignId: string;
  companyName: string;
  businessDescription: string;
  targetAudience: string;
  productsServices: string;
  brandStyle: string;
  competitors: string;
  goals: string;
  communicationChannels: string;
  contentPreferences: string;
  additionalInfo: string;
}

interface ContentPlanGeneratorProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  onPlanGenerated?: (contentItems: any[], closeDialog?: boolean) => void;
}

export function ContentPlanGenerator({
  isOpen,
  onClose,
  campaignId,
  onPlanGenerated
}: ContentPlanGeneratorProps) {
  const [selectedTopicIds, setSelectedTopicIds] = useState<Set<string>>(new Set());
  const [contentCount, setContentCount] = useState(5);
  const [aiDecidesCount, setAiDecidesCount] = useState(false); // ИИ сам решает кол-во постов и расписание
  const [selectedType, setSelectedType] = useState<string>("mixed");
  const [includeBusiness, setIncludeBusiness] = useState(true);
  const [includeGeneratedImage, setIncludeGeneratedImage] = useState(true);
  const [customInstructions, setCustomInstructions] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState("trends");
  const [generatedContentPlan, setGeneratedContentPlan] = useState<any[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedContentItems, setSelectedContentItems] = useState<Set<number>>(new Set());
  const [jobId, setJobId] = useState<string | null>(null);
  const processedJobRef = useRef<string | null>(null);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Загружаем тренды кампании
  const { data: trendTopics = [], isLoading: isLoadingTrends } = useQuery({
    queryKey: ["campaign-trends", campaignId],
    queryFn: async ({ queryKey }) => {
      if (!campaignId) return [];
      
      try {
        const response = await apiRequest(`/api/campaign-trends?campaignId=${campaignId}`);
        return response.data || [];
      } catch (error) {
        console.error("Ошибка при загрузке трендов:", error);
        throw error;
      }
    },
    enabled: !!campaignId && isOpen
  });

  // Обработчик ошибок для трендов
  useEffect(() => {
    const handleError = (error: any) => {
      if (error) {
        toast({
          title: "Ошибка загрузки",
          description: `Не удалось загрузить тренды: ${error.message}`,
          variant: "destructive"
        });
      }
    };
    
    // Placeholder for error handling
    handleError(null);
  }, [toast]);

  // Загружаем ключевые слова кампании
  const { data: keywords = [], isLoading: isLoadingKeywords } = useQuery({
    queryKey: ["/api/keywords", campaignId],
    queryFn: async ({ queryKey }) => {
      if (!campaignId) return [];
      
      try {
        const response = await apiRequest(`/api/keywords?campaignId=${campaignId}`);
        // Бэкенд отдаёт массив напрямую; старую обёртку { data: [...] } тоже поддерживаем.
        return Array.isArray(response) ? response : (response?.data || []);
      } catch (error) {
        console.error("Ошибка при загрузке ключевых слов:", error);
        throw error;
      }
    },
    enabled: !!campaignId && isOpen
  });

  // Обработчик ошибок для ключевых слов
  useEffect(() => {
    const handleError = (error: any) => {
      if (error) {
        toast({
          title: "Ошибка загрузки",
          description: `Не удалось загрузить ключевые слова: ${error.message}`,
          variant: "destructive"
        });
      }
    };
    
    // Placeholder for error handling
    handleError(null);
  }, [toast]);

  // Загружаем данные бизнес-анкеты
  const { data: businessData, isLoading: isLoadingBusiness } = useQuery({
    queryKey: ["business-questionnaire", campaignId],
    queryFn: async ({ queryKey }) => {
      if (!campaignId) return null;
      
      try {
        console.log(`[ContentPlanGenerator] Загрузка анкеты для кампании: ${campaignId}`);
        const response = await apiRequest(`/api/campaigns/${campaignId}/questionnaire`);
        console.log(`[ContentPlanGenerator] Ответ анкеты:`, response);
        
        // В некоторых API ответ может быть обернут в { success: true, data: [...] }
        const data = response.data || response;
        
        // Если это массив, берем первый элемент (хотя роут /api/campaigns/:id/questionnaire обычно возвращает объект)
        const questionnaire = Array.isArray(data) ? data[0] : data;
        
        if (!questionnaire || Object.keys(questionnaire).length === 0 || (!questionnaire.id && !questionnaire.companyName && !questionnaire.company_name)) {
          console.log(`[ContentPlanGenerator] Анкета пуста или не найдена`);
          return null;
        }

        console.log(`[ContentPlanGenerator] Анкета успешно загружена:`, questionnaire.companyName || questionnaire.company_name);
        return questionnaire;
      } catch (error: any) {
        console.error(`[ContentPlanGenerator] Ошибка при загрузке анкеты:`, error);
        // Если ошибка 404, значит анкеты нет, это не ошибка
        if (error.response && error.response.status === 404) {
          return null;
        }
        throw error;
      }
    },
    enabled: !!campaignId && isOpen && includeBusiness
  });

  // Обработчик ошибок для бизнес-анкеты
  useEffect(() => {
    const handleError = (error: any) => {
      if (error) {
        toast({
          title: "Ошибка загрузки",
          description: `Не удалось загрузить данные бизнеса: ${error.message}`,
          variant: "destructive"
        });
      }
    };
    
    // Placeholder for error handling
    handleError(null);
  }, [toast]);

  // Поллинг статуса задачи генерации
  const { data: jobStatus } = useQuery({
    queryKey: ['/api/content/generate-plan/status', jobId],
    queryFn: () => apiRequest(`/api/content/generate-plan/status/${jobId}`),
    enabled: !!jobId && isGenerating,
    refetchInterval: (query) => {
      const data = query.state.data as any;
      if (data?.status === 'done' || data?.status === 'error') return false;
      return 500;
    }
  });

  // Обрабатываем результат когда задача завершилась
  useEffect(() => {
    if (!jobStatus || !jobId) return;
    if (processedJobRef.current === jobId) return;

    const status = (jobStatus as any).status;

    if (status === 'done') {
      processedJobRef.current = jobId;
      setIsGenerating(false);
      setJobId(null);
      const contentPlanData = (jobStatus as any).result?.contentPlan;

      if (contentPlanData && Array.isArray(contentPlanData) && contentPlanData.length > 0) {
        const normalizedContentPlan = contentPlanData.map((item: any) => ({
          title: item.title || "Без названия",
          content: item.content || item.text || "",
          contentType: item.contentType || item.type || "text",
          scheduledAt: item.scheduledAt || item.scheduled_at || null,
          hashtags: item.hashtags || [],
          keywords: item.keywords || [],
          imageUrl: item.imageUrl || item.image_url || null,
          videoUrl: item.videoUrl || item.video_url || null,
          prompt: item.prompt || null,
          originalPrompt: item.prompt || null
        }));

        setGeneratedContentPlan(normalizedContentPlan);
        setShowPreview(true);
        const initialSelectedItems = new Set<number>();
        contentPlanData.forEach((_: any, index: number) => initialSelectedItems.add(index));
        setSelectedContentItems(initialSelectedItems);
        setActiveTab("preview");
        toast({
          title: "Готово!",
          description: `Контент-план готов (${contentPlanData.length} постов). Выберите посты для сохранения.`,
        });
      } else {
        toast({
          title: "Ошибка формата данных",
          description: "Не удалось извлечь контент-план из ответа",
          variant: "destructive"
        });
      }
    } else if (status === 'error') {
      processedJobRef.current = jobId;
      setIsGenerating(false);
      setJobId(null);
      toast({
        title: "Ошибка генерации",
        description: (jobStatus as any).error || "Не удалось сгенерировать контент-план",
        variant: "destructive"
      });
    }
  }, [jobStatus, jobId, toast]);

  const handleGenerateContentPlan = async () => {
    const authToken = useAuthStore.getState().token;
    if (!authToken) {
      toast({ title: "Ошибка авторизации", description: "Вы не авторизованы", variant: "destructive" });
      return;
    }

    if (selectedTopicIds.size === 0 && activeTab === "trends") {
      toast({ description: "Выберите хотя бы один тренд для генерации", variant: "destructive" });
      return;
    }

    if (!campaignId) {
      toast({ title: "Ошибка", description: "Не указан ID кампании", variant: "destructive" });
      return;
    }

    setIsGenerating(true);
    processedJobRef.current = null;

    // «Смешанный» (все типы вперемешку) и «рандом» (случайный тип у поста) —
    // оба включают все доступные типы; отличаются инструкцией модели на бэке.
    const allTypes = selectedType === "mixed" || selectedType === "random";

    const requestData = {
      campaignId,
      settings: {
        postsCount: contentCount,
        contentType: selectedType,
        period: 14,
        aiDecidesCount, // ИИ сам решает кол-во постов и расписание (без потолка)
        // «Смешанный» и «рандом» включают ВСЕ типы; конкретный тип — только свои флаги.
        includeImages: includeGeneratedImage
          && (allTypes || selectedType === "image" || selectedType === "text-image"
            || selectedType === "text-image-mix"),
        includeVideos: allTypes || selectedType === "video",
        includeClips: allTypes || selectedType === "clip",
        includeStories: allTypes || selectedType === "story",
        customInstructions: customInstructions || null
      },
      selectedTrendTopics: Array.from(selectedTopicIds),
      keywords: keywords
        // Берём все непустые ключевые слова кампании; trendScore опционален (0 по умолчанию).
        // Раньше фильтр требовал trend_score > 0 и молча отбрасывал ручные слова без оценки.
        .filter((kw: any) => kw.keyword && kw.keyword.trim() !== '')
        .map((kw: any) => ({ keyword: kw.keyword, trendScore: kw.trend_score || kw.trendScore || 0 })),
      businessData: includeBusiness && businessData ? {
        companyName: businessData.companyName,
        businessDescription: businessData.businessDescription,
        targetAudience: businessData.targetAudience,
        productsServices: businessData.productsServices,
        brandStyle: businessData.brandStyle,
        businessValues: businessData.goals,
        competitiveAdvantages: businessData.competitors
      } : null
    };

    try {
      const response = await apiRequest('/api/content/generate-plan', { method: 'POST', data: requestData });
      setJobId((response as any).jobId);
    } catch (error: any) {
      setIsGenerating(false);
      toast({
        title: "Ошибка",
        description: error.message || "Не удалось запустить генерацию",
        variant: "destructive"
      });
    }
  };

  // Обработчик выбора/отмены тренда
  const toggleTopic = (topicId: string) => {
    const newSelectedTopics = new Set(selectedTopicIds);

    if (newSelectedTopics.has(topicId)) {
      newSelectedTopics.delete(topicId);
    } else {
      const limit = trendTopics.length <= MAX_TRENDS ? trendTopics.length : MAX_TRENDS;
      if (newSelectedTopics.size >= limit) {
        toast({
          title: `Максимум ${limit} трендов`,
          description: "Снимите выбор с одного тренда, чтобы добавить другой.",
          variant: "destructive",
        });
        return;
      }
      newSelectedTopics.add(topicId);
    }

    setSelectedTopicIds(newSelectedTopics);
  };

  // Обработчик выбора всех трендов
  const selectAllTopics = () => {
    const limit = trendTopics.length <= MAX_TRENDS ? trendTopics.length : MAX_TRENDS;
    const allTopicIds = trendTopics.slice(0, limit).map((topic: CampaignTrendTopic) => topic.id);
    setSelectedTopicIds(new Set(allTopicIds));
  };

  // Обработчик отмены выбора всех трендов
  const deselectAllTopics = () => {
    setSelectedTopicIds(new Set());
  };

  // Форматирование числа с добавлением сокращения для больших значений
  const formatNumber = (num: number): string => {
    if (num === null || num === undefined) return '0';
    
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    } else {
      return num.toString();
    }
  };

  // Объединяем состояния загрузки
  const isLoading = isLoadingTrends || isLoadingKeywords || (includeBusiness && isLoadingBusiness);

  // Добавляем эффект для сброса выбранных трендов при закрытии
  useEffect(() => {
    if (!isOpen) {
      setSelectedTopicIds(new Set());
    }
  }, [isOpen]);

  const currentStep = (jobStatus as any)?.step || '';
  const currentProgress = (jobStatus as any)?.progress || 0;
  const currentDetail = (jobStatus as any)?.detail || '';

  const steps = [
    { key: 'init', label: 'Инициализация', icon: Sparkles, match: ['Инициализация'] },
    { key: 'trends', label: 'Загрузка трендов', icon: Database, match: ['Загрузка трендов'] },
    { key: 'prompt', label: 'Составление промпта', icon: FileText, match: ['Составление промпта'] },
    { key: 'gen', label: 'Генерация AI', icon: Brain, match: ['Генерация контент-плана'] },
    { key: 'parse', label: 'Обработка ответа', icon: CheckCircle2, match: ['Обработка ответа', 'Готово'] },
  ];

  const activeStepIdx = steps.findIndex(s => s.match.some(m => currentStep.includes(m)));

  return (
    <>
      <DialogHeader>
        <DialogTitle>Генерация контент-плана</DialogTitle>
      </DialogHeader>

      {isGenerating && (
        <div className="my-4 p-5 rounded-xl border bg-muted/40 space-y-4">
          <div className="flex items-center gap-3">
            <Brain className="h-5 w-5 text-primary animate-pulse shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{currentStep || 'Запуск генерации...'}</p>
              {currentDetail && <p className="text-xs text-muted-foreground truncate">{currentDetail}</p>}
            </div>
            <span className="text-sm font-semibold text-primary shrink-0">{currentProgress}%</span>
          </div>

          <Progress value={currentProgress} className="h-2" />

          <div className="flex justify-between">
            {steps.map((step, idx) => {
              const Icon = step.icon;
              const isDone = activeStepIdx > idx || currentProgress === 100;
              const isActive = activeStepIdx === idx;
              return (
                <div key={step.key} className="flex flex-col items-center gap-1 flex-1">
                  <div className={`rounded-full p-1.5 transition-colors ${isDone ? 'bg-primary text-primary-foreground' : isActive ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {isDone ? <CheckCircle2 className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                  </div>
                  <span className={`text-[10px] text-center leading-tight hidden sm:block ${isActive ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-3">
          <TabsTrigger value="trends">Выбор трендов</TabsTrigger>
          <TabsTrigger value="settings">Настройки</TabsTrigger>
          <TabsTrigger value="preview" disabled={!showPreview}>Предпросмотр</TabsTrigger>
        </TabsList>
        
        <TabsContent value="trends" className="space-y-4 mt-4">
          {isLoadingTrends ? (
            <div className="flex justify-center items-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-2">Загрузка трендов...</span>
            </div>
          ) : trendTopics.length === 0 ? (
            <div className="text-center py-8 space-y-4">
              <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 text-left">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Тренды ещё не собраны</p>
                <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                  Перейдите в раздел «Тренды», добавьте источники (каналы, группы) и нажмите «Собрать тренды».
                </p>
              </div>
              <div className="p-4 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 text-left">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-200">Можно сгенерировать и без трендов</p>
                <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                  Переключитесь на вкладку «Настройки» — контент-план будет создан на основе ключевых слов и данных бизнес-анкеты.
                </p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-2"
                  onClick={() => setActiveTab("settings")}
                >
                  Перейти к настройкам
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center mb-4">
                <div>
                  {(() => {
                    const limit = trendTopics.length <= MAX_TRENDS ? trendTopics.length : MAX_TRENDS;
                    const atLimit = selectedTopicIds.size >= limit;
                    return (
                      <span className={`text-sm font-medium ${atLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
                        Выбрано {selectedTopicIds.size} / {limit}
                        {atLimit && trendTopics.length > MAX_TRENDS && ' — лимит достигнут'}
                      </span>
                    );
                  })()}
                </div>
                <div className="space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectAllTopics}
                    disabled={trendTopics.length === 0 || selectedTopicIds.size >= (trendTopics.length <= MAX_TRENDS ? trendTopics.length : MAX_TRENDS)}
                  >
                    Выбрать {trendTopics.length <= MAX_TRENDS ? trendTopics.length : MAX_TRENDS}
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={deselectAllTopics}
                    disabled={selectedTopicIds.size === 0}
                  >
                    Снять выбор
                  </Button>
                </div>
              </div>
              
              <div className="grid grid-cols-1 gap-4 max-h-[50vh] overflow-y-auto pr-2">
                {trendTopics.map((topic: CampaignTrendTopic) => {
                  const isSelected = selectedTopicIds.has(topic.id);
                  const limit = trendTopics.length <= MAX_TRENDS ? trendTopics.length : MAX_TRENDS;
                  const isDisabled = !isSelected && selectedTopicIds.size >= limit;
                  return (
                  <Card 
                    key={topic.id} 
                    className={`transition-colors ${
                      isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                    } ${isSelected ? 'border-primary bg-primary/5' : ''}`}
                    onClick={() => !isDisabled && toggleTopic(topic.id)}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-start">
                        <CardTitle className="text-base">{topic.title}</CardTitle>
                        <Checkbox 
                          checked={isSelected}
                          disabled={isDisabled}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isDisabled) toggleTopic(topic.id);
                          }}
                        />
                      </div>
                      <CardDescription className="flex items-center gap-2 text-xs">
                        {topic.sourceName && (
                          <span className="inline-flex items-center">
                            Источник: {topic.sourceName}
                          </span>
                        )}
                        {topic.createdAt && (
                          <span className="inline-flex items-center">
                            <Clock className="h-3 w-3 mr-1" />
                            {format(new Date(topic.createdAt), 'dd MMMM yyyy', {locale: ru})}
                          </span>
                        )}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pb-2">
                      {topic.description && (
                        <p className="text-sm line-clamp-2 mb-2">{topic.description}</p>
                      )}
                      <div className="flex gap-3 text-xs text-muted-foreground">
                        <span>👁 {formatNumber(topic.views || 0)}</span>
                        <span>❤️ {formatNumber(topic.reactions || 0)}</span>
                        <span>💬 {formatNumber(topic.comments || 0)}</span>
                      </div>
                    </CardContent>
                  </Card>
                  );
                })}
              </div>
            </>
          )}
        </TabsContent>
        
        <TabsContent value="settings" className="space-y-4 mt-4">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="content-count">Количество элементов контента</Label>
              <Input
                id="content-count"
                type="number"
                min={1}
                max={60}
                value={contentCount}
                onChange={(e) => setContentCount(parseInt(e.target.value))}
                disabled={aiDecidesCount}
              />
              <div className="flex items-center space-x-2 mt-1">
                <Checkbox
                  id="ai-decides-count"
                  checked={aiDecidesCount}
                  onCheckedChange={(v) => setAiDecidesCount(v === true)}
                />
                <Label htmlFor="ai-decides-count" className="cursor-pointer text-sm font-normal">
                  ИИ сам решает количество постов и расписание (без ограничения)
                </Label>
              </div>
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="content-type">Тип контента</Label>
              <Select value={selectedType} onValueChange={setSelectedType}>
                <SelectTrigger 
                  id="content-type" 
                  className="w-full !bg-white dark:!bg-gray-800 !text-black dark:!text-white !border-gray-300 dark:!border-gray-600"
                >
                  <SelectValue placeholder="Выберите тип контента" />
                </SelectTrigger>
                <SelectContent className="z-[9999] !bg-white dark:!bg-gray-800 !text-black dark:!text-white !border-gray-300 dark:!border-gray-600">
                  <SelectItem value="text" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Текст</SelectItem>
                  <SelectItem value="text-image" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Текст с картинкой</SelectItem>
                  <SelectItem value="image" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Только картинка</SelectItem>
                  <SelectItem value="video" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Видео</SelectItem>
                  <SelectItem value="clip" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Клип (Shorts/Reels)</SelectItem>
                  <SelectItem value="story" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Stories</SelectItem>
                  <SelectItem value="text-image-mix" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Текст + текст с картинкой (ИИ выбирает)</SelectItem>
                  <SelectItem value="mixed" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Смешанный (все типы вперемешку)</SelectItem>
                  <SelectItem value="random" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Рандом (случайный тип у каждого поста)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="include-business" 
                checked={includeBusiness} 
                onCheckedChange={(checked) => setIncludeBusiness(checked === true)}
              />
              <Label htmlFor="include-business" className="cursor-pointer">
                Использовать данные о бизнесе
              </Label>
            </div>
            
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="include-image" 
                checked={includeGeneratedImage} 
                onCheckedChange={(checked) => setIncludeGeneratedImage(checked === true)}
                disabled={selectedType === "text"}
              />
              <Label 
                htmlFor="include-image" 
                className={`cursor-pointer ${selectedType === "text" ? "text-muted-foreground" : ""}`}
              >
                Генерировать промт генерации для картинки
              </Label>
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="custom-instructions">Дополнительные инструкции</Label>
              <Textarea
                id="custom-instructions"
                placeholder="Укажите особые требования к генерируемому контенту..."
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          
          {isLoadingBusiness && includeBusiness && (
            <div className="flex items-center text-muted-foreground text-sm mt-4">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Загрузка данных о бизнесе...
            </div>
          )}
          
          {includeBusiness && !businessData && !isLoadingBusiness && (
            <div className="text-amber-500 text-sm mt-4 p-2 border border-amber-200 bg-amber-50 rounded">
              ⚠️ Данные о бизнесе не найдены. Заполните бизнес-анкету для лучших результатов.
              <div className="text-[10px] mt-1 opacity-50">ID кампании: {campaignId}</div>
            </div>
          )}
          
          {isLoadingKeywords && (
            <div className="flex items-center text-muted-foreground text-sm mt-2">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Загрузка ключевых слов...
            </div>
          )}
          
          {!isLoadingKeywords && keywords.length === 0 && (
            <div className="text-amber-500 text-sm">
              ⚠️ Ключевые слова не найдены. Добавьте ключевые слова для лучших результатов.
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="preview" className="space-y-4 mt-4">
          {generatedContentPlan.length === 0 ? (
            <div className="text-center py-8">
              <p>Сначала сгенерируйте контент-план.</p>
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <span className="text-sm text-muted-foreground">
                    Выбрано {selectedContentItems.size} из {generatedContentPlan.length} элементов
                  </span>
                </div>
                <div className="space-x-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                      const allItems = new Set<number>();
                      generatedContentPlan.forEach((_: any, index: number) => allItems.add(index));
                      setSelectedContentItems(allItems);
                    }}
                    disabled={generatedContentPlan.length === 0}
                  >
                    Выбрать все
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setSelectedContentItems(new Set())}
                    disabled={selectedContentItems.size === 0}
                  >
                    Снять выбор
                  </Button>
                </div>
              </div>
              
              <div className="grid grid-cols-1 gap-4 max-h-[50vh] overflow-y-auto pr-2">
                {generatedContentPlan.map((item: any, index: number) => (
                  <Card 
                    key={index} 
                    className={`cursor-pointer transition-colors ${
                      selectedContentItems.has(index) ? 'border-primary bg-primary/5' : ''
                    }`}
                    onClick={() => {
                      const newSelected = new Set(selectedContentItems);
                      if (newSelected.has(index)) {
                        newSelected.delete(index);
                      } else {
                        newSelected.add(index);
                      }
                      setSelectedContentItems(newSelected);
                    }}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-start">
                        <CardTitle className="text-base">{item.title}</CardTitle>
                        <Checkbox 
                          checked={selectedContentItems.has(index)} 
                          onClick={(e) => {
                            e.stopPropagation();
                            const newSelected = new Set(selectedContentItems);
                            if (newSelected.has(index)) {
                              newSelected.delete(index);
                            } else {
                              newSelected.add(index);
                            }
                            setSelectedContentItems(newSelected);
                          }}
                        />
                      </div>
                      <CardDescription className="flex items-center gap-2 text-xs">
                        <span className="inline-flex items-center">
                          <Calendar className="h-3 w-3 mr-1" />
                          {item.scheduledAt ? format(new Date(item.scheduledAt), 'dd MMMM yyyy, HH:mm', {locale: ru}) : 'Не запланировано'}
                        </span>
                        <span className="inline-flex items-center">
                          {item.contentType === 'text' && <FileText className="h-3 w-3 mr-1" />}
                          {item.contentType === 'text-image' && <Image className="h-3 w-3 mr-1" />}
                          {item.contentType === 'clip' && <Smartphone className="h-3 w-3 mr-1" />}
                          {item.contentType === 'video' && <Video className="h-3 w-3 mr-1" />}
                          {item.contentType === 'story' && <Layers className="h-3 w-3 mr-1" />}
                          {item.contentType === 'clip' ? 'Короткое видео' : 
                           item.contentType === 'video' ? 'Длинное видео' :
                           item.contentType === 'story' ? 'Stories' : item.contentType}
                        </span>
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pb-2">
                      <p className="text-sm line-clamp-3 mb-2">{item.content}</p>
                      {item.hashtags && item.hashtags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {item.hashtags.map((tag: string, tagIndex: number) => (
                            <span key={tagIndex} className="bg-secondary text-secondary-foreground px-2 py-0.5 rounded-md text-xs">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      {item.keywords && item.keywords.length > 0 && (
                        <div className="text-xs text-muted-foreground mt-2">
                          <span className="block font-medium">Ключевые слова:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {item.keywords.map((kw: any, kwIndex: number) => {
                              // Проверяем, является ли ключевое слово объектом или строкой
                              const keywordText = typeof kw === 'string' ? kw : (kw.keyword || kw);
                              const trendScore = typeof kw === 'object' ? (kw.trendScore || kw.trend_score || 0) : 0;
                              
                              // Если тренд отрицательный или нулевой, не отображаем его значение
                              
                              return (
                                <span key={kwIndex} className="bg-muted px-2 py-0.5 rounded-md">
                                  {keywordText}{trendScore > 0 ? ` (${trendScore})` : ''}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
      
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onClose}>
          Отмена
        </Button>
        
        {activeTab === "preview" && showPreview ? (
          <Button 
            onClick={() => {
              // Выбираем только те элементы контент-плана, которые были отмечены пользователем
              const selectedContent = Array.from(selectedContentItems).map(index => {
                const item = generatedContentPlan[index];
                
                // Подробное логирование для отладки
                console.log(`Передача элемента ${index} в родительский компонент:`, item);
                console.log(`Промпт в элементе: ${item.prompt || 'не указан'}`);
                
                // Сохраняем как оригинальный текст контента, так и промпт (если есть)
                // для использования при генерации изображений
                return {
                  ...item,
                  originalContent: item.content, // Сохраняем оригинальный текст как запасной вариант
                  // Используем промпт (если он есть) или контент в качестве промпта для изображений
                  imagePrompt: item.prompt || item.content 
                };
              });
              
              if (selectedContent.length === 0) {
                toast({
                  title: "Внимание",
                  description: "Выберите хотя бы один элемент контент-плана",
                  variant: "destructive"
                });
                return;
              }
              
              console.log("Сохраняем выбранный контент с оригинальным текстом для промптов:", selectedContent);
              
              if (onPlanGenerated) {
                // Вызываем с параметром true для закрытия диалога
                // Родительский компонент сам позаботится о закрытии диалога
                onPlanGenerated(selectedContent, true);
              } else {
                // Если onPlanGenerated не определен, просто закрываем диалог напрямую
                toast({
                  description: "Контент-план сохранен",
                });
                
                onClose();
              }
            }}
            disabled={selectedContentItems.size === 0}
          >
            Сохранить выбранное
          </Button>
        ) : (
          <Button 
            onClick={handleGenerateContentPlan} 
            disabled={isLoading || isGenerating || (activeTab === "trends" && selectedTopicIds.size === 0)}
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Генерация...
              </>
            ) : (
              "Сгенерировать контент-план"
            )}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
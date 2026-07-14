import { useState, useEffect, useRef, createRef } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardDescription, CardFooter } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Loader2, Plus, Pencil, Calendar, Send, SendHorizontal, Trash2, FileText,
  ImageIcon, Video, FilePlus2, CheckCircle2, Clock, RefreshCw, Play,
  Wand2, Share, Sparkles, CalendarDays, ChevronDown, ChevronRight,
  CalendarIcon, XCircle, Filter, Ban, CheckCircle, Upload, AlertCircle, Layers, ArchiveRestore, Copy, Lock, Zap
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { usePlan } from "@/hooks/use-plan";
import { useAuth } from "@/hooks/use-auth";
import { PublishingStatus } from "@/components/PublishingStatus";
import { ScheduledPostInfo } from "@/components/ScheduledPostInfo";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import ContentTypeDialog from "@/components/ContentTypeDialog";
import { InstagramStoriesPreview } from "@/components/InstagramStoriesPreview";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import type { Campaign, CampaignContent } from "@shared/schema";
import axios from "axios";
import { formatDistanceToNow, format, isAfter, isBefore, parseISO, startOfDay, endOfDay } from "date-fns";
import { ru } from "date-fns/locale";
import { ContentGenerationDialog } from "@/components/ContentGenerationDialog";
import { SocialContentAdaptationDialog } from "@/components/SocialContentAdaptationDialog";
import { ImageGenerationDialog } from "@/components/ImageGenerationDialog";
import { ContentPlanGenerator } from "@/components/ContentPlanGenerator";
import { useCampaignStore } from "@/lib/campaignStore";
import { publishWithImageGeneration } from "@/utils/publishWithImageGeneration";

// FORCE REBUILD 2025-11-22 15:15
import RichTextEditor from "@/components/RichTextEditor";
import { TextareaWithResize } from "@/components/TextareaWithResize";
import SocialMediaFilter from "@/components/SocialMediaFilter";
import SocialMediaIcon from "@/components/SocialMediaIcon";
import PlatformSelector from "@/components/PlatformSelector";
import { ImageUploader } from "@/components/ImageUploader";
import { AdditionalImagesUploader } from "@/components/AdditionalImagesUploader";
import { VideoUploader } from "@/components/VideoUploader";
import { AdditionalVideosUploader } from "@/components/AdditionalVideosUploader";
import { AdditionalMediaUploader } from "@/components/AdditionalMediaUploader";
import CreationTimeDisplay from "@/components/CreationTimeDisplay";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { DateTimePicker } from "@/components/ui/date-time-picker";

// Создаем формат даты
const formatDate = (date: string | Date) => {
  if (!date) return "";
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: ru });
};

// Функция для преобразования Markdown-подобного синтаксиса в HTML
const processMarkdownSyntax = (content: string): string => {
  if (!content) return "";

  // Сохраняем исходный контент для проверки изменений
  let processedContent = content;

  // Обработка заголовков разных уровней
  processedContent = processedContent
    .replace(/^###\s+(.*?)(?:\n|$)/gm, '<h3>$1</h3>') // h3 заголовки
    .replace(/^##\s+(.*?)(?:\n|$)/gm, '<h2>$1</h2>')  // h2 заголовки
    .replace(/^#\s+(.*?)(?:\n|$)/gm, '<h1>$1</h1>');  // h1 заголовки

  // Обработка жирного текста **текст** или __текст__
  processedContent = processedContent.replace(/(\*\*|__)(.*?)\1/g, '<strong>$2</strong>');

  // Обработка курсива *текст* или _текст_
  processedContent = processedContent.replace(/(\*|_)([^\*_]+)\1/g, '<em>$2</em>');

  // Обработка переносов строк (двойной перенос строки на абзацы)
  // Сначала разделяем контент на абзацы по двойным переносам
  const paragraphs = processedContent.split(/\n\s*\n/);

  // Обрабатываем каждый абзац
  processedContent = paragraphs.map(paragraph => {
    // Если абзац уже содержит HTML-тег, оставляем как есть
    if (paragraph.trim().startsWith('<') && !paragraph.trim().startsWith('<em>') && !paragraph.trim().startsWith('<strong>')) {
      return paragraph;
    }

    // Иначе оборачиваем в <p>
    return `<p>${paragraph.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  return processedContent;
};

// Очистка AI-ответа от вводных и завершающих фраз
const cleanAiText = (text: string): string => {
  let cleaned = text.trim();

  // Удаляем вводные фразы в начале (многострочный вариант)
  const introPatterns = [
    /^(Конечно[,!]?\s+вот\s+[^:\n]*[:\n]+\s*)/i,
    /^(Конечно[,!]?\s+я\s+[^.\n]*[.\n]+\s*)/i,
    /^(Конечно[,!]\s+)/i,
    /^(Привет[,!]\s+[^.\n]*[.\n]+\s*)/i,
    /^(Разумеется[,!]\s+[^.\n]*[.\n]+\s*)/i,
    /^(С\s+удовольствием[,!]\s+[^.\n]*[.\n]+\s*)/i,
    /^(Вот\s+(вариант|пример|пост|текст)[^:\n]*[:\n]+\s*)/i,
    /^(Отлично[,!]\s+[^.\n]*[.\n]+\s*)/i,
    /^(Хорошо[,!]\s+[^.\n]*[.\n]+\s*)/i,
    /^(Я\s+подготовил[^.\n]*[.\n]+\s*)/i,
    /^(Я\s+написал[^.\n]*[.\n]+\s*)/i,
    /^(Вот\s+что\s+[^:\n]*[:\n]+\s*)/i,
  ];
  for (const pattern of introPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Удаляем завершающие фразы в конце
  const outroPatterns = [
    /\n+\s*Надеюсь[^.]*\.\s*$/i,
    /\n+\s*Нужно ли что[^?]*\?\s*$/i,
    /\n+\s*Нужна ли[^?]*\?\s*$/i,
    /\n+\s*Если[^,]+, (дайте знать|скажите|напишите)[^.]*\.\s*$/i,
    /\n+\s*Буду рад[^.]*\.\s*$/i,
    /\n+\s*Хотите[^?]*\?\s*$/i,
    /\n+\s*Могу[^.]*\.\s*$/i,
    /\n+\s*Готов[^.]*\.\s*$/i,
    /\n+\s*Дайте знать[^.]*\.\s*$/i,
    /\n+\s*Пишите[^.]*\.\s*$/i,
    /\n+\s*Обращайтесь[^.]*\.\s*$/i,
  ];
  for (const pattern of outroPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Markdown-заголовки ### → жирный текст (для совместимости с соцсетями)
  cleaned = cleaned.replace(/^#{1,6}\s+(.+)$/gm, '**$1**');

  // Удаляем блоки кода
  cleaned = cleaned.replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, '').trim());

  // Инлайн-код
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

  // Зачёркнутый
  cleaned = cleaned.replace(/~~(.+?)~~/g, '$1');

  // Маркированные списки - • вместо -
  cleaned = cleaned.replace(/^[-*]\s+/gm, '• ');

  return cleaned.trim();
};

export default function ContentPage() {
  const { t } = useTranslation();
  const { limits, effectivePlan, isExpired } = usePlan();
  const { user } = useAuth();

  // Feature flag: стиль доступен только для signmark@gmail.com
  const userId = user?.user?.id || user?.id;
  const token = localStorage.getItem('auth_token');
  const { data: userProfile } = useQuery<{ email: string }>({
    queryKey: ['/api/user/profile', userId || 'me', token],
    enabled: !!userId,
  });
  const isStyleFeatureEnabled = userProfile?.email === 'signmark@gmail.com';

  const { data: imageGenUsage } = useQuery<{
    count: number; limit: number | null; remaining: number | null; month: string;
  }>({
    queryKey: ['/api/user/image-gen-usage'],
    enabled: limits.aiImageGeneration,
    staleTime: 0,
    refetchOnMount: true,
  });
  // Используем глобальный стор выбранной кампании
  const { selectedCampaign } = useCampaignStore();
  const [location, navigate] = useLocation();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(selectedCampaign?.id || "");

  // Bulk selection state (declared early so useEffect can reference it)
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [bulkProgressText, setBulkProgressText] = useState('');
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  // Обновляем локальный ID кампании когда меняется глобальный выбор
  useEffect(() => {
    if (selectedCampaign?.id) {
      setSelectedCampaignId(selectedCampaign.id);
      setBulkSelectedIds(new Set());
    }
  }, [selectedCampaign]);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
  const [isAdaptDialogOpen, setIsAdaptDialogOpen] = useState(false);
  const [isImageGenerationDialogOpen, setIsImageGenerationDialogOpen] = useState(false);
  const [isContentPlanDialogOpen, setIsContentPlanDialogOpen] = useState(false);
  const [isContentTypeDialogOpen, setIsContentTypeDialogOpen] = useState(false);
  const [currentContent, setCurrentContent] = useState<CampaignContent | null>(null);
  const [deletingContentId, setDeletingContentId] = useState<string | null>(null);
  const [unpublishingContentId, setUnpublishingContentId] = useState<string | null>(null);
  const [cloningContentId, setCloningContentId] = useState<string | null>(null);
  const [selectedKeywordIds, setSelectedKeywordIds] = useState<Set<string>>(new Set());

  // Вспомогательная функция для безопасной установки контента с гарантией наличия массива keywords
  // ВАЖНО: Всегда используйте эту функцию вместо setCurrentContent при установке ненулевых значений,
  // чтобы избежать ошибок типа "keywords is not iterable"
  const setCurrentContentSafe = (content: CampaignContent | null) => {
    if (content) {
      // Гарантируем, что keywords всегда массив
      let processedKeywords: string[] = [];

      // Обрабатываем ключевые слова для обеспечения правильного формата
      if (content.keywords) {
        if (Array.isArray(content.keywords)) {
          processedKeywords = content.keywords.map(k => {
            // Проверяем, является ли k объектом с полем keyword
            if (k && typeof k === 'object' && 'keyword' in k) {
              return k.keyword;
            }
            // Если это простой объект без специфической структуры
            if (k && typeof k === 'object') {

              return JSON.stringify(k);
            }
            // Если это строка - используем как есть
            return typeof k === 'string' ? k : String(k);
          });
        } else if (typeof content.keywords === 'string') {
          try {
            // Пытаемся разобрать JSON строку
            const parsed = JSON.parse(content.keywords);
            if (Array.isArray(parsed)) {
              processedKeywords = parsed.map(k => {
                if (k && typeof k === 'object' && 'keyword' in k) {
                  return k.keyword;
                }
                return typeof k === 'string' ? k : String(k);
              });
            } else {
              processedKeywords = [content.keywords];
            }
          } catch (e) {
            // Если не JSON, просто используем как строку
            processedKeywords = [content.keywords];
          }
        } else if (content.keywords !== null) {
          // Для всех других случаев

          if (typeof content.keywords === 'object') {
            // Пытаемся извлечь информацию из объекта
            const extractedKeywords = Object.values(content.keywords)
              .filter(v => typeof v === 'string')
              .map(v => String(v));
            if (extractedKeywords.length > 0) {
              processedKeywords = extractedKeywords;
            } else {
              processedKeywords = [JSON.stringify(content.keywords)];
            }
          } else {
            processedKeywords = [String(content.keywords)];
          }
        }
      }

      const safeContent = {
        ...content,
        keywords: processedKeywords
      };


      setCurrentContent(safeContent);

      // Сбрасываем и заново устанавливаем выбранные ключевые слова
      const newSelectedKeywords = new Set<string>();

      // Добавляем ID из предопределенных ключевых слов
      if (Array.isArray(safeContent.keywords)) {


        campaignKeywords.forEach(kw => {
          // Строгое сравнение и нормализация строк для более надежного сопоставления
          const normalizedKeyword = kw.keyword.trim().toLowerCase();
          const hasKeyword = safeContent.keywords.some(
            k => typeof k === 'string' && k.trim().toLowerCase() === normalizedKeyword
          );



          if (hasKeyword) {
            newSelectedKeywords.add(kw.id);
          }
        });
      }

      setSelectedKeywordIds(newSelectedKeywords);

    } else {
      setCurrentContent(null);
      setSelectedKeywordIds(new Set());
    }
  };
  const [newContent, setNewContent] = useState({
    title: "",
    content: "",
    contentType: "text",
    imageUrl: "",
    additionalImages: [] as string[], // Массив URL-адресов дополнительных изображений
    videoUrl: "",
    videoThumbnail: "", // Обложка для видео (thumbnail)
    additionalVideos: [] as string[], // Массив URL-адресов дополнительных видео
    prompt: "", // Добавляем поле промта для генерации изображений
    keywords: [] as string[]
  });

  // Состояние загрузки видео - блокирует создание контента пока видео грузится
  const [isVideoUploading, setIsVideoUploading] = useState(false);

  // Inline AI generation в форме создания/редактирования
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiModel, setAiModel] = useState<'gemini-3.5-flash' | 'gemini-2.5-flash' | 'gemini-2.5-pro' | 'gemini-3.0-pro' | 'deepseek' | 'qwen'>('gemini-3.5-flash');
  const [aiPromptText, setAiPromptText] = useState('');
  const [aiTone, setAiTone] = useState('informative');
  const [aiUseCampaignData, setAiUseCampaignData] = useState(true);
  const [aiSelectedKeywords, setAiSelectedKeywords] = useState<string[]>([]);
  const [aiMatchStyle, setAiMatchStyle] = useState(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [showAiImagePanel, setShowAiImagePanel] = useState(false);

  // Fast polling when actions are in progress
  const [isActionActive, setIsActionActive] = useState(false);
  const actionCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerFastPolling = () => {
    setIsActionActive(true);
    if (actionCooldownRef.current) clearTimeout(actionCooldownRef.current);
    actionCooldownRef.current = setTimeout(() => setIsActionActive(false), 15000);
  };

  // Дефолтное время планирования: сегодня + 1 час, округленное до часа
  const getDefaultScheduleDate = () => {
    const now = new Date();
    now.setHours(now.getHours() + 1);
    now.setMinutes(0);
    now.setSeconds(0);
    now.setMilliseconds(0);
    return now;
  };

  const [scheduleDate, setScheduleDate] = useState<Date | undefined>(getDefaultScheduleDate());
  const [selectedPlatforms, setSelectedPlatforms] = useState<{ [key: string]: boolean }>({
    instagram: false,
    telegram: false,
    vk: false,
    facebook: false,
    youtube: false,
    threads: false
  });
  const [activeTab, setActiveTab] = useState<string>("all");

  // Состояние для фильтрации по датам
  const [dateRange, setDateRange] = useState<{
    from: Date | undefined;
    to: Date | undefined;
  }>({
    from: undefined,
    to: undefined,
  });
  // Состояние для отображения фильтра по датам
  const [isDateFilterOpen, setIsDateFilterOpen] = useState(false);

  const { toast, dismiss: dismissToast, update: updateToast } = useToast();
  const [publishState, setPublishState] = useState<'idle' | 'publishing' | 'done'>('idle');
  const [publishResults, setPublishResults] = useState<{
    succeeded: Array<{ platform: string; name: string }>;
    failed: Array<{ platform: string; name: string; error: string }>;
  } | null>(null);
  const queryClient = useQueryClient();

  // Закрытие диалога и показ toast после завершения публикации
  useEffect(() => {
    if (publishState === 'done' && publishResults) {
      // Сначала закрываем диалог
      setIsScheduleDialogOpen(false);

      // Затем показываем toast через небольшую задержку
      const { succeeded, failed } = publishResults;
      const timer = setTimeout(() => {
        if (succeeded.length > 0 && failed.length === 0) {
          toast({
            title: 'Опубликовано',
            description: `Успешно: ${succeeded.map(s => s.name).join(', ')}`,
          });
        } else if (succeeded.length > 0 && failed.length > 0) {
          toast({
            title: 'Частично опубликовано',
            description: `Успешно: ${succeeded.map(s => s.name).join(', ')}. Ошибки: ${failed.map(f => `${f.name}: ${f.error}`).join(', ')}`,
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Ошибка публикации',
            description: failed.map(f => `${f.name}: ${f.error}`).join('; '),
            variant: 'destructive',
          });
        }
        // Сбрасываем состояние
        setPublishState('idle');
        setPublishResults(null);
        queryClient.invalidateQueries({ queryKey: ['/api/campaign-content'] });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [publishState, publishResults, toast, queryClient]);

  // Обёртка: открыть генерацию изображений только если это не ограничено тарифом
  const openImageGenIfAllowed = () => {
    if (!limits.aiImageGeneration) {
      toast({
        variant: 'destructive',
        title: 'Функция недоступна',
        description: 'Генерация изображений недоступна на вашем тарифе.',
      });
      return;
    }
    if (effectivePlan === 'basic' && imageGenUsage && imageGenUsage.remaining !== null && imageGenUsage.remaining <= 0) {
      toast({
        variant: 'destructive',
        title: 'Лимит генераций исчерпан',
        description: `Использовано ${imageGenUsage.count}/${imageGenUsage.limit} генераций в этом месяце. Обновите тариф до Pro.`,
      });
      return;
    }
    setIsImageGenerationDialogOpen(true);
  };

  // Отслеживание предыдущих статусов контента для показа тостов при изменении
  const [previousStatuses, setPreviousStatuses] = useState<Record<string, string>>({});

  // Auto-uncheck Instagram when content has no images
  useEffect(() => {
    if (currentContent && isScheduleDialogOpen) {
      const hasImages = currentContent.imageUrl ||
        (currentContent.images && currentContent.images.length > 0) ||
        currentContent.contentType === 'image' ||
        currentContent.contentType === 'text-image' ||
        currentContent.contentType === 'video';

      if (!hasImages && selectedPlatforms.instagram) {
        setSelectedPlatforms(prev => ({
          ...prev,
          instagram: false
        }));
      }
    }
  }, [currentContent?.id, currentContent?.imageUrl, currentContent?.images, currentContent?.contentType, isScheduleDialogOpen]);



  // Автоматическое открытие диалога создания при переходе на /content/new
  useEffect(() => {
    if (location === '/content/new' && selectedCampaignId && selectedCampaignId !== "loading" && selectedCampaignId !== "empty") {
      setIsContentTypeDialogOpen(true);
      // Перенаправляем на /content чтобы URL был чистым
      navigate('/content', { replace: true });
    }
  }, [location, selectedCampaignId, navigate]);

  // Force refetch data when campaign changes OR when navigating to content page
  useEffect(() => {
    if (selectedCampaignId && selectedCampaignId !== 'loading' && selectedCampaignId !== 'empty' &&
        (location === '/content' || location === '/content/new')) {
      // refetchQueries форсирует запрос независимо от staleTime
      queryClient.refetchQueries({ queryKey: ["/api/campaign-content", selectedCampaignId] });
      queryClient.refetchQueries({ queryKey: ["/api/campaign-content", selectedCampaignId || ""] });
      queryClient.invalidateQueries({ queryKey: ["/api/keywords", selectedCampaignId] });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampaignId, location]); // location нужен чтобы перечитывать при навигации на страницу

  // Запрос списка кампаний
  const { data: campaignsResponse, isLoading: isLoadingCampaigns } = useQuery({
    queryKey: ["/api/campaigns"],
    queryFn: async () => {
      const response = await fetch('/api/campaigns', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });
      if (!response.ok) {
        throw new Error('Failed to fetch campaigns');
      }
      return response.json();
    },
    staleTime: 10 * 1000,
    refetchOnWindowFocus: true,
  });

  const campaigns = campaignsResponse?.data || [];

  // Запрос полных данных выбранной кампании для получения socialMediaSettings
  const { data: fullCampaignData, isLoading: isLoadingCampaign } = useQuery({
    queryKey: ["campaign-detail", selectedCampaignId],
    queryFn: async () => {
      if (!selectedCampaignId) return null;

      const response = await fetch(`/api/campaigns/${selectedCampaignId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });
      if (!response.ok) {
        throw new Error('Failed to fetch campaign details');
      }
      return response.json();
    },
    enabled: !!selectedCampaignId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  const contentStyle = (fullCampaignData?.data as any)?.content_style || null;

  // Определяем подключенные платформы из настроек кампании.
  // Возвращает null если данные ещё не загружены (→ UI показывает все платформы активными).
  // Возвращает объект с явными true/false когда данные есть.
  const getConnectedPlatforms = (): Record<string, boolean> | null => {
    // fullCampaignData.data может быть объектом (detail) или массивом (если React Query вернул кэш списка)
    const rawData = fullCampaignData?.data;
    const campaignData = Array.isArray(rawData)
      ? rawData.find((c: any) => c.id === selectedCampaignId)
      : rawData || (campaigns as any[])?.find((c: any) => c.id === selectedCampaignId);

    const settingsRaw =
      campaignData?.social_media_settings ||
      campaignData?.socialMediaSettings ||
      campaignData?.social_settings;

    // Directus может отдать JSON как строку — парсим
    let settings: any;
    try {
      settings = typeof settingsRaw === 'string' ? JSON.parse(settingsRaw) : settingsRaw;
    } catch {
      settings = settingsRaw;
    }

    if (!settings || typeof settings !== 'object') {
      return null;
    }

    // Настройки загружены — проверяем что реально подключено
    const result: Record<string, boolean> = {
      instagram: !!(settings.instagram?.accessToken || settings.instagram?.token),
      telegram: !!(settings.telegram?.token || settings.telegram?.chatId),
      vk: !!(settings.vk?.token || settings.vk?.groupId),
      facebook: !!(settings.facebook?.accessToken || settings.facebook?.pageId || settings.facebook?.token),
      youtube: !!(settings.youtube?.accessToken || settings.youtube?.refreshToken),
      threads: !!(settings.threads?.accessToken && settings.threads?.threadsUserId),
    };

    return result;
  };

  const connectedPlatforms = getConnectedPlatforms();

  // Автовыбор платформ при открытии диалога публикации:
  // выбираем все подключённые платформы, которые поддерживают тип контента
  const getAutoSelectedPlatforms = (content: any) => {
    const connected = getConnectedPlatforms();

    // Проверяем только реальные URL картинок — тип контента не гарантирует наличие фото
    const hasImage = !!(
      content?.imageUrl ||
      (content?.images && content.images.length > 0) ||
      content?.additionalImages?.length
    );
    const hasVideo = !!(
      content?.videoUrl ||
      content?.video_url ||
      content?.contentType === 'video' ||
      content?.contentType === 'clip' ||
      content?.contentType === 'shorts' ||
      content?.contentType === 'short_video' ||
      content?.contentType === 'video_clip' ||
      (content?.additionalVideos && content.additionalVideos.length > 0)
    );
    const isStory = content?.contentType === 'story';

    // Если connected=null — данные ещё не загружены, не авто-выбираем ничего
    if (!connected) {
      return {
        instagram: false,
        telegram: false,
        vk: false,
        facebook: false,
        youtube: false,
        threads: false,
      };
    }

    return {
      telegram: !!(connected.telegram && !isStory),
      vk: !!connected.vk,
      facebook: !!(connected.facebook && !isStory),
      threads: !!(connected.threads && !isStory),
      instagram: !!(connected.instagram && (hasImage || hasVideo || isStory)),
      youtube: !!(connected.youtube && hasVideo),
    };
  };

  // Тайминг-фикс: если диалог открыт, но данные кампании загрузились позже —
  // применяем авто-выбор платформ как только fullCampaignData стал доступен
  useEffect(() => {
    if (!isScheduleDialogOpen || !currentContent || !fullCampaignData) return;
    const autoSelected = getAutoSelectedPlatforms(currentContent);
    const anyAutoSelected = Object.values(autoSelected).some(Boolean);
    // Применяем только если ещё ничего не выбрано (не перетираем выбор пользователя)
    setSelectedPlatforms(prev => {
      const anyCurrently = Object.values(prev).some(Boolean);
      if (anyAutoSelected && !anyCurrently) return autoSelected;
      return prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullCampaignData, isScheduleDialogOpen, currentContent?.id]);


  // Запрос списка контента для выбранной кампании
  const { data: campaignContent = [], isLoading: isLoadingContent, isFetching: isFetchingContent, refetch: refetchContent } = useQuery<CampaignContent[]>({
    queryKey: ["/api/campaign-content", selectedCampaignId || ""],
    queryFn: async () => {
      if (!selectedCampaignId) return [];

      const data = await apiRequest(`/api/campaign-content?campaignId=${selectedCampaignId}&page=1&limit=500`, {
        method: 'GET'
      });

      return data.data || [];
    },
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    staleTime: isActionActive || isAiGenerating || isBulkProcessing ? 0 : Infinity,
    gcTime: 1000 * 60 * 30,
    refetchInterval: isActionActive || isAiGenerating || isBulkProcessing ? 3000 : false,
    placeholderData: keepPreviousData,
  });

  // Запрос ключевых слов кампании
  const { data: campaignKeywords = [], isLoading: isLoadingKeywords } = useQuery<any[]>({
    queryKey: ["/api/keywords", selectedCampaignId || ""],
    queryFn: async () => {
      if (!selectedCampaignId) return [];

      const response = await fetch(`/api/keywords?campaignId=${selectedCampaignId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (!response.ok) {
        console.error('[Frontend] Failed to fetch keywords:', response.status);
        throw new Error('Failed to fetch campaign keywords');
      }

      const data = await response.json();

      // Backend returns the array directly now
      if (Array.isArray(data)) {
        return data;
      }

      // Fallback for old structure if any
      return data.data || [];
    },
    refetchOnMount: false,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 30,
    refetchInterval: false
  });

  // Эффект для отслеживания изменений статуса контента и показа тостов
  useEffect(() => {
    if (!Array.isArray(campaignContent)) return;

    campaignContent.forEach((content: any) => {
      const contentId = content.id;
      const currentStatus = content.status;
      const previousStatus = previousStatuses[contentId];

      // Если статус изменился с любого на "published", показываем тост
      if (previousStatus && previousStatus !== 'published' && currentStatus === 'published') {

        toast({
          title: t('content.messages.contentPublished'),
          description: t('content.messages.contentPublishedDesc', { title: content.title }),
        });
      }

      // Обновляем предыдущие статусы
      setPreviousStatuses(prev => ({
        ...prev,
        [contentId]: currentStatus
      }));
    });
  }, [campaignContent, previousStatuses, toast]);

  // Мутация для создания контента
  const createContentMutation = useMutation({
    mutationFn: async (contentData: any) => {
      triggerFastPolling();
      return await apiRequest('/api/campaign-content', {
        method: 'POST',
        data: contentData
      });
    },
    onSuccess: () => {
      // Показываем уведомление об успехе
      toast({
        description: t('content.messages.contentCreated'),
      });

      // Сбрасываем форму
      setNewContent({
        title: "",
        content: "",
        contentType: "text",
        imageUrl: "",
        additionalImages: [],
        videoUrl: "",
        videoThumbnail: "",
        additionalVideos: [], // Сбрасываем дополнительные видео
        prompt: "", // Сохраняем поле prompt
        keywords: []
      });

      // Закрываем диалог сразу
      setIsCreateDialogOpen(false);

      // Обновляем данные в фоне
      queryClient.invalidateQueries({ queryKey: ["/api/campaign-content", selectedCampaignId] });
    },
    onError: (error: Error) => {
      toast({
        title: t('content.messages.createError'),
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Мутация для обновления контента
  const updateContentMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string, data: any }) => {
      triggerFastPolling();
      // Убедимся, что keywords всегда массив и JSON-сериализуем его
      if (data.keywords) {


        // Проверяем, что keywords это массив
        if (!Array.isArray(data.keywords)) {
          console.warn('Keywords is not an array, converting:', data.keywords);
          data.keywords = data.keywords ? [String(data.keywords)] : [];
        }
      }

      return await apiRequest(`/api/publish/update-content/${id}`, {
        method: 'PATCH',
        data
      });
    },
    onSuccess: (data) => {
      // Показываем тост в любом случае, чтобы уведомить пользователя
      toast({
        description: t('content.messages.contentUpdated'),
      });

      // Принудительно закрываем форму сразу
      setIsEditDialogOpen(false);
      setCurrentContent(null);

      // Обновляем данные в фоне
      queryClient.invalidateQueries({ queryKey: ["/api/campaign-content", selectedCampaignId] });
    },
    onError: (error: Error) => {
      console.error('Content update error:', error);
      toast({
        title: t('content.messages.updateError'),
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Мутация для снятия публикации и переноса в черновики (ДЕПОСТИНГ)
  const unpublishContentMutation = useMutation({
    mutationFn: async (id: string) => {
      triggerFastPolling();
      console.log('[UNPUBLISH] Starting unpublish for content:', id);
      try {
        // Вызываем endpoint для снятия публикации из соцсетей
        const result = await apiRequest(`/api/content/${id}/unpublish`, {
          method: 'POST'
        });
        console.log('[UNPUBLISH] Success response:', result);
        return result;
      } catch (error) {
        console.error('[UNPUBLISH] Error during request:', error);
        throw error;
      }
    },
    onSuccess: (data: any) => {
      console.log('[UNPUBLISH] onSuccess called with data:', data);
      // Обновляем данные
      queryClient.invalidateQueries({ queryKey: ["/api/campaign-content", selectedCampaignId] })
        .then(() => {
          // Показываем результаты удаления из соцсетей
          const results = data.deletionResults || [];
          const successCount = results.filter((r: any) => r.success).length;
          const failCount = results.filter((r: any) => !r.success).length;

          let message = 'Публикация снята и перенесена в черновики';
          if (successCount > 0) {
            message += `. Удалено из ${successCount} соцсет${successCount === 1 ? 'и' : 'ей'}`;
          }
          if (failCount > 0) {
            message += `. Ошибка удаления из ${failCount} платформ${failCount === 1 ? 'ы' : ''}`;
          }

          toast({
            description: message,
          });
        });
    },
    onError: (error: Error) => {
      console.error('[UNPUBLISH] onError called with error:', error);
      toast({
        title: 'Ошибка снятия публикации',
        description: error.message,
        variant: "destructive"
      });
    },
    onSettled: () => {
      setUnpublishingContentId(null);
    }
  });

  // Мутация для полного удаления контента из базы данных
  const deleteContentMutation = useMutation({
    mutationFn: async (id: string) => {
      triggerFastPolling();
      setDeletingContentId(id);
      // Вызываем endpoint для полного удаления контента
      return await apiRequest(`/api/content/${id}`, {
        method: 'DELETE'
      });
    },
    onSuccess: () => {
      // Обновляем данные
      queryClient.invalidateQueries({ queryKey: ["/api/campaign-content", selectedCampaignId] });
      toast({
        description: 'Контент успешно удален',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Ошибка удаления контента',
        description: error.message,
        variant: "destructive"
      });
    },
    onSettled: () => {
      setDeletingContentId(null);
    }
  });

  const cloneContentMutation = useMutation({
    mutationFn: async (id: string) => {
      setCloningContentId(id);
      return await apiRequest(`/api/clone-content/${id}`, { method: 'POST' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaign-content", selectedCampaignId] });
      toast({ description: 'Копия контента создана в черновиках' });
    },
    onError: (error: Error) => {
      toast({ title: 'Ошибка клонирования', description: error.message, variant: "destructive" });
    },
    onSettled: () => {
      setCloningContentId(null);
    }
  });

  // ─── Bulk selection helpers ───────────────────────────────────────────────
  const toggleBulkSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setBulkSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setBulkSelectedIds(new Set(filteredContent.map((c: any) => c.id)));
  };

  const clearBulkSelection = () => setBulkSelectedIds(new Set());

  const bulkDelete = async () => {
    setIsBulkProcessing(true);
    const ids = Array.from(bulkSelectedIds);
    let done = 0;
    for (const id of ids) {
      setBulkProgressText(`Удаление ${++done} из ${ids.length}...`);
      try { await apiRequest(`/api/content/${id}`, { method: 'DELETE' }); } catch (_) {}
    }
    setBulkSelectedIds(new Set());
    setShowBulkDeleteConfirm(false);
    setIsBulkProcessing(false);
    setBulkProgressText('');
    queryClient.invalidateQueries({ queryKey: ["/api/campaign-content", selectedCampaignId] });
    toast({ description: `Удалено ${ids.length} постов` });
  };

  const bulkEditorPass = async () => {
    setIsBulkProcessing(true);
    const ids = Array.from(bulkSelectedIds);
    let done = 0; let ok = 0;
    for (const id of ids) {
      setBulkProgressText(`Редактура ${++done} из ${ids.length}...`);
      try { await apiRequest(`/api/content/${id}/editor-pass`, { method: 'POST' }); ok++; } catch (_) {}
    }
    setBulkSelectedIds(new Set());
    setIsBulkProcessing(false);
    setBulkProgressText('');
    queryClient.invalidateQueries({ queryKey: ["/api/campaign-content", selectedCampaignId] });
    toast({ description: `Редактура завершена: ${ok} из ${ids.length} постов` });
  };

  const bulkAdapt = async () => {
    setIsBulkProcessing(true);
    const ids = Array.from(bulkSelectedIds);
    const platforms = ['telegram', 'vk', 'instagram', 'facebook', 'youtube', 'threads'];
    let done = 0; let ok = 0;
    for (const id of ids) {
      setBulkProgressText(`Адаптация ${++done} из ${ids.length}...`);
      try {
        const c = (filteredContent as any[]).find((x: any) => x.id === id);
        const text: string = c?.content || '';
        if (!text.trim()) continue;
        const socialPlatforms: Record<string, any> = {};
        platforms.forEach(platform => {
          let adapted = text;
          if (platform === 'instagram' && text.length > 1800) adapted = text.substring(0, 1800) + '...';
          socialPlatforms[platform] = { caption: adapted, status: 'pending', publishedAt: null, postId: null, postUrl: null, error: null };
        });
        await apiRequest(`/api/campaign-content/${id}`, { method: 'PATCH', data: { social_platforms: socialPlatforms } });
        ok++;
      } catch (_) {}
    }
    setBulkSelectedIds(new Set());
    setIsBulkProcessing(false);
    setBulkProgressText('');
    queryClient.invalidateQueries({ queryKey: ["/api/campaign-content", selectedCampaignId] });
    toast({ description: `Адаптация завершена: ${ok} из ${ids.length} постов` });
  };
  // ─────────────────────────────────────────────────────────────────────────

  // Мутация для планирования публикации
  const scheduleContentMutation = useMutation({
    mutationFn: async ({ id, scheduledAt, platforms }: { id: string, scheduledAt: string, platforms?: { [key: string]: boolean } }) => {
      triggerFastPolling();
      // Подготовка данных о платформах
      const socialPlatformsData: Record<string, any> = {};

      // Если есть выбранные платформы, настраиваем их в JSON-структуру
      if (platforms) {
        Object.entries(platforms).forEach(([platform, isEnabled]) => {
          if (isEnabled) {
            socialPlatformsData[platform] = {
              status: 'pending',
              publishedAt: null,
              postId: null,
              postUrl: null,
              error: null
            };
          }
        });
      }



      const requestData = {
        scheduledAt,
        status: 'scheduled',
        socialPlatforms: socialPlatformsData // Всегда передаем объект, даже если он пустой
      };



      // Используем новый маршрут direct-schedule вместо patch к campaign-content
      return await apiRequest(`/api/direct-schedule/${id}`, {
        method: 'POST',
        data: requestData
      });
    },
    onSuccess: () => {
      // Сначала обновляем данные, затем закрываем диалог
      queryClient.invalidateQueries({ queryKey: ["/api/campaign-content", selectedCampaignId] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaign-content", selectedCampaignId, "scheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/publish/scheduled"] });

      toast({
        description: t('content.messages.publicationScheduled'),
      });
      setIsScheduleDialogOpen(false);
      setCurrentContent(null);
    },
    onError: (error: Error) => {
      toast({
        title: t('content.messages.scheduleError'),
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Мутация для немедленной публикации контента через новый API эндпоинт
  const publishContentMutation = useMutation({
    mutationFn: async ({ id, platforms, contentType }: { id: string, platforms?: { [key: string]: boolean }, contentType?: string }) => {
      triggerFastPolling();
      // Проверяем наличие необходимых параметров
      if (!id) {
        throw new Error('ID контента не указан');
      }

      console.log(`[DEV] [content-publish] 🎬 Publishing content ${id} of type: ${contentType}`);
      console.log(`[DEV] [content-publish] 🎬 Platforms: ${JSON.stringify(platforms)}`);

      // Если платформы не указаны, используем пустой объект
      const platformsToPublish = platforms || {
        telegram: false,
        vk: false,
        instagram: false,
        facebook: false,
        youtube: false
      };

      // Определяем API endpoint в зависимости от типа контента
      let apiEndpoint = '/api/publish/now'; // по умолчанию для обычного контента

      // Для Stories используем специальный роут
      if (contentType === 'story') {
        apiEndpoint = '/api/stories/publish';
        console.log(`[DEV] [content-publish] 🎬 Using Stories-specific endpoint: ${apiEndpoint}`);
      } else if (contentType === 'clip' || contentType === 'shorts') {
        // Для клипов/shorts используем специальный роут для VK Clips и YouTube Shorts
        apiEndpoint = '/api/stories/publish-clip';
        console.log(`[DEV] [content-publish] 🎬 Using Clips/Shorts endpoint: ${apiEndpoint}`);
      } else {
        console.log(`[DEV] [content-publish] 🎬 Using general content endpoint: ${apiEndpoint}`);
      }

      // Вызываем соответствующий API эндпоинт
      const result = await apiRequest(apiEndpoint, {
        method: 'POST',
        data: {
          contentId: id,
          platforms: platforms || {} // используем переданные платформы или пустой объект
        }
      });


      return result;
    },
    onSuccess: async (data, variables) => {
      // Обновляем данные в интерфейсе БЕЗ тоста
      // Тост покажется автоматически когда планировщик обновит статус на "published"
      queryClient.invalidateQueries({ queryKey: ["/api/campaign-content", selectedCampaignId] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaign-content", selectedCampaignId, "scheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/publish/scheduled"] });
    },
    onError: (error: Error) => {
      console.error("Ошибка публикации:", error);
      toast({
        title: t('content.messages.publishError'),
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Мутация для перемещения контента в черновики (отмена запланированной публикации)
  const moveToDraftMutation = useMutation({
    mutationFn: async (contentId: string) => {
      triggerFastPolling();
      console.log(`Перемещение контента ${contentId} в черновики`);

      // 1. Сервер очищает social_platforms и ставит status: draft
      const result = await apiRequest(`/api/publish/update-content/${contentId}`, {
        method: 'PATCH',
        data: {
          status: 'draft',
          scheduled_at: null,
          social_platforms: {}
        }
      });
      // 2. Ждём пока сервер реально обновит данные
      await new Promise(r => setTimeout(r, 300));
      return result;
    },
    onSuccess: () => {
      toast({
        title: t('content.messages.movedToDrafts'),
        description: t('content.messages.movedToDraftsDesc'),
        variant: "default"
      });
      // 3. Только после подтверждения сервера — подтягиваем РЕАЛЬНЫЕ данные
      queryClient.invalidateQueries({ queryKey: ["/api/campaign-content", selectedCampaignId] });
    },
    onError: (error: Error) => {
      console.error("Ошибка при перемещении в черновики:", error);
      toast({
        title: t('content.messages.error'),
        description: `${t('content.messages.moveToDraftsError')}: ${error.message || t('content.messages.error')}`,
        variant: "destructive"
      });
    }
  });

  // Inline AI генерация текста для формы создания
  const handleGenerateAiText = async (targetSetter: (html: string) => void) => {
    if (!aiPromptText.trim()) {
      toast({ description: 'Введите промт для генерации', variant: 'destructive' });
      return;
    }
    const authToken = localStorage.getItem('auth_token');
    if (!authToken) {
      toast({ description: 'Требуется авторизация', variant: 'destructive' });
      return;
    }
    setIsAiGenerating(true);
    try {
      const response = await fetch('/api/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({
          prompt: aiPromptText,
          keywords: aiSelectedKeywords.length > 0 ? aiSelectedKeywords : newContent.keywords,
          tone: aiTone,
          campaignId: selectedCampaignId,
          platform: 'telegram',
          service: aiModel,
          useCampaignData: aiUseCampaignData,
          matchStyle: aiMatchStyle && contentStyle?.style
        })
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || 'Ошибка генерации');
      }
      const data = await response.json();
      const rawText = data.content || '';
      let cleaned = cleanAiText(rawText);
      // Дополнительная очистка Markdown (даже если уже есть HTML)
      cleaned = cleaned
        .replace(/^#{1,6}\s+(.+)$/gm, '<p><strong>$1</strong></p>')
        .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, '').trim())
        .replace(/`([^`]+)`/g, '$1')
        .replace(/~~(.+?)~~/g, '$1');
      // Если нет HTML — форматируем plain text
      const html = /<[a-z][\s\S]*>/i.test(cleaned)
        ? cleaned
        : cleaned.split('\n\n').filter(p => p.trim()).map(p => `<p>${p.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>')}</p>`).join('');
      targetSetter(html || `<p>${cleaned}</p>`);
      setShowAiPanel(false);
      setAiPromptText('');
      const MODEL_NAMES: Record<string, string> = {
        'gemini-3.5-flash': 'Gemini 3.5 Flash',
        'gemini-3.0-pro': 'Gemini 3.0 Pro',
        'gemini-2.5-pro': 'Gemini 2.5 Pro',
        'gemini-2.5-flash': 'Gemini 2.5 Flash',
        'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',

        'gemini-proxy': 'Gemini',
        'gemini-proxy-fallback': 'Gemini (fallback)',
        'deepseek-chat': 'DeepSeek',
        'deepseek': 'DeepSeek',
        'qwen': 'Qwen',
      };
      // Показываем оригинальную выбранную модель, а не замапленную сервером
      const displayModel = data.originalService || data.model || data.service || aiModel;
      const svcLabel = MODEL_NAMES[displayModel] ?? displayModel ?? 'Gemini';
      const originalLabel = data.originalService ? (MODEL_NAMES[data.originalService] ?? data.originalService) : null;
      if (data.isFallback && originalLabel) {
        toast({ title: 'Модель переключена', description: `${originalLabel} была недоступна. Ответ через ${svcLabel}.` });
      } else {
        toast({ title: 'Готово', description: `Текст сгенерирован (${svcLabel})` });
      }
    } catch (err: any) {
      const msg = err.message || '';
      const isQuota = msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('rate limit');
      const is503 = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand');
      if (isQuota) {
        toast({ title: 'Лимит Gemini исчерпан', description: 'Квота бесплатного тарифа Gemini на сегодня закончилась. Переключитесь на DeepSeek или Qwen.' });
      } else if (is503) {
        toast({ title: 'Gemini временно перегружен', description: 'Попробуйте через минуту или переключитесь на DeepSeek / Qwen.' });
      } else {
        toast({ description: msg || 'Ошибка генерации', variant: 'destructive' });
      }
    } finally {
      setIsAiGenerating(false);
    }
  };

  // Обработчик создания контента
  const handleCreateContent = () => {
    if (!selectedCampaignId) {
      toast({
        description: t('content.messages.selectCampaign'),
        variant: "destructive"
      });
      return;
    }

    if (!newContent.title) {
      toast({
        description: t('content.messages.enterTitle'),
        variant: "destructive"
      });
      return;
    }

    // Для типа "только картинка", "клип", "stories" контент не обязателен
    const contentOptionalTypes = ["image", "clip", "story"];
    if (!newContent.content && !contentOptionalTypes.includes(newContent.contentType)) {
      toast({
        description: t('content.messages.enterContent'),
        variant: "destructive"
      });
      return;
    }

    // Проверяем корректность URL для изображения или видео
    if (
      (newContent.contentType === "post" && !newContent.content) ||
      (newContent.contentType === "video" && !newContent.videoUrl) ||
      (newContent.contentType === "image" && !newContent.imageUrl)
    ) {
      toast({
        description: t('content.messages.addMedia'),
        variant: "destructive"
      });
      return;
    }

    // Подготавливаем дополнительные изображения включая thumbnail видео
    const additionalImages = [...(newContent.additionalImages || [])];
    if (newContent.videoThumbnail && !additionalImages.includes(newContent.videoThumbnail)) {
      additionalImages.unshift(newContent.videoThumbnail); // Thumbnail в начале списка
    }

    createContentMutation.mutate({
      campaign_id: selectedCampaignId,
      content_type: newContent.contentType,
      title: newContent.title,
      content: newContent.content,
      image_url: newContent.imageUrl,
      video_url: newContent.videoUrl,
      video_thumbnail: newContent.videoThumbnail,
      additional_images: additionalImages,
      keywords: newContent.keywords || [],
      prompt: newContent.prompt || null,
      status: 'draft'
    });
  };

  // Обработчик обновления контента
  const handleUpdateContent = () => {
    if (!currentContent) return;

    console.log('Current content before update:', currentContent);
    console.log('Selected keyword IDs:', Array.from(selectedKeywordIds));

    // Собираем выбранные ключевые слова из нашего состояния
    let selectedKeywordTexts: string[] = [];

    // Проверяем каждое ключевое слово из кампании
    campaignKeywords.forEach(keyword => {
      // Используем наш Set для проверки, выбрано ли ключевое слово
      if (selectedKeywordIds.has(keyword.id)) {
        // Добавляем нормализованное ключевое слово (без изменения регистра для отображения)
        selectedKeywordTexts.push(keyword.keyword);
        console.log(`Adding keyword from campaign: "${keyword.keyword}"`);
      }
    });

    // Добавляем пользовательские ключевые слова, которые не являются частью кампании
    if (Array.isArray(currentContent.keywords)) {
      currentContent.keywords.forEach(keyword => {
        if (typeof keyword !== 'string' || !keyword.trim()) return;

        // Нормализуем для сравнения
        const normalizedKeyword = keyword.trim();

        // Проверяем, не входит ли уже это ключевое слово в список из предопределенных кампаний
        // используя нормализованное сравнение (без учета регистра)
        const isAlreadyIncluded = campaignKeywords.some(
          k => k.keyword.trim().toLowerCase() === normalizedKeyword.toLowerCase()
        );

        const isAlreadySelected = selectedKeywordTexts.some(
          k => k.trim().toLowerCase() === normalizedKeyword.toLowerCase()
        );

        // Если ключевое слово не из предопределенных в кампании, добавляем его
        if (!isAlreadyIncluded && !isAlreadySelected) {
          selectedKeywordTexts.push(normalizedKeyword);
        }
      });
    }



    // Подготавливаем дополнительные изображения включая thumbnail видео
    const additionalImages = [...(currentContent.additionalImages || [])];
    if (currentContent.videoThumbnail && !additionalImages.includes(currentContent.videoThumbnail)) {
      additionalImages.unshift(currentContent.videoThumbnail); // Thumbnail в начале списка
    }

    // Создаем типизированный объект для обновления
    const updateData = {
      title: currentContent.title,
      content: currentContent.content,
      contentType: currentContent.contentType,
      imageUrl: currentContent.imageUrl,
      additionalImages: additionalImages,
      videoUrl: currentContent.videoUrl,
      videoThumbnail: currentContent.videoThumbnail,
      additionalVideos: currentContent.additionalVideos || [],
      // Включаем prompt — он обновляется при генерации изображений и должен храниться в Directus
      prompt: currentContent.prompt || null,
      keywords: [...selectedKeywordTexts.filter(k => k && k.trim() !== '')]
    };

    console.log('Update data being sent:', updateData);
    console.log('Keywords type:', Array.isArray(updateData.keywords) ? 'Array' : typeof updateData.keywords);

    updateContentMutation.mutate({
      id: currentContent.id,
      data: updateData
    });
  };

  // Обработчик планирования публикации
  const handleScheduleContent = () => {
    if (!currentContent || !scheduleDate) return;

    // Проверяем наличие выбранных платформ
    const selectedPlatformsCount = Object.values(selectedPlatforms).filter(Boolean).length;

    // Если платформы не выбраны, показываем предупреждение
    if (selectedPlatformsCount === 0) {
      toast({
        description: t('content.messages.selectPlatform'),
        variant: "destructive"
      });
      return;
    }

    // Создаем отладочный вывод
    console.log("Планирование публикации:", {
      id: currentContent.id,
      scheduledAt: scheduleDate.toISOString(),
      platforms: selectedPlatforms
    });

    scheduleContentMutation.mutate({
      id: currentContent.id,
      scheduledAt: scheduleDate.toISOString(),
      platforms: selectedPlatforms
    });
  };

  // Фильтруем контент в зависимости от выбранной вкладки
  // Функция для группировки контента по датам
  const groupContentByDate = (content: CampaignContent[]) => {
    const groups: { [key: string]: CampaignContent[] } = {};

    content.forEach(item => {
      // Используем дату публикации, планирования или создания
      const date = item.publishedAt || item.scheduledAt || item.createdAt;
      if (!date) return;

      // Преобразуем в строку даты (только дата, без времени)
      // Используем локальный часовой пояс пользователя для группировки
      const localDate = new Date(date);

      // Форматируем дату для использования в качестве ключа группы в формате YYYY-MM-DD
      const dateStr = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, '0')}-${String(localDate.getDate()).padStart(2, '0')}`;

      if (!groups[dateStr]) {
        groups[dateStr] = [];
      }

      groups[dateStr].push(item);
    });

    return groups;
  };

  // Фильтрация контента по активной вкладке
  // Функция для форматирования даты для группировки (только день, месяц, год)
  const formatDateForGrouping = (date: Date | string): string => {
    // Если дата передана в формате ISO string (YYYY-MM-DD)
    if (typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // Создаем дату из строки ISO, используя localeDate для правильного часового пояса
      const [year, month, day] = date.split('-').map(Number);
      // Месяцы в JS начинаются с 0, поэтому вычитаем 1 из месяца
      const localDate = new Date(year, month - 1, day);
      return localDate.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    } else {
      // Для других форматов дат
      const localDate = new Date(date);
      return localDate.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    }
  };

  // Функция для сброса фильтрации по датам
  const resetDateFilter = () => {
    setDateRange({
      from: undefined,
      to: undefined
    });
  };

  // Фильтрация и сортировка контента
  const filteredContent = Array.isArray(campaignContent) ? campaignContent
    .filter(content => {
      // Фильтр по статусу (вкладки)
      if (activeTab !== "all") {
        if (activeTab === "published") {
          // В табе "Опубликованные" показываем контент со статусом "published" и "partial",
          // а также посты у которых хотя бы одна платформа была опубликована
          if (content.status !== "published" && content.status !== "partial" && content.status !== "partially_published") {
            const platforms = (content as any).socialPlatforms || (content as any).social_platforms || {};
            const hasPublishedPlatform = Object.values(platforms as Record<string, any>).some(
              (p: any) => p?.status === 'published' || !!p?.publishedAt
            );
            if (!hasPublishedPlatform) return false;
          }
        } else if (content.status !== activeTab) {
          return false;
        }
      }

      // Фильтр по диапазону дат, если указан
      if (dateRange.from || dateRange.to) {
        const contentDate = new Date(content.publishedAt || content.scheduledAt || content.createdAt || 0);

        // Проверка начальной даты диапазона
        if (dateRange.from && contentDate < startOfDay(dateRange.from)) {
          return false;
        }

        // Проверка конечной даты диапазона
        if (dateRange.to && contentDate > endOfDay(dateRange.to)) {
          return false;
        }
      }

      return true;
    })
    // Сортировка контента по дате (новые сверху)
    .sort((a, b) => {
      const dateA = new Date(a.publishedAt || a.scheduledAt || a.createdAt || 0);
      const dateB = new Date(b.publishedAt || b.scheduledAt || b.createdAt || 0);
      return dateB.getTime() - dateA.getTime();
    }) : [];

  // Группировка контента по дате
  const contentByDate: Record<string, CampaignContent[]> = {};

  filteredContent.forEach((content: CampaignContent) => {
    // Получаем дату в локальном часовом поясе пользователя
    const localDate = new Date(content.publishedAt || content.scheduledAt || content.createdAt || new Date());
    // Формируем строку даты в формате ISO YYYY-MM-DD для использования в качестве ключа
    const dateStr = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, '0')}-${String(localDate.getDate()).padStart(2, '0')}`;

    if (!contentByDate[dateStr]) {
      contentByDate[dateStr] = [];
    }
    contentByDate[dateStr].push(content);
  });

  // Состояние для отслеживания, какие группы развернуты/свернуты
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Состояние для модального окна предпросмотра контента
  const [previewContent, setPreviewContent] = useState<CampaignContent | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [retryingPlatform, setRetryingPlatform] = useState<string | null>(null);

  const retryPlatformPublish = async (contentId: string, platform: string) => {
    setRetryingPlatform(platform);
    try {
      const response = await fetch('/api/retry-platform', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ contentId, platform })
      });
      const result = await response.json();
      if (result.success) {
        toast({ title: 'Опубликовано', description: `Успешно опубликовано в ${platform}` });
        // Обновляем previewContent локально
        if (previewContent && previewContent.id === contentId) {
          const platforms = (previewContent.socialPlatforms as any) || {};
          setPreviewContent({
            ...previewContent,
            socialPlatforms: {
              ...platforms,
              [platform]: { ...platforms[platform], status: 'published', publishedAt: new Date().toISOString(), ...(result.postUrl ? { postUrl: result.postUrl } : {}) }
            } as any
          });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/campaign-content", selectedCampaignId] });
      } else {
        toast({ title: 'Ошибка публикации', description: result.error || 'Не удалось опубликовать', variant: 'destructive' });
        if (previewContent && previewContent.id === contentId) {
          const platforms = (previewContent.socialPlatforms as any) || {};
          setPreviewContent({
            ...previewContent,
            socialPlatforms: {
              ...platforms,
              [platform]: { ...platforms[platform], status: 'failed', error: result.error, ...(result.tokenExpired ? { tokenExpired: true } : {}) }
            } as any
          });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/campaign-content", selectedCampaignId] });
      }
    } catch (err: any) {
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
      queryClient.invalidateQueries({ queryKey: ["/api/campaign-content", selectedCampaignId] });
    } finally {
      setRetryingPlatform(null);
    }
  };

  // Получаем иконку для типа контента
  const getContentTypeIcon = (type: string) => {
    switch (type) {
      case "text":
        return <FileText className="h-4 w-4" />;
      case "text-image":
        return <ImageIcon className="h-4 w-4" />;
      case "image":
        return <ImageIcon className="h-4 w-4" />;
      case "video":
        return <Video className="h-4 w-4" />;
      case "video-text":
        return <FilePlus2 className="h-4 w-4" />;
      case "story":
        return <Layers className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  // Получаем иконку для статуса
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "draft":
        return <Pencil className="h-4 w-4" />;
      case "scheduled":
        return <Clock className="h-4 w-4" />;
      case "published":
        return <CheckCircle2 className="h-4 w-4" />;
      case "partial":
      case "partially_published":
        return <CheckCircle2 className="h-4 w-4" />;
      default:
        return <Pencil className="h-4 w-4" />;
    }
  };

  // Получаем цвет бейджа для статуса
  const getStatusBadgeVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case "draft":
        return "outline";
      case "scheduled":
        return "secondary";
      case "published":
        return "default";
      case "partial":
      case "partially_published":
        return "secondary";
      default:
        return "outline";
    }
  };

  // Получаем текст статуса
  const getStatusText = (status: string) => {
    switch (status) {
      case "draft":
        return t('content.status.draft');
      case "scheduled":
        return t('content.status.scheduled');
      case "published":
        return t('content.status.published');
      case "partial":
      case "partially_published":
        return t('content.status.partial');
      default:
        return t('content.status.draft');
    }
  };

  // Получаем правильное время публикации из платформ или основного поля
  const getCorrectPublishedTime = (content: any) => {
    if (!content.socialPlatforms || typeof content.socialPlatforms !== 'object') {
      return content.publishedAt;
    }

    let latestTime = null;

    // Ищем самое позднее время публикации среди всех платформ
    for (const [platformName, platform] of Object.entries(content.socialPlatforms)) {
      if (platform &&
        typeof platform === 'object' &&
        'status' in platform &&
        'publishedAt' in platform &&
        platform.status === 'published' &&
        platform.publishedAt) {
        const publishedTime = new Date(platform.publishedAt as string);
        if (!latestTime || publishedTime > new Date(latestTime as string)) {
          latestTime = platform.publishedAt;
        }
      }
    }

    // Если найдено время в платформах, используем его, иначе основное поле
    return latestTime || content.publishedAt;
  };

  // Получаем правильное время создания контента
  const getCorrectCreatedTime = (content: any) => {
    // Для времени создания пока используем основное поле createdAt
    // В будущем можно добавить логику получения времени создания из других источников
    return content.createdAt;
  };

  return (
    <div className="space-y-4 md:space-y-6 p-3 md:p-6 max-w-full mobile-safe-padding mobile-safe-content">
      {isExpired && (
        <div className="flex items-center gap-3 p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
          <Lock className="h-5 w-5 text-orange-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-orange-800 dark:text-orange-200">Подписка истекла</p>
            <p className="text-xs text-orange-700 dark:text-orange-300">Генерация контента и публикация в социальные сети недоступны.</p>
          </div>
          <Button variant="default" size="sm" asChild className="flex-shrink-0 gap-1.5">
            <a href="/pricing"><Zap className="h-3.5 w-3.5" />Выбрать тариф</a>
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start">
        <div className="flex flex-col">
          <h1 className="text-lg md:text-2xl font-bold">{t('content.title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm hidden sm:block">
            {t('content.subtitle')}
          </p>


        </div>
        <div className="flex items-center gap-1 md:gap-2 flex-wrap w-full min-w-0">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={() => refetchContent()}
            disabled={isFetchingContent}
            title="Обновить"
            data-testid="button-refresh-content"
          >
            <RefreshCw size={15} className={isFetchingContent ? 'animate-spin' : ''} />
          </Button>
          <Button
            onClick={() => setIsContentPlanDialogOpen(true)}
            disabled={!selectedCampaignId || selectedCampaignId === "loading" || selectedCampaignId === "empty"}
            variant="outline"
            size="sm"
            className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-800/30 text-blue-700 dark:text-blue-300 flex-shrink-0 min-w-0"
          >
            <CalendarDays className="mr-1 md:mr-2 h-4 w-4" />
            <span className="hidden sm:inline">{t('content.buttons.generatePlan')}</span>
            <span className="sm:hidden">{t('content.buttons.generatePlan').split(' ')[0]}</span>
          </Button>
          <Button
            onClick={() => setIsContentTypeDialogOpen(true)}
            disabled={!selectedCampaignId || selectedCampaignId === "loading" || selectedCampaignId === "empty"}
            size="sm"
            data-testid="button-create-content"
            className="bg-blue-600 hover:bg-blue-700 text-white flex-shrink-0 min-w-0"
          >
            <Plus className="mr-1 md:mr-2 h-4 w-4" />
            <span className="hidden sm:inline">{t('content.buttons.createContent')}</span>
            <span className="sm:hidden">{t('common.create')}</span>
          </Button>
        </div>
      </div>

      {/* Используется глобальный выбор кампаний в верхней панели */}

      {/* Контент кампании */}
      {!selectedCampaignId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 space-y-4">
            <div className="text-center">
              <h3 className="text-lg font-medium text-muted-foreground mb-2">Выберите кампанию</h3>
              <p className="text-sm text-muted-foreground">
                Для управления контентом выберите кампанию в селекторе выше
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <Tabs defaultValue="all" value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                  <TabsTrigger value="all">{t('content.tabs.all')}</TabsTrigger>
                  <TabsTrigger value="draft">{t('content.tabs.draft')}</TabsTrigger>
                  <TabsTrigger value="scheduled">{t('content.tabs.scheduled')}</TabsTrigger>
                  <TabsTrigger value="published">{t('content.tabs.published')}</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="flex items-center gap-2">
                <Popover open={isDateFilterOpen} onOpenChange={setIsDateFilterOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id="date-range-filter"
                      variant={dateRange.from || dateRange.to ? "default" : "outline"}
                      size="sm"
                      className={dateRange.from || dateRange.to ? "bg-blue-500 hover:bg-blue-600" : ""}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateRange.from || dateRange.to ? (
                        <>
                          {dateRange.from ? format(dateRange.from, "dd MMMM yyyy", { locale: ru }) : "..."}
                          {" – "}
                          {dateRange.to ? format(dateRange.to, "dd MMMM yyyy", { locale: ru }) : "..."}
                        </>
                      ) : (
                        t('content.filters.dateFilter')
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <div className="flex flex-col space-y-2 p-2">
                      <div className="grid gap-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">Выберите диапазон дат</div>
                          {(dateRange.from || dateRange.to) && (
                            <Button variant="ghost" size="sm" onClick={resetDateFilter} className="h-7 px-2">
                              <XCircle className="h-4 w-4" />
                              <span className="sr-only">Сбросить</span>
                            </Button>
                          )}
                        </div>
                        <CalendarComponent
                          initialFocus
                          mode="range"
                          defaultMonth={dateRange.from}
                          selected={{
                            from: dateRange.from,
                            to: dateRange.to,
                          }}
                          onSelect={(range: any) => {
                            if (range?.from) {
                              setDateRange({
                                from: range.from,
                                to: range.to,
                              });
                            } else {
                              resetDateFilter();
                            }
                          }}
                          numberOfMonths={2}
                          locale={ru}
                        />
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!filteredContent.length ? (
              <p className="text-center text-muted-foreground py-8">
                Нет контента для этой кампании
                {(dateRange.from || dateRange.to) && (
                  <div className="text-center mt-2">
                    <Button variant="outline" size="sm" onClick={resetDateFilter}>
                      <XCircle className="h-4 w-4 mr-2" />
                      Сбросить фильтр по датам
                    </Button>
                  </div>
                )}
              </p>
            ) : (
              <div className="space-y-4">
                {/* Bulk action toolbar */}
                {bulkSelectedIds.size > 0 && (
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 bg-primary/5 border border-primary/20 rounded-lg">
                    <Checkbox
                      data-testid="checkbox-select-all"
                      checked={bulkSelectedIds.size === filteredContent.length}
                      onCheckedChange={(c) => c ? selectAllVisible() : clearBulkSelection()}
                    />
                    <span className="text-sm font-medium">
                      {isBulkProcessing ? bulkProgressText : `Выбрано: ${bulkSelectedIds.size}`}
                    </span>
                    {!isBulkProcessing && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearBulkSelection}>
                        Снять
                      </Button>
                    )}
                    <div className="flex-1" />
                    {isBulkProcessing ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          data-testid="button-bulk-editor-pass"
                          onClick={bulkEditorPass}
                        >
                          <Wand2 className="h-3.5 w-3.5" />
                          Редактура
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          data-testid="button-bulk-adapt"
                          onClick={bulkAdapt}
                        >
                          <Share className="h-3.5 w-3.5" />
                          Адаптация
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          data-testid="button-bulk-delete"
                          onClick={() => setShowBulkDeleteConfirm(true)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Удалить
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {/* Select all button when nothing selected yet */}
                {bulkSelectedIds.size === 0 && filteredContent.length > 1 && (
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1 text-muted-foreground"
                      data-testid="button-select-all"
                      onClick={selectAllVisible}
                    >
                      <Checkbox checked={false} className="h-3 w-3 pointer-events-none" />
                      Выбрать все
                    </Button>
                  </div>
                )}

                {/* Bulk delete confirm dialog */}
                <AlertDialog open={showBulkDeleteConfirm} onOpenChange={setShowBulkDeleteConfirm}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Удалить {bulkSelectedIds.size} постов?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Это действие нельзя отменить. Все выбранные посты будут безвозвратно удалены.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Отмена</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive hover:bg-destructive/90"
                        onClick={bulkDelete}
                        data-testid="button-bulk-delete-confirm"
                      >
                        Удалить
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                {/* Группировка по датам */}
                <Accordion type="multiple" defaultValue={Object.keys(contentByDate)}>
                  {Object.entries(contentByDate).map(([dateStr, contents]) => (
                    <AccordionItem key={dateStr} value={dateStr}>
                      <AccordionTrigger className="py-2 hover:bg-gray-50 dark:hover:bg-gray-800">
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="h-4 w-4 opacity-70" />
                          <span className="font-medium">{formatDateForGrouping(dateStr)}</span>
                          <Badge className="ml-2">{contents.length}</Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 mt-2">
                          {contents.map((content) => (
                            <Card
                              key={content.id}
                              className={`overflow-hidden border cursor-pointer hover:border-primary/50 hover:shadow-sm transition-all h-fit ${bulkSelectedIds.has(content.id) ? 'border-primary ring-1 ring-primary/30 bg-primary/5' : 'border-muted'}`}
                              onClick={() => {
                                if (bulkSelectedIds.size > 0) {
                                  toggleBulkSelect(content.id, window.event as any);
                                  return;
                                }
                                setPreviewContent(content);
                                setIsPreviewOpen(true);
                              }}
                            >
                              <div className="p-2.5">
                                {/* Header with type, status and actions */}
                                <div className="flex items-center flex-wrap gap-y-1 mb-1.5">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div
                                      onClick={(e) => toggleBulkSelect(content.id, e)}
                                      className="flex-shrink-0"
                                      data-testid={`checkbox-select-${content.id}`}
                                    >
                                      <Checkbox
                                        checked={bulkSelectedIds.has(content.id)}
                                        className="h-3.5 w-3.5"
                                      />
                                    </div>
                                    {getContentTypeIcon(content.contentType || 'text')}
                                    <Badge variant={getStatusBadgeVariant(content.status || 'draft')} className="text-xs px-2 flex-shrink-0">
                                      {getStatusIcon(content.status || 'draft')}
                                      <span className="ml-1">{getStatusText(content.status || 'draft')}</span>
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-1 ml-auto flex-shrink-0">
                                    <Button
                                      variant="black"
                                      size="sm"
                                      className="h-7 w-7 p-0"
                                      onClick={(e) => {
                                        e.stopPropagation(); // Предотвращаем открытие превью
                                        setCurrentContentSafe(content);
                                        setIsEditDialogOpen(true);
                                      }}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    {content.status === "draft" && (
                                      <>


                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 w-7 p-0 text-green-500 hover:text-green-600 hover:bg-green-50"
                                          title={t('content.tooltips.publishOrSchedule')}
                                          data-testid={`button-publish-content-${content.id}`}
                                          onClick={(e) => {
                                            e.stopPropagation(); // Предотвращаем открытие превью

                                            // Устанавливаем текущий контент и открываем диалог выбора платформ
                                            setCurrentContentSafe(content);
                                            // Автовыбор подключённых платформ, поддерживающих тип контента
                                            setSelectedPlatforms(getAutoSelectedPlatforms(content));
                                            setIsScheduleDialogOpen(true);
                                          }}
                                        >
                                          <SendHorizontal className="h-3.5 w-3.5" />
                                        </Button>
                                      </>
                                    )}

                                    {/* Кнопка клонирования — для всех статусов */}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0 text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
                                      disabled={cloningContentId === content.id}
                                      title="Клонировать в черновик"
                                      data-testid={`button-clone-${content.id}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        cloneContentMutation.mutate(content.id);
                                      }}
                                    >
                                      {cloningContentId === content.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Copy className="h-3.5 w-3.5" />
                                      )}
                                    </Button>

                                    {/* Кнопка "В черновики" для запланированного контента */}
                                    {content.status === "scheduled" && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-muted"
                                        title={t('content.tooltips.moveToDrafts')}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          moveToDraftMutation.mutate(content.id);
                                        }}
                                      >
                                        <ArchiveRestore className="h-3.5 w-3.5" />
                                      </Button>
                                    )}

                                    {/* Кнопка депостинга - снятие публикации из соцсетей */}
                                    {(content.status === "published" || content.status === "partial" || content.status === "partially_published" || content.status === "failed") && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0 text-orange-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950"
                                        disabled={unpublishingContentId === content.id}
                                        title="Снять публикацию и вернуть в черновики"
                                        data-testid={`button-unpublish-${content.id}`}
                                        onClick={(e) => {
                                          console.log('[UNPUBLISH] Button clicked for content:', content.id, 'status:', content.status);
                                          e.stopPropagation(); // Предотвращаем открытие превью
                                          setUnpublishingContentId(content.id);
                                          unpublishContentMutation.mutate(content.id);
                                        }}
                                      >
                                        {unpublishingContentId === content.id ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          <Ban className="h-3.5 w-3.5" />
                                        )}
                                      </Button>
                                    )}

                                    {/* Кнопка удаления для всех статусов */}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                                      disabled={deletingContentId === content.id}
                                      title="Удалить контент"
                                      data-testid={`button-delete-${content.id}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        deleteContentMutation.mutate(content.id);
                                      }}
                                    >
                                      {deletingContentId === content.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-3.5 w-3.5" />
                                      )}
                                    </Button>
                                  </div>
                                </div>

                                {/* Content title */}
                                {content.title && (
                                  <div className="mb-1.5">
                                    <h3 className="text-sm font-medium line-clamp-1 text-foreground dark:text-white" style={{ color: 'hsl(var(--foreground))' }}>
                                      {typeof content.title === 'string' ? content.title : String(content.title || '')}
                                    </h3>
                                  </div>
                                )}

                                {/* Content preview */}
                                <div className="flex gap-3">
                                  {/* Text content */}
                                  <div className="flex-1">
                                    {content.contentType === 'story' && content.metadata ? (
                                      <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-lg p-2 mb-1.5">
                                        <div className="flex items-center gap-2 mb-1.5">
                                          <Layers className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                                          <span className="text-purple-800 dark:text-purple-300 font-medium text-xs">Instagram Stories</span>
                                        </div>
                                        {(() => {
                                          try {
                                            // Парсим метаданные Stories
                                            let metadata;
                                            if (typeof content.metadata === 'string') {
                                              metadata = JSON.parse(content.metadata);
                                            } else {
                                              metadata = content.metadata;
                                            }

                                            // Получаем данные Stories из content или metadata
                                            let storyData;
                                            if (typeof content.content === 'string' && content.content.startsWith('{')) {
                                              try {
                                                storyData = JSON.parse(content.content);
                                              } catch {
                                                storyData = metadata;
                                              }
                                            } else {
                                              storyData = metadata;
                                            }

                                            // Удален избыточный лог для уменьшения спама в консоли

                                            // Поддержка нового формата Stories (textOverlays) и старого формата (slides)
                                            let slidesCount = 0;
                                            if (storyData?.slides && Array.isArray(storyData.slides)) {
                                              slidesCount = storyData.slides.length;
                                            } else if (storyData?.textOverlays && Array.isArray(storyData.textOverlays) && storyData.textOverlays.length > 0) {
                                              slidesCount = 1; // textOverlays означает 1 слайд с наложениями
                                            } else {
                                              // Фоллбек: если есть любые данные Stories, считаем 1 слайд
                                              slidesCount = (storyData && Object.keys(storyData).length > 0) ? 1 : 0;
                                            }

                                            return (
                                              <div className="text-xs text-purple-700 dark:text-purple-300">
                                                <div className="flex items-center gap-2">
                                                  <span>Слайдов: {slidesCount}</span>
                                                  <span className="text-purple-500 dark:text-purple-400">•</span>
                                                  <span>Формат: {metadata?.format || '9:16'}</span>
                                                </div>
                                              </div>
                                            );
                                          } catch (e) {
                                            return <span className="text-xs text-purple-600 dark:text-purple-400">Stories контент</span>;
                                          }
                                        })()}
                                      </div>
                                    ) : (
                                      <div className="max-h-12 overflow-hidden relative card-content mb-1.5">
                                        <div
                                          className="prose prose-xs max-w-none text-xs leading-tight text-foreground dark:text-white prose-headings:text-foreground dark:prose-headings:text-white prose-p:text-foreground dark:prose-p:text-white"
                                          style={{ color: 'hsl(var(--foreground)) !important' }}
                                          dangerouslySetInnerHTML={{
                                            __html: typeof content.content === 'string'
                                              ? (content.content.startsWith('<')
                                                ? content.content
                                                : processMarkdownSyntax(content.content))
                                              : ''
                                          }}
                                        />
                                        <div className="absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-white to-transparent dark:from-background"></div>
                                      </div>
                                    )}

                                  </div>

                                  {/* Media content */}
                                  {(content.contentType === "text-image" || content.contentType === "image") &&
                                    content.imageUrl &&
                                    typeof content.imageUrl === 'string' &&
                                    content.imageUrl.startsWith('http') &&
                                    !content.imageUrl.includes('[object') && (
                                      <div className="w-16 h-16 flex-shrink-0">
                                        <img
                                          src={content.imageUrl}
                                          alt={content.title || "Content Image"}
                                          className="rounded-md w-full h-full object-cover"
                                          onError={(e) => {
                                            (e.target as HTMLImageElement).src = "https://placehold.co/400x225?text=Image+Error";
                                          }}
                                        />
                                      </div>
                                    )}
                                  {(content.contentType === "video" || content.contentType === "video-text") && content.videoUrl && (
                                    <div className="w-16 h-16 flex-shrink-0 relative bg-black rounded-md overflow-hidden">
                                      <video
                                        src={content.videoUrl}
                                        className="w-full h-full object-cover"
                                      />
                                      <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30">
                                        <Button variant="outline" size="sm" className="h-7 w-7 rounded-full p-0 bg-white bg-opacity-70">
                                          <Play className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </div>

                                {/* Publishing status for published content */}
                                {content.status === 'published' && content.socialPlatforms &&
                                  typeof content.socialPlatforms === 'object' &&
                                  Object.keys(content.socialPlatforms as Record<string, any>).length > 0 && (
                                    <div className="mt-2">
                                      <PublishingStatus contentId={content.id} className="mt-1" />
                                    </div>
                                  )}

                                {/* Enhanced social platforms information */}
                                {content.socialPlatforms &&
                                  typeof content.socialPlatforms === 'object' &&
                                  Object.keys(content.socialPlatforms).length > 0 && (
                                    <ScheduledPostInfo
                                      socialPlatforms={content.socialPlatforms as Record<string, any>}
                                      scheduledAt={content.scheduledAt || null}
                                      publishedAt={content.publishedAt || null}
                                      compact={true}
                                    />
                                  )}

                                {/* Dates */}
                                <div className="mt-1.5 pt-1.5 border-t text-xs text-muted-foreground flex flex-wrap gap-x-2">
                                  {content.publishedAt && (
                                    <CreationTimeDisplay
                                      createdAt={content.publishedAt}
                                      label={t('content.labels.published')}
                                      showIcon={false}
                                      iconType="check"
                                      className="text-xs"
                                      isFromPlatforms={false}
                                      isPublishedTime={true}
                                    />
                                  )}
                                  {content.scheduledAt && !content.publishedAt && content.status !== 'scheduled' && (
                                    <CreationTimeDisplay
                                      createdAt={content.scheduledAt}
                                      label="План:"
                                      showIcon={false}
                                      iconType="clock"
                                      className="text-xs"
                                    />
                                  )}
                                  {!content.publishedAt && !content.scheduledAt && (
                                    <CreationTimeDisplay
                                      createdAt={getCorrectCreatedTime(content) || new Date()}
                                      label="Создано:"
                                      showIcon={false}
                                      iconType="calendar"
                                      className="text-xs"
                                    />
                                  )}
                                </div>
                              </div>
                            </Card>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Диалог создания контента */}
      <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
          if (!open) {
            setNewContent({
              title: "",
              content: "",
              contentType: "text",
              imageUrl: "",
              additionalImages: [],
              videoUrl: "",
              videoThumbnail: "",
              additionalVideos: [],
              prompt: "",
              keywords: []
            });
          }
          setIsCreateDialogOpen(open);
        }}>
        <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Создание нового контента</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">{t('content.form.title')}</Label>
              <Input
                id="title"
                placeholder={t('content.form.titlePlaceholder')}
                value={newContent.title}
                onChange={(e) => setNewContent({ ...newContent, title: e.target.value })}
                className="mb-4"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contentType">Тип контента</Label>
              <Select
                value={newContent.contentType}
                onValueChange={(value) => setNewContent({ ...newContent, contentType: value })}
              >
                <SelectTrigger data-testid="select-content-type">
                  <SelectValue placeholder={t('content.form.contentTypePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Текст</SelectItem>
                  <SelectItem value="text-image">Текст с картинкой</SelectItem>
                  <SelectItem value="image">Только картинка</SelectItem>
                  <SelectItem value="video">Видео</SelectItem>
                  <SelectItem value="clip">Клип (Shorts/Reels/Stories)</SelectItem>
                  <SelectItem value="story">Instagram Stories</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(newContent.contentType !== "story" && newContent.contentType !== "clip") && (
              <div>
                {/* Поле контента только для типов кроме 'image' */}
                {newContent.contentType !== 'image' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="content">
                        {newContent.contentType === "video" ? t('content.form.description') : t('content.form.content')}
                      </Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAiPanel(p => !p)}
                        className="flex items-center gap-1.5 text-indigo-600 border-indigo-200 hover:bg-indigo-50 dark:text-indigo-400 dark:border-indigo-700 dark:hover:bg-indigo-900/20"
                        data-testid="button-ai-generate-text"
                        disabled={isExpired}
                        title={isExpired ? 'Выберите тариф для использования ИИ' : undefined}
                      >
                        {isExpired ? <Lock className="h-3.5 w-3.5" /> : <Wand2 className="h-3.5 w-3.5" />}
                        Сгенерировать ИИ
                      </Button>
                    </div>
                    {showAiPanel && (
                      <div className="p-3 border border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg space-y-2">
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <Textarea
                              placeholder="Опишите что написать: тема, стиль, аудитория..."
                              value={aiPromptText}
                              onChange={e => setAiPromptText(e.target.value)}
                              className="text-sm resize-none h-16"
                              data-testid="input-ai-prompt"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5 min-w-[140px]">
                            <Select value={aiModel} onValueChange={(v: any) => setAiModel(v)}>
                              <SelectTrigger className="h-8 text-xs" data-testid="select-ai-model">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="gemini-3.5-flash">Gemini 3.5 Flash ⚡</SelectItem>
                                <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                                <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                                <SelectItem value="gemini-3.0-pro">Gemini 3.0 Pro</SelectItem>
                                <SelectItem value="deepseek">DeepSeek</SelectItem>
                                <SelectItem value="qwen">Qwen</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                              onClick={() => handleGenerateAiText(html => setNewContent(p => ({ ...p, content: html })))}
                              disabled={isAiGenerating}
                              data-testid="button-ai-generate-submit"
                            >
                              {isAiGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                              {isAiGenerating ? 'Генерация...' : 'Создать'}
                            </Button>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <Select value={aiTone} onValueChange={setAiTone}>
                            <SelectTrigger className="h-7 w-[130px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="informative">Информативный</SelectItem>
                              <SelectItem value="friendly">Дружелюбный</SelectItem>
                              <SelectItem value="professional">Профессиональный</SelectItem>
                              <SelectItem value="casual">Повседневный</SelectItem>
                              <SelectItem value="humorous">С юмором</SelectItem>
                            </SelectContent>
                          </Select>
                          <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground">
                            <Checkbox
                              checked={aiUseCampaignData}
                              onCheckedChange={(c) => setAiUseCampaignData(c === true)}
                              className="h-3.5 w-3.5"
                            />
                            Данные компании
                          </label>
                          {contentStyle?.style && (
                            <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground">
                              <Checkbox
                                checked={aiMatchStyle}
                                onCheckedChange={(c) => setAiMatchStyle(c === true)}
                                className="h-3.5 w-3.5"
                              />
                              Соответствовать стилю
                            </label>
                          )}
                        </div>
                        {campaignKeywords.length > 0 && (
                          <div className="space-y-1.5">
                            <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground">
                              <Checkbox
                                checked={aiSelectedKeywords.length === campaignKeywords.length}
                                onCheckedChange={(c) => setAiSelectedKeywords(c ? campaignKeywords.map(k => k.keyword) : [])}
                                className="h-3.5 w-3.5"
                              />
                              <span className="text-xs">Все ключевые слова ({campaignKeywords.length})</span>
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                              {campaignKeywords.filter(k => k.keyword?.trim()).map(kw => (
                                <button
                                  key={kw.id}
                                  type="button"
                                  className={`text-xs px-2 py-0.5 rounded-md transition-colors ${aiSelectedKeywords.includes(kw.keyword) ? 'bg-indigo-600 text-white border border-indigo-600' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                                  onClick={() => setAiSelectedKeywords(prev => prev.includes(kw.keyword) ? prev.filter(k => k !== kw.keyword) : [...prev, kw.keyword])}
                                >{kw.keyword}</button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <div>
                      <RichTextEditor
                        value={newContent.content || ''}
                        onChange={(html: string) => setNewContent({ ...newContent, content: html })}
                        minHeight={150}
                        className="tiptap"
                        enableResize={true}
                        placeholder={t('content.form.contentPlaceholder')}
                      />
                    </div>
                  </div>
                )}
                {/* Генерация изображения для текстового контента */}
                {newContent.contentType === 'text' && (
                  <div className="mt-3 flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="flex items-center gap-1"
                      onClick={() => openImageGenIfAllowed()}
                    >
                      <Sparkles className="h-4 w-4" />
                      Сгенерировать изображение
                    </Button>
                  </div>
                )}
              </div>
            )}

            {newContent.contentType === "clip" && (
              <div className="space-y-4">
                <div className="p-4 border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <h3 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">Клип (короткое видео)</h3>
                  <p className="text-xs text-blue-600 dark:text-blue-300">Вертикальное видео до 60 сек для Shorts, Reels и Stories (YouTube, Instagram, VK)</p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="clipDescription">Описание / сценарий клипа</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowAiPanel(p => !p)}
                      className="flex items-center gap-1.5 text-indigo-600 border-indigo-200 hover:bg-indigo-50 dark:text-indigo-400 dark:border-indigo-700 dark:hover:bg-indigo-900/20"
                      disabled={isExpired}
                      title={isExpired ? 'Выберите тариф для использования ИИ' : undefined}
                    >
                      {isExpired ? <Lock className="h-3.5 w-3.5" /> : <Wand2 className="h-3.5 w-3.5" />}
                      Сгенерировать ИИ
                    </Button>
                  </div>
                  {showAiPanel && (
                    <div className="p-3 border border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg space-y-2">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <Textarea
                            placeholder="Опишите сценарий или идею для клипа..."
                            value={aiPromptText}
                            onChange={e => setAiPromptText(e.target.value)}
                            className="text-sm resize-none h-16"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5 min-w-[140px]">
                          <Select value={aiModel} onValueChange={(v: any) => setAiModel(v)}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="gemini-3.5-flash">Gemini 3.5 Flash ⚡</SelectItem>
                              <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                              <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                              <SelectItem value="gemini-3.0-pro">Gemini 3.0 Pro</SelectItem>
                              <SelectItem value="deepseek">DeepSeek</SelectItem>
                              <SelectItem value="qwen">Qwen</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            size="sm"
                            className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                            onClick={() => handleGenerateAiText(html => setNewContent(p => ({ ...p, content: html })))}
                            disabled={isAiGenerating}
                          >
                            {isAiGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                            {isAiGenerating ? 'Генерация...' : 'Создать'}
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <Select value={aiTone} onValueChange={setAiTone}>
                          <SelectTrigger className="h-7 w-[130px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="informative">Информативный</SelectItem>
                            <SelectItem value="friendly">Дружелюбный</SelectItem>
                            <SelectItem value="professional">Профессиональный</SelectItem>
                            <SelectItem value="casual">Повседневный</SelectItem>
                            <SelectItem value="humorous">С юмором</SelectItem>
                          </SelectContent>
                        </Select>
                        <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground">
                          <Checkbox
                            checked={aiUseCampaignData}
                            onCheckedChange={(c) => setAiUseCampaignData(c === true)}
                            className="h-3.5 w-3.5"
                          />
                          Данные компании
                        </label>
                        {contentStyle?.style && (
                          <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground">
                            <Checkbox
                              checked={aiMatchStyle}
                              onCheckedChange={(c) => setAiMatchStyle(c === true)}
                              className="h-3.5 w-3.5"
                            />
                            Соответствовать стилю
                          </label>
                        )}
                      </div>
                      {campaignKeywords.length > 0 && (
                        <div className="space-y-1.5">
                          <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground">
                            <Checkbox
                              checked={aiSelectedKeywords.length === campaignKeywords.length}
                              onCheckedChange={(c) => setAiSelectedKeywords(c ? campaignKeywords.map(k => k.keyword) : [])}
                              className="h-3.5 w-3.5"
                            />
                            <span className="text-xs">Все ключевые слова ({campaignKeywords.length})</span>
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            {campaignKeywords.filter(k => k.keyword?.trim()).map(kw => (
                              <button
                                key={kw.id}
                                type="button"
                                className={`text-xs px-2 py-0.5 rounded-md transition-colors ${aiSelectedKeywords.includes(kw.keyword) ? 'bg-indigo-600 text-white border border-indigo-600' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                                onClick={() => setAiSelectedKeywords(prev => prev.includes(kw.keyword) ? prev.filter(k => k !== kw.keyword) : [...prev, kw.keyword])}
                              >{kw.keyword}</button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <RichTextEditor
                    value={newContent.content || ''}
                    onChange={(html: string) => setNewContent({ ...newContent, content: html })}
                    minHeight={100}
                    className="tiptap"
                    enableResize={true}
                    placeholder="Краткое описание для клипа..."
                  />
                </div>
              </div>
            )}
            {newContent.contentType === "story" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="storyCaption">Текст / подпись Stories</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowAiPanel(p => !p)}
                      className="flex items-center gap-1.5 text-indigo-600 border-indigo-200 hover:bg-indigo-50 dark:text-indigo-400 dark:border-indigo-700 dark:hover:bg-indigo-900/20"
                      disabled={isExpired}
                      title={isExpired ? 'Выберите тариф для использования ИИ' : undefined}
                    >
                      {isExpired ? <Lock className="h-3.5 w-3.5" /> : <Wand2 className="h-3.5 w-3.5" />}
                      Сгенерировать ИИ
                    </Button>
                  </div>
                  {showAiPanel && (
                    <div className="p-3 border border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg space-y-2">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <Textarea
                            placeholder="Опишите идею для Stories..."
                            value={aiPromptText}
                            onChange={e => setAiPromptText(e.target.value)}
                            className="text-sm resize-none h-16"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5 min-w-[140px]">
                          <Select value={aiModel} onValueChange={(v: any) => setAiModel(v)}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="gemini-3.5-flash">Gemini 3.5 Flash ⚡</SelectItem>
                              <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                              <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                              <SelectItem value="gemini-3.0-pro">Gemini 3.0 Pro</SelectItem>
                              <SelectItem value="deepseek">DeepSeek</SelectItem>
                              <SelectItem value="qwen">Qwen</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            size="sm"
                            className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                            onClick={() => handleGenerateAiText(html => setNewContent(p => ({ ...p, content: html })))}
                            disabled={isAiGenerating}
                          >
                            {isAiGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                            {isAiGenerating ? 'Генерация...' : 'Создать'}
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <Select value={aiTone} onValueChange={setAiTone}>
                          <SelectTrigger className="h-7 w-[130px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="informative">Информативный</SelectItem>
                            <SelectItem value="friendly">Дружелюбный</SelectItem>
                            <SelectItem value="professional">Профессиональный</SelectItem>
                            <SelectItem value="casual">Повседневный</SelectItem>
                            <SelectItem value="humorous">С юмором</SelectItem>
                          </SelectContent>
                        </Select>
                        <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground">
                          <Checkbox
                            checked={aiUseCampaignData}
                            onCheckedChange={(c) => setAiUseCampaignData(c === true)}
                            className="h-3.5 w-3.5"
                          />
                          Данные компании
                        </label>
                        {contentStyle?.style && (
                          <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground">
                            <Checkbox
                              checked={aiMatchStyle}
                              onCheckedChange={(c) => setAiMatchStyle(c === true)}
                              className="h-3.5 w-3.5"
                            />
                            Соответствовать стилю
                          </label>
                        )}
                      </div>
                      {campaignKeywords.length > 0 && (
                        <div className="space-y-1.5">
                          <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground">
                            <Checkbox
                              checked={aiSelectedKeywords.length === campaignKeywords.length}
                              onCheckedChange={(c) => setAiSelectedKeywords(c ? campaignKeywords.map(k => k.keyword) : [])}
                              className="h-3.5 w-3.5"
                            />
                            <span className="text-xs">Все ключевые слова ({campaignKeywords.length})</span>
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            {campaignKeywords.filter(k => k.keyword?.trim()).map(kw => (
                              <button
                                key={kw.id}
                                type="button"
                                className={`text-xs px-2 py-0.5 rounded-md transition-colors ${aiSelectedKeywords.includes(kw.keyword) ? 'bg-indigo-600 text-white border border-indigo-600' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                                onClick={() => setAiSelectedKeywords(prev => prev.includes(kw.keyword) ? prev.filter(k => k !== kw.keyword) : [...prev, kw.keyword])}
                              >{kw.keyword}</button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <RichTextEditor
                    value={newContent.content || ''}
                    onChange={(html: string) => setNewContent({ ...newContent, content: html })}
                    minHeight={80}
                    className="tiptap"
                    enableResize={true}
                    placeholder="Текст для слайдов или подпись к Stories..."
                  />
                </div>
                <div className="p-4 border border-dashed border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/20 rounded-lg text-center">
                  <p className="text-purple-600 dark:text-purple-300 text-sm mb-3">Для создания слайдов и визуальных элементов</p>
                  <Button
                    type="button"
                    onClick={() => {
                      if (!newContent.title.trim()) {
                        toast({
                          title: t('content.messages.error'),
                          description: t('content.messages.enterStoriesTitle'),
                          variant: "destructive"
                        });
                        return;
                      }
                      navigate(`/campaigns/${selectedCampaignId}/stories/new`);
                    }}
                    className="bg-purple-600 hover:bg-purple-700"
                    size="sm"
                  >
                    <Layers className="mr-2 h-4 w-4" />
                    Открыть редактор Stories
                  </Button>
                </div>
              </div>
            )}
            {(newContent.contentType === "text-image" || newContent.contentType === "image") && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <Label htmlFor="imageUrl">Основное изображение</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="flex items-center gap-1"
                      onClick={() => openImageGenIfAllowed()}
                    >
                      <Sparkles className="h-4 w-4" />
                      Сгенерировать изображение
                    </Button>
                  </div>
                  <ImageUploader
                    id="imageUrl"
                    value={newContent.imageUrl}
                    onChange={(url) => setNewContent({ ...newContent, imageUrl: url })}
                    placeholder={t('content.form.imageUrlPlaceholder')}
                    forcePreview={true}
                  />
                </div>
                {/* Дополнительные изображения */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <Label>Дополнительные изображения</Label>
                  </div>
                  <AdditionalImagesUploader
                    images={newContent.additionalImages}
                    onChange={(images) => setNewContent({ ...newContent, additionalImages: images })}
                    label={t('content.form.additionalImagesLabel')}
                    onGenerateImage={(index) => {
                      // Сохраняем индекс текущего изображения в локальном состоянии
                      localStorage.setItem('currentAdditionalImageIndex', String(index));
                      localStorage.setItem('additionalImageMode', 'create');
                      openImageGenIfAllowed();
                    }}
                  />
                </div>
              </div>
            )}
            {(newContent.contentType === "video" || newContent.contentType === "video-text" || newContent.contentType === "clip") && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="videoUrl">{newContent.contentType === "clip" ? "URL клипа (вертикальное видео до 60 сек)" : "URL видео"}</Label>
                  <VideoUploader
                    id="videoUrl"
                    value={newContent.videoUrl}
                    onChange={(url) => setNewContent({ ...newContent, videoUrl: url })}
                    onUploadingChange={setIsVideoUploading}
                    placeholder={t('content.form.videoUrlPlaceholder')}
                    forcePreview={true}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <Label htmlFor="videoThumbnail">Обложка видео (рекомендуется для YouTube, Rutube)</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="flex items-center gap-1"
                      onClick={() => {
                        localStorage.setItem('videoThumbnailMode', 'true');
                        openImageGenIfAllowed();
                      }}
                    >
                      <Sparkles className="h-4 w-4" />
                      Сгенерировать обложку
                    </Button>
                  </div>
                  <ImageUploader
                    id="videoThumbnail"
                    value={newContent.videoThumbnail}
                    onChange={(url) => setNewContent({ ...newContent, videoThumbnail: url })}
                    placeholder={t('content.form.videoThumbnailPlaceholder')}
                    forcePreview={true}
                  />
                </div>
              </div>
            )}

            {/* Дополнительные видео */}
            {(newContent.contentType === "video" || newContent.contentType === "video-text" || newContent.contentType === "clip") && (
              <div className="space-y-2">
                <AdditionalVideosUploader
                  videos={newContent.additionalVideos}
                  onChange={(videos) => setNewContent({ ...newContent, additionalVideos: videos })}
                  label={t('content.form.additionalVideos')}
                />
              </div>
            )}

            {/* Поле для ввода дополнительных ключевых слов */}
            <div className="space-y-2">
              <Label htmlFor="additionalKeywords">
                {newContent.contentType === 'video' ? 'Дополнительные теги (введите и нажмите Enter)' : 'Дополнительные ключевые слова (введите и нажмите Enter)'}
              </Label>
              <Input
                id="additionalKeywords"
                placeholder={t('content.form.keywordsPlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();

                    const value = e.currentTarget.value.trim();
                    if (!value) return;

                    // Не добавляем, если ключевое слово уже есть в списке
                    if (!newContent.keywords.includes(value)) {
                      setNewContent({
                        ...newContent,
                        keywords: [...newContent.keywords, value]
                      });
                    }

                    // Очищаем поле ввода
                    e.currentTarget.value = "";
                  }
                }}
                onBlur={(e) => {
                  const value = e.currentTarget.value.trim();
                  if (!value) return;

                  // Не добавляем, если ключевое слово уже есть в списке
                  if (!newContent.keywords.includes(value)) {
                    setNewContent({
                      ...newContent,
                      keywords: [...newContent.keywords, value]
                    });
                  }

                  // Очищаем поле ввода
                  e.currentTarget.value = "";
                }}
              />
            </div>

            {/* Предпросмотр выбранных ключевых слов */}
            {newContent.keywords.length > 0 && (
              <div className="space-y-2">
                <Label>Выбранные ключевые слова:</Label>
                <div className="flex flex-wrap gap-2">
                  {newContent.keywords.map((keyword, index) => (
                    <Badge key={index} variant="secondary" className="flex items-center gap-1">
                      {keyword}
                      <button
                        type="button"
                        className="h-4 w-4 rounded-full"
                        onClick={() => {
                          setNewContent({
                            ...newContent,
                            keywords: newContent.keywords.filter((_, i) => i !== index)
                          });
                        }}
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={handleCreateContent}
              disabled={createContentMutation.isPending || isVideoUploading}
            >
              {(createContentMutation.isPending || isVideoUploading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isVideoUploading ? 'Загрузка видео...' : 'Создать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог редактирования контента */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="ai-dialog bg-card text-card-foreground sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Редактирование контента</DialogTitle>
          </DialogHeader>
          {currentContent && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="title">{t('content.form.title')}</Label>
                <Input
                  id="title"
                  placeholder={t('content.form.titlePlaceholder')}
                  value={currentContent.title || ""}
                  onChange={(e) => {
                    const updatedContent = { ...currentContent, title: e.target.value };
                    setCurrentContentSafe(updatedContent);
                  }}
                  className="mb-4 !bg-white dark:!bg-gray-800 !text-black dark:!text-white !placeholder:text-gray-500 dark:!placeholder:text-gray-400 !border-gray-300 dark:!border-gray-600"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contentType">Тип контента</Label>
                <Select
                  value={currentContent.contentType || 'text'}
                  onValueChange={(value) => {
                    console.log('Changing content type from', currentContent.contentType, 'to', value);
                    const updatedContent = { ...currentContent, contentType: value };
                    setCurrentContent(updatedContent);
                  }}
                >
                  <SelectTrigger className="!bg-white dark:!bg-gray-800 !text-black dark:!text-white !border-gray-300 dark:!border-gray-600">
                    <SelectValue placeholder={t('content.form.contentTypePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent className="z-[9999] !bg-white dark:!bg-gray-800 !text-black dark:!text-white !border-gray-300 dark:!border-gray-600">
                    <SelectItem value="text" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Текст</SelectItem>
                    <SelectItem value="text-image" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Текст с картинкой</SelectItem>
                    <SelectItem value="image" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Только картинка</SelectItem>
                    <SelectItem value="video" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Видео</SelectItem>
                    <SelectItem value="clip" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Клип (Shorts/Reels)</SelectItem>
                    <SelectItem value="story" className="!hover:bg-gray-100 dark:!hover:bg-gray-700">Instagram Stories</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(currentContent.contentType !== "story" && currentContent.contentType !== "clip") && (
                <div>
                  {/* Поле контента только для типов кроме 'image' */}
                  {currentContent.contentType !== 'image' && (
                    <div className="space-y-2">
                      <Label htmlFor="content">
                        {currentContent.contentType === 'video' ? 'Описание' : 'Контент'}
                      </Label>
                      <div>
                        <RichTextEditor
                          value={currentContent.content || ''}
                          onChange={(html: string) => {
                            const updatedContent = { ...currentContent, content: html };
                            setCurrentContentSafe(updatedContent);
                          }}
                          minHeight={150}
                          className="tiptap"
                          enableResize={true}
                          placeholder={t('content.form.contentPlaceholder')}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {currentContent.contentType === "clip" && (
                <div className="space-y-4">
                  <div className="p-4 border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <h3 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">Клип (короткое видео)</h3>
                    <p className="text-xs text-blue-600 dark:text-blue-300">Вертикальное видео до 60 сек для Shorts, Reels и Stories (YouTube, Instagram, VK)</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="clipDescriptionEdit">Описание клипа</Label>
                    <RichTextEditor
                      value={currentContent.content || ''}
                      onChange={(html: string) => {
                        const updatedContent = { ...currentContent, content: html };
                        setCurrentContentSafe(updatedContent);
                      }}
                      minHeight={100}
                      className="tiptap"
                      enableResize={true}
                      placeholder="Краткое описание для клипа..."
                    />
                  </div>
                </div>
              )}
              {currentContent.contentType === "story" && (
                <div className="space-y-4">
                  <div className="p-6 border-2 border-dashed border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/20 rounded-lg text-center">
                    <Layers className="mx-auto h-12 w-12 text-purple-400 dark:text-purple-300 mb-3" />
                    <h3 className="text-lg font-medium text-purple-900 dark:text-purple-100 mb-2">Instagram Stories</h3>

                    {(() => {
                      // Получаем данные Stories из content или metadata
                      let storyData;
                      if (typeof currentContent.content === 'string' && currentContent.content.startsWith('{')) {
                        try {
                          storyData = JSON.parse(currentContent.content);
                        } catch {
                          storyData = currentContent.metadata;
                        }
                      } else {
                        storyData = currentContent.metadata;
                      }

                      // Поддержка нового формата Stories (textOverlays) и старого формата (slides)
                      const slidesCount = storyData?.slides?.length ||
                        (storyData?.textOverlays && storyData.textOverlays.length > 0 ? 1 : 0);

                      return (
                        <div className="space-y-3">
                          <p className="text-purple-600 dark:text-purple-300">
                            {slidesCount > 0 ? `Создано слайдов: ${slidesCount}` : 'Stories контент'}
                          </p>
                          <div className="flex gap-2 justify-center">
                            <Button
                              onClick={() => {
                                // Направляем в соответствующий редактор в зависимости от типа контента
                                console.log('Stories redirect logic:', {
                                  contentId: currentContent.id,
                                  videoUrl: currentContent.videoUrl,
                                  video_url: currentContent.video_url,
                                  hasVideo: !!(currentContent.videoUrl || currentContent.video_url)
                                });

                                if (currentContent.videoUrl || currentContent.video_url) {
                                  navigate(`/stories/${currentContent.id}/video-edit`);
                                } else {
                                  navigate(`/stories/${currentContent.id}/edit`);
                                }
                              }}
                              className="bg-purple-600 hover:bg-purple-700"
                            >
                              <Layers className="mr-2 h-4 w-4" />
                              Редактировать Stories
                            </Button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
              {(currentContent.contentType === "text-image" || currentContent.contentType === "image") && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="imageUrl">Основное изображение</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-1"
                        onClick={() => {
                          // Открываем диалог генерации изображения для редактирования
                          setCurrentContentSafe(currentContent);
                          openImageGenIfAllowed();
                        }}
                      >
                        <Sparkles className="h-4 w-4" />
                        Сгенерировать изображение
                      </Button>
                    </div>
                    <ImageUploader
                      id="imageUrlEdit"
                      value={currentContent.imageUrl || ""}
                      onChange={(url) => {
                        const updatedContent = { ...currentContent, imageUrl: url };
                        setCurrentContentSafe(updatedContent);
                      }}
                      placeholder={t('content.form.imageUrlPlaceholder')}
                      forcePreview={true}
                    />
                  </div>

                  {/* Дополнительные изображения */}
                  <div className="space-y-2">
                    <AdditionalImagesUploader
                      images={currentContent.additionalImages || []}
                      onChange={(images) => setCurrentContentSafe({ ...currentContent, additionalImages: images })}
                      label="Дополнительные изображения"
                      onGenerateImage={(index) => {
                        // Сохраняем индекс текущего изображения в локальном состоянии
                        localStorage.setItem('currentAdditionalImageIndex', String(index));
                        localStorage.setItem('additionalImageMode', 'edit');
                        openImageGenIfAllowed();
                      }}
                    />
                  </div>
                </div>
              )}
              {(currentContent.contentType === "video" || currentContent.contentType === "video-text" || currentContent.contentType === "clip") && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="videoUrl">{currentContent.contentType === "clip" ? "URL клипа (вертикальное видео до 60 сек)" : "URL видео"}</Label>
                    <VideoUploader
                      id="videoUrl"
                      value={currentContent.videoUrl || ""}
                      onChange={(url) => {
                        const updatedContent = { ...currentContent, videoUrl: url };
                        setCurrentContentSafe(updatedContent);
                      }}
                      placeholder={t('content.form.videoUrlPlaceholder')}
                      forcePreview={true}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="videoThumbnailEdit">Обложка видео (рекомендуется для YouTube, Rutube)</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-1"
                        onClick={() => {
                          localStorage.setItem('videoThumbnailMode', 'true');
                          setCurrentContentSafe(currentContent);
                          openImageGenIfAllowed();
                        }}
                      >
                        <Sparkles className="h-4 w-4" />
                        Сгенерировать обложку
                      </Button>
                    </div>
                    <ImageUploader
                      id="videoThumbnailEdit"
                      value={currentContent.videoThumbnail || ""}
                      onChange={(url) => {
                        const updatedContent = { ...currentContent, videoThumbnail: url };
                        setCurrentContentSafe(updatedContent);
                      }}
                      placeholder={t('content.form.videoThumbnailPlaceholder')}
                      forcePreview={true}
                    />
                  </div>
                </div>
              )}

              {/* Дополнительные видео - устаревший компонент */}
              {(currentContent.contentType === "video" || currentContent.contentType === "video-text" || currentContent.contentType === "clip") && (
                <div className="space-y-2">
                  <AdditionalVideosUploader
                    videos={currentContent.additionalVideos || []}
                    onChange={(videos) => setCurrentContentSafe({ ...currentContent, additionalVideos: videos })}
                    label={t('content.form.additionalVideos')}
                  />
                </div>
              )}

              {/* Скрыли универсальное поле additional_media */}

              {/* Поле для ввода дополнительных ключевых слов */}
              <div className="space-y-2">
                <Label htmlFor="editAdditionalKeywords">
                  {currentContent.contentType === 'video' ? 'Дополнительные теги (введите и нажмите Enter)' : 'Дополнительные ключевые слова (введите и нажмите Enter)'}
                </Label>
                <Input
                  id="editAdditionalKeywords"
                  placeholder={t('content.form.keywordsPlaceholder')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();

                      const value = e.currentTarget.value.trim();
                      if (!value) return;

                      console.log('Adding new keyword:', value);

                      // Гарантируем, что keywords всегда массив
                      const existingKeywords = Array.isArray(currentContent.keywords)
                        ? [...currentContent.keywords]
                        : [];

                      // Не добавляем, если ключевое слово уже есть в списке
                      if (!existingKeywords.includes(value)) {
                        const updatedKeywords = [...existingKeywords, value];
                        console.log('New keywords array:', updatedKeywords);

                        const updatedContent = {
                          ...currentContent,
                          keywords: updatedKeywords
                        };
                        setCurrentContentSafe(updatedContent);
                      }

                      // Очищаем поле ввода
                      e.currentTarget.value = "";
                    }
                  }}
                  onBlur={(e) => {
                    const value = e.currentTarget.value.trim();
                    if (!value) return;

                    console.log('Adding keyword on blur:', value);

                    // Гарантируем, что keywords всегда массив
                    const existingKeywords = Array.isArray(currentContent.keywords)
                      ? [...currentContent.keywords]
                      : [];

                    // Не добавляем, если ключевое слово уже есть в списке
                    if (!existingKeywords.includes(value)) {
                      const updatedKeywords = [...existingKeywords, value];
                      console.log('New keywords array on blur:', updatedKeywords);

                      const updatedContent = {
                        ...currentContent,
                        keywords: updatedKeywords
                      };
                      setCurrentContentSafe(updatedContent);
                    }

                    // Очищаем поле ввода
                    e.currentTarget.value = "";
                  }}
                />
              </div>

              {/* Предпросмотр выбранных ключевых слов */}
              {currentContent.keywords && currentContent.keywords.length > 0 && (
                <div className="space-y-2">
                  <Label>Выбранные ключевые слова:</Label>
                  <div className="flex flex-wrap gap-2">
                    {Array.isArray(currentContent.keywords) ? (
                      currentContent.keywords.map((keyword, index) => (
                        <Badge key={index} variant="secondary" className="flex items-center gap-1">
                          {keyword}
                          <button
                            type="button"
                            className="h-4 w-4 rounded-full"
                            onClick={() => {
                              console.log('Removing keyword:', keyword);
                              // Гарантируем, что keywords всегда массив
                              const existingKeywords = Array.isArray(currentContent.keywords)
                                ? [...currentContent.keywords]
                                : [];

                              // Удаляем ключевое слово по индексу
                              const updatedKeywords = existingKeywords.filter((_, i) => i !== index);
                              console.log('Keywords after removal:', updatedKeywords);

                              const updatedContent = {
                                ...currentContent,
                                keywords: updatedKeywords
                              };
                              setCurrentContentSafe(updatedContent);
                            }}
                          >
                            ×
                          </button>
                        </Badge>
                      ))
                    ) : (
                      <div>Нет ключевых слов</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={handleUpdateContent}
              disabled={updateContentMutation.isPending}
            >
              {updateContentMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог планирования публикации */}
      <Dialog open={isScheduleDialogOpen} onOpenChange={setIsScheduleDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Публикация в социальные сети</DialogTitle>
            <DialogDescription>
              Выберите платформы для публикации и укажите время или опубликуйте сразу
            </DialogDescription>
          </DialogHeader>
          {currentContent && (
            <div className="space-y-4 py-4">
              <Tabs defaultValue="now" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="now">Опубликовать сейчас</TabsTrigger>
                  <TabsTrigger value="schedule">Запланировать</TabsTrigger>
                </TabsList>
                <TabsContent value="schedule" className="space-y-4 mt-2">
                  <div className="space-y-2">
                    <Label htmlFor="scheduleDate">Дата и время публикации</Label>
                    <DateTimePicker
                      value={scheduleDate}
                      onChange={setScheduleDate}
                    />
                  </div>
                </TabsContent>
              </Tabs>

              <div className="space-y-3" data-testid="dialog-publish-platforms">
                <Label>Платформы для публикации</Label>
                <PlatformSelector
                  selectedPlatforms={{
                    instagram: selectedPlatforms.instagram || false,
                    telegram: selectedPlatforms.telegram || false,
                    vk: selectedPlatforms.vk || false,
                    facebook: selectedPlatforms.facebook || false,
                    youtube: selectedPlatforms.youtube || false,
                    threads: selectedPlatforms.threads || false,
                  }}
                  onChange={(platform, isSelected) => {
                    setSelectedPlatforms(prev => ({
                      ...prev,
                      [platform]: isSelected
                    }));
                  }}
                  content={{
                    contentType: currentContent.contentType,
                    imageUrl: currentContent.imageUrl ?? undefined,
                    images: currentContent.images,
                    videoUrl: currentContent.videoUrl ?? undefined,
                    additionalImages: currentContent.additionalImages,
                    additionalVideos: currentContent.additionalVideos
                  }}
                  connectedPlatforms={connectedPlatforms as any}
                />

                {/* Summary of selected platforms */}
                <div className="bg-muted/30 p-3 rounded-md mt-2">
                  <h4 className="text-sm font-medium mb-1">Выбрано платформ: {Object.values(selectedPlatforms).filter(Boolean).length}</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(selectedPlatforms)
                      .filter(([_, isSelected]) => isSelected)
                      .map(([platform]) => (
                        <Badge key={platform} variant="outline" className="capitalize">
                          {platform}
                        </Badge>
                      ))
                    }
                    {!Object.values(selectedPlatforms).some(Boolean) && (
                      <p className="text-xs text-muted-foreground">Выберите хотя бы одну платформу для публикации</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 flex-col sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsScheduleDialogOpen(false)}
            >
              Отмена
            </Button>
            <div className="space-x-2">
              <Button
                type="button"
                variant="default"
                onClick={async () => {
                  // Проверка на выбор хотя бы одной платформы
                  if (!Object.values(selectedPlatforms).some(Boolean)) {
                    toast({
                      description: t('content.messages.selectPlatform'),
                      variant: "destructive"
                    });
                    return;
                  }

                  setPublishState('publishing');
                  setPublishResults(null);

                  try {
                    // Получаем выбранные платформы как массив строк для N8N API
                    const selectedPlatformList = Object.entries(selectedPlatforms)
                      .filter(([_, isSelected]) => isSelected)
                      .map(([platform]) => platform);

                    const requestData = {
                      contentId: currentContent?.id,
                      platforms: selectedPlatformList
                    };

                    // Определяем API endpoint в зависимости от типа контента
                    let publishEndpoint = '/api/publish/now';

                    // Проверяем является ли контент clip/shorts/reels
                    const CLIPS_CONTENT_TYPES = ['clip', 'shorts', 'video_clip', 'short_video', 'video_story'];
                    const isClipContent = CLIPS_CONTENT_TYPES.includes(currentContent?.contentType || '');

                    const platformNames: Record<string, string> = {
                      telegram: 'Telegram',
                      vk: 'ВКонтакте',
                      instagram: 'Instagram',
                      facebook: 'Facebook',
                      threads: 'Threads',
                      youtube: 'YouTube',
                    };

                    let result: { succeeded: Array<{ platform: string; name: string }>; failed: Array<{ platform: string; name: string; error: string }> } = { succeeded: [], failed: [] };

                    if (isClipContent) {
                      publishEndpoint = '/api/clips/publish';
                      const response = await apiRequest(publishEndpoint, { method: 'POST', data: requestData });
                      if (response.success) {
                        result = { succeeded: selectedPlatformList.map(p => ({ platform: p, name: platformNames[p] || p })), failed: [] };
                      } else {
                        result = { succeeded: [], failed: selectedPlatformList.map(p => ({ platform: p, name: platformNames[p] || p, error: response.error || 'Не удалось опубликовать' })) };
                      }
                    } else if (currentContent?.contentType === 'story') {
                      const storyResponse = await apiRequest(`/api/stories/simple/${currentContent.id}`, { method: 'GET' });
                      if (!storyResponse.success) throw new Error('Не удалось получить данные Stories');
                      const response = await publishWithImageGeneration({
                        contentId: currentContent.id,
                        platforms: selectedPlatformList,
                        story: storyResponse.data
                      });
                      if (response.success) {
                        result = { succeeded: selectedPlatformList.map(p => ({ platform: p, name: platformNames[p] || p })), failed: [] };
                      } else {
                        result = { succeeded: [], failed: selectedPlatformList.map(p => ({ platform: p, name: platformNames[p] || p, error: response.message || 'Ошибка публикации Stories' })) };
                      }
                    } else {
                      const response = await apiRequest(publishEndpoint, { method: 'POST', data: requestData });
                      const results: Array<{ platform: string; success: boolean; error?: string }> = response.results || response.publishResults || [];

                      if (results.length > 0) {
                        result = {
                          succeeded: results.filter(r => r.success).map(r => ({ platform: r.platform, name: platformNames[r.platform] || r.platform })),
                          failed: results.filter(r => !r.success).map(r => ({ platform: r.platform, name: platformNames[r.platform] || r.platform, error: r.error || 'Не удалось опубликовать' })),
                        };
                      } else if (response.success !== false) {
                        result = { succeeded: selectedPlatformList.map(p => ({ platform: p, name: platformNames[p] || p })), failed: [] };
                      } else {
                        result = { succeeded: [], failed: selectedPlatformList.map(p => ({ platform: p, name: platformNames[p] || p, error: response.error || 'Ошибка при публикации' })) };
                      }
                    }

                    setPublishResults(result);
                    setPublishState('done');

                  } catch (error: any) {
                    console.error("Ошибка публикации контента:", error);
                    const rawMsg = error.message || "Ошибка при публикации контента";
                    const cleanMsg = rawMsg.includes('<') ? "Ошибка при публикации контента" : rawMsg;
                    const selectedPlatformList = Object.entries(selectedPlatforms)
                      .filter(([_, isSelected]) => isSelected)
                      .map(([platform]) => platform);
                    const platformNames: Record<string, string> = {
                      telegram: 'Telegram', vk: 'ВКонтакте', instagram: 'Instagram',
                      facebook: 'Facebook', threads: 'Threads', youtube: 'YouTube',
                    };
                    setPublishResults({
                      succeeded: [],
                      failed: selectedPlatformList.map(p => ({ platform: p, name: platformNames[p] || p, error: cleanMsg })),
                    });
                    setPublishState('done');
                  }
                }}
                disabled={
                  publishState === 'publishing' ||
                  publishContentMutation.isPending ||
                  !Object.values(selectedPlatforms).some(Boolean) ||
                  isExpired
                }
                title={isExpired ? 'Выберите тариф для публикации' : undefined}
              >
                {publishContentMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isExpired && <Lock className="mr-2 h-4 w-4" />}
                Опубликовать сразу
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleScheduleContent}
                disabled={
                  scheduleContentMutation.isPending ||
                  !scheduleDate ||
                  !Object.values(selectedPlatforms).some(Boolean) ||
                  isExpired
                }
                title={isExpired ? 'Выберите тариф для планирования' : undefined}
              >
                {scheduleContentMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isExpired && <Lock className="mr-2 h-4 w-4" />}
                Запланировать
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог генерации контента через AI */}
      {isGenerateDialogOpen && (
        <ContentGenerationDialog
          campaignId={selectedCampaignId || ''}
          keywords={campaignKeywords.map(k => ({
            id: k.id,
            keyword: k.keyword,
            trendScore: k.trend_score || 0,
            campaignId: k.campaign_id
          }))}
          contentStyle={isStyleFeatureEnabled ? contentStyle : null}
          onClose={() => {
            setIsGenerateDialogOpen(false);
            queryClient.invalidateQueries({ queryKey: ['/api/campaign-content', selectedCampaignId] });
          }}
        />
      )}

      {/* Диалог адаптации контента для социальных сетей */}
      {isAdaptDialogOpen && currentContent && (
        <SocialContentAdaptationDialog
          contentId={currentContent.id}
          originalContent={currentContent.content}
          onClose={() => {
            setIsAdaptDialogOpen(false);
            // Используем null, так как это явное обнуление, а не обновление содержимого
            setCurrentContent(null);
            queryClient.invalidateQueries({ queryKey: ['/api/campaign-content', selectedCampaignId] });
          }}
        />
      )}

      {/* Диалог генерации изображений */}
      <Dialog open={isImageGenerationDialogOpen} onOpenChange={setIsImageGenerationDialogOpen}>
        <ImageGenerationDialog
          campaignId={selectedCampaignId}
          contentId={currentContent?.id} // Передаем ID контента, если редактируем
          // Корректно передаем контент в зависимости от режима (редактирование или создание)
          initialContent={currentContent ? currentContent.content : newContent.content}
          // Передаем промт в зависимости от режима (редактирование, создание или доп.изображение)
          initialPrompt={
            currentContent ? (currentContent.prompt || "") :
              newContent.prompt ? newContent.prompt : ""
          }
          onImageGenerated={(imageUrl, promptText) => {
            // Инвалидируем кеш счётчика — все компоненты получат свежие данные
            queryClient.invalidateQueries({ queryKey: ['/api/user/image-gen-usage'] });
            // Проверяем режим обложки видео
            const videoThumbnailMode = localStorage.getItem('videoThumbnailMode');
            const additionalImageMode = localStorage.getItem('additionalImageMode');
            const imageIndex = localStorage.getItem('currentAdditionalImageIndex');

            if (videoThumbnailMode === 'true') {
              // Режим генерации обложки видео
              if (currentContent) {
                // Для режима редактирования
                setCurrentContent({
                  ...currentContent,
                  videoThumbnail: imageUrl,
                  ...(promptText && !currentContent.prompt ? { prompt: promptText } : {})
                });
              } else {
                // Для режима создания
                setNewContent({
                  ...newContent,
                  videoThumbnail: imageUrl,
                  ...(promptText && !newContent.prompt ? { prompt: promptText } : {})
                });
              }

              // Очищаем флаг режима
              localStorage.removeItem('videoThumbnailMode');
              setIsImageGenerationDialogOpen(false);

            } else if (additionalImageMode) {
              // Если это режим дополнительного изображения
              const index = parseInt(imageIndex || '0', 10);

              if (additionalImageMode === 'create') {
                // Для режима создания
                const updatedImages = [...newContent.additionalImages];
                updatedImages[index] = imageUrl;
                setNewContent({
                  ...newContent,
                  additionalImages: updatedImages,
                  ...(promptText ? { prompt: promptText } : {})
                });
              } else if (additionalImageMode === 'edit' && currentContent) {
                // Для режима редактирования
                const updatedImages = [...(currentContent.additionalImages || [])];
                updatedImages[index] = imageUrl;
                setCurrentContentSafe({
                  ...currentContent,
                  additionalImages: updatedImages,
                  ...(promptText ? { prompt: promptText } : {})
                });
              }

              // Очищаем localStorage после генерации
              localStorage.removeItem('additionalImageMode');
              localStorage.removeItem('currentAdditionalImageIndex');
            } else {
              // Обычный режим (основное изображение)
              if (currentContent) {
                // Для режима редактирования
                setCurrentContent({
                  ...currentContent,
                  imageUrl,
                  ...(promptText ? { prompt: promptText } : {})
                });
              } else {
                // Обновляем URL изображения и промт в форме создания контента
                setNewContent({
                  ...newContent,
                  imageUrl,
                  // Сохраняем промт только если он был передан
                  ...(promptText ? { prompt: promptText } : {})
                });
              }

              // Закрываем диалог только для обычного режима
              setIsImageGenerationDialogOpen(false);
            }
          }}
          onClose={() => {
            // Очищаем localStorage при закрытии диалога
            localStorage.removeItem('additionalImageMode');
            localStorage.removeItem('currentAdditionalImageIndex');
            localStorage.removeItem('videoThumbnailMode');
            setIsImageGenerationDialogOpen(false);
          }}
        />
      </Dialog>

      {/* Диалог генерации контент-плана */}
      <Dialog open={isContentPlanDialogOpen} onOpenChange={setIsContentPlanDialogOpen}>
        <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
          {selectedCampaignId && (
            <ContentPlanGenerator
              isOpen={isContentPlanDialogOpen}
              onClose={() => setIsContentPlanDialogOpen(false)}
              campaignId={selectedCampaignId}
              onPlanGenerated={async (contentItems, closeDialog) => {
                if (!contentItems || contentItems.length === 0) {
                  toast({
                    variant: 'destructive',
                    description: 'Нет элементов для сохранения'
                  });
                  return;
                }

                try {
                  const savedResults = [];
                  for (const item of contentItems) {
                    const contentData = {
                      campaignId: selectedCampaignId,
                      title: item.title || "Без названия",
                      content: item.content || item.text || "",
                      contentType: item.contentType || item.type || "text",
                      scheduledAt: item.scheduledAt || item.scheduled_at || null,
                      hashtags: item.hashtags || [],
                      keywords: item.keywords || [],
                      imageUrl: item.imageUrl || item.image_url || null,
                      videoUrl: item.videoUrl || item.video_url || null,
                      prompt: item.prompt || "",
                      status: 'draft',
                      // Добавляем дополнительные поля, которые могут быть в item
                      additionalImages: item.additionalImages || item.additional_images || [],
                      metadata: item.metadata || {}
                    };

                    try {
                      console.log('Сохранение элемента контент-плана:', contentData.title);
                      const result = await apiRequest('/api/campaign-content', {
                        method: 'POST',
                        data: contentData
                      });
                      console.log('Элемент сохранен успешно:', result);
                      savedResults.push(result);
                    } catch (saveError: any) {
                      console.error('Ошибка сохранения элемента:', contentData.title, saveError);
                      // Попробуем вывести детали ошибки если они есть
                      if (saveError.response?.data) {
                        console.error('Детали ошибки от сервера:', saveError.response.data);
                      }
                    }
                  }

                  const successCount = savedResults.length;

                  await queryClient.invalidateQueries({ queryKey: ["/api/campaign-content"] });
                  await queryClient.invalidateQueries({ queryKey: ["/api/campaign-content", selectedCampaignId] });
                  await queryClient.refetchQueries({ queryKey: ["/api/campaign-content", selectedCampaignId] });

                  toast({
                    description: `Контент-план сохранён (${successCount} из ${contentItems.length} постов)`,
                  });

                  if (closeDialog) {
                    setIsContentPlanDialogOpen(false);
                  }
                } catch (error: any) {
                  console.error('Ошибка сохранения контент-плана:', error);
                  toast({
                    variant: 'destructive',
                    title: 'Ошибка',
                    description: 'Не удалось сохранить контент-план'
                  });
                }
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Диалог просмотра контента */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previewContent?.title || "Просмотр контента"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Stories Preview */}
            {previewContent?.contentType === 'story' && previewContent?.metadata ? (
              <div className="space-y-4">
                <InstagramStoriesPreview
                  metadata={previewContent.metadata}
                  backgroundImageUrl={previewContent.imageUrl}
                />
              </div>
            ) : (
              <div>
                {/* Тип контента */}
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                  {previewContent?.contentType === "text" && <FileText size={16} />}
                  {(previewContent?.contentType === "text-image" || previewContent?.contentType === "image") && <ImageIcon size={16} />}
                  {previewContent?.contentType === "video" && <Video size={16} />}
                  {previewContent?.contentType === "video-text" && <Video size={16} />}
                  <span>
                    {previewContent?.contentType === "text" && "Текстовый контент"}
                    {previewContent?.contentType === "text-image" && "Контент с изображением"}
                    {previewContent?.contentType === "image" && "Только изображение"}
                    {previewContent?.contentType === "video" && "Видео контент"}
                    {previewContent?.contentType === "video-text" && "Видео с текстом"}
                  </span>
                </div>

                {/* Основной контент */}
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <div
                    dangerouslySetInnerHTML={{
                      __html: previewContent && typeof previewContent.content === 'string'
                        ? (previewContent.content.startsWith('<')
                          ? previewContent.content
                          : processMarkdownSyntax(previewContent.content))
                        : ''
                    }}
                  />
                </div>
              </div>
            )}

            {previewContent?.contentType !== 'story' &&
              (previewContent?.contentType === "text-image" || previewContent?.contentType === "image") &&
              previewContent?.imageUrl &&
              typeof previewContent.imageUrl === 'string' &&
              previewContent.imageUrl.startsWith('http') &&
              !previewContent.imageUrl.includes('[object') && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium mb-2">Основное изображение</h4>
                  <img
                    src={previewContent.imageUrl.includes('fal.media')
                      ? `/api/proxy-image?url=${encodeURIComponent(previewContent.imageUrl)}`
                      : previewContent.imageUrl}
                    alt={previewContent?.title || "Content Image"}
                    className="rounded-md max-h-[400px] max-w-full object-contain mx-auto"
                    onError={async (e) => {
                      const target = e.target as HTMLImageElement;
                      const imageUrl = previewContent.imageUrl;
                      console.error(`[ImagePreview] Ошибка загрузки основного изображения: ${target.src}`);

                      // Попытаемся узнать статус ошибки через fetch
                      try {
                        const checkRes = await fetch(imageUrl, { method: 'HEAD', mode: 'no-cors' });
                        console.log(`[ImagePreview] Статус HEAD запроса (no-cors): ${checkRes.type}`);

                        // Повторный fetch с cors чтобы увидеть статус (если возможно)
                        const fullRes = await fetch(imageUrl);
                        console.log(`[ImagePreview] Статус HTTP ошибки: ${fullRes.status} ${fullRes.statusText}`);
                      } catch (err) {
                        console.log(`[ImagePreview] Не удалось получить детальный статус ошибки: ${err}`);
                      }

                      // Попробуем прокси если еще не попробовали
                      if (!target.src.includes('/api/proxy-image') && imageUrl) {
                        console.log('[ImagePreview] Пробуем загрузить через прокси...');
                        target.src = `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
                      } else {
                        target.src = "https://placehold.co/800x400?text=Image+Load+Error";
                      }
                    }}
                  />
                </div>
              )}

            {previewContent?.contentType !== 'story' && (previewContent?.contentType === "text-image" || previewContent?.contentType === "image") &&
              Array.isArray(previewContent?.additionalImages) &&
              previewContent.additionalImages.filter(url => url && url.trim() !== '').length > 0 && (
                <div className="mt-6">
                  <h4 className="text-sm font-medium mb-2">Дополнительные изображения</h4>
                  <div className="grid grid-cols-2 gap-4">
                    {previewContent.additionalImages.map((imageUrl, index) => {
                      const isValid = imageUrl &&
                        typeof imageUrl === 'string' &&
                        imageUrl.trim() !== '' &&
                        imageUrl.startsWith('http') &&
                        !imageUrl.includes('[object');
                      return isValid && (
                        <div key={index} className="relative border rounded-md overflow-hidden bg-muted/20 h-[300px]">
                          <img
                            src={imageUrl.includes('fal.media')
                              ? `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`
                              : imageUrl}
                            alt={`Дополнительное изображение ${index + 1}`}
                            className="rounded-md max-h-[300px] w-full h-full object-contain"
                            onError={async (e) => {
                              const target = e.target as HTMLImageElement;
                              console.error(`[ImagePreview] Ошибка загрузки доп. изображения: ${target.src}`);

                              // Попытаемся узнать статус ошибки через fetch
                              try {
                                const fullRes = await fetch(imageUrl);
                                console.log(`[ImagePreview] Статус HTTP ошибки (доп): ${fullRes.status} ${fullRes.statusText}`);
                              } catch (err) {
                                console.log(`[ImagePreview] Не удалось получить детальный статус ошибки (доп): ${err}`);
                              }

                              if (!target.src.includes('/api/proxy-image') && imageUrl) {
                                console.log('[ImagePreview] Пробуем загрузить через прокси...');
                                target.src = `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
                              } else {
                                target.src = "https://placehold.co/400x300?text=Image+Load+Error";
                              }
                            }}
                          />
                          <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1 truncate">
                            {imageUrl}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

            {previewContent?.contentType !== 'story' && (previewContent?.contentType === "video" || previewContent?.contentType === "video-text") && previewContent?.videoUrl && (
              <div className="mt-4 space-y-4">
                <h4 className="text-sm font-medium">Видео</h4>
                <video
                  src={previewContent.videoUrl}
                  controls
                  className="rounded-md max-h-[400px] max-w-full mx-auto"
                />

                {previewContent.videoThumbnail && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Обложка видео</h4>
                    <img
                      src={previewContent.videoThumbnail}
                      alt="Обложка видео"
                      className="rounded-md max-h-[300px] max-w-full object-contain mx-auto border"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "https://placehold.co/800x400?text=Обложка+не+найдена";
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Ключевые слова */}
            {previewContent?.contentType !== 'story' && previewContent?.keywords && Array.isArray(previewContent.keywords) && previewContent.keywords.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium mb-2">
                  {previewContent?.contentType === 'video' ? 'Теги:' : 'Ключевые слова:'}
                </h4>
                <div className="flex flex-wrap gap-2">
                  {previewContent.keywords.map((keyword, index) => (
                    <Badge key={index} variant="secondary">
                      {keyword}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Информация о публикации - расширенная */}
            {previewContent?.socialPlatforms &&
              typeof previewContent.socialPlatforms === 'object' &&
              ((previewContent?.status === 'scheduled' && previewContent?.scheduledAt) ||
                (previewContent?.status === 'published' && previewContent?.publishedAt) ||
                (previewContent?.status === 'partial') ||
                (previewContent?.status === 'partially_published')) ? (
              <div className="mt-4 pt-4 border-t">
                <h4 className="text-sm font-medium mb-3">Информация о публикации</h4>
                <div className="space-y-3">
                  <div>
                    <h5 className="text-xs font-medium text-muted-foreground mb-2">Платформы:</h5>
                    <div className="space-y-2">
                      {Object.entries(previewContent.socialPlatforms as Record<string, any>).map(([platform, platformData]) => {
                        // Show all platforms that exist in the data
                        if (!platformData) return null;

                        const platformNames: Record<string, string> = {
                          vk: 'ВКонтакте',
                          telegram: 'Telegram',
                          instagram: 'Instagram',
                          facebook: 'Facebook',
                          youtube: 'YouTube',
                          threads: 'Threads'
                        };

                        // Показываем все платформы которые имеют данные
                        const isPublished = platformData.status === 'published' || platformData.postUrl;
                        const isFailed = platformData.status === 'failed' || (platformData.error && platformData.status !== 'pending');
                        const isPending = platformData.status === 'pending' || (platformData.scheduledAt && !isPublished && !isFailed);
                        const isScheduled = platformData.status === 'scheduled' || platformData.scheduledAt;

                        // Показываем платформы с любым статусом
                        if (!isPublished && !isFailed && !isScheduled && !isPending && !platformData.selected) return null;

                        // Цвета и текст в зависимости от статуса
                        const bgColor = isPublished ? 'bg-green-100 border-green-300' :
                          isFailed ? 'bg-red-100 border-red-300' :
                            'bg-amber-100 border-amber-300';
                        const textColor = isPublished ? 'text-green-800' :
                          isFailed ? 'text-red-800' :
                            'text-amber-800';
                        const iconColor = isPublished ? 'text-green-600' :
                          isFailed ? 'text-red-600' :
                            'text-amber-600';
                        const statusText = isPublished ? 'Опубликовано' :
                          isFailed ? 'Ошибка' :
                            'Ожидает публикации';
                        const Icon = isPublished ? CheckCircle2 :
                          isFailed ? AlertCircle :
                            Clock;

                        const isTokenExpired = isFailed && platformData.tokenExpired;
                        const displayStatusText = isTokenExpired ? 'Токен истёк' : statusText;
                        const isCurrentlyRetrying = retryingPlatform === platform;

                        const content = (
                          <div className={`flex flex-col gap-1 p-3 rounded-lg ${bgColor}`}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {isCurrentlyRetrying
                                  ? <Loader2 className={`h-5 w-5 ${iconColor} animate-spin`} />
                                  : <Icon className={`h-5 w-5 ${iconColor}`} />
                                }
                                <span className={`text-sm font-medium ${textColor}`}>{platformNames[platform] || platform}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`text-sm ${isPublished ? 'text-green-700' : 'text-red-700'}`}>
                                  {isCurrentlyRetrying ? 'Публикуем...' : displayStatusText} {isPublished && platformData.publishedAt && (() => {
                                    const date = new Date(platformData.publishedAt);
                                    return date.toLocaleString('ru-RU', {
                                      day: '2-digit',
                                      month: 'long',
                                      year: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    });
                                  })()}
                                </span>
                                <Icon className={`h-4 w-4 ${iconColor}`} />
                              </div>
                            </div>
                            {isFailed && !isCurrentlyRetrying && (
                              <div className="flex items-center justify-between mt-1 gap-2">
                                <div className="flex-1">
                                  {isTokenExpired && platformData.campaignId && (
                                    <span className="text-xs text-red-600">Обновите токен и нажмите «Повторить»</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  {isTokenExpired && platformData.campaignId && (
                                    <button
                                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = `/campaigns/${platformData.campaignId}/settings`; }}
                                      className="text-xs text-orange-700 underline hover:text-orange-900"
                                      data-testid="button-vk-reauth-content"
                                    >
                                      Настройки →
                                    </button>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (previewContent?.id) retryPlatformPublish(previewContent.id, platform);
                                    }}
                                    disabled={isCurrentlyRetrying}
                                    className="flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-300 rounded px-2 py-0.5 hover:bg-blue-100 transition-colors"
                                    data-testid={`button-retry-content-${platform}`}
                                  >
                                    <RefreshCw className="h-3 w-3" />
                                    Повторить
                                  </button>
                                </div>
                              </div>
                            )}
                            {isCurrentlyRetrying && (
                              <div className="flex items-center gap-1 mt-1">
                                <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                                <span className="text-xs text-blue-600">Публикуем в {platformNames[platform] || platform}...</span>
                              </div>
                            )}
                          </div>
                        );

                        // Если есть ссылка на пост, делаем блок кликабельным
                        if (platformData.postUrl) {
                          return (
                            <a
                              key={platform}
                              href={platformData.postUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block hover:opacity-90 transition-opacity"
                            >
                              {content}
                            </a>
                          );
                        }

                        return <div key={platform}>{content}</div>;
                      })}
                    </div>
                  </div>

                </div>
              </div>
            ) : (
              <div className="mt-4 pt-4 border-t flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                {previewContent?.publishedAt && (() => {
                  // Для общего времени публикации используем published_at как есть (БЕЗ добавления 3 часов)
                  // Это время уже сохранено в правильном формате из N8N
                  return (
                    <CreationTimeDisplay
                      createdAt={previewContent.publishedAt}
                      label="Опубликовано:"
                      showIcon={true}
                      iconType="check"
                      className="flex items-center gap-1"
                      isFromPlatforms={false}
                      isPublishedTime={true}
                    />
                  );
                })()}
                {previewContent?.scheduledAt && !previewContent?.publishedAt && (
                  <CreationTimeDisplay
                    createdAt={previewContent.scheduledAt}
                    label="Запланировано:"
                    showIcon={true}
                    iconType="clock"
                    className="flex items-center gap-1"
                  />
                )}
                {previewContent?.createdAt && (
                  <CreationTimeDisplay
                    createdAt={previewContent.createdAt}
                    label="Создано:"
                    showIcon={true}
                    iconType="calendar"
                    className="flex items-center gap-1"
                  />
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsPreviewOpen(false)}
            >
              Закрыть
            </Button>
            {previewContent && (
              <Button
                onClick={() => {
                  setCurrentContentSafe(previewContent);
                  setIsEditDialogOpen(true);
                  setIsPreviewOpen(false);
                }}
              >
                Редактировать
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог выбора типа контента */}
      <ContentTypeDialog
        isOpen={isContentTypeDialogOpen}
        onClose={() => setIsContentTypeDialogOpen(false)}
        onSelectType={(type) => {
          if (type === 'story') {
            // Очищаем состояние Stories store перед созданием новой Stories
            // Это гарантирует чистое состояние при создании через диалог
            navigate(`/campaigns/${selectedCampaignId}/stories/new`);
          } else {
            // Устанавливаем выбранный тип контента в состояние
            setNewContent({
              title: "",
              content: "",
              contentType: type,
              imageUrl: "",
              additionalImages: [],
              videoUrl: "",
              videoThumbnail: "",
              additionalVideos: [],
              prompt: "",
              keywords: []
            });
            setIsCreateDialogOpen(true);
          }
        }}
      />
    </div>
  );
}
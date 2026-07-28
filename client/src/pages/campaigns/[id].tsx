import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { KeywordSelector } from "@/components/KeywordSelector";
import { api as apiClient } from "@/lib/api-client";
import { api } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";
import {
  Loader2,
  Search,
  Wand2,
  Check,
  CheckCircle,
  Circle,
  Share2,
  FileText,
  Send,
  Calendar,
  Bot,
  Play,
  Square,
  Clock,
  AlertCircle,
  ImageIcon,
  RefreshCw,
  ClipboardList,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { SocialMediaSettings } from "@/components/SocialMediaSettings";
import AutonomousSettings from "@/components/AutonomousSettings";
import { TrendAnalysisSettings } from "@/components/TrendAnalysisSettings";
import { ContentPlanDialog } from "@/components/ContentPlanApproval";
import { BusinessQuestionnaireForm } from "@/components/BusinessQuestionnaireForm";
import { ContentStyleSettings } from "@/components/ContentStyleSettings";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useState, useCallback, useEffect, useMemo } from "react";
import { useCampaignStore } from "@/lib/campaignStore";
import { ContentGenerationDialog } from "@/components/ContentGenerationDialog";
import { PublicationPanel } from "@/components/PublicationPanel";

interface SuggestedKeyword {
  keyword: string;
  isSelected: boolean;
}

export default function CampaignDetails() {
  const { id } = useParams<{ id: string }>();
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Feature flag: стиль доступен только для signmark@gmail.com
  const userId = user?.user?.id || user?.id;
  const token = localStorage.getItem('auth_token');
  const { data: userProfile } = useQuery<{ email: string }>({
    queryKey: ['/api/user/profile', userId || 'me', token],
    enabled: !!userId,
  });
  const isStyleFeatureEnabled = userProfile?.email === 'signmark@gmail.com';
  const [isSearchingKeywords, setIsSearchingKeywords] = useState(false);
  const [suggestedKeywords, setSuggestedKeywords] = useState<
    SuggestedKeyword[]
  >([]);
  const [currentUrl, setCurrentUrl] = useState<string>("");
  const [urlSaveStatus, setUrlSaveStatus] = useState<
    "idle" | "saving" | "saved"
  >("idle");
  const [isGenerationDialogOpen, setIsGenerationDialogOpen] = useState(false);
  const [autonomousInterval, setAutonomousInterval] = useState(24);
  const [autonomousPostsPerCycle, setAutonomousPostsPerCycle] = useState(1);
  const [autonomousAutoSchedule, setAutonomousAutoSchedule] = useState(true);
  const [autonomousWithImages, setAutonomousWithImages] = useState(true);
  const [isPlanDialogOpen, setIsPlanDialogOpen] = useState(false);

  // Получаем доступ к глобальному хранилищу кампаний
  const { setSelectedCampaign } = useCampaignStore();

  // Запрос для получения списка ключевых слов
  const { data: keywordList = [] } = useQuery<any[]>({
    queryKey: ["/api/keywords", id],
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`/api/keywords/${id}`, {
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        }
      });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  // Запрос бизнес-анкеты для отображения статуса завершенности
  const { data: businessQuestionnaire } = useQuery({
    queryKey: ["business-questionnaire", id],
    queryFn: async () => {
      if (!id) return null;
      try {
        console.log("Fetching questionnaire for status check...");
        const response = await apiRequest(`/api/campaigns/${id}/questionnaire`);
        console.log("Questionnaire API response:", response);
        return response.data || null;
      } catch (error) {
        console.error("Ошибка при загрузке анкеты:", error);
        return null;
      }
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  // Запрос списка контента для отображения статуса
  const { data: campaignContent = [] } = useQuery<any[]>({
    queryKey: ["/api/campaign-content", id],
    queryFn: async () => {
      if (!id) return [];
      const token = localStorage.getItem("auth_token");
      const response = await fetch(`/api/campaign-content?campaignId=${id}`, {
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
        },
      });
      if (!response.ok) return [];
      const data = await response.json();
      return data.data || [];
    },
    enabled: !!id,
    staleTime: 1 * 60 * 1000,
  });

  const { data: campaignResponse, isLoading } = useQuery({
    queryKey: ["/api/proxy/campaign", id],
    queryFn: async () => {
      if (!id) throw new Error("Campaign ID is required");

      try {
        return await apiClient.campaigns.get(id);
      } catch (err: any) {
        console.error("Error fetching campaign:", err);
        const errorMessage = err.message || "Кампания не найдена или у вас нет прав доступа к ней";
        throw new Error(errorMessage);
      }
    },
    enabled: !!id,
    staleTime: 30 * 1000,  // 30 секунд — обновляемся чаще
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    retry: false,
  });

  useEffect(() => {
    const data = campaignResponse?.data;
    if (data && data.id && data.name) {
      setSelectedCampaign(data.id, data.name);
    }
  }, [campaignResponse, setSelectedCampaign]);

  const campaign = campaignResponse?.data;

  const { mutate: updateCampaign } = useMutation({
    mutationFn: async (values: { name?: string; link?: string }) => {
      if (!id) throw new Error("Campaign ID is required");
      if (values.link) {
        setUrlSaveStatus("saving");
      }
      await apiClient.campaigns.update(id, values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/proxy/campaign", id] });
      if (!silentUpdate) {
        toast({
          title: "Успешно",
          description: "Данные кампании обновлены",
        });
      }
      setUrlSaveStatus("saved");
      setSilentUpdate(false);
    },
    onError: () => {
      setUrlSaveStatus("idle");
      setSilentUpdate(false);
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: "Не удалось обновить данные кампании",
      });
    },
  });

  // Синхронизируем currentUrl с данными кампании
  useEffect(() => {
    if (campaign && campaign.link) {
      setCurrentUrl(campaign.link);
    }
  }, [campaign]);

  // Синхронизируем параметры автономного режима из autonomous_settings
  useEffect(() => {
    if (campaign?.autonomous_settings) {
      const s = typeof campaign.autonomous_settings === 'string'
        ? JSON.parse(campaign.autonomous_settings)
        : campaign.autonomous_settings;
      if (s?.intervalHours) setAutonomousInterval(Number(s.intervalHours));
      if (s?.postsPerCycle) setAutonomousPostsPerCycle(Number(s.postsPerCycle));
      if (s?.autoSchedule !== undefined) setAutonomousAutoSchedule(Boolean(s.autoSchedule));
      if (s?.withImages !== undefined) setAutonomousWithImages(Boolean(s.withImages));
    }
  }, [campaign]);

  const { mutate: searchKeywords, isPending: isSearching } = useMutation({
    mutationFn: async (url: string) => {
      if (!url || !url.trim()) {
        throw new Error("Пожалуйста, введите корректный URL сайта");
      }

      // Нормализуем URL
      let normalizedUrl = url.trim();
      if (
        !normalizedUrl.startsWith("http://") &&
        !normalizedUrl.startsWith("https://")
      ) {
        normalizedUrl = `https://${normalizedUrl}`;
      }

      // Используем новый API для анализа ключевых слов
      console.log(
        "🔍 CAMPAIGNS PAGE: Отправляем запрос к NEW API:",
        normalizedUrl,
      );
      console.log(
        "🔍 CAMPAIGNS PAGE: Используется endpoint /keywords/analyze-website",
      );
      const response = await api.post("/keywords/analyze-website", {
        url: normalizedUrl,
      });

      console.log("📋 Получен ответ:", response.data);
      console.log("📋 Ключевые слова из API:", response.data?.data?.keywords);

      if (!response.data?.success || !response.data?.data?.keywords?.length) {
        console.error("❌ Неудачный ответ API:", response.data);
        throw new Error("Не удалось извлечь ключевые слова с сайта");
      }

      // Возвращаем массив строк ключевых слов
      const keywords = response.data.data.keywords.map(
        (kw: any) => kw.keyword || kw,
      );
      console.log("📋 Обработанные ключевые слова:", keywords);
      return keywords;
    },
    onSuccess: (data) => {
      const formattedKeywords = data.map((keyword: string) => ({
        keyword,
        isSelected: false,
      }));
      setSuggestedKeywords(formattedKeywords);
      setIsSearchingKeywords(true);
      toast({
        description: "Ключевые слова успешно найдены",
      });
    },
    onError: (error: any) => {
      const serverMsg = error?.response?.data?.error;
      toast({
        variant: "destructive",
        description: serverMsg || error.message || "Не удалось найти ключевые слова",
      });
    },
  });

  // Мутация для добавления ключевых слов с их метриками
  const { mutate: addKeywords } = useMutation({
    mutationFn: async (
      keywordsInput:
        | string[]
        | { keyword: string; frequency?: number; competition?: number }[],
    ) => {
      let newKeywords: {
        keyword: string;
        frequency?: number;
        competition?: number;
      }[] = [];

      // Проверяем тип входных данных и конвертируем в нужный формат
      if (Array.isArray(keywordsInput) && keywordsInput.length > 0) {
        if (typeof keywordsInput[0] === "string") {
          // Если простой массив строк, преобразуем его в массив объектов с метриками по умолчанию
          newKeywords = (keywordsInput as string[]).map((keyword) => ({
            keyword,
            frequency: 3500, // Значение по умолчанию
            competition: 75, // Значение по умолчанию
          }));
        } else {
          // Если уже массив объектов с метриками, используем его напрямую
          newKeywords = keywordsInput as {
            keyword: string;
            frequency?: number;
            competition?: number;
          }[];
        }
      }

      console.log("Добавление ключевых слов с метриками:", newKeywords);

      // Сначала получаем список существующих ключевых слов для проверки на дубликаты
      if (!id) throw new Error("Campaign ID is required");
      const existingKeywordsResponse = await apiClient.keywords.list(id);

      const existingKeywords = existingKeywordsResponse?.data || [];
      const existingKeywordsLower = existingKeywords.map((k: any) =>
        k.keyword.toLowerCase(),
      );

      let addedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      let results: any[] = [];

      // Обрабатываем каждое ключевое слово по-отдельности для корректной работы с дубликатами
      for (const item of newKeywords) {
        // Проверяем, су �ествует ли уже такое ключевое слово (независимо от регистра)
        if (existingKeywordsLower.includes(item.keyword.toLowerCase())) {
          console.log(
            `Ключевое слово "${item.keyword}" уже существует - пропускаем`,
          );
          skippedCount++;
          continue;
        }

        try {
          if (!id) throw new Error("Campaign ID is required");
          const result = await apiClient.keywords.create({
            campaign_id: id,
            keyword: item.keyword,
            trend_score: item.frequency || 3500,
            mentions_count: item.competition || 75,
            last_checked: new Date().toISOString(),
          });

          results.push(result);
          addedCount++;
        } catch (err: any) {
          // Проверяем, связана ли ошибка с дубликатом
          const errorMessage = err.response?.data?.errors?.[0]?.message || "";
          if (
            errorMessage.includes("Дубликат ключевого слова") ||
            errorMessage.includes("duplicate") ||
            errorMessage.includes("unique") ||
            errorMessage.includes("already exists")
          ) {
            console.log(
              `Ключевое слово "${item.keyword}" вызвало ошибку дубликата - пропускаем`,
            );
            skippedCount++;
          } else {
            console.error(
              `Ошибка при добавлении ключевого слова "${item.keyword}":`,
              err,
            );
            errorCount++;
          }
        }
      }

      // Проверяем, есть ли серьезные ошибки, при которых мы должны вообще отменить операцию
      if (errorCount > 0 && addedCount === 0) {
        // Если не добавлено ни одного ключевого слова, сообщаем об ошибке
        throw new Error(
          `Не удалось добавить ни одного ключевого слова. Пропущено дубликатов: ${skippedCount}, ошибок: ${errorCount}`,
        );
      }

      // Возвращаем информативный результат даже если были некоторые ошибки, но хотя бы одно ключевое слово добавлено
      return {
        added: addedCount,
        skipped: skippedCount,
        errors: errorCount,
        total: newKeywords.length,
        newKeywords: newKeywords.map((k) => k.keyword),
        results,
      };
    },
    // Оптимистичное обновление UI
    onMutate: async (
      keywordsInput:
        | string[]
        | { keyword: string; frequency?: number; competition?: number }[],
    ) => {
      // Отменяем запросы на получение ключевых слов
      await queryClient.cancelQueries({ queryKey: ["/api/keywords", id] });

      // Сохраняем предыдущие данные для возможного отката
      const previousKeywords = queryClient.getQueryData(["/api/keywords", id]);

      // Получаем текущие ключевые слова для фильтрации только новых
      const currentKeywords = ((previousKeywords as any[]) || []).map(
        (k) => k.keyword,
      );

      // Конвертируем входные данные в стандартный формат
      let newKeywords: {
        keyword: string;
        frequency?: number;
        competition?: number;
      }[] = [];

      if (Array.isArray(keywordsInput) && keywordsInput.length > 0) {
        if (typeof keywordsInput[0] === "string") {
          // Если простой массив строк, фильтруем их и преобразуем
          const stringKeywords = keywordsInput as string[];
          const filteredKeywords = stringKeywords.filter(
            (k) => !currentKeywords.includes(k),
          );

          newKeywords = filteredKeywords.map((keyword) => ({
            keyword,
            frequency: 3500, // Значение по умолчанию
            competition: 75, // Значение по умолчанию
          }));
        } else {
          // Если массив объектов с метриками, фильтруем их
          const objectKeywords = keywordsInput as {
            keyword: string;
            frequency?: number;
            competition?: number;
          }[];
          newKeywords = objectKeywords.filter(
            (item) => !currentKeywords.includes(item.keyword),
          );
        }
      }

      if (newKeywords.length > 0) {
        try {
          // Оптимистично обновляем кэш сразу, не дожидаясь API-запроса
          // Это ускорит взаимодействие с интерфейсом
          queryClient.setQueryData(["/api/keywords", id], (old: any[] = []) => {
            const newItems = newKeywords.map((item) => ({
              id: `temp-${Date.now()}-${Math.random()}`, // Временный ID
              campaign_id: id,
              keyword: item.keyword,
              trend_score: item.frequency || 3500, // Используем существующее значение или по умолчанию
              mentions_count: item.competition || 75, // Используем существующее значение или по умолчанию
              date_created: new Date().toISOString(),
            }));

            console.log("Оптимистичное обновление кэша с данными:", newItems);
            return [...old, ...newItems];
          });

          // Больше не запускаем асинхронное обогащение данных,
          // так как мы уже используем значения, которые были получены ранее
        } catch (error) {
          console.error("Критическая ошибка при обновлении кэша:", error);

          // В случае критической ошибки используем значения по умолчанию
          queryClient.setQueryData(["/api/keywords", id], (old: any[] = []) => {
            const newItems = newKeywords.map((item) => ({
              id: `temp-${Date.now()}-${Math.random()}`, // Временный ID
              campaign_id: id,
              keyword: item.keyword,
              trend_score: item.frequency || 3500,
              mentions_count: item.competition || 75,
              date_created: new Date().toISOString(),
            }));

            return [...old, ...newItems];
          });
        }
      }

      // Возвращаем контекст для возможного отката
      return {
        previousKeywords,
        newKeywordsCount: newKeywords.length,
        newKeywords: newKeywords.map((k) => k.keyword),
      };
    },
    onSuccess: (result) => {
      // Обновляем данные с сервера, чтобы получить правильные ID и другие поля
      queryClient.invalidateQueries({ queryKey: ["/api/keywords", id] });

      // Также инвалидируем кэш для страницы ключевых слов
      queryClient.invalidateQueries({ queryKey: ["campaign_keywords", id] });

      // Очищаем диалог поиска ключевых слов
      setIsSearchingKeywords(false);
      setSuggestedKeywords([]);

      // Формируем информативное сообщение о результате
      let message = "";
      if (result.added > 0) {
        message += `Добавлено ${result.added} ключевых слов. `;
      }
      if (result.skipped > 0) {
        message += `Пропущено ${result.skipped} дубликатов. `;
      }
      if (result.errors > 0) {
        message += `Не удалось добавить ${result.errors} ключевых слов. `;
      }

      // Показываем сообщение о результате
      toast({
        title: result.added > 0 ? "Успешно" : "Информация",
        description: message || `Обработано ${result.total} ключевых слов`,
        variant: result.errors > 0 ? "destructive" : "default",
      });
    },
    onError: (error, variables, context) => {
      console.error("Ошибка при добавлении ключевых слов:", error);

      // Восстанавливаем предыдущие данные в случае ошибки
      if (context?.previousKeywords) {
        queryClient.setQueryData(
          ["/api/keywords", id],
          context.previousKeywords,
        );
      }

      // Проверяем, есть ли частичные результаты
      // Это позволит более информативно сообщать о проблемах
      let errorMessage = "Не удалось добавить ключевые слова";

      // Пытаемся извлечь более конкретное сообщение об ошибке
      if (error instanceof Error) {
        errorMessage = error.message || errorMessage;
      } else if (typeof error === "object" && error !== null) {
        const errorObj = error as any;
        if (errorObj.response?.data?.errors?.[0]?.message) {
          errorMessage = errorObj.response.data.errors[0].message;
        } else if (errorObj.message) {
          errorMessage = errorObj.message;
        }
      }

      toast({
        variant: "destructive",
        title: "Ошибка",
        description: errorMessage,
      });

      // Принудительно обновляем данные, чтобы показать актуальное состояние
      queryClient.invalidateQueries({ queryKey: ["/api/keywords", id] });
    },
  });

  // Мутация для удаления ключевого слова при клике на него
  const { mutate: removeKeyword } = useMutation({
    mutationFn: async (keyword: string) => {
      if (!id) throw new Error("Campaign ID is required");

      // Получаем все ключевые слова кампании
      const response = await apiClient.keywords.list(id);
      const keywords = response?.data || [];

      // Ищем нужное ключевое слово по тексту
      const keywordItem = keywords.find((k: any) => k.keyword === keyword);

      if (!keywordItem || !keywordItem.id) {
        throw new Error(`Ключевое слово "${keyword}" не найдено`);
      }

      // Удаляем ключевое слово по ID
      await apiClient.keywords.delete(keywordItem.id);
      return { keyword, keywordId: keywordItem.id };
    },
    // Оптимистичное обновление UI до получения ответа от сервера
    onMutate: async (keyword) => {
      // Отменяем все запросы на получение ключевых слов, чтобы они не перезаписали наше обновление
      await queryClient.cancelQueries({ queryKey: ["/api/keywords", id] });

      // Сохраняем текущие данные для возможного отката
      const previousKeywords = queryClient.getQueryData(["/api/keywords", id]);

      // Оптимистично обновляем кэш
      queryClient.setQueryData(["/api/keywords", id], (old: any[]) => {
        return old ? old.filter((item) => item.keyword !== keyword) : [];
      });

      // Возвращаем контекст для отката в случае ошибки
      return { previousKeywords };
    },
    onSuccess: (result, keyword) => {
      // Запрашиваем новые данные, чтобы убедиться, что интерфейс синхронизирован с сервером
      queryClient.invalidateQueries({ queryKey: ["/api/keywords", id] });

      // Также инвалидируем кэш для страницы ключевых слов
      queryClient.invalidateQueries({ queryKey: ["campaign_keywords", id] });

      console.log(`Ключевое слово "${keyword}" успешно удалено`);
      // Удаляем дубликат уведомления, так как оно уже показывается в KeywordSelector
    },
    onError: (error, keyword, context) => {
      console.error("Ошибка при удалении ключевого слова:", error);
      // Восстанавливаем предыдущее состояние кэша в случае ошибки
      if (context?.previousKeywords) {
        queryClient.setQueryData(
          ["/api/keywords", id],
          context.previousKeywords,
        );
      }
      toast({
        variant: "destructive",
        description: `Не удалось удалить ключевое слово "${keyword}"`,
      });
    },
    // Всегда запрашиваем новые данные после мутации, независимо от результата
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/keywords", id] });
      // Обновляем кэш для страницы ключевых слов
      queryClient.invalidateQueries({ queryKey: ["campaign_keywords", id] });
    },
  });

  // Автономный режим: статус
  const { data: autonomousStatus, refetch: refetchAutonomousStatus } = useQuery<any>({
    queryKey: ['/api/autonomous/status', id],
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/autonomous/status/${id}`, {
        headers: { Authorization: token ? `Bearer ${token}` : '' }
      });
      return res.json();
    },
    refetchInterval: (query) => {
      const data = query.state.data as any;
      return data?.pendingApprovalStep ? 5000 : 30000;
    },
    enabled: !!id,
  });

  const { mutate: startAutonomous, isPending: isStartingAutonomous } = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/autonomous/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({
          campaignId: id,
          userId: user?.id,
          interval: autonomousInterval,
          postsPerCycle: autonomousPostsPerCycle,
          autoSchedule: autonomousAutoSchedule,
          withImages: autonomousWithImages,
          auth_token: localStorage.getItem('auth_token'),
          refresh_token: localStorage.getItem('refresh_token'),
        }),
      });
      // 5xx и 404 (чужая кампания) без этой проверки проходили как успех
      // (находка ревью 2026-07-28).
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Не удалось запустить автономный режим');
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success === false) {
        toast({ variant: 'destructive', description: data.error || 'Ошибка запуска' });
      } else {
        toast({ description: '🤖 Автономный режим запущен' });
        queryClient.invalidateQueries({ queryKey: ['/api/autonomous/status', id] });
      }
    },
    onError: (err: any) => {
      toast({ variant: 'destructive', description: err?.message || 'Ошибка запуска' });
    },
  });

  const { mutate: stopAutonomous, isPending: isStoppingAutonomous } = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/autonomous/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ campaignId: id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Не удалось остановить автономный режим');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ description: '⛔ Автономный режим остановлен' });
      queryClient.invalidateQueries({ queryKey: ['/api/autonomous/status', id] });
    },
    onError: (err: any) => {
      toast({ variant: 'destructive', description: err?.message || 'Ошибка остановки' });
    },
  });

  const toggleKeywordSelection = (index: number) => {
    setSuggestedKeywords((prev) =>
      prev.map((kw, i) =>
        i === index ? { ...kw, isSelected: !kw.isSelected } : kw,
      ),
    );
  };

  const handleAddSelectedKeywords = () => {
    const selectedKeywords = suggestedKeywords
      .filter((kw) => kw.isSelected)
      .map((kw) => kw.keyword);

    if (selectedKeywords.length > 0) {
      addKeywords(selectedKeywords);
      setIsSearchingKeywords(false); // Закрываем диалог с результатами
      setSuggestedKeywords([]); // Очищаем результаты
    }
  };

  const [silentUpdate, setSilentUpdate] = useState(false);

  const handleUrlUpdate = (newUrl: string, silent: boolean = false) => {
    if (newUrl && newUrl !== campaign?.link) {
      setSilentUpdate(silent);
      updateCampaign({ link: newUrl });
    }
  };

  // Функция для проверки завершенности разделов
  const getSectionCompletionStatus = () => {
    const sections = {
      site: {
        completed: Boolean(campaign?.link && campaign.link.trim()),
        label: "URL сайта указан",
      },
      keywords: {
        completed: Boolean(keywordList && keywordList.length > 0),
        label: `Добавлено ${keywordList?.length || 0} ключевых слов`,
      },
      questionnaire: {
        completed: Boolean(
          businessQuestionnaire &&
          typeof businessQuestionnaire === 'object' &&
          (businessQuestionnaire.companyName || businessQuestionnaire.brandVoice || businessQuestionnaire.targetAudience)
        ),
        label: (() => {
          if (!businessQuestionnaire) return "Анкета не заполнена";
          if (businessQuestionnaire.companyName && businessQuestionnaire.brandVoice && businessQuestionnaire.targetAudience) {
            return "Бизнес-анкета заполнена";
          }
          return "Анкета частично заполнена";
        })(),
      },
      trendAnalysis: {
        completed: Boolean(
          campaign?.trend_analysis_settings &&
          typeof campaign.trend_analysis_settings === "object" &&
          Object.keys(campaign.trend_analysis_settings).length > 0 &&
          // Хотя бы один параметр настроен
          (campaign.trend_analysis_settings.maxSourcesPerPlatform > 0 ||
            campaign.trend_analysis_settings.maxTrendsPerSource > 0 ||
            (campaign.trend_analysis_settings.minFollowers &&
              typeof campaign.trend_analysis_settings.minFollowers === "object" &&
              Object.values(campaign.trend_analysis_settings.minFollowers).some((val: any) => val > 0)))
        ),
        label: (() => {
          if (
            !campaign?.trend_analysis_settings ||
            Object.keys(campaign.trend_analysis_settings).length === 0
          ) {
            return "Советы не настроены";
          }
          const settings = campaign.trend_analysis_settings;

          if (
            !settings.minFollowers ||
            typeof settings.minFollowers !== "object" ||
            !Object.values(settings.minFollowers).some((val: any) => val > 0) ||
            !settings.maxSourcesPerPlatform ||
            !settings.maxTrendsPerSource
          ) {
            return "Советы частично настроены";
          }
          return "Советы настроены";
        })(),
      },
      socialMedia: {
        completed: Boolean(
          campaign?.social_media_settings &&
          typeof campaign.social_media_settings === "object" &&
          Object.values(campaign.social_media_settings).some((s: any) => {
            if (!s || typeof s !== "object") return false;
            // Считаем настроенным, если есть хотя бы одно непустое значение (токен, ID и т.д.)
            return Object.values(s).some(
              (val) => val !== null && val !== "" && val !== undefined,
            );
          }),
        ),
        label:
          campaign?.social_media_settings &&
            Object.values(campaign.social_media_settings).some(
              (s: any) =>
                s &&
                typeof s === "object" &&
                Object.values(s).some((v) => !!v),
            )
            ? "Соцсети настроены"
            : "Соцсети не настроены",
      },
      content: {
        completed: Boolean(campaignContent && campaignContent.length > 0),
        label:
          campaignContent && campaignContent.length > 0
            ? `Создано ${campaignContent.length} ед. контента`
            : "Контент не создан",
      },
      publication: {
        completed: Boolean(
          campaignContent &&
          campaignContent.some(
            (c) => c.status === "published" || c.status === "scheduled",
          ),
        ),
        label:
          campaignContent &&
            campaignContent.some(
              (c) => c.status === "published" || c.status === "scheduled",
            )
            ? "Есть публикации"
            : "Нет публикаций",
      },
    };

    return sections;
  };

  if (!campaign && !isLoading) {
    return (
      <div className="p-6">
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <Loader2 className="h-4 w-4 animate-spin" />
              <p className="font-medium">
                Кампания не найдена или у вас нет прав доступа к ней. Проверка данных...
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="page-header">
        <h1 className="text-2xl font-bold mb-6" data-testid="text-campaign-name">
          {isLoading ? (
            <span className="inline-block h-8 w-48 bg-muted animate-pulse rounded" />
          ) : (
            campaign?.name
          )}
        </h1>
      </div>

      <Accordion type="single" defaultValue="site">
        <AccordionItem
          value="site"
          campaignId={id}
          className="accordion-item px-6"
        >
          <AccordionTrigger
            value="site"
            campaignId={id}
            className="py-4 hover:no-underline hover:bg-accent hover:text-accent-foreground"
          >
            <div className="flex items-center gap-3">
              {getSectionCompletionStatus().site.completed ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <Circle className="h-5 w-5 text-gray-400" />
              )}
              <span>Сайт</span>
              <span className="text-sm text-muted-foreground ml-auto">
                {getSectionCompletionStatus().site.label}
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pt-2 pb-4">
            <div className="flex gap-4 items-center pt-2">
              <div className="relative">
                <Input
                  placeholder="Введите URL сайта"
                  value={currentUrl}
                  onChange={(e) => setCurrentUrl(e.target.value)}
                  onBlur={(e) => handleUrlUpdate(e.target.value.trim())}
                  className="max-w-md pr-10"
                />
                {urlSaveStatus === "saving" && (
                  <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 animate-spin text-blue-500 transition-all duration-200" />
                )}
                {urlSaveStatus === "saved" && (
                  <Check className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-green-500 transition-all duration-200" />
                )}
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  if (currentUrl) {
                    searchKeywords(currentUrl);
                  }
                }}
                disabled={isSearching || !currentUrl}
              >
                {isSearching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Поиск ключевых слов...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Найти ключевые слова
                  </>
                )}
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem
          value="keywords"
          campaignId={id}
          className="accordion-item px-6"
        >
          <AccordionTrigger
            value="keywords"
            campaignId={id}
            className="py-4 hover:no-underline hover:bg-accent hover:text-accent-foreground"
          >
            <div className="flex items-center gap-3">
              {getSectionCompletionStatus().keywords.completed ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <Circle className="h-5 w-5 text-gray-400" />
              )}
              <span>Ключевые слова</span>
              <span className="text-sm text-muted-foreground ml-auto">
                {getSectionCompletionStatus().keywords.label}
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pt-2 pb-4">
            <p className="text-sm text-muted-foreground mb-4">
              Ключевые слова помогают ИИ создавать контент, который точно соответствует вашей нише. Они используются при генерации постов, подборе трендов и оптимизации текстов для поисковых систем.
            </p>
            <div>
              <KeywordSelector
                campaignId={id}
                onSelect={(keywords) => {
                  console.log("onSelect вызван с keywords:", keywords);

                  const isStringArray =
                    Array.isArray(keywords) &&
                    keywords.length > 0 &&
                    typeof keywords[0] === "string";

                  const isObjectArray =
                    Array.isArray(keywords) &&
                    keywords.length > 0 &&
                    typeof keywords[0] === "object" &&
                    keywords[0] !== null &&
                    "keyword" in keywords[0];

                  if (isStringArray) {
                    const keywordStrings = keywords as string[];

                    if (keywordStrings.length === 1) {
                      const existingKeywords =
                        keywordList?.map((k) => k.keyword) || [];
                      if (existingKeywords.includes(keywordStrings[0])) {
                        console.log(
                          "Удаляем существующее ключевое слово:",
                          keywordStrings[0],
                        );
                        removeKeyword(keywordStrings[0]);
                        return;
                      } else {
                        console.log(
                          "Добавляем одиночное ключевое слово:",
                          keywordStrings[0],
                        );
                        addKeywords(keywordStrings);
                        return;
                      }
                    } else if (keywordStrings.length > 1) {
                      addKeywords(keywordStrings);
                    }
                  } else if (isObjectArray) {
                    console.log(
                      "Добавляем ключевые слова с метриками:",
                      keywords,
                    );
                    addKeywords(keywords);
                  }
                }}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="business-questionnaire"
          campaignId={id}
          className="accordion-item px-6"
        >
          <AccordionTrigger
            value="business-questionnaire"
            campaignId={id}
            className="py-4 hover:no-underline hover:bg-accent hover:text-accent-foreground"
          >
            <div className="flex items-center gap-3">
              {getSectionCompletionStatus().questionnaire.completed ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <Circle className="h-5 w-5 text-gray-400" />
              )}
              <span data-testid="text-business-questionnaire">Бизнес-анкета</span>
              <span className="text-sm text-muted-foreground ml-auto">
                {getSectionCompletionStatus().questionnaire.label}
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pt-2 pb-4">
            <BusinessQuestionnaireForm
              campaignId={id}
              onQuestionnaireUpdated={() => {
                queryClient.invalidateQueries({
                  queryKey: ["business-questionnaire", id],
                });
              }}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="trend-analysis"
          campaignId={id}
          className="accordion-item px-6"
        >
          <AccordionTrigger
            value="trend-analysis"
            campaignId={id}
            className="py-4 hover:no-underline hover:bg-accent hover:text-accent-foreground"
          >
            <div className="flex items-center gap-3">
              {getSectionCompletionStatus().trendAnalysis.completed ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <Circle className="h-5 w-5 text-gray-400" />
              )}
              <span>Настройки анализа трендов</span>
              <span className="text-sm text-muted-foreground ml-auto">
                {getSectionCompletionStatus().trendAnalysis.label}
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pt-2 pb-4">
            <div className="space-y-4">
              <div className="flex flex-col">
                <h3 className="text-xl font-semibold">
                  Параметры сбора трендов
                </h3>
                <p className="text-muted-foreground mt-1 mb-3">
                  Настройте параметры для сбора трендовых тем из социальных
                  сетей. Эти параметры влияют на то, какие аккаунты будут
                  анализироваться и какие тренды будут учитываться.
                </p>
              </div>
              <TrendAnalysisSettings
                campaignId={id}
                initialSettings={campaign?.trend_analysis_settings}
                onSettingsUpdated={() => {
                  queryClient.invalidateQueries({
                    queryKey: ["/api/proxy/campaign", id],
                  });
                }}
              />
              <div className="mt-4 border-t pt-4">
                <p className="text-sm text-muted-foreground">
                  После настройки параметров, перейдите в раздел «Тренды» для
                  сбора актуальных трендовых тем, которые затем будут
                  отображаться в блоке «Тренды» ниже.
                </p>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="social-media"
          campaignId={id}
          className="accordion-item px-6"
        >
          <AccordionTrigger
            value="social-media"
            campaignId={id}
            className="py-4 hover:no-underline hover:bg-accent hover:text-accent-foreground"
          >
            <div className="flex items-center gap-3">
              {getSectionCompletionStatus().socialMedia.completed ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <Circle className="h-5 w-5 text-gray-400" />
              )}
              <span>Настройки публикации</span>
              <span className="text-sm text-muted-foreground ml-auto">
                {getSectionCompletionStatus().socialMedia.label}
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pt-2 pb-4">
            <div className="space-y-4">
              <div className="flex flex-col">
                <h3 className="text-xl font-semibold">
                  Подключение социальных сетей
                </h3>
                <p className="text-muted-foreground mt-1 mb-3">
                  Настройте доступ к вашим социальным сетям для автоматической
                  публикации контента. Вам потребуются API-ключи и
                  идентификаторы ваших аккаунтов или сообществ для каждой
                  платформы.
                </p>
              </div>
              <SocialMediaSettings
                campaignId={id}
                initialSettings={campaign?.social_media_settings}
                onSettingsUpdated={() => {
                  // Принудительный рефetch — invalidateQueries + refetchQueries
                  queryClient.invalidateQueries({
                    queryKey: ["/api/proxy/campaign", id],
                  });
                  queryClient.refetchQueries({
                    queryKey: ["/api/proxy/campaign", id],
                  });
                }}
              />
              <div className="mt-4 border-t pt-4">
                <p className="text-sm text-muted-foreground">
                  После настройки доступа, вы сможете публиковать контент
                  напрямую из системы в выбранные социальные сети согласно
                  установленному расписанию в разделе «Календарь публикаций».
                </p>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {isStyleFeatureEnabled && (
          <AccordionItem
            value="content-style"
            campaignId={id}
            className="accordion-item px-6"
          >
            <AccordionTrigger
              value="content-style"
              campaignId={id}
              className="py-4 hover:no-underline hover:bg-accent hover:text-accent-foreground"
            >
              <div className="flex items-center gap-3">
                {(campaign as any)?.content_style?.style ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : (
                  <Circle className="h-5 w-5 text-gray-400" />
                )}
                <span>Стиль контента</span>
                <span className="text-sm text-muted-foreground ml-auto">
                  {(campaign as any)?.content_style?.style ? 'Настроено' : 'Не настроен'}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pt-2 pb-4">
              <div className="space-y-4">
                <div className="flex flex-col">
                  <h3 className="text-xl font-semibold">
                    Анализ стиля написания
                  </h3>
                  <p className="text-muted-foreground mt-1 mb-3">
                    Загрузите ваши существующие посты, чтобы AI определил стиль написания.
                    При генерации нового контента можно включить «Соответствовать стилю» —
                    и AI будет писать в том же духе.
                  </p>
                </div>
                <ContentStyleSettings
                  campaignId={id!}
                  initialStyle={(campaign as any)?.content_style}
                  onStyleUpdated={() => {
                    queryClient.invalidateQueries({
                      queryKey: ["/api/proxy/campaign", id],
                    });
                  }}
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        <AccordionItem
          value="content-generation"
          campaignId={id}
          className="accordion-item px-6"
        >
          <AccordionTrigger
            value="content-generation"
            campaignId={id}
            className="py-4 hover:no-underline hover:bg-accent hover:text-accent-foreground"
          >
            <div className="flex items-center gap-3">
              {getSectionCompletionStatus().content.completed ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <Circle className="h-5 w-5 text-gray-400" />
              )}
              <span>Генерация контента</span>
              <span className="text-sm text-muted-foreground ml-auto">
                {getSectionCompletionStatus().content.label}
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pt-2 pb-4">
            <div className="space-y-4">
              <div className="flex flex-col">
                <h3 className="text-xl font-semibold">
                  Создание контента с помощью ИИ
                </h3>
                <p className="text-muted-foreground mt-1 mb-3">
                  Используйте мощные языковые модели для генерации постов, статей и другого контента на основе ваших ключевых слов и настроек кампании.
                </p>
              </div>
              <div className="flex gap-4">
                <Button
                  onClick={() => setIsGenerationDialogOpen(true)}
                  className="bg-primary text-primary-foreground"
                >
                  <Wand2 className="mr-2 h-4 w-4" />
                  Сгенерировать контент
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate('/content')}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Все материалы
                </Button>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="autonomous-settings"
          campaignId={id}
          className="accordion-item px-6"
        >
          <AccordionTrigger
            value="autonomous-settings"
            campaignId={id}
            className="py-4 hover:no-underline hover:bg-accent hover:text-accent-foreground"
          >
            <div className="flex items-center gap-3">
              <Bot className="h-5 w-5 text-primary" />
              <span>Настройки автономного ассистента</span>
              <span className="text-sm text-muted-foreground ml-auto">
                Промпт, ссылки, подпись
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pt-2 pb-4">
            <AutonomousSettings
              campaignId={id}
              initialSettings={(campaign as any)?.autonomous_settings}
              onSettingsUpdated={() => {
                queryClient.invalidateQueries({
                  queryKey: ["/api/proxy/campaign", id],
                });
              }}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {isGenerationDialogOpen && (
        <ContentGenerationDialog
          campaignId={id!}
          keywords={keywordList.map(kw => ({
            id: kw.id,
            keyword: kw.keyword,
            trendScore: kw.trend_score,
            campaignId: kw.campaign_id
          }))}
          contentStyle={(campaign as any)?.content_style}
          onClose={() => {
            setIsGenerationDialogOpen(false);
            queryClient.invalidateQueries({ queryKey: ["/api/campaign-content", id] });
          }}
        />
      )}

      {/* Уведомление об ожидающем одобрении (план / тексты / картинки) */}
      {autonomousStatus?.pendingApprovalStep && (
        <div
          data-testid="pending-plan-banner"
          className="fixed bottom-6 right-6 z-50 max-w-sm shadow-lg rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/90 p-4 flex items-start gap-3 animate-in slide-in-from-bottom-5"
        >
          <ClipboardList className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
              {autonomousStatus.pendingApprovalStep === 'plan' && 'Контент-план готов к проверке'}
              {autonomousStatus.pendingApprovalStep === 'content' && 'Тексты написаны — проверьте'}
              {autonomousStatus.pendingApprovalStep === 'images' && 'Картинки готовы — проверьте'}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
              {autonomousStatus.pendingApprovalStep === 'plan' && `AI составил ${autonomousStatus.pendingPlan?.length ?? 0} идей постов`}
              {autonomousStatus.pendingApprovalStep === 'content' && 'Посты созданы как черновики — одобрите для генерации картинок'}
              {autonomousStatus.pendingApprovalStep === 'images' && 'Картинки прикреплены к постам — одобрите для планирования'}
            </p>
            <Button
              size="sm"
              className="mt-2 bg-amber-600 hover:bg-amber-700 text-white h-7 text-xs"
              onClick={() => setIsPlanDialogOpen(true)}
              data-testid="open-plan-dialog-btn"
            >
              Просмотреть и одобрить
            </Button>
          </div>
        </div>
      )}

      {/* Диалог одобрения контент-плана */}
      {id && (
        <ContentPlanDialog
          campaignId={id}
          open={isPlanDialogOpen}
          onOpenChange={setIsPlanDialogOpen}
          plan={autonomousStatus?.pendingPlan || null}
          approvalStep={autonomousStatus?.pendingApprovalStep || null}
          pendingContentIds={autonomousStatus?.pendingContentIds || null}
        />
      )}

      <Dialog open={isSearchingKeywords} onOpenChange={setIsSearchingKeywords}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Найденные ключевые слова</DialogTitle>
            <DialogDescription>
              Выберите ключевые слова для добавления в кампанию
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="space-y-4">
              {suggestedKeywords.map((kw, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <Checkbox
                    id={`keyword-${index}`}
                    checked={kw.isSelected}
                    onCheckedChange={() => toggleKeywordSelection(index)}
                    className="data-[state=checked]:bg-primary"
                  />
                  <label
                    htmlFor={`keyword-${index}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    {kw.keyword}
                  </label>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => setIsSearchingKeywords(false)}
            >
              Отмена
            </Button>
            <Button onClick={handleAddSelectedKeywords}>
              Добавить выбранные
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

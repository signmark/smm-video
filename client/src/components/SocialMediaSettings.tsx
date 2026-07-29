import { useState, useEffect, useRef, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { usePlan } from "@/hooks/use-plan";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle, XCircle, AlertCircle, AlertTriangle, Youtube, RefreshCw, Clock } from "lucide-react";
import { directusApi } from "@/lib/directus";
import { api } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import { YouTubeOAuthSetup } from "./YouTubeOAuthSetup";
import { YouTubeSetupWizard } from "./YouTubeSetupWizard";
import InstagramSetupWizardSimple from "./InstagramSetupWizardSimple";
import VkSetupWizard from "./VkSetupWizard";
import FacebookSetupWizard from "./FacebookSetupWizard";
import { isPlatformConnected } from "@/lib/platform-connection";
import type { SocialMediaSettings } from "@shared/schema";

const socialMediaSettingsSchema = z.object({
  telegram: z.object({
    token: z.string().nullable().optional(),
    chatId: z.string().nullable().optional(),
  }).optional(),
  vk: z.object({
    token: z.string().nullable().optional(),
    groupId: z.string().nullable().optional(),
    groupName: z.string().nullable().optional(),
  }).optional(),
  instagram: z.object({
    token: z.string().nullable().optional(),
    accessToken: z.string().nullable().optional(),
    businessAccountId: z.string().nullable().optional(),
    appId: z.string().nullable().optional(),
    appSecret: z.string().nullable().optional(),
  }).optional(),
  facebook: z.object({
    token: z.string().nullable().optional(),
    pageId: z.string().nullable().optional(),
    pageName: z.string().nullable().optional(),
  }).optional(),
  youtube: z.object({
    channelId: z.string().nullable().optional(),
    channelTitle: z.string().nullable().optional(),
    accessToken: z.string().nullable().optional(),
    refreshToken: z.string().nullable().optional(),
  }).optional(),
  threads: z.object({
    appId: z.string().nullable().optional(),
    appSecret: z.string().nullable().optional(),
    accessToken: z.string().nullable().optional(),
    threadsUserId: z.string().nullable().optional(),
    username: z.string().nullable().optional(),
  }).optional(),
  tiktok: z.object({
    clientKey: z.string().nullable().optional(),
    clientSecret: z.string().nullable().optional(),
  }).optional(),
});

interface SocialMediaSettingsProps {
  campaignId: string;
  initialSettings?: SocialMediaSettings;
  onSettingsUpdated?: () => void;
}

interface ValidationStatus {
  isValid?: boolean;
  message?: string;
  isLoading: boolean;
  /**
   * Насколько плох отказ. `warning` — временный сбой самой соцсети (VK не
   * отвечает, флуд-контроль, таймаут): подключение исправно, надо подождать.
   * `error` — нужно действие пользователя. Раньше различия не было, и любой
   * чих VK показывался красной «Ошибкой».
   */
  severity?: 'success' | 'warning' | 'error';
  /** Имеет ли смысл повторить — приходит с сервера вместе с severity. */
  retryable?: boolean;
}

/** Отказ, который требует действий пользователя (а не «подождите»). */
const isActionableFailure = (status: ValidationStatus): boolean =>
  status.isValid === false && status.severity !== 'warning';

export function SocialMediaSettings({
  campaignId,
  initialSettings,
  onSettingsUpdated
}: SocialMediaSettingsProps) {
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { limits } = usePlan();
  
  // Состояние для показа Instagram wizard
  const [showInstagramWizard, setShowInstagramWizard] = useState(false);
  
  // Состояние для показа VK wizard
  const [showVkWizard, setShowVkWizard] = useState(false);
  
  // Состояние для показа Facebook wizard
  const [showFacebookWizard, setShowFacebookWizard] = useState(false);
  
  // Состояние для показа YouTube wizard
  const [showYoutubeWizard, setShowYoutubeWizard] = useState(false);

  // Состояние для сохранения TikTok credentials
  const [isSavingTikTokCredentials, setIsSavingTikTokCredentials] = useState(false);
  

  
  // Состояние для Instagram настроек из базы данных
  const [instagramSettings, setInstagramSettings] = useState<any>(null);
  const [loadingInstagramSettings, setLoadingInstagramSettings] = useState(false);
  
  // Состояние для VK настроек из базы данных
  const [vkSettings, setVkSettings] = useState<any>(null);
  const [loadingVkSettings, setLoadingVkSettings] = useState(false);

  // Состояние для Facebook настроек из базы данных
  const [facebookSettings, setFacebookSettings] = useState<any>(null);
  const [loadingFacebookSettings, setLoadingFacebookSettings] = useState(false);
  
  // Состояние для YouTube настроек из базы данных
  const [youtubeSettings, setYoutubeSettings] = useState<any>(null);
  const [loadingYoutubeSettings, setLoadingYoutubeSettings] = useState(false);

  // Состояние для Threads настроек из базы данных
  const [threadsSettings, setThreadsSettings] = useState<any>(null);
  // Показ блоков настройки Threads, когда уже подключено (переподключение)
  const [threadsShowSetup, setThreadsShowSetup] = useState(false);
  const [loadingThreadsSettings, setLoadingThreadsSettings] = useState(false);
  const [showThreadsOAuthForm, setShowThreadsOAuthForm] = useState(false);
  // Показ поля ввода Bot Token, когда Telegram уже настроен (замена токена)
  const [telegramShowTokenInput, setTelegramShowTokenInput] = useState(false);

  // Статусы валидации для каждой соцсети
  const [telegramStatus, setTelegramStatus] = useState<ValidationStatus>({ isLoading: false });
  const [vkStatus, setVkStatus] = useState<ValidationStatus>({ isLoading: false });
  const [instagramStatus, setInstagramStatus] = useState<ValidationStatus>({ isLoading: false });
  const [facebookStatus, setFacebookStatus] = useState<ValidationStatus>({ isLoading: false });
  const [youtubeStatus, setYoutubeStatus] = useState<ValidationStatus>({ isLoading: false });
  const [threadsStatus, setThreadsStatus] = useState<ValidationStatus>({ isLoading: false });

  // Состояние для переключения Instagram аккаунтов
  const [showAccountSwitcher, setShowAccountSwitcher] = useState(false);

  // Состояние для кэширования Instagram username
  const [instagramDisplayName, setInstagramDisplayName] = useState<string>('');

  // useEffect для загрузки Instagram username при изменении настроек
  useEffect(() => {
    const loadInstagramUsername = async () => {
      if (instagramSettings?.businessAccountId && instagramSettings?.accessToken) {
        try {

          const response = await fetch(`https://graph.facebook.com/v23.0/${instagramSettings.businessAccountId}?access_token=${instagramSettings.accessToken}&fields=id,username,name`);
          const data = await response.json();
          
          if (data.username) {
            const displayName = `@${data.username}`;

            setInstagramDisplayName(displayName);
          } else if (data.name) {
            // Используем name если username недоступен

            setInstagramDisplayName(data.name);
          } else {

            setInstagramDisplayName('Instagram Business Account');
          }
        } catch (error) {
          console.error('Error fetching Instagram username:', error);
          setInstagramDisplayName('Instagram Business Account');
        }
      }
    };

    loadInstagramUsername();
  }, [instagramSettings?.businessAccountId, instagramSettings?.accessToken]);

  // Функция для получения имени Instagram аккаунта (только fallback)
  const getInstagramAccountName = (accountId: string) => {
    return 'Instagram Business Account';
  };
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  
  // Состояние для доступных Instagram аккаунтов
  const [availableInstagramAccounts, setAvailableInstagramAccounts] = useState<Array<{
    id: string;
    name: string;
    username?: string;
  }>>([]);

  // Состояние для VK URL парсинга
  const [vkUrlInput, setVkUrlInput] = useState('');
  const [vkGroups, setVkGroups] = useState<Array<{
    id: string;
    name: string;
    screen_name: string;
    members_count: number;
  }>>([]);
  const [loadingVkGroups, setLoadingVkGroups] = useState(false);
  const [vkPolling, setVkPolling] = useState(false);
  const [vkWebhookCopied, setVkWebhookCopied] = useState(false);
  // Стабильный URL с постоянным секретом выдаёт сервер (prepare). Без верного
  // секрета публичный VK-webhook отклоняется; сам URL переиспользуется.
  const [vkWebhookUrl, setVkWebhookUrl] = useState('');
  const [vkWebhookPreparing, setVkWebhookPreparing] = useState(false);
  const [vkShowManual, setVkShowManual] = useState(false);
  const vkPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vkPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vkGroupsFetchedRef = useRef(false);

  // Состояние для инлайн-переподключения VK (PKCE popup)
  const [isVkReconnecting, setIsVkReconnecting] = useState(false);
  const vkReconnectListenerRef = useRef<((e: MessageEvent) => void) | null>(null);
  const vkReconnectCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vkValidatedForSettingsRef = useRef<any>(null);
  // true после «Отмена» или таймаута — блокирует авто-рестарт поллинга из useEffect
  const vkPollCancelledRef = useRef(false);

  // Функция проверки статуса настройки платформ.
  // Правила «что считается подключённым» живут в lib/platform-connection — тем же
  // хелпером пользуется панель публикации. Здесь поверх них только серверное
  // состояние, которого нет в форме (instagramSettings, vkSettings).
  const isConfigured = (platform: 'instagram' | 'youtube' | 'facebook' | 'vk' | 'telegram' | 'threads' | 'tiktok') => {
    const settings = form.getValues();

    switch (platform) {
      case 'instagram': {
        // Серверные настройки приоритетнее формы: OAuth-визард пишет их мимо неё.
        const igSettings = (instagramSettings as any) || {};
        return isPlatformConnected({ instagram: igSettings }, 'instagram')
          || isPlatformConnected(settings as any, 'instagram');
      }
      case 'vk':
        return isPlatformConnected(settings as any, 'vk')
          || isPlatformConnected({ vk: (vkSettings as any) || {} }, 'vk');
      case 'youtube':
      case 'facebook':
      case 'telegram':
      case 'threads':
        return isPlatformConnected(settings as any, platform);
      case 'tiktok':
        return false;
      default:
        return false;
    }
  };

  // Факт наличия сохранённого Bot Token. Сам токен в браузер не приходит
  // (sanitizeOAuthSecrets), наружу отдаётся только boolean hasToken. По chatId судить
  // нельзя: он сохраняется отдельно, и «chatId без токена» — достижимое состояние.
  const telegramHasSavedToken = !!(initialSettings?.telegram as any)?.hasToken;

  // Функция парсинга VK URL для извлечения API ключа
  const parseVkUrl = (url: string) => {
    try {
      // Ищем access_token в URL hash (классический OAuth)
      const urlParams = new URLSearchParams(url.split('#')[1] || url.split('?')[1] || '');
      const accessToken = urlParams.get('access_token');
      
      if (accessToken) {
        return accessToken;
      }

      // Альтернативный парсинг для разных форматов VK URL
      const tokenMatch = url.match(/access_token=([^&]+)/);
      if (tokenMatch) {
        return tokenMatch[1];
      }

      // Парсинг payload от VK ID (silent_token)
      const payloadMatch = url.match(/payload=([^&]+)/);
      if (payloadMatch) {
        try {
          const decodedPayload = decodeURIComponent(payloadMatch[1]);
          const payload = JSON.parse(decodedPayload);
          if (payload.token) {
            console.log('[VK] Извлечён токен из payload');
            return payload.token;
          }
        } catch (e) {
          console.error('[VK] Ошибка парсинга payload:', e);
        }
      }

      return null;
    } catch (error) {
      console.error('Ошибка парсинга VK URL:', error);
      return null;
    }
  };

  // Функция обработки VK URL
  const handleVkUrlParse = () => {
    if (!vkUrlInput.trim()) {
      toast({
        variant: "destructive",
        title: "Ошибка!",
        description: "Введите URL с токеном доступа ВК"
      });
      return;
    }

    const token = parseVkUrl(vkUrlInput);
    if (token) {
      form.setValue('vk.token', token);
      setVkUrlInput('');
      toast({
        title: "Успешно!",
        description: "Токен доступа извлечен из URL"
      });
    } else {
      toast({
        variant: "destructive", 
        title: "Ошибка!",
        description: "Не удалось извлечь токен из URL. Проверьте формат ссылки."
      });
    }
  };

  // Функция получения VK групп. Токен из базы в браузер не приходит —
  // по умолчанию группы грузит сервер по campaignId; если пользователь
  // вставил токен вручную, используем его напрямую.
  const fetchVkGroups = async () => {
    setLoadingVkGroups(true);
    try {
      const manualToken = form.getValues('vk.token');
      const response = manualToken
        ? await fetch(`/api/vk/groups?access_token=${encodeURIComponent(manualToken)}`)
        : await fetch(`/api/campaigns/${campaignId}/vk-groups`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` }
          });
      const data = await response.json();
      
      if (data.success && data.groups) {
        setVkGroups(data.groups);
        toast({
          title: "Успешно",
          description: `Загружено ${data.groups.length} групп`,
        });
        return;
      }

      // Сервер классифицировал отказ VK — временный сбой платформы показываем
      // спокойным тостом «подождите». Раньше сюда прилетал сырой текст VK
      // («Internal server error: could not check access_token now, check later»)
      // красным, и выглядело это как поломка подключения.
      if (data.severity === 'warning' || data.retryable) {
        toast({
          title: "ВКонтакте временно недоступен",
          description: data.error || "ВКонтакте сейчас не отдаёт список сообществ. Подключение в порядке — попробуйте через несколько минут.",
        });
        setVkGroups([]);
        return;
      }

      toast({
        title: "Не удалось загрузить сообщества",
        description: data.error || 'ВКонтакте не вернул список сообществ',
        variant: "destructive"
      });
      setVkGroups([]);
    } catch (error: any) {
      // Сюда попадаем, только если запрос вообще не дошёл или ответ не разобрался.
      console.error('Error fetching VK groups:', error);
      toast({
        title: "Запрос не выполнен",
        description: "Не удалось связаться с сервером. Попробуйте ещё раз через минуту.",
      });
      setVkGroups([]);
    } finally {
      setLoadingVkGroups(false);
    }
  };

  // Обработчик выбора VK группы
  const handleVkGroupSelect = async (groupId: string, groupName: string) => {
    try {
      console.log('🔄 VK Group Select: Saving group selection...', { groupId, groupName });

      // Получаем АКТУАЛЬНЫЕ настройки из БД прямо сейчас,
      // чтобы не потерять refreshToken / clientId / deviceId которые
      // были сохранены token-webhook'ом, но отсутствуют в форме
      const savedResp = await fetch(`/api/campaigns/${campaignId}/vk-settings`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` }
      });
      const savedData = await savedResp.json();
      const savedVk = savedData.settings || {};

      // Сохраняем через специализированный эндпоинт который корректно мержит поля
      const body: Record<string, any> = {
        token: savedVk.token || form.getValues('vk.token') || '',
        groupId,
        groupName,
        setupCompletedAt: new Date().toISOString(),
      };
      if (savedVk.refreshToken) body.refreshToken = savedVk.refreshToken;
      if (savedVk.clientId)     body.clientId     = savedVk.clientId;
      if (savedVk.deviceId)     body.deviceId     = savedVk.deviceId;
      if (savedVk.tokenExpiresAt) body.tokenExpiresAt = savedVk.tokenExpiresAt;

      const patchResp = await fetch(`/api/campaigns/${campaignId}/vk-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
        body: JSON.stringify(body)
      });
      const patchData = await patchResp.json();
      if (!patchData.success) throw new Error(patchData.error || 'Ошибка сохранения');

      // Обновляем форму и состояние
      form.setValue('vk.groupId', groupId);
      form.setValue('vk.groupName', groupName);
      await loadVkSettings();
      setVkGroups([]);
      vkGroupsFetchedRef.current = false;

      toast({ title: "Группа выбрана", description: `Выбрана группа: ${groupName}` });
      console.log('✅ VK Group Select: Group saved with full settings');
    } catch (error) {
      console.error('❌ VK Group Select: Error saving group selection:', error);
      toast({ title: "Ошибка", description: "Не удалось сохранить выбранную группу", variant: "destructive" });
    }
  };

  // Обработчик завершения Facebook мастера
  const handleFacebookComplete = (data: { token: string; pageId: string; pageName: string; userToken?: string }) => {
    // Проверяем что токен не содержит лог консоли
    if (data.token.includes('Facebook Wizard:') || data.token.includes('%20') || data.token.includes('FacebookSetupWizard')) {
      toast({
        title: "Ошибка",
        description: "Получен некорректный токен от мастера настройки. Попробуйте заново.",
        variant: "destructive",
      });
      return;
    }

    // Токен страницы Facebook идет в основное поле token
    form.setValue('facebook.token', data.token);
    form.setValue('facebook.pageId', data.pageId);
    form.setValue('facebook.pageName', data.pageName);
    
    // Если есть пользовательский токен (это Instagram токен), сохраняем его отдельно
    if (data.userToken) {
      // Проверяем, что это именно Instagram токен из существующих настроек
      const instagramToken = instagramSettings?.accessToken || 
                            instagramSettings?.token ||
                            instagramSettings?.longLivedToken;
      
      // Если userToken совпадает с Instagram токеном, это значит был использован "Взять из Instagram"
      if (instagramToken && data.userToken === instagramToken) {
        console.log('📋 Facebook Setup: Instagram токен будет сохранен как ссылка в Facebook настройках');
        // В будущем здесь можно добавить сохранение ссылки на Instagram токен
        // Пока просто логируем для понимания структуры
      }
    }
    
    toast({
      title: "Facebook настроен",
      description: `Выбрана страница: ${data.pageName}`,
    });
  };

  // Обработчик завершения Instagram мастера
  const handleInstagramComplete = async (data: { 
    token: string; 
    accessToken: string;
    businessAccountId: string;
    appId: string;
    appSecret: string;
    needsReload?: boolean;
  }) => {
    console.log('📸 [Instagram Complete] Setting form values:', data);
    
    // Обновляем поля формы
    form.setValue('instagram.token', data.token || data.accessToken);
    form.setValue('instagram.accessToken', data.accessToken || data.token);
    form.setValue('instagram.businessAccountId', data.businessAccountId);
    form.setValue('instagram.appId', data.appId);
    form.setValue('instagram.appSecret', data.appSecret);
    
    try {
      await onSubmit(form.getValues());
      console.log('✅ [Instagram Complete] Settings automatically saved');
      
      // Перезагружаем Instagram настройки из базы для обновления UI
      await loadInstagramSettings();
      
      toast({
        title: "Instagram настроен!",
        description: "Токен получен и сохранен в настройки кампании"
      });
    } catch (error) {
      console.error('❌ [Instagram Complete] Error saving settings:', error);
      toast({
        title: "Ошибка сохранения",
        description: "Instagram настроен, но возникла ошибка при сохранении настроек",
        variant: "destructive"
      });
    }
  };

  // Обработчик завершения YouTube мастера
  const handleYoutubeComplete = async (data: { 
    channelId: string; 
    channelTitle: string; 
    accessToken: string; 
    refreshToken: string;
    channelInfo: any;
    campaignId?: string;  // Добавляем возможность передать campaignId
  }) => {
    // OAuth callback already persisted the tokens on the server. The browser only
    // receives channel metadata and must never round-trip OAuth credentials.
    form.setValue('youtube.channelId', data.channelId);
    form.setValue('youtube.channelTitle', data.channelTitle);
    setYoutubeSettings((current: any) => ({
      ...(current || {}),
      channelId: data.channelId,
      channelTitle: data.channelTitle,
      configured: true,
    }));
    toast({
      title: "YouTube настроен!",
      description: `Канал "${data.channelTitle}" готов к публикации видео`
    });
    if (onSettingsUpdated) onSettingsUpdated();
  };

  const form = useForm<SocialMediaSettings>({
    resolver: zodResolver(socialMediaSettingsSchema),
    defaultValues: {
      telegram: initialSettings?.telegram || { token: '', chatId: '' },
      vk: initialSettings?.vk || { token: '', groupId: '', groupName: '' },
      instagram: initialSettings?.instagram || { token: '', accessToken: '', businessAccountId: '', appId: '', appSecret: '' },
      facebook: initialSettings?.facebook || { token: '', pageId: '', pageName: '' },
      youtube: initialSettings?.youtube || { channelId: '', channelTitle: '', accessToken: '', refreshToken: '' },
      threads: (initialSettings as any)?.threads || { appId: '', appSecret: '', accessToken: '', threadsUserId: '', username: '' },
      tiktok: (initialSettings as any)?.tiktok || { clientKey: '', clientSecret: '' }
    }
  });

  // Функция загрузки VK настроек из базы данных
  const loadVkSettings = async () => {
    setLoadingVkSettings(true);
    try {

      
      const response = await fetch(`/api/campaigns/${campaignId}/vk-settings`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();

        
        if (data.success && data.settings) {
          // Сброс guard если токен изменился (переподключение VK)
          const oldToken = form.getValues('vk.token');
          if (data.settings.token && data.settings.token !== oldToken) {
            vkGroupsFetchedRef.current = false;
          }
          setVkSettings(data.settings);
          
          // Обновляем поля формы с полученными данными
          if (data.settings.token) {
            form.setValue('vk.token', data.settings.token);
          }
          if (data.settings.groupId) {
            form.setValue('vk.groupId', data.settings.groupId);
          }
          

        } else {

          setVkSettings(null);
        }
      } else {
        console.error('❌ Failed to load VK settings:', response.statusText);
      }
    } catch (error: any) {
      console.error('❌ Error loading VK settings:', error);
    } finally {
      setLoadingVkSettings(false);
    }
  };

  // Получает стабильный webhook URL с постоянным per-campaign секретом (сервер
  // генерит его один раз и переиспользует). Возвращает URL или '' при ошибке.
  const prepareVkWebhook = async (): Promise<string> => {
    setVkWebhookPreparing(true);
    try {
      const resp = await fetch(`/api/vk/token-webhook/${campaignId}/prepare`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
      });
      if (!resp.ok) return '';
      const data = await resp.json();
      setVkWebhookUrl(data.webhookUrl);
      return data.webhookUrl as string;
    } catch {
      return '';
    } finally {
      setVkWebhookPreparing(false);
    }
  };

  // Готовим URL, когда видна инструкция needanapp (VK не настроен / токен невалиден).
  useEffect(() => {
    const needWebhook = !isConfigured('vk') || isActionableFailure(vkStatus) || vkSettings?.authExpired;
    if (campaignId && needWebhook && !vkWebhookUrl && !vkWebhookPreparing) {
      prepareVkWebhook();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, vkStatus.isValid, vkSettings?.authExpired]);

  // Переподключение VK через needanapp (webhook polling)
  const startVkReconnect = async () => {
    // URL стабилен (постоянный секрет): уже сохранённый в needanapp URL продолжит
    // работать. Готовим его на всякий случай, чтобы показать пользователю.
    const freshUrl = await prepareVkWebhook();

    // Ставим флаг reconnecting чтобы polling не срабатывал на старом токене
    try {
      await fetch(`/api/vk/token-webhook/${campaignId}/reconnecting`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
      });
    } catch {}

    // Открываем needanapp в новой вкладке
    window.open('https://vk.needanapp.ru', '_blank');
    setIsVkReconnecting(true);

    toast({
      title: "Переподключение VK",
      description: freshUrl
        ? "Откройте needanapp, получите токен. Webhook URL уже сохранён (можно проверить ниже). Ожидаем токен..."
        : "Откройте vk.needanapp.ru, получите токен и вставьте webhook URL. Ожидаем токен..."
    });

    // Запускаем polling webhook status
    vkReconnectCheckRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`/api/vk/token-webhook/${campaignId}/status`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
        });
        const data = await resp.json();
        if (data.ready) {
          cleanupVkReconnect();
          // Загружаем настройки
          const resp2 = await fetch(`/api/campaigns/${campaignId}/vk-settings`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` }
          });
          const d2 = await resp2.json();
          // Токен в ответ не приходит (sanitizeOAuthSecrets) — смотрим на groupId
          if (d2.settings?.groupId) {
            form.setValue('vk.groupId', d2.settings.groupId);
            if (d2.settings.groupName) form.setValue('vk.groupName', d2.settings.groupName);
            toast({ title: "VK переподключён", description: "Группа сохранена, публикации возобновлены." });
          } else if (!vkGroupsFetchedRef.current) {
            vkGroupsFetchedRef.current = true;
            fetchVkGroups();
            toast({ title: "VK переподключён", description: "Выберите группу для публикации." });
          }
          loadVkSettings();
        }
      } catch {}
    }, 3000);

    // Таймаут 5 минут
    setTimeout(() => {
      if (vkReconnectCheckRef.current) {
        cleanupVkReconnect();
        toast({ title: "Время ожидания истекло", description: "Токен не получен за 5 минут. Попробуйте ещё раз.", variant: "destructive" });
      }
    }, 5 * 60 * 1000);
  };

  const cleanupVkReconnect = () => {
    if (vkReconnectListenerRef.current) {
      window.removeEventListener("message", vkReconnectListenerRef.current);
      vkReconnectListenerRef.current = null;
    }
    if (vkReconnectCheckRef.current) {
      clearInterval(vkReconnectCheckRef.current);
      vkReconnectCheckRef.current = null;
    }
    setIsVkReconnecting(false);
  };

  // Запуск polling VK токена (общий для auto-start и ручного запуска)
  const startVkPolling = useCallback(() => {
    if (vkPollRef.current || vkPolling) return; // уже запущен
    vkPollCancelledRef.current = false;
    setVkPolling(true);
    vkPollRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`/api/vk/token-webhook/${campaignId}/status`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
        });
        const data = await resp.json();
        if (data.ready) {
          clearInterval(vkPollRef.current!);
          vkPollRef.current = null;
          setVkPolling(false);
          if (vkPollTimeoutRef.current) {
            clearTimeout(vkPollTimeoutRef.current);
            vkPollTimeoutRef.current = null;
          }
          const resp2 = await fetch(`/api/campaigns/${campaignId}/vk-settings`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` }
          });
          const d2 = await resp2.json();
          // Токен в ответ не приходит (sanitizeOAuthSecrets) — смотрим на groupId
          if (d2.settings?.groupId) {
            form.setValue('vk.groupId', d2.settings.groupId);
            if (d2.settings.groupName) form.setValue('vk.groupName', d2.settings.groupName);
          } else if (!vkGroupsFetchedRef.current) {
            vkGroupsFetchedRef.current = true;
            fetchVkGroups();
          }
          loadVkSettings();
        }
      } catch {}
    }, 3000);
    vkPollTimeoutRef.current = setTimeout(() => {
      if (vkPollRef.current) {
        clearInterval(vkPollRef.current);
        vkPollRef.current = null;
        vkPollCancelledRef.current = true; // не рестартовать автоматически после таймаута
        setVkPolling(false);
      }
      vkPollTimeoutRef.current = null;
    }, 5 * 60 * 1000);
  }, [campaignId, form, fetchVkGroups]);

  const stopVkPolling = useCallback(() => {
    if (vkPollRef.current) {
      clearInterval(vkPollRef.current);
      vkPollRef.current = null;
    }
    if (vkPollTimeoutRef.current) {
      clearTimeout(vkPollTimeoutRef.current);
      vkPollTimeoutRef.current = null;
    }
    vkPollCancelledRef.current = true; // «Отмена» пользователя — авто-рестарт запрещён
    setVkPolling(false);
  }, []);

  // Функция загрузки Instagram настроек из базы данных
  // Функция для переключения Instagram аккаунтов
  const handleSwitchInstagramAccount = async () => {

    
    // Токен в браузер не приходит — сервер сам возьмёт его из настроек кампании
    if (!instagramSettings?.configured && !instagramSettings?.businessAccountId) {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: "Сначала подключите Instagram через OAuth"
      });
      return;
    }

    setLoadingAccounts(true);
    try {

      const response = await fetch(`/api/campaigns/${campaignId}/discover-instagram-accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({})
      });

      const data = await response.json();

      
      if (data.success && data.accounts) {

        setAvailableInstagramAccounts(data.accounts);
        setShowAccountSwitcher(true);
        toast({
          title: "Аккаунты найдены",
          description: `Найдено ${data.accounts.length} Instagram Business аккаунтов`
        });
      } else {
        console.log('❌ Instagram: Аккаунты не найдены:', data);
        throw new Error(data.error || 'Аккаунты не найдены');
      }
    } catch (error: any) {
      console.error('❌ Instagram: Ошибка при поиске аккаунтов:', error);
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoadingAccounts(false);
    }
  };

  // Функция выбора нового Instagram аккаунта
  const handleSelectNewAccount = async (accountId: string, accountName: string) => {
    try {
      setLoadingAccounts(true);
      
      // Обновляем настройки в базе данных
      const currentSettings = form.getValues();
      const updatedSettings = {
        ...currentSettings,
        instagram: {
          ...currentSettings.instagram,
          businessAccountId: accountId
        }
      };
      
      await onSubmit(updatedSettings);
      
      // Перезагружаем настройки Instagram
      await loadInstagramSettings();
      
      setShowAccountSwitcher(false);
      toast({
        title: "Аккаунт изменен",
        description: `Выбран новый аккаунт: ${accountName}`
      });
    } catch (error: any) {
      console.error('Error switching Instagram account:', error);
      toast({
        title: "Ошибка",
        description: "Не удалось изменить аккаунт",
        variant: "destructive"
      });
    } finally {
      setLoadingAccounts(false);
    }
  };

  const loadInstagramSettings = async () => {
    setLoadingInstagramSettings(true);
    try {

      // Используем API client с авторизацией 
      const response = await api.get(`/campaigns/${campaignId}/instagram-settings`);
      const data = response.data;
      

      
      if (data.success && data.settings) {

        setInstagramSettings(data.settings);
      } else {

        setInstagramSettings(null);
      }
    } catch (error: any) {

      // Если ошибка авторизации, попробуем обновить страницу
      if (error.response?.status === 401) {
        // Обработка ошибки авторизации
      }
      setInstagramSettings(null);
    } finally {
      setLoadingInstagramSettings(false);
    }
  };

  // Функция загрузки Facebook настроек из базы данных
  const loadFacebookSettings = async () => {
    setLoadingFacebookSettings(true);
    try {

      
      const response = await fetch(`/api/campaigns/${campaignId}/facebook-settings`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();

        
        if (data.success && data.settings) {
          setFacebookSettings(data.settings);
          
          // Обновляем поля формы с полученными данными
          if (data.settings.token) {
            form.setValue('facebook.token', data.settings.token);
          }
          if (data.settings.pageId) {
            form.setValue('facebook.pageId', data.settings.pageId);
          }
          if (data.settings.pageName) {
            form.setValue('facebook.pageName', data.settings.pageName);
          }
          

        } else {

          setFacebookSettings(null);
        }
      } else {
        console.error('❌ Failed to load Facebook settings:', response.statusText);
      }
    } catch (error: any) {
      console.error('❌ Error loading Facebook settings:', error);
    } finally {
      setLoadingFacebookSettings(false);
    }
  };

  // Функция загрузки YouTube настроек из базы данных
  const loadYoutubeSettings = async () => {
    setLoadingYoutubeSettings(true);
    try {

      
      const response = await fetch(`/api/campaigns/${campaignId}/youtube-settings`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();

        
        if (data.success && data.settings) {
          setYoutubeSettings(data.settings);
          
          // Обновляем поля формы с полученными данными
          if (data.settings.channelId) {
            form.setValue('youtube.channelId', data.settings.channelId);
          }
          if (data.settings.channelTitle) {
            form.setValue('youtube.channelTitle', data.settings.channelTitle);
          }
          

        } else {

          setYoutubeSettings(null);
        }
      } else {
        console.error('❌ Failed to load YouTube settings:', response.statusText);
      }
    } catch (error: any) {
      console.error('❌ Error loading YouTube settings:', error);
    } finally {
      setLoadingYoutubeSettings(false);
    }
  };

  // Функция загрузки Threads настроек из базы данных
  const loadThreadsSettings = async () => {
    setLoadingThreadsSettings(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/threads-settings`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.settings) {
          setThreadsSettings(data.settings);
          if (data.settings.accessToken) (form as any).setValue('threads.accessToken', data.settings.accessToken);
          if (data.settings.threadsUserId) (form as any).setValue('threads.threadsUserId', data.settings.threadsUserId);
          if (data.settings.username) (form as any).setValue('threads.username', data.settings.username);
          if (data.settings.appId) (form as any).setValue('threads.appId', data.settings.appId);
          if (data.settings.appSecret) (form as any).setValue('threads.appSecret', data.settings.appSecret);
        } else {
          setThreadsSettings(null);
        }
      }
    } catch (error: any) {
      console.error('Error loading Threads settings:', error);
    } finally {
      setLoadingThreadsSettings(false);
    }
  };

  // Загружаем Instagram, VK, Facebook и YouTube настройки при монтировании компонента
  useEffect(() => {
    if (campaignId) {
      loadInstagramSettings();
      loadVkSettings();
      loadFacebookSettings();
      loadYoutubeSettings();
      loadThreadsSettings();
      
      // Проверяем URL параметр для автоматического открытия YouTube мастера
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('openYouTube') === 'true') {
        console.log('🎬 [YouTube Settings] Auto-opening YouTube wizard from URL parameter');
        
        // Принудительно перезагружаем YouTube настройки
        setTimeout(() => {
          loadYoutubeSettings();
        }, 1000);
        
        // Открываем мастер через 1.5 секунды, после перезагрузки настроек
        setTimeout(() => {
          setShowYoutubeWizard(true);
        }, 1500);
        
        // Очищаем URL параметр
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete('openYouTube');
        window.history.replaceState({}, '', newUrl.toString());
      }
    }
  }, [campaignId]);

  // Слушатель событий для обновления Instagram и VK настроек после OAuth
  useEffect(() => {
    const handleOAuthSuccess = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      if (event.data.type === 'INSTAGRAM_OAUTH_SUCCESS') {
        console.log('📋 [SocialMediaSettings] Получено событие Instagram OAuth успеха');
        console.log('🔄 [SocialMediaSettings] Перезагружаем Instagram настройки...');
        
        // Перезагружаем Instagram настройки с задержкой для синхронизации с базой данных
        setTimeout(() => {
          loadInstagramSettings();
          toast({
            title: "Instagram обновлен",
            description: "Настройки Instagram успешно обновлены"
          });
        }, 500);
      }

      if (event.data.type === 'VK_OAUTH_SUCCESS') {
        console.log('📋 [SocialMediaSettings] Получено событие VK OAuth успеха');
        queryClient.invalidateQueries({ queryKey: ['/api/campaigns'] });
        setTimeout(() => {
          loadVkSettings();
          toast({ title: "VK обновлен", description: "Настройки VK успешно обновлены" });
        }, 500);
      }

      if (event.data.type === 'THREADS_OAUTH_SUCCESS') {
        setTimeout(() => {
          loadThreadsSettings();
          toast({ title: "Threads подключён", description: `Аккаунт @${event.data.data?.username || ''} успешно подключён` });
        }, 500);
      }
    };

    window.addEventListener('message', handleOAuthSuccess);
    
    return () => {
      window.removeEventListener('message', handleOAuthSuccess);
    };
  }, [campaignId, loadInstagramSettings, loadVkSettings, toast]);

  // Очищаем ресурсы инлайн-переподключения VK при размонтировании
  useEffect(() => {
    return () => {
      if (vkReconnectListenerRef.current) window.removeEventListener("message", vkReconnectListenerRef.current);
      if (vkReconnectCheckRef.current) clearInterval(vkReconnectCheckRef.current);
      if (vkPollRef.current) clearInterval(vkPollRef.current);
      if (vkPollTimeoutRef.current) clearTimeout(vkPollTimeoutRef.current);
    };
  }, []);

  // Auto-polling: запускаем poll когда инструкции needanapp видны (VK не настроен / токен невалиден / authExpired).
  // Временный сбой VK сюда не считается — иначе каждый чих платформы запускал
  // бы сценарий переподключения у пользователя с исправным подключением.
  useEffect(() => {
    const shouldShowNeedanapp = !isConfigured('vk') || isActionableFailure(vkStatus) || vkSettings?.authExpired;
    // Не рестартуем, если пользователь нажал «Отмена», истёк таймаут
    // или токен уже получен и идёт выбор группы
    if (shouldShowNeedanapp && !vkPolling && !vkPollRef.current
        && !vkPollCancelledRef.current && !vkGroupsFetchedRef.current) {
      startVkPolling();
    }
  }, [vkSettings, vkStatus, isConfigured, vkPolling, startVkPolling]);

  // Обновляем форму когда Instagram настройки загружены
  useEffect(() => {
    if (instagramSettings) {
      
      // Приводим данные из базы к формату схемы формы
      const formattedInstagramData = {
        token: instagramSettings.longLivedToken || instagramSettings.accessToken || instagramSettings.token || '',
        accessToken: instagramSettings.longLivedToken || instagramSettings.accessToken || instagramSettings.token || '',
        businessAccountId: instagramSettings.businessAccountId || instagramSettings.instagramId || '',
        appId: instagramSettings.appId || '',
        appSecret: instagramSettings.appSecret || '',
      };
      
      
      // Обновляем каждое поле отдельно для уверенности
      form.setValue('instagram.token', formattedInstagramData.token);
      form.setValue('instagram.accessToken', formattedInstagramData.accessToken);
      form.setValue('instagram.businessAccountId', formattedInstagramData.businessAccountId);
      form.setValue('instagram.appId', formattedInstagramData.appId);
      form.setValue('instagram.appSecret', formattedInstagramData.appSecret);
      

      
      // Принудительно обновляем отображение формы
      form.trigger('instagram');
    }
  }, [instagramSettings, form]);

  // Обновляем форму когда VK настройки загружены
  useEffect(() => {
    if (vkSettings) {
      // Токен из базы в браузер не приходит (sanitizeOAuthSecrets) — заполняем только groupId
      if (vkSettings.groupId) {
        form.setValue('vk.groupId', vkSettings.groupId);
      }
      if (vkSettings.groupName) {
        form.setValue('vk.groupName', vkSettings.groupName);
      }

      // Принудительно обновляем отображение формы
      form.trigger('vk');

      // Автоматически проверяем токен при загрузке (тихо, без тоста) —
      // сервер сам достанет токен по campaignId
      // Пропускаем если уже валидировали для этих же настроек (защита от цикла)
      if (vkSettings.groupId && vkValidatedForSettingsRef.current !== vkSettings) {
        vkValidatedForSettingsRef.current = vkSettings;
        setVkStatus({ isLoading: true });
        api.post('/validate/vk', { groupId: vkSettings.groupId, campaignId })
          .then(response => {
            setVkStatus({
              isLoading: false,
              isValid: response.data.success,
              message: response.data.message,
              severity: response.data.severity,
              retryable: response.data.retryable
            });
            // Вердикт про переподключение берём с бэка, а не выводим из
            // `success`: провал проверки бывает от сети, ошибки группы и
            // блокировки VK-приложения — токен при этом жив, и требовать
            // переподключения не за что.
            const authExpired = Boolean(response.data.authExpired);
            if (authExpired !== Boolean(vkSettings.authExpired)) {
              setVkSettings((prev: any) => prev ? { ...prev, authExpired } : prev);
            }
          })
          .catch(() => {
            // Не достучались до своего же бэкенда — это тоже «подождите»,
            // а не приговор подключению.
            setVkStatus({
              isLoading: false,
              isValid: false,
              message: 'Не удалось выполнить проверку — попробуем позже.',
              severity: 'warning',
              retryable: true
            });
          });
      }
    }
  }, [vkSettings, form]);

  // Обновляем форму когда Facebook настройки загружены
  useEffect(() => {
    if (facebookSettings) {

      
      // Проверяем что токен не содержит лог консоли
      const token = facebookSettings.token || '';
      if (token.includes('Facebook Wizard:') || token.includes('%20') || token.includes('FacebookSetupWizard')) {
        console.error('❌ Facebook token is corrupted with console log data');
        return;
      }
      
      // Обновляем поля формы с данными из базы
      if (facebookSettings.token) {
        form.setValue('facebook.token', facebookSettings.token);
      }
      if (facebookSettings.pageId) {
        form.setValue('facebook.pageId', facebookSettings.pageId);
      }
      if (facebookSettings.pageName) {
        form.setValue('facebook.pageName', facebookSettings.pageName);
      }
      

      
      // Принудительно обновляем отображение формы
      form.trigger('facebook');
    }
  }, [facebookSettings, form]);

  // Обновляем форму когда YouTube настройки загружены
  useEffect(() => {
    if (youtubeSettings) {

      
      // Обновляем поля формы с данными из базы
      if (youtubeSettings.channelId) {
        form.setValue('youtube.channelId', youtubeSettings.channelId);
      }
      if (youtubeSettings.channelTitle) {
        form.setValue('youtube.channelTitle', youtubeSettings.channelTitle);
      }
      

      
      // Принудительно обновляем отображение формы
      form.trigger('youtube.channelId');
    }
  }, [youtubeSettings, form]);

  // Функции проверки API ключей
  const validateTelegramToken = async () => {
    const token = form.getValues("telegram.token");
    if (!token) {
      toast({
        variant: "destructive",
        description: "Введите токен Telegram бота для проверки"
      });
      return;
    }
    
    try {
      setTelegramStatus({ isLoading: true });
      const response = await api.post('/validate/telegram', { token });
      
      setTelegramStatus({
        isLoading: false,
        isValid: response.data.success,
        message: response.data.message
      });
      
      toast({
        variant: response.data.success ? "default" : "destructive",
        description: response.data.message
      });

      // Если валидация успешна, автоматически сохраняем настройки
      if (response.data.success) {
        await onSubmit(form.getValues());
      }
    } catch (error) {
      console.error('Error validating Telegram token:', error);
      setTelegramStatus({
        isLoading: false,
        isValid: false,
        message: 'Ошибка при проверке токена'
      });
      
      toast({
        variant: "destructive",
        description: "Не удалось проверить токен Telegram"
      });
    }
  };
  
  const validateVkToken = async () => {
    const token = form.getValues("vk.token");
    const groupId = form.getValues("vk.groupId");
    
    if (!token) {
      toast({
        variant: "destructive",
        description: "Введите токен ВКонтакте для проверки"
      });
      return;
    }
    
    try {
      setVkStatus({ isLoading: true });
      const response = await api.post('/validate/vk', { token, groupId, campaignId });
      
      setVkStatus({
        isLoading: false,
        isValid: response.data.success,
        message: response.data.message,
        severity: response.data.severity,
        retryable: response.data.retryable
      });

      // Временный сбой VK показываем обычным тостом «подождите», а не
      // destructive: пользователю нечего чинить.
      toast({
        variant: isActionableFailure({ isLoading: false, isValid: response.data.success, severity: response.data.severity })
          ? "destructive"
          : "default",
        title: response.data.severity === 'warning' ? "ВКонтакте временно недоступен" : undefined,
        description: response.data.message
      });

      // Если валидация успешна, автоматически сохраняем настройки
      if (response.data.success) {
        await onSubmit(form.getValues());
      }
      // Флаг переподключения — только по вердикту бэка (см. авто-проверку выше)
      setVkSettings((prev: any) =>
        prev ? { ...prev, authExpired: Boolean(response.data.authExpired) } : prev);
    } catch (error) {
      console.error('Error validating VK token:', error);
      // Запрос не дошёл — про само подключение это ничего не говорит.
      setVkStatus({
        isLoading: false,
        isValid: false,
        message: 'Не удалось выполнить проверку — попробуйте позже.',
        severity: 'warning',
        retryable: true
      });

      toast({
        title: "Проверка не выполнена",
        description: "Не удалось связаться с ВКонтакте. Подключение не изменилось — попробуйте позже."
      });
    }
  };

  const validateInstagramToken = async () => {
    const token = form.getValues("instagram.token");
    
    if (!token) {
      toast({
        variant: "destructive",
        description: "Введите токен Instagram для проверки"
      });
      return;
    }
    
    try {
      setInstagramStatus({ isLoading: true });
      const response = await api.post('/validate/instagram', { token });
      
      setInstagramStatus({
        isLoading: false,
        isValid: response.data.success,
        message: response.data.message
      });
      
      toast({
        variant: response.data.success ? "default" : "destructive",
        description: response.data.message
      });

      // Если валидация успешна, автоматически сохраняем настройки
      if (response.data.success) {
        await onSubmit(form.getValues());
      }
    } catch (error) {
      console.error('Error validating Instagram token:', error);
      setInstagramStatus({
        isLoading: false,
        isValid: false,
        message: 'Ошибка при проверке токена'
      });
      
      toast({
        variant: "destructive",
        description: "Не удалось проверить токен Instagram"
      });
    }
  };

  const fetchInstagramBusinessId = async () => {
    const accessToken = form.getValues("instagram.token");
    if (!accessToken) {
      toast({
        variant: "destructive",
        description: "Сначала введите и проверьте Access Token"
      });
      return;
    }
    
    try {
      setInstagramStatus({ isLoading: true });
      console.log('🔍 Fetching Instagram Business Account ID...');
      
      const response = await api.post(`/campaigns/${campaignId}/fetch-instagram-business-id`, {
        accessToken
      });
      
      if (response.data.success) {
        // Обновляем поле формы с полученным Business Account ID
        form.setValue('instagram.businessAccountId', response.data.businessAccountId);
        
        // Перезагружаем настройки из базы данных для синхронизации
        await loadInstagramSettings();
        
        toast({
          variant: "default",
          description: `Business Account ID получен: ${response.data.businessAccountId}`
        });
        
        console.log('✅ Instagram Business Account ID fetched:', response.data.businessAccountId);
      } else {
        toast({
          variant: "destructive",
          description: response.data.error || "Ошибка при получении Business Account ID"
        });
      }
      
      setInstagramStatus({ isLoading: false });
    } catch (error: any) {
      console.error('Error fetching Instagram Business ID:', error);
      setInstagramStatus({ isLoading: false });
      
      let errorMessage = error.response?.data?.error || "Ошибка при получении Instagram Business Account ID";
      
      // Если есть детали с доступными страницами, покажем их пользователю
      if (error.response?.data?.details?.availablePages) {
        const pages = error.response.data.details.availablePages;
        const pageInfo = pages.map((p: any) => {
          let status = 'нет Instagram';
          if (p.hasInstagramBusiness) status = 'есть Business Account';
          else if (p.hasConnectedInstagram) status = 'есть Connected Account';
          return `${p.name} (${status})`;
        }).join(', ');
        errorMessage += `\n\nВаши Facebook страницы: ${pageInfo}`;
      }
      
      toast({
        variant: "destructive",
        description: errorMessage
      });
    }
  };

  const discoverInstagramAccounts = async () => {
    const accessToken = form.getValues("instagram.token");
    if (!accessToken) {
      toast({
        variant: "destructive",
        description: "Сначала введите Access Token"
      });
      return;
    }

    try {
      setInstagramStatus({ isLoading: true });
      console.log('🔍 Discovering all Instagram accounts...');
      
      const response = await api.post(`/campaigns/${campaignId}/discover-instagram-accounts`, {
        accessToken
      });
      
      if (response.data.success && response.data.accounts) {
        setAvailableInstagramAccounts(response.data.accounts);
        console.log('✅ Instagram accounts discovered:', response.data.accounts);
        
        if (response.data.accounts.length === 0) {
          toast({
            variant: "destructive",
            description: "Не найдено Facebook страниц с подключенными Instagram аккаунтами"
          });
        } else {
          toast({
            variant: "default",
            description: `Найдено ${response.data.accounts.length} Instagram аккаунтов`
          });
        }
      } else {
        toast({
          variant: "destructive",
          description: response.data.error || "Ошибка при поиске Instagram аккаунтов"
        });
      }
      
      setInstagramStatus({ isLoading: false });
    } catch (error: any) {
      console.error('Error discovering Instagram accounts:', error);
      setInstagramStatus({ isLoading: false });
      
      toast({
        variant: "destructive",
        description: "Ошибка при поиске Instagram аккаунтов"
      });
    }
  };

  const selectKnownInstagramAccount = async (pageId: string, instagramId: string, pageName: string) => {
    const accessToken = form.getValues("instagram.token");
    if (!accessToken) {
      toast({
        variant: "destructive",
        description: "Сначала введите Access Token"
      });
      return;
    }

    try {
      setInstagramStatus({ isLoading: true });
      console.log(`🔍 Selecting known Instagram account: ${instagramId} from page ${pageName}`);
      
      // Обновляем поля формы
      form.setValue('instagram.businessAccountId', instagramId);
      
      // Получаем обновленные данные формы
      const formData = form.getValues();
      formData.instagram = {
        ...formData.instagram,
        businessAccountId: instagramId
      };
      
      // Используем основную функцию сохранения для consistency
      await onSubmit(formData);
      
      toast({
        variant: "default",
        description: `Instagram аккаунт "${pageName}" выбран (ID: ${instagramId})`
      });
      
      console.log('✅ Known Instagram account selected and saved successfully');
      setInstagramStatus({ isLoading: false });
    } catch (error: any) {
      console.error('Error selecting known Instagram account:', error);
      setInstagramStatus({ isLoading: false });
      
      toast({
        variant: "destructive",
        description: "Ошибка при выборе Instagram аккаунта"
      });
    }
  };
  
  const validateFacebookToken = async () => {
    const token = form.getValues("facebook.token");
    const pageId = form.getValues("facebook.pageId");
    
    if (!token) {
      toast({
        variant: "destructive",
        description: "Введите токен Facebook для проверки"
      });
      return;
    }
    
    try {
      setFacebookStatus({ isLoading: true });
      const response = await api.post('/validate/facebook', { token, pageId });
      
      setFacebookStatus({
        isLoading: false,
        isValid: response.data.success,
        message: response.data.message
      });
      
      toast({
        variant: response.data.success ? "default" : "destructive",
        description: response.data.message
      });

      // Если валидация успешна, автоматически сохраняем настройки
      if (response.data.success) {
        await onSubmit(form.getValues());
      }
    } catch (error) {
      console.error('Error validating Facebook token:', error);
      setFacebookStatus({
        isLoading: false,
        isValid: false,
        message: 'Ошибка при проверке токена'
      });
      
      toast({
        variant: "destructive",
        description: "Не удалось проверить токен Facebook"
      });
    }
  };
  
  const validateYoutubeApiKey = async () => {
    const apiKey = form.getValues("youtube.apiKey");
    const channelId = form.getValues("youtube.channelId");
    
    if (!apiKey) {
      toast({
        variant: "destructive",
        description: "Введите API ключ YouTube для проверки"
      });
      return;
    }
    
    try {
      setYoutubeStatus({ isLoading: true });
      const response = await api.post('/validate/youtube', { apiKey, channelId });
      
      setYoutubeStatus({
        isLoading: false,
        isValid: response.data.success,
        message: response.data.message
      });
      
      toast({
        variant: response.data.success ? "default" : "destructive",
        description: response.data.message
      });

      // Если валидация успешна, автоматически сохраняем настройки
      if (response.data.success) {
        await onSubmit(form.getValues());
      }
    } catch (error) {
      console.error('Error validating YouTube API key:', error);
      setYoutubeStatus({
        isLoading: false,
        isValid: false,
        message: 'Ошибка при проверке API ключа'
      });
      
      toast({
        variant: "destructive",
        description: "Не удалось проверить API ключ YouTube"
      });
    }
  };
  
  // Компонент статуса валидации
  const ValidationBadge = ({ status }: { status: ValidationStatus }) => {
    if (status.isLoading) {
      return <Badge variant="outline" className="ml-2"><Loader2 className="h-4 w-4 animate-spin" /></Badge>;
    }
    
    if (status.isValid === undefined) {
      return null;
    }

    // Временный сбой соцсети — жёлтым «Недоступен», а не красной «Ошибкой»:
    // подключение исправно, действий от пользователя не требуется.
    const isTransient = status.isValid === false && status.severity === 'warning';

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {isTransient ? (
              <Badge
                variant="secondary"
                className="ml-2 bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100"
              >
                <Clock className="h-4 w-4 mr-1" />
                Недоступен
              </Badge>
            ) : (
              <Badge variant={status.isValid ? "success" : "destructive"} className="ml-2">
                {status.isValid ?
                  <CheckCircle className="h-4 w-4 mr-1" /> :
                  <XCircle className="h-4 w-4 mr-1" />
                }
                {status.isValid ? "Валиден" : "Ошибка"}
              </Badge>
            )}
          </TooltipTrigger>
          <TooltipContent>
            <p>{status.message || (status.isValid ? "Ключ валиден" : "Ключ не валиден")}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const onSubmit = async (data: SocialMediaSettings) => {
    
    try {
      setIsLoading(true);

      // Preserve fields not managed by the form but saved by OAuth callbacks/webhooks
      const submittedData = {
        ...data,
        tiktok: {
          ...(initialSettings as any)?.tiktok,
          ...(data as any).tiktok
        },
        vk: {
          ...(vkSettings || {}),
          ...data.vk
        },
        // YouTube: form data has priority (wizard just set fresh values)
        youtube: {
          ...(data as any).youtube
        }
      };

      // Используем apiRequest для правильной авторизации
      const response = await apiRequest(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        data: {
          social_media_settings: submittedData
        }
      });

      // Вызываем callback ПОСЛЕ успешного ответа от сервера
      // Это гарантирует, что кэш обновится с новыми данными
      onSettingsUpdated?.();

      // Новый токен уехал на сервер — убираем его из формы и сворачиваем поле обратно
      // в состояние «сохранён», чтобы браузер не держал секрет дольше нужного.
      if (data.telegram?.token) {
        form.setValue('telegram.token', '');
        setTelegramShowTokenInput(false);
      }

      toast({
        title: "Успешно!",
        description: "Настройки соцсетей обновлены"
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Ошибка!",
        description: error.response?.data?.message || error.message || "Ошибка при обновлении настроек"
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Считаем подключённые соцсети (после объявления формы)
  const ALL_PLATFORMS = ['instagram', 'youtube', 'facebook', 'vk', 'telegram', 'threads'] as const;
  const connectedCount = ALL_PLATFORMS.filter(p => isConfigured(p)).length;
  const maxAccounts = limits.maxConnectedAccounts;
  const atLimit = maxAccounts !== null && connectedCount >= maxAccounts;

  // Хелпер: открыть вайзард только если не превышен лимит подключений
  const openWizardIfAllowed = (platform: typeof ALL_PLATFORMS[number], openFn: () => void) => {
    if (atLimit && !isConfigured(platform)) {
      toast({
        variant: 'destructive',
        title: 'Лимит подключений исчерпан',
        description: `На базовом тарифе можно подключить не более ${maxAccounts} соцсетей. Отключите одну из существующих или перейдите на Pro.`,
      });
      return;
    }
    openFn();
  };

  return (
    <div className="space-y-6">
      {/* Баннер лимита подключений для базового тарифа */}
      {maxAccounts !== null && (
        <div className={`flex items-start gap-3 p-4 rounded-lg border ${atLimit ? 'border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30' : 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30'}`}>
          <AlertCircle className={`h-5 w-5 mt-0.5 flex-shrink-0 ${atLimit ? 'text-orange-500' : 'text-blue-500'}`} />
          <div>
            <p className={`text-sm font-medium ${atLimit ? 'text-orange-800 dark:text-orange-200' : 'text-blue-800 dark:text-blue-200'}`}>
              {atLimit
                ? `Лимит подключений исчерпан (${connectedCount}/${maxAccounts})`
                : `Подключено соцсетей: ${connectedCount} из ${maxAccounts}`}
            </p>
            <p className={`text-sm mt-1 ${atLimit ? 'text-orange-700 dark:text-orange-300' : 'text-blue-700 dark:text-blue-300'}`}>
              {atLimit
                ? 'На базовом тарифе можно подключить не более 3 соцсетей. Перейдите на Pro для неограниченного числа подключений.'
                : 'На базовом тарифе доступно до 3 подключений. Вы можете выбрать любые соцсети.'}
            </p>
          </div>
        </div>
      )}
      <div className="flex items-start gap-3 p-4 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30">
        <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-green-800 dark:text-green-200">
            Авторизация через API — это безопасно
          </p>
          <p className="text-sm text-green-700 dark:text-green-300 mt-1">
            Подключение соцсетей происходит через официальные API платформ. Ваши данные надёжно защищены и используются только для публикации контента от имени вашего аккаунта. Мы не храним пароли и не получаем доступ к личным сообщениям.
          </p>
        </div>
      </div>
      <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <Accordion type="multiple" className="space-y-2">
          {/* Telegram Settings */}
          <AccordionItem value="telegram">
            <AccordionTrigger className="py-2">
              <div className="flex items-center space-x-2">
                <span>Telegram</span>
                {isConfigured('telegram') && <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">Настроено</Badge>}
                <ValidationBadge status={telegramStatus} />
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-2">
              {/* Инструкция по получению токена нужна только при первой настройке
                  или при явной замене токена — не мозолит глаза подключённому каналу. */}
              {(!telegramHasSavedToken || telegramShowTokenInput) && (
              <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm text-blue-800 dark:text-blue-200">
                <p className="font-medium mb-2">Что такое Bot Token и зачем он нужен?</p>
                <p className="text-blue-700 dark:text-blue-300 mb-2">
                  Bot Token — это уникальный ключ вашего Telegram-бота, через которого система будет публиковать контент в ваш канал или группу. Бот выступает как «автор» публикаций от вашего имени.
                </p>
                <p className="font-medium mb-1">Как получить токен:</p>
                <ol className="list-decimal list-inside space-y-0.5 text-blue-700 dark:text-blue-300">
                  <li>Откройте <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="underline font-medium">@BotFather</a> в Telegram</li>
                  <li>Отправьте команду <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">/newbot</code></li>
                  <li>Придумайте имя и username для бота</li>
                  <li>Скопируйте полученный токен и вставьте в поле ниже</li>
                  <li>Добавьте созданного бота администратором в ваш канал/группу</li>
                </ol>
                <p className="text-blue-600 dark:text-blue-400 mt-2 text-xs">
                  Подробная видеоинструкция доступна в разделе «Обучение».
                </p>
              </div>
              )}

              {/* Токен сохранён на сервере и в браузер не приходит (sanitizeOAuthSecrets).
                  Пустое поле выглядело бы как «ничего не сохранено» — показываем состояние
                  явно, а ввод нового токена прячем за кнопкой «Заменить токен».
                  Плейсхолдеры в поле токена запрещены контрактом (откат 40417eb5). */}
              {telegramHasSavedToken && !telegramShowTokenInput ? (
                <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
                  <div className="text-sm text-green-800 dark:text-green-200">
                    <span className="font-medium">Bot Token:</span> сохранён
                    <div className="text-xs text-green-700 dark:text-green-300 mt-0.5">
                      Хранится на сервере и в браузер не передаётся.
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => {
                      setTelegramShowTokenInput(true);
                      setTelegramStatus({ isLoading: false });
                    }}
                    data-testid="button-telegram-change-token"
                  >
                    🔄 Заменить токен
                  </Button>
                </div>
              ) : (
              <FormField
                control={form.control}
                name="telegram.token"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bot Token</FormLabel>
                    <div className="flex space-x-2">
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="Введите токен бота"
                          {...field}
                          value={field.value || ''}
                        />
                      </FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={validateTelegramToken}
                        disabled={telegramStatus.isLoading}
                      >
                        {telegramStatus.isLoading ?
                          <Loader2 className="h-4 w-4 animate-spin" /> :
                          <AlertCircle className="h-4 w-4" />
                        }
                      </Button>
                      {telegramHasSavedToken && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          onClick={() => {
                            // Пустая строка, а не undefined: mergeOAuthSettings трактует ''
                            // как «не трогать» и сохраняет прежний токен на сервере.
                            form.setValue('telegram.token', '');
                            setTelegramShowTokenInput(false);
                            setTelegramStatus({ isLoading: false });
                          }}
                          data-testid="button-telegram-cancel-token"
                        >
                          Отмена
                        </Button>
                      )}
                    </div>
                    {telegramHasSavedToken && (
                      <div className="text-xs text-muted-foreground">
                        Оставьте поле пустым, чтобы сохранить текущий токен.
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              )}
              <FormField
                control={form.control}
                name="telegram.chatId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ID Чата или @username канала</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Например: -1001234567890 или @channel_name" 
                        {...field} 
                        value={field.value || ''}
                        className={field.value?.startsWith('@') ? "border-green-500" : ""}
                      />
                    </FormControl>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium text-orange-600">Важно!</span> Для аналитики лучше указывать @username канала.
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </AccordionContent>
          </AccordionItem>

          {/* VK Settings */}
          <AccordionItem value="vk">
            <AccordionTrigger className="py-2">
              <div className="flex items-center space-x-2">
                <span>ВКонтакте</span>
                {vkSettings?.authExpired
                  ? <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100">Требует переподключения</Badge>
                  : isConfigured('vk') && (
                    <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
                      {vkSettings?.groupName ? `Настроено · Группа: ${vkSettings.groupName}` : 'Настроено'}
                    </Badge>
                  )
                }
                <ValidationBadge status={vkStatus} />
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-2">
              {/* Баннер: соединение разорвано, нужно переподключить */}
              {vkSettings?.authExpired && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3">
                  <div className="flex items-start gap-2 text-sm text-red-800 dark:text-red-200">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-red-500" />
                    <span><span className="font-medium">ВКонтакте отключился.</span> Соединение разорвалось — нужно переподключить аккаунт, чтобы публикации продолжали работать.</span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="shrink-0"
                    onClick={startVkReconnect}
                    disabled={isVkReconnecting}
                    data-testid="button-vk-reconnect"
                  >
                    {isVkReconnecting
                      ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Подключение...</>
                      : <><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Переподключить VK</>
                    }
                  </Button>
                </div>
              )}
              {/* Временный сбой на стороне VK: подключение исправно, надо просто подождать */}
              {vkStatus.isValid === false && vkStatus.severity === 'warning' && !vkSettings?.authExpired && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-200">
                  <Clock className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>
                    <span className="font-medium">ВКонтакте временно недоступен.</span>{' '}
                    {vkStatus.message || "Это сбой на стороне VK — подключение не тронуто. Проверим ещё раз автоматически."}
                  </span>
                </div>
              )}
              {/* Отказ, требующий действий пользователя */}
              {isActionableFailure(vkStatus) && !vkSettings?.authExpired && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2.5 text-sm text-red-800 dark:text-red-200">
                  <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-red-500" />
                  <span><span className="font-medium">Проверка не прошла.</span> {vkStatus.message || "Обновите токен, чтобы публикации в VK работали."}</span>
                </div>
              )}
              {/* Webhook-инструкция (needanapp) — только когда действительно нужно
                  подключение заново. При сбое VK её показывать нельзя: она предлагает
                  переподключение там, где чинить нечего. */}
              {(!isConfigured('vk') || isActionableFailure(vkStatus) || vkSettings?.authExpired) && (
              <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 space-y-3">
                <p className="font-medium text-blue-900 dark:text-blue-100 text-sm">
                  Пошаговая инструкция через needanapp:
                </p>
                <ol className="list-decimal list-inside space-y-1 text-sm text-blue-700 dark:text-blue-300">
                  <li>Откройте <a href="https://vk.needanapp.ru" target="_blank" rel="noopener noreferrer" className="underline font-medium">vk.needanapp.ru</a></li>
                  <li>Нажмите «Получить токен» и авторизуйтесь в VK</li>
                  <li>Нажмите «Разрешить»</li>
                  <li>Внизу страницы найдите поле <strong>«Отправить данные в n8n»</strong></li>
                  <li>Вставьте в это поле ваш URL webhook (скопируйте ниже)</li>
                  <li>Нажмите «Отправить» — токены придут автоматически</li>
                </ol>
                <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">Вы должны быть администратором сообщества, в которое хотите публиковать.</p>

                {/* Webhook URL */}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-blue-800 dark:text-blue-200">Ваш webhook URL:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-white dark:bg-gray-900 border rounded px-2 py-1.5 break-all font-mono text-blue-900 dark:text-blue-100">
                      {vkWebhookUrl || (vkWebhookPreparing ? 'Генерируем защищённый URL…' : '—')}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={async () => {
                        // URL стабилен; если ещё не подготовлен — готовим сейчас.
                        const url = vkWebhookUrl || (await prepareVkWebhook());
                        if (!url) return;
                        await navigator.clipboard.writeText(url);
                        setVkWebhookCopied(true);
                        setTimeout(() => setVkWebhookCopied(false), 2000);
                      }}
                      data-testid="button-copy-vk-webhook"
                    >
                      {vkWebhookCopied ? '✓' : '📋'}
                    </Button>
                  </div>
                </div>

                {/* Polling */}
                {!vkPolling ? (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="w-full"
                    data-testid="button-vk-wait-token"
                    onClick={startVkPolling}
                  >
                    ⏳ Жду токен от needanapp
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 text-center text-sm text-blue-700 dark:text-blue-300 py-2 border rounded bg-white dark:bg-gray-900 animate-pulse">
                      Ожидаю токен...
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={stopVkPolling}>
                      Отмена
                    </Button>
                  </div>
                )}
              </div>
              )}

              {/* Текущая группа + смена группы (когда VK подключён) */}
              {(vkSettings?.groupId || form.watch('vk.groupId')) && vkGroups.length === 0 && (
                <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
                  <div className="text-sm text-green-800 dark:text-green-200">
                    <span className="font-medium">Группа для публикации:</span>{' '}
                    {vkSettings?.groupName || form.watch('vk.groupName') || `ID ${vkSettings?.groupId || form.watch('vk.groupId')}`}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={fetchVkGroups}
                    disabled={loadingVkGroups}
                    data-testid="button-vk-change-group"
                  >
                    {loadingVkGroups
                      ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Загрузка...</>
                      : '🔄 Сменить группу'}
                  </Button>
                </div>
              )}

              {/* Ручной ввод — по ссылке */}
              <div>
                <button
                  type="button"
                  className="text-xs text-gray-400 hover:text-gray-600 underline"
                  onClick={() => setVkShowManual(v => !v)}
                >
                  {vkShowManual ? '▲ Скрыть ручной ввод токена' : '▼ Вставить токен вручную (без needanapp)'}
                </button>
              </div>

              {/* VK Authorization URL — ручной ввод */}
              {vkShowManual && <div className="space-y-4">
                <FormItem>
                  <FormLabel className="text-base font-medium">Authorization URL или токен</FormLabel>
                  <div className="flex space-x-2">
                    <Input
                      placeholder="https://oauth.vk.com/blank.html#access_token=vk1.a.enhtsafWTnsHKIpezjv..."
                      value={vkUrlInput}
                      onChange={(e) => {
                        setVkUrlInput(e.target.value);
                        
                        // Автоматически извлекаем токен при вводе URL (access_token или payload)
                        const inputValue = e.target.value.trim();
                        if (inputValue.includes('access_token=') || inputValue.includes('payload=')) {
                          const token = parseVkUrl(inputValue);
                          if (token) {
                            form.setValue('vk.token', token);
                          }
                        }
                      }}
                      className="flex-1"
                    />
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="sm"
                      onClick={validateVkToken}
                      disabled={vkStatus.isLoading || !form.watch('vk.token')}
                    >
                      {vkStatus.isLoading ? 
                        <Loader2 className="h-4 w-4 animate-spin" /> : 
                        <AlertCircle className="h-4 w-4" />
                      }
                    </Button>
                    <Button 
                      type="button" 
                      variant="default" 
                      size="sm"
                      onClick={fetchVkGroups}
                      disabled={loadingVkGroups}
                    >
                      {loadingVkGroups ? 
                        <Loader2 className="h-4 w-4 animate-spin" /> : 
                        '📋 Получить группы'
                      }
                    </Button>
                  </div>
                  {form.watch('vk.token') && (
                    <div className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
                      ✅ Токен введён
                    </div>
                  )}
                </FormItem>
              </div>}

              {/* VK Groups Selection - Instagram Style */}
              {vkGroups.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      🎯 Выберите VK группу для публикации
                    </h4>
                    <span className="text-xs text-gray-500">
                      Найдено: {vkGroups.length} групп
                    </span>
                  </div>
                  
                  <div className="grid gap-3 max-h-64 overflow-y-auto">
                    {vkGroups.map((group) => {
                      const isSelected = form.getValues('vk.groupId') === group.id;
                      return (
                        <div 
                          key={group.id}
                          className={`
                            p-4 rounded-lg border cursor-pointer transition-all duration-200
                            ${isSelected 
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-200 dark:ring-blue-800' 
                              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
                            }
                          `}
                          onClick={() => handleVkGroupSelect(group.id, group.name)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center space-x-3">
                                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                                  <span className="text-blue-600 dark:text-blue-400 font-semibold text-lg">
                                    {group.name.charAt(0).toUpperCase()}
                                  </span>
                                </div>
                                <div className="flex-1">
                                  <div className="font-medium text-gray-900 dark:text-gray-100">
                                    {group.name}
                                  </div>
                                  <div className="text-sm text-gray-500 dark:text-gray-400">
                                    @{group.screen_name}
                                  </div>
                                  <div className="text-xs text-gray-400 dark:text-gray-500">
                                    👥 {group.members_count.toLocaleString()} участников
                                  </div>
                                </div>
                              </div>
                            </div>
                            
                            <div className="flex items-center space-x-2">
                              {isSelected && (
                                <div className="flex items-center space-x-1 text-blue-600 dark:text-blue-400">
                                  <CheckCircle className="h-4 w-4" />
                                  <span className="text-xs font-medium">Выбрано</span>
                                </div>
                              )}
                              <Button 
                                type="button" 
                                variant={isSelected ? "default" : "outline"}
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleVkGroupSelect(group.id, group.name);
                                }}
                              >
                                {isSelected ? 'Выбрано' : 'Выбрать'}
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <FormField
                control={form.control}
                name="vk.groupId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ID Группы</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Например: 228626989 (без знака минус)" 
                        {...field} 
                        value={field.value || ''}
                      />
                    </FormControl>
                    <div className="text-xs text-muted-foreground">
                      ID группы можно найти в адресной строке: vk.com/club<span className="font-semibold">123456789</span>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </AccordionContent>
          </AccordionItem>

          {/* Instagram Settings */}
          <AccordionItem value="instagram">
            <AccordionTrigger className="py-2">
              <div className="flex items-center space-x-2">
                <span>Instagram</span>
                {isConfigured('instagram') && <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">Настроено</Badge>}
                <ValidationBadge status={instagramStatus} />
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-2">
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-200">
                <p className="text-amber-700 dark:text-amber-300">
                  <span className="font-medium">Обратите внимание:</span> для настройки Instagram может потребоваться VPN, так как Meta API недоступен из некоторых регионов. Подробная видеоинструкция и текстовое руководство доступны в разделе «Обучение».
                </p>
              </div>
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-blue-900 dark:text-blue-100">Instagram API настройки</h4>
                    <p className="text-sm text-blue-700 dark:text-blue-200 mt-1">
                      {instagramSettings?.businessAccountId 
                        ? `Аккаунт: ${instagramDisplayName || getInstagramAccountName(instagramSettings.businessAccountId)} (${instagramSettings.businessAccountId})` 
                        : 'Настройте Instagram API для этой кампании'
                      }
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    {(instagramSettings?.configured || instagramSettings?.businessAccountId) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleSwitchInstagramAccount}
                        disabled={loadingAccounts || loadingInstagramSettings}
                      >
                        {loadingAccounts ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Поиск...
                          </>
                        ) : (
                          <>
                            🔄 Сменить аккаунт
                          </>
                        )}
                      </Button>
                    )}
                    <Button 
                      type="button" 
                      variant={instagramSettings?.configured || instagramSettings?.businessAccountId ? "default" : "outline"}
                      size="sm"
                      onClick={() => openWizardIfAllowed('instagram', () => setShowInstagramWizard(true))}
                      disabled={loadingInstagramSettings}
                    >
                      {loadingInstagramSettings ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Загрузка...
                        </>
                      ) : (instagramSettings?.configured || instagramSettings?.businessAccountId || instagramSettings?.instagramId) ? 'Пересконфигурировать' : 'Настроить Instagram'}
                    </Button>
                  </div>
                </div>
              </div>
              
              {/* Instagram Setup Wizard Inline */}
              {showInstagramWizard && (
                <div className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
                  <InstagramSetupWizardSimple
                    campaignId={campaignId}
                    onCancel={() => {
                      setShowInstagramWizard(false);
                    }}
                    onSettingsRefresh={() => {
                      loadInstagramSettings();
                    }}
                    onComplete={(data) => {
                      console.log('📸 [Instagram Simple Wizard] Settings updated:', data);
                      
                      // Обновляем поля формы напрямую
                      if (data?.token || data?.accessToken) {
                        form.setValue('instagram.token', data.token || data.accessToken);
                        form.setValue('instagram.accessToken', data.accessToken || data.token);
                      }
                      if (data?.businessAccountId) {
                        form.setValue('instagram.businessAccountId', data.businessAccountId);
                      }
                      if (data?.appId) {
                        form.setValue('instagram.appId', data.appId);
                      }
                      if (data?.appSecret) {
                        form.setValue('instagram.appSecret', data.appSecret);
                      }
                      
                      setShowInstagramWizard(false);
                      
                      // Перезагружаем Instagram настройки из базы данных
                      loadInstagramSettings();
                      
                      if (onSettingsUpdated) {
                        onSettingsUpdated();
                      }
                      toast({
                        title: "Instagram OAuth настройка завершена",
                        description: "Instagram интеграция успешно настроена для этой кампании",
                      });
                    }}
                  />
                </div>
              )}

              {/* Переключатель аккаунтов Instagram */}
              {showAccountSwitcher && availableInstagramAccounts.length > 0 && (
                <div className="space-y-3 p-4 border rounded-lg bg-gray-50 dark:bg-gray-800/50">
                  <div className="flex justify-between items-center">
                    <h4 className="font-medium">Выберите Instagram Business аккаунт:</h4>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setShowAccountSwitcher(false)}
                    >
                      Отмена
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {availableInstagramAccounts.map((account) => (
                      <Card key={account.id} className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                        <CardContent className="p-3">
                          <div className="flex justify-between items-center">
                            <div>
                              <h5 className="font-semibold">{account.name || getInstagramAccountName(account.id)}</h5>
                              {account.username && (
                                <p className="text-sm text-gray-600 dark:text-gray-300">@{account.username}</p>
                              )}
                              <span className="text-xs text-gray-500 dark:text-gray-400">ID: {account.id}</span>
                              {instagramSettings?.businessAccountId === account.id && (
                                <div className="flex items-center mt-1">
                                  <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400 mr-1" />
                                  <span className="text-xs text-green-600 dark:text-green-400 font-medium">Активный аккаунт</span>
                                </div>
                              )}
                            </div>
                            <Button 
                              onClick={() => handleSelectNewAccount(account.id, account.name || getInstagramAccountName(account.id))}
                              disabled={loadingAccounts}
                              size="sm"
                              variant={instagramSettings?.businessAccountId === account.id ? "default" : "outline"}
                            >
                              {instagramSettings?.businessAccountId === account.id ? 'Текущий' : 'Выбрать'}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Instagram поля скрыты - используется только мастер настройки */}
            </AccordionContent>
          </AccordionItem>

          {/* Facebook Settings */}
          <AccordionItem value="facebook">
            <AccordionTrigger className="py-2">
              <div className="flex items-center space-x-2">
                <span>Facebook</span>
                {isConfigured('facebook') && <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">Настроено</Badge>}
                <ValidationBadge status={facebookStatus} />
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-2">
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-200">
                <p className="text-amber-700 dark:text-amber-300">
                  <span className="font-medium">Обратите внимание:</span> для настройки Facebook может потребоваться VPN (Meta API). Процесс аналогичен Instagram — используется тот же мастер настройки.
                </p>
              </div>
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-blue-900 dark:text-blue-100">Facebook настройки</h4>
                    <p className="text-sm text-blue-700 dark:text-blue-200 mt-1">
                      {form.watch('facebook.pageName') 
                        ? `Страница: ${form.watch('facebook.pageName')} (${form.watch('facebook.pageId')})` 
                        : 'Настройте Facebook страницу для этой кампании'
                      }
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    <Button 
                      type="button" 
                      variant={form.watch('facebook.pageId') ? "default" : "outline"}
                      size="sm"
                      onClick={() => openWizardIfAllowed('facebook', () => setShowFacebookWizard(true))}
                    >
                      {form.watch('facebook.pageId') ? 'Пересконфигурировать' : 'Настроить Facebook'}
                    </Button>
                  </div>
                </div>
              </div>
              
              {/* Facebook Setup Wizard Inline */}
              {showFacebookWizard && (
                <div className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
                  <FacebookSetupWizard
                    campaignId={campaignId}
                    onCancel={() => {

                      setShowFacebookWizard(false);
                    }}
                    onComplete={(data) => {

                      handleFacebookComplete(data);
                      setShowFacebookWizard(false);
                    }}
                  />
                </div>
              )}
              
              {/* Facebook поля скрыты - используется только мастер настройки */}
            </AccordionContent>
          </AccordionItem>

          {/* Threads Settings */}
          <AccordionItem value="threads">
            <AccordionTrigger className="py-2">
              <div className="flex items-center space-x-2">
                <span>Threads</span>
                {isConfigured('threads') && <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">Настроено</Badge>}
                {threadsStatus.isLoading && <Badge variant="outline">Проверка...</Badge>}
                {threadsStatus.isValid === true && !threadsStatus.isLoading && <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">Активен</Badge>}
                {threadsStatus.isValid === false && !threadsStatus.isLoading && <Badge variant="destructive">Ошибка</Badge>}
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-2">
              <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm text-blue-800 dark:text-blue-200">
                <p className="font-medium mb-1">Threads API (Meta)</p>
                <p className="text-blue-700 dark:text-blue-300 text-xs">
                  Создайте Meta App на developers.facebook.com, добавьте продукт "Threads API", 
                  затем подключитесь через OAuth или введите токен вручную.
                  App ID и App Secret можно использовать те же, что и для Instagram.
                </p>
              </div>

              {threadsSettings?.username && (
                <div className="flex items-center justify-between gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                  <p className="text-sm text-green-800 dark:text-green-200">
                    <span className="font-medium">Подключено:</span> @{threadsSettings.username}
                    {threadsSettings.threadsUserId && <span className="text-xs ml-2 opacity-70">(ID: {threadsSettings.threadsUserId})</span>}
                  </p>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={threadsStatus.isLoading}
                      data-testid="button-threads-check"
                      onClick={async () => {
                        // Токен в браузер не приходит — сервер проверит его по campaignId
                        setThreadsStatus({ isLoading: true });
                        try {
                          const resp = await fetch('/api/validate/threads', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
                            body: JSON.stringify({ campaignId })
                          });
                          const data = await resp.json();
                          setThreadsStatus({ isLoading: false, isValid: data.success, message: data.message });
                          toast({ title: data.success ? 'Подключение работает' : 'Ошибка подключения', description: data.message, variant: data.success ? 'default' : 'destructive' });
                        } catch (e: any) {
                          setThreadsStatus({ isLoading: false, isValid: false, message: e.message });
                        }
                      }}
                    >
                      {threadsStatus.isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Проверить'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="button-threads-reconnect"
                      onClick={() => setThreadsShowSetup(v => !v)}
                    >
                      {threadsShowSetup ? 'Скрыть' : '🔄 Переподключить'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Блоки настройки — при подключённом Threads спрятаны за «Переподключить» */}
              {(!threadsSettings?.username || threadsShowSetup) && (<>
              <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border space-y-3">
                <h4 className="font-medium text-sm">Подключение через OAuth</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">App ID</label>
                    <Input
                      data-testid="input-threads-app-id"
                      placeholder="App ID от Meta"
                      value={(form.watch as any)('threads.appId') || ''}
                      onChange={e => (form as any).setValue('threads.appId', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">App Secret</label>
                    <Input
                      data-testid="input-threads-app-secret"
                      type="password"
                      placeholder="App Secret от Meta"
                      value={(form.watch as any)('threads.appSecret') || ''}
                      onChange={e => (form as any).setValue('threads.appSecret', e.target.value)}
                    />
                  </div>
                </div>
                <Button
                  data-testid="button-threads-oauth"
                  type="button"
                  variant="default"
                  size="sm"
                  className="w-full"
                  onClick={async () => {
                    const appId = (form as any).getValues('threads.appId');
                    const appSecret = (form as any).getValues('threads.appSecret');
                    if (!appId || !appSecret) {
                      toast({ variant: 'destructive', title: 'Ошибка', description: 'Введите App ID и App Secret' });
                      return;
                    }
                    try {
                      const resp = await fetch('/api/threads/auth/start', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
                        body: JSON.stringify({ appId, appSecret, campaignId })
                      });
                      const data = await resp.json();
                      if (data.success && data.authUrl) {
                        window.open(data.authUrl, '_blank', 'width=600,height=700');
                        toast({ title: 'Откроется окно авторизации', description: 'Войдите в Threads и разрешите доступ. После редиректа настройки обновятся автоматически.' });
                        setTimeout(() => loadThreadsSettings(), 10000);
                      } else {
                        toast({ variant: 'destructive', title: 'Ошибка', description: data.error || 'Не удалось запустить OAuth' });
                      }
                    } catch (e: any) {
                      toast({ variant: 'destructive', title: 'Ошибка', description: e.message });
                    }
                  }}
                >
                  Подключить через OAuth
                </Button>
              </div>

              <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border space-y-3">
                <h4 className="font-medium text-sm">Или введите токен вручную</h4>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Access Token (Long-lived)</label>
                  <Input
                    data-testid="input-threads-access-token"
                    type="password"
                    placeholder="Долгосрочный токен Threads"
                    value={(form.watch as any)('threads.accessToken') || ''}
                    onChange={e => (form as any).setValue('threads.accessToken', e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Threads User ID</label>
                  <Input
                    data-testid="input-threads-user-id"
                    placeholder="Числовой ID пользователя Threads"
                    value={(form.watch as any)('threads.threadsUserId') || ''}
                    onChange={e => (form as any).setValue('threads.threadsUserId', e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    data-testid="button-threads-validate"
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={threadsStatus.isLoading}
                    onClick={async () => {
                      const accessToken = (form as any).getValues('threads.accessToken');
                      if (!accessToken) {
                        toast({ variant: 'destructive', title: 'Ошибка', description: 'Введите токен для проверки' });
                        return;
                      }
                      setThreadsStatus({ isLoading: true });
                      try {
                        const resp = await fetch('/api/validate/threads', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
                          body: JSON.stringify({ accessToken })
                        });
                        const data = await resp.json();
                        setThreadsStatus({ isLoading: false, isValid: data.success, message: data.message });
                        if (data.success && data.username) {
                          (form as any).setValue('threads.username', data.username);
                        }
                        toast({ title: data.success ? 'Токен валиден' : 'Ошибка токена', description: data.message, variant: data.success ? 'default' : 'destructive' });
                      } catch (e: any) {
                        setThreadsStatus({ isLoading: false, isValid: false, message: e.message });
                      }
                    }}
                  >
                    {threadsStatus.isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Проверить токен
                  </Button>
                  <Button
                    data-testid="button-threads-save-manual"
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={async () => {
                      const accessToken = (form as any).getValues('threads.accessToken');
                      const threadsUserId = (form as any).getValues('threads.threadsUserId');
                      const username = (form as any).getValues('threads.username');
                      const appId = (form as any).getValues('threads.appId');
                      const appSecret = (form as any).getValues('threads.appSecret');
                      if (!accessToken || !threadsUserId) {
                        toast({ variant: 'destructive', title: 'Ошибка', description: 'Введите токен и User ID' });
                        return;
                      }
                      try {
                        const resp = await fetch(`/api/campaigns/${campaignId}/threads-settings`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
                          body: JSON.stringify({ accessToken, threadsUserId, username, appId, appSecret })
                        });
                        const data = await resp.json();
                        if (data.success) {
                          setThreadsSettings(data.settings);
                          setThreadsShowSetup(false);
                          toast({ title: 'Сохранено', description: 'Настройки Threads сохранены' });
                          if (onSettingsUpdated) onSettingsUpdated();
                        } else {
                          toast({ variant: 'destructive', title: 'Ошибка', description: data.error });
                        }
                      } catch (e: any) {
                        toast({ variant: 'destructive', title: 'Ошибка', description: e.message });
                      }
                    }}
                  >
                    Сохранить вручную
                  </Button>
                </div>
              </div>
              </>)}
            </AccordionContent>
          </AccordionItem>

          {/* YouTube Settings */}
          <AccordionItem value="youtube">
            <AccordionTrigger className="py-2">
              <div className="flex items-center space-x-2">
                <span>YouTube</span>
                {isConfigured('youtube') && <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">Настроено</Badge>}
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-2">
              <div className="space-y-4">
                {/* YouTube Channel Info Display */}
                {form.watch('youtube.channelId') && form.watch('youtube.channelTitle') ? (
                  <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium text-green-800">YouTube канал настроен</h4>
                        <p className="text-sm text-green-700">
                          Канал: <span className="font-medium">{form.watch('youtube.channelTitle')}</span>
                        </p>
                        <p className="text-xs text-green-600">
                          ID: {form.watch('youtube.channelId')}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openWizardIfAllowed('youtube', () => setShowYoutubeWizard(true))}
                        className="border-green-300 text-green-700 hover:bg-green-100"
                      >
                        Пересконфигурировать
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-sm text-muted-foreground bg-blue-50 p-3 rounded">
                      <span className="font-medium">Упрощенная настройка YouTube:</span>
                      <br />• Системный API ключ уже настроен
                      <br />• Требуется только OAuth авторизация
                      <br />• Channel ID получается автоматически
                    </div>
                    
                    <Button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openWizardIfAllowed('youtube', () => setShowYoutubeWizard(true));
                      }}
                      className="w-full"
                      variant="outline"
                    >
                      <Youtube className="h-4 w-4 mr-2" />
                      Настроить YouTube
                    </Button>
                  </div>
                )}
              </div>
              
              {/* YouTube Setup Wizard Inline */}
              {showYoutubeWizard && (
                <div className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
                  <YouTubeSetupWizard
                    campaignId={campaignId}
                    initialSettings={initialSettings}
                    onComplete={(data) => {
                      console.log('🎬 YouTube setup completed, updating form...');
                      handleYoutubeComplete(data);
                      setShowYoutubeWizard(false);
                    }}
                  />
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

        </Accordion>

        <div className="flex justify-end space-x-2 pt-4">
          <Button 
            type="submit" 
            disabled={isLoading}

          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Сохранить настройки
          </Button>
        </div>
        </form>
      </Form>
      


      {/* VK Setup Wizard Dialog */}
      {showVkWizard && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-auto">
            <VkSetupWizard
              campaignId={campaignId}
              onComplete={() => {
                console.log('🔄 VK setup completed, refreshing VK settings...');
                setShowVkWizard(false);
                
                // Перезагружаем VK настройки из базы данных
                loadVkSettings();
                
                if (onSettingsUpdated) {
                  onSettingsUpdated();
                }
                toast({
                  title: "VK OAuth настройка завершена",
                  description: "VK интеграция успешно настроена для этой кампании",
                });
              }}
              onCancel={() => {
                console.log('VK wizard: Закрытие через onCancel');
                setShowVkWizard(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

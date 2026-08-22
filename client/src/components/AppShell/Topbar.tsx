import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu, X, User, LogOut, Settings, Sparkles, Send, CreditCard, Bot, Zap, SlidersHorizontal, GitMerge, ClipboardList, Pause, Play } from "lucide-react";
import { CampaignSelector } from "../CampaignSelector";
import { AiZone, HelpZone, AccountZone, ZoneDivider } from "./TopbarZones";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { autonomousControls, pauseResultToast } from "@/lib/autonomous-controls";
import { useAuthStore } from "@/lib/store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCampaignDetail, useCampaignsList } from "@/hooks/use-campaigns";
import { useUserProfile } from "@/hooks/use-user-profile";
import { useCampaignStore } from "@/lib/campaignStore";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTranslation } from 'react-i18next';
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

type PipelineMode = 'full_auto' | 'controlled' | 'mixed';

interface TopbarProps {
  onMenuClick: () => void;
  isSidebarCollapsed?: boolean;
  onLogout: () => void;
  onOpenProfile: () => void;
  onOpenAIChat?: () => void;
  onOpenTGBot?: () => void;
  location: string;
}

interface UserProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_smm_admin: boolean;
}

export function Topbar({ onMenuClick, isSidebarCollapsed, onLogout, onOpenProfile, onOpenAIChat, onOpenTGBot, location }: TopbarProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showModeDialog, setShowModeDialog] = useState(false);
  // SM-20: окно управления активным режимом и подтверждение выключения.
  // Выключение необратимо стирает прогресс, поэтому спрашиваем отдельно.
  const [showManageDialog, setShowManageDialog] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [selectedMode, setSelectedMode] = useState<PipelineMode>('full_auto');
  
  // Нормализуем location и скрываем селектор на Dashboard и списке кампаний
  const normalizedLocation = location.replace(/\/+$/, '') || '/';
  const showCampaignSelector = !['/campaigns', '/', '/dashboard'].includes(normalizedLocation);
  
  // Получаем информацию о пользователе
  const userId = useAuthStore((state) => state.userId);
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const token = useAuthStore((state) => state.token);

  // Текущая кампания
  const { selectedCampaignId } = useCampaignStore();

  // Статус автономного режима для текущей кампании
  const { data: autonomousStatus } = useQuery<any>({
    queryKey: ['/api/autonomous/status', selectedCampaignId],
    queryFn: async () => {
      const res = await fetch(`/api/autonomous/status/${selectedCampaignId}`, {
        headers: { Authorization: token ? `Bearer ${token}` : '' }
      });
      return res.json();
    },
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    staleTime: 0,
    enabled: !!selectedCampaignId && !!token,
  });

  const isAutonomousActive = autonomousStatus?.isActive === true;
  // SM-20: режим может быть на паузе — таймеры сняты, но прогресс сохранён.
  // status появился вместе с паузой; на старом ответе его нет, поэтому
  // отсутствие трактуем как «работает», а не как «на паузе».
  const isAutonomousPaused = isAutonomousActive && autonomousStatus?.status === 'paused';
  const hasQuotaError = !isAutonomousActive && !!autonomousStatus?.quotaError;
  // AI-123. Режим мог остановиться сам не только из-за исчерпанной квоты AI:
  // например, потеряно подключение к аккаунту. Раньше всё, кроме квоты,
  // выглядело как «режим просто выключен» — хотя выключил его не человек, и
  // человек об этом не знал, пока не замечал отсутствие постов.
  const hasStopReason = !isAutonomousActive && !hasQuotaError && !!autonomousStatus?.stopReason;
  // AI-123v2. Режим ещё работает, но последняя попытка сорвалась. При суточном
  // интервале до остановки по трём прерываниям подряд трое суток — человек всё
  // это время видел бы обычное зелёное «работает» и ждал постов, которых нет.
  const hasAttention = isAutonomousActive && !!autonomousStatus?.attention;

  // Настройки автономного режима из кампании.
  // Раньше здесь был useQuery без queryFn с ключом ['/api/campaigns', id]:
  // дефолтный queryFn шлёт голый GET по queryKey[0], то есть тянул СПИСОК
  // кампаний (43 КБ, третий параллельный дубль на каждой странице), а
  // autonomous_settings читался с верхнего уровня списочного ответа и всегда
  // был undefined — тултип автономного режима молча пустовал.
  const { data: campaignData } = useCampaignDetail(selectedCampaignId);

  // SM-78: второй эшелон. Topbar показывает блок автономного режима
  // только когда выбранная кампания реально существует в списке.
  // Запрос уже делает CampaignSelector; мы тут только читаем кэш —
  // нового HTTP-вызова нет.
  //
  // Скрываем кнопки ТОЛЬКО когда список успешно загружен и выбранной
  // кампании в нём нет. Пока запрос идёт или упал — ведём себя как
  // раньше, чтобы пользователь с нормально выбранной кампанией
  // не потерял функцию из-за сетевого флапа.
  const campaignsList = useCampaignsList();
  const campaignsLoaded = !campaignsList.isLoading && !campaignsList.isError && !!campaignsList.data?.data;
  const selectedCampaignExists = !selectedCampaignId
    ? false
    : !!campaignsList.data?.data?.some((c: { id: string }) => c.id === selectedCampaignId);
  const showAutonomousBlock = !!selectedCampaignId && (!campaignsLoaded || selectedCampaignExists);

  // Формируем описание настроек для тултипа
  const autonomousSettings = campaignData?.autonomous_settings;
  const tooltipInterval = isAutonomousActive
    ? autonomousStatus?.interval
    : autonomousSettings?.intervalHours;
  const tooltipPosts = isAutonomousActive
    ? autonomousStatus?.postsPerCycle
    : autonomousSettings?.postsPerCycle;
  const tooltipWithImages = isAutonomousActive
    ? autonomousStatus?.withImages
    : autonomousSettings?.withImages;

  const buildAutonomousDesc = () => {
    if (!tooltipInterval && !tooltipPosts) return null;
    const interval = tooltipInterval ?? 8;
    const posts = tooltipPosts ?? 1;
    // Склонение «пост/поста/постов» отдано i18next (count + _one/_few/_many):
    // в en/es правила другие, руками их не воспроизвести.
    const schedule = t('topbar.autonomous.schedule', { count: posts, interval });
    return tooltipWithImages !== false
      ? `${schedule} · ${t('topbar.autonomous.withImages')}`
      : schedule;
  };

  const { mutate: startAutonomousWithMode, isPending: isTogglingAutonomous } = useMutation({
    mutationFn: async (mode: PipelineMode) => {
      const res = await fetch('/api/autonomous/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({
          campaignId: selectedCampaignId,
          userId,
          interval: autonomousSettings?.intervalHours ?? 8,
          postsPerCycle: autonomousSettings?.postsPerCycle ?? 1,
          autoSchedule: autonomousSettings?.autoSchedule ?? true,
          withImages: autonomousSettings?.withImages ?? true,
          pipelineMode: mode,
          auth_token: localStorage.getItem('auth_token'),
          refresh_token: localStorage.getItem('refresh_token'),
        }),
      });
      // Без этой проверки 5xx проходил как успех: диалог закрывался, статус
      // инвалидировался, пользователь считал, что режим запущен
      // (находка ревью 2026-07-28).
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Не удалось запустить автономный режим');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/autonomous/status', selectedCampaignId] });
      setShowModeDialog(false);
    },
    onError: (err: any) => {
      toast({
        title: 'Ошибка',
        description: err?.message || 'Не удалось запустить автономный режим',
        variant: 'destructive',
      });
    },
  });

  const { mutate: stopAutonomous, isPending: isStoppingAutonomous } = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/autonomous/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ campaignId: selectedCampaignId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Не удалось остановить автономный режим');
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      toast(pauseResultToast(t('topbar.autonomous.stoppedToast'), data?.content));
      queryClient.invalidateQueries({ queryKey: ['/api/autonomous/status', selectedCampaignId] });
      setShowManageDialog(false);
      setConfirmDisable(false);
    },
    onError: (err: any) => {
      toast({
        title: 'Ошибка',
        description: err?.message || 'Не удалось остановить автономный режим',
        variant: 'destructive',
      });
    },
  });

  // SM-20: пауза и снятие с паузы. В отличие от /stop не теряют прогресс —
  // счётчики циклов и постов сохраняются, расписание не сбрасывается.
  const { mutate: pauseAutonomous, isPending: isPausingAutonomous } = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/autonomous/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ campaignId: selectedCampaignId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Не удалось поставить на паузу');
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      // SM-20: пауза теперь ещё и снимает с очереди публикации этого запуска.
      // Если снялось не всё — человек обязан узнать сразу, иначе он считает,
      // что всё стоит, а пост выходит.
      toast(pauseResultToast(t('topbar.autonomous.pausedToast'), data?.content));
      queryClient.invalidateQueries({ queryKey: ['/api/autonomous/status', selectedCampaignId] });
      setShowManageDialog(false);
    },
    onError: (err: any) => {
      toast({
        title: 'Ошибка',
        description: err?.message || 'Не удалось поставить на паузу',
        variant: 'destructive',
      });
    },
  });

  const { mutate: resumeAutonomous, isPending: isResumingAutonomous } = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/autonomous/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ campaignId: selectedCampaignId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Не удалось возобновить');
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      const mins = typeof data?.nextCycleMin === 'number' ? data.nextCycleMin : null;
      toast({
        description: mins !== null
          ? `▶️ Автономный режим возобновлён, следующий цикл через ${mins} мин`
          : '▶️ Автономный режим возобновлён',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/autonomous/status', selectedCampaignId] });
    },
    onError: (err: any) => {
      toast({
        title: 'Ошибка',
        description: err?.message || 'Не удалось возобновить',
        variant: 'destructive',
      });
    },
  });

  // Полный профиль пользователя — единый каноник useUserProfile (task #84).
  const { data: userProfile, isLoading, error } = useUserProfile();


  // Формируем отображаемое имя пользователя
  const getUserDisplayName = () => {
    if (isLoading) return t('common.loading');
    if (!userProfile) return t('auth.login');
    
    const { first_name, last_name, email } = userProfile;
    
    if (first_name && last_name) {
      return `${first_name} ${last_name}`;
    } else if (first_name) {
      return first_name;
    } else if (last_name) {
      return last_name;
    } else {
      return email || t('auth.login');
    }
  };

  const userDisplayName = getUserDisplayName();
  const userIsAdmin = userProfile?.is_smm_admin || isAdmin;


  return (
    <>
    <header className="h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-2 px-4 lg:px-6 lg:pl-6 shadow-sm safe-area-top safe-area-left safe-area-right overflow-hidden">
      {/* min-w-0 + flex-shrink заставляют ЛЕВУЮ часть сжиматься, а не
          правую — иначе на 375×800 переполнение (правка ревью 22.08). */}
      <div className="flex items-center gap-4 min-w-0 flex-shrink">
        {/* Menu button — гамбургер на мобильных, toggle коллапса на десктопе */}
        <Button
          variant="ghost"
          size="icon"
          data-testid="button-menu"
          className="h-9 w-9"
          onClick={onMenuClick}
          title={isSidebarCollapsed ? t('topbar.menuExpand') : t('topbar.menuCollapse')}
        >
          <Menu className="h-4 w-4" />
        </Button>

        {/* Campaign selector — скрываем на странице списка кампаний.
            gap-2 вместо gap-4 на узком экране — экономит горизонтальное
            место (правка ревью 22.08). */}
        {showCampaignSelector && (
          <div className="flex items-center gap-2 sm:gap-4">
            <CampaignSelector persistSelection={true} />
          </div>
        )}
            {showAutonomousBlock && (
                      <>
                      {/* SM-20: пауза — отдельная кнопка ВНЕ TooltipTrigger.
                          Внутрь asChild её класть нельзя: Radix Slot клонирует ровно
                          одного ребёнка и вешает на него props и ref, а фрагмент из
                          двух кнопок их не принимает — тултип теряет якорь. Ни tsc,
                          ни build этого не ловят: семантика Slot им неизвестна. */}
                      {isAutonomousActive && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (isAutonomousPaused) {
                            resumeAutonomous();
                          } else {
                            pauseAutonomous();
                          }
                        }}
                        className="h-9 w-9"
                        data-testid="button-autonomous-pause"
                        disabled={isPausingAutonomous || isResumingAutonomous}
                        aria-label={isAutonomousPaused ? t('nav.autonomous.resumeLabel') : t('nav.autonomous.pauseLabel')}
                        title={isAutonomousPaused ? t('nav.autonomous.resumeLabel') : t('nav.autonomous.pauseLabel')}
                      >
                        {isAutonomousPaused
                          ? <Play className="h-4 w-4 text-emerald-600" />
                          : <Pause className="h-4 w-4 text-amber-600" />}
                      </Button>
                      )}
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            {autonomousStatus?.pendingApprovalStep ? (
                              <Link href={`/campaigns/${selectedCampaignId}`}>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 relative"
                                  data-testid="button-autonomous-pending"
                                  aria-label={t('nav.autonomous.pendingLabel')}
                                  title={t('nav.autonomous.pendingLabel')}
                                >
                                  <ClipboardList className="h-4 w-4 text-amber-500 dark:text-amber-400" aria-hidden="true" />
                                  <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-500 animate-pulse" aria-hidden="true" />
                                </Button>
                              </Link>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  // SM-20: клик больше не выключает режим молча. Раньше одно
                                  // нажатие стирало прогресс без вопроса и без возможности
                                  // просто поставить на паузу — на это и жаловались.
                                  if (isAutonomousActive) {
                                    setConfirmDisable(false);
                                    setShowManageDialog(true);
                                  } else {
                                    setShowModeDialog(true);
                                  }
                                }}
                                className="h-9 w-9 relative"
                                data-testid="button-autonomous-toggle"
                                disabled={isTogglingAutonomous || isStoppingAutonomous}
                                aria-label={
                                  isAutonomousActive
                                    ? t('nav.autonomous.manageLabel')
                                    : t('nav.autonomous.startLabel')
                                }
                                aria-pressed={isAutonomousActive}
                                title={
                                  isAutonomousActive
                                    ? t('nav.autonomous.manageLabel')
                                    : t('nav.autonomous.startLabel')
                                }
                              >
                                <Bot
                                  className={`h-4 w-4 transition-colors ${
                                    hasAttention
                                      ? 'text-yellow-500 dark:text-yellow-400'
                                      : isAutonomousActive
                                      ? 'text-green-500 dark:text-green-400'
                                      : hasQuotaError
                                      ? 'text-yellow-500 dark:text-yellow-400'
                                      : 'text-red-400 dark:text-red-500'
                                  }`}
                                  aria-hidden="true"
                                />
                                <span
                                  className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ${
                                    hasAttention
                                      ? 'bg-yellow-500 animate-pulse'
                                      : isAutonomousActive
                                      ? 'bg-green-500 animate-pulse'
                                      : hasQuotaError
                                      ? 'bg-yellow-500 animate-pulse'
                                      : 'bg-red-400'
                                  }`}
                                  aria-hidden="true"
                                />
                              </Button>
                            )}
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-[220px] text-center">
                            {autonomousStatus?.pendingApprovalStep ? (
                              <div className="space-y-0.5">
                                <p className="font-medium text-amber-600 dark:text-amber-400">{t('topbar.autonomous.pendingTitle')}</p>
                                <p className="text-xs text-muted-foreground">
                                  {t('topbar.autonomous.pendingDescription')}
                                </p>
                              </div>
                            ) : hasAttention ? (
                              <div className="space-y-0.5">
                                <p className="font-medium text-yellow-600 dark:text-yellow-400">Режим работает, но есть проблема</p>
                                <p className="text-xs text-yellow-700 dark:text-yellow-300">{autonomousStatus.attention.message}</p>
                                <p className="text-xs text-muted-foreground">
                                  Неудачных попыток подряд: {autonomousStatus.attention.failedAttempts} из {autonomousStatus.attention.stopsAfter}.
                                </p>
                              </div>
                            ) : isAutonomousActive ? (
                              <div className="space-y-0.5">
                                <p className="font-medium text-green-600 dark:text-green-400">{t('topbar.autonomous.activeTitle')}</p>
                                {buildAutonomousDesc() && (
                                  <p className="text-xs text-muted-foreground">{buildAutonomousDesc()}</p>
                                )}
                                {autonomousStatus?.cyclesCompleted != null && (
                                  <p className="text-xs text-muted-foreground">
                                    {t('topbar.autonomous.stats', {
                                      cycles: autonomousStatus.cyclesCompleted,
                                      posts: autonomousStatus.postsCreated ?? 0,
                                    })}
                                  </p>
                                )}
                                <p className="text-xs text-muted-foreground">{t('topbar.autonomous.activeHint')}</p>
                              </div>
                            ) : hasStopReason ? (
                              <div className="space-y-0.5">
                                <p className="font-medium text-red-600 dark:text-red-400">Режим остановлен</p>
                                <p className="text-xs text-red-700 dark:text-red-300">{autonomousStatus.stopReason.message}</p>
                                <p className="text-xs text-muted-foreground">Включите автономный режим снова после входа.</p>
                              </div>
                            ) : hasQuotaError ? (
                              <div className="space-y-0.5">
                                <p className="font-medium text-yellow-600 dark:text-yellow-400">{t('topbar.autonomous.quotaTitle')}</p>
                                <p className="text-xs text-yellow-700 dark:text-yellow-300">{autonomousStatus.quotaError.message}</p>
                                <p className="text-xs text-muted-foreground">{t('topbar.autonomous.quotaHint')}</p>
                              </div>
                            ) : (
                              <div className="space-y-0.5">
                                <p className="font-medium">{t('topbar.autonomous.offTitle')}</p>
                                {buildAutonomousDesc() && (
                                  <p className="text-xs text-muted-foreground">{buildAutonomousDesc()}</p>
                                )}
                                <p className="text-xs text-muted-foreground">{t('topbar.autonomous.offHint')}</p>
                              </div>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      </>
            )}
      </div>

      {/* Right side actions — три зоны через ZoneDivider (AI-134).
          flex-shrink-0 запрещает шапке сжимать правую группу за счёт
          левой: иначе на 375×800 правая группа уезжает за экран на
          ~160 пикселей (см. браузерную проверку 22.08). */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {onOpenAIChat && <AiZone onOpenAIChat={onOpenAIChat} />}
        <ZoneDivider />
        <HelpZone onOpenTGBot={onOpenTGBot} />
        <ZoneDivider />
        <AccountZone
          userDisplayName={userDisplayName}
          userRoleLabel={t('topbar.smmAdmin')}
          onLogout={onLogout}
          onOpenProfile={onOpenProfile}
        />
      </div>
    </header>

      {/* Диалог выбора режима автономного ассистента */}
    {/* SM-20: окно управления активным режимом.

        Раньше единственным действием над работающим режимом было выключение по
        клику на значок — без вопроса и без промежуточного варианта. Здесь три
        действия названы словами, а выключение, которое стирает прогресс,
        требует отдельного подтверждения. */}
    <Dialog
      open={showManageDialog}
      onOpenChange={(open) => {
        setShowManageDialog(open);
        if (!open) setConfirmDisable(false);
      }}
    >
      <DialogContent className="sm:max-w-[420px]" data-testid="dialog-autonomous-manage">
        <DialogHeader>
          <DialogTitle>{t('topbar.manageDialog.title')}</DialogTitle>
          <DialogDescription>
            {isAutonomousPaused
              ? t('topbar.manageDialog.pausedDescription')
              : t('topbar.manageDialog.runningDescription')}
          </DialogDescription>
        </DialogHeader>

        {(() => {
          const controls = autonomousControls({
            active: isAutonomousActive,
            phase: isAutonomousPaused
              ? 'paused'
              : autonomousStatus?.status === 'pausing'
              ? 'pausing'
              : 'running',
            pending: {
              pause: isPausingAutonomous,
              resume: isResumingAutonomous,
              disable: isStoppingAutonomous,
            },
          });

          return (
            <div className="flex flex-col gap-2">
              {controls.pause.visible && (
                <Button
                  variant="outline"
                  onClick={() => pauseAutonomous()}
                  disabled={controls.pause.disabled}
                  data-testid="button-manage-pause"
                >
                  <Pause className="h-4 w-4 mr-2 text-amber-600" aria-hidden="true" />
                  {controls.pause.busy
                    ? t('topbar.manageDialog.pausing')
                    : t('topbar.manageDialog.pause')}
                </Button>
              )}

              {controls.resume.visible && (
                <Button
                  variant="outline"
                  onClick={() => resumeAutonomous()}
                  disabled={controls.resume.disabled}
                  data-testid="button-manage-resume"
                >
                  <Play className="h-4 w-4 mr-2 text-emerald-600" aria-hidden="true" />
                  {controls.resume.busy
                    ? t('topbar.manageDialog.resuming')
                    : t('topbar.manageDialog.resume')}
                </Button>
              )}

              {controls.disable.visible && !confirmDisable && (
                <Button
                  variant="destructive"
                  onClick={() => setConfirmDisable(true)}
                  disabled={controls.disable.disabled}
                  data-testid="button-manage-disable"
                >
                  {t('topbar.manageDialog.disable')}
                </Button>
              )}

              {confirmDisable && (
                <div className="rounded-md border border-destructive/40 p-3 space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {t('topbar.manageDialog.disableWarning')}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      onClick={() => stopAutonomous()}
                      disabled={controls.disable.disabled}
                      data-testid="button-manage-disable-confirm"
                    >
                      {controls.disable.busy
                        ? t('topbar.manageDialog.disabling')
                        : t('topbar.manageDialog.disableConfirm')}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setConfirmDisable(false)}
                      disabled={controls.disable.busy}
                      data-testid="button-manage-disable-cancel"
                    >
                      {t('topbar.manageDialog.cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </DialogContent>
    </Dialog>

    <Dialog open={showModeDialog} onOpenChange={setShowModeDialog}>
      <DialogContent className="sm:max-w-[520px]" data-testid="dialog-pipeline-mode">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            {t('topbar.pipelineDialog.title')}
          </DialogTitle>
          <DialogDescription>
            {t('topbar.pipelineDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {[
            {
              id: 'full_auto' as PipelineMode,
              // ключ локали отдельно от id: в JSON camelCase, в API — snake_case
              i18nKey: 'fullAuto',
              icon: <Zap className="h-5 w-5 text-green-500" />,
              badgeColor: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
            },
            {
              id: 'mixed' as PipelineMode,
              i18nKey: 'mixed',
              icon: <GitMerge className="h-5 w-5 text-blue-500" />,
              badgeColor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
            },
            {
              id: 'controlled' as PipelineMode,
              i18nKey: 'controlled',
              icon: <SlidersHorizontal className="h-5 w-5 text-orange-500" />,
              badgeColor: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
            },
          ].map((option) => (
            <button
              key={option.id}
              data-testid={`option-mode-${option.id}`}
              onClick={() => setSelectedMode(option.id)}
              className={`w-full text-left rounded-lg border-2 p-4 transition-all ${
                selectedMode === option.id
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/40'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{option.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">
                      {t(`topbar.pipelineDialog.modes.${option.i18nKey}.title`)}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${option.badgeColor}`}>
                      {t(`topbar.pipelineDialog.modes.${option.i18nKey}.badge`)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t(`topbar.pipelineDialog.modes.${option.i18nKey}.description`)}
                  </p>
                </div>
                <div className={`h-4 w-4 rounded-full border-2 mt-0.5 flex-shrink-0 ${
                  selectedMode === option.id ? 'border-primary bg-primary' : 'border-muted-foreground/30'
                }`} />
              </div>
            </button>
          ))}
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={() => setShowModeDialog(false)} data-testid="button-mode-cancel">
              {t('common.cancel')}
          </Button>
          <Button
            onClick={() => startAutonomousWithMode(selectedMode)}
            disabled={isTogglingAutonomous}
            data-testid="button-mode-confirm"
            className="gap-2"
          >
            <Bot className="h-4 w-4" />
              {isTogglingAutonomous
                ? t('topbar.pipelineDialog.starting')
                : t('topbar.pipelineDialog.start')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

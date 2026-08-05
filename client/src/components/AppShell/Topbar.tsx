import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu, X, User, LogOut, Settings, Sun, Moon, Sparkles, Send, CreditCard, Bot, Zap, SlidersHorizontal, GitMerge, ClipboardList, Pause, Play } from "lucide-react";
import { CampaignSelector } from "../CampaignSelector";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuthStore } from "@/lib/store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCampaignDetail } from "@/hooks/use-campaigns";
import { useThemeStore } from "@/lib/themeStore";
import { useCampaignStore } from "@/lib/campaignStore";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
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

  // Настройки автономного режима из кампании.
  // Раньше здесь был useQuery без queryFn с ключом ['/api/campaigns', id]:
  // дефолтный queryFn шлёт голый GET по queryKey[0], то есть тянул СПИСОК
  // кампаний (43 КБ, третий параллельный дубль на каждой странице), а
  // autonomous_settings читался с верхнего уровня списочного ответа и всегда
  // был undefined — тултип автономного режима молча пустовал.
  const { data: campaignData } = useCampaignDetail(selectedCampaignId);

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/autonomous/status', selectedCampaignId] });
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
    onSuccess: () => {
      toast({ description: '⏸ Автономный режим на паузе, прогресс сохранён' });
      queryClient.invalidateQueries({ queryKey: ['/api/autonomous/status', selectedCampaignId] });
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

  // Загружаем полный профиль пользователя из API.
  // Ключ БЕЗ токена: с ним запрос не схлопывался с точно таким же из usePlan
  // (ключ ['/api/user/profile', userId]) — профиль ехал дважды параллельно.
  // Смена пользователя и так чистит кеш (queryClient.clear в use-auth), а смена
  // токена того же пользователя новых данных профиля не даёт.
  const { data: userProfile, isLoading, error } = useQuery<UserProfile>({
    queryKey: ['/api/user/profile', userId || 'me'],
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 1
  });


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

  // Тема
  const { resolvedTheme, setColorMode } = useThemeStore();
  
  const toggleTheme = () => {
    setColorMode(resolvedTheme === 'light' ? 'dark' : 'light');
  };

  return (
    <>
    <header className="h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 lg:px-6 lg:pl-6 shadow-sm safe-area-top safe-area-left safe-area-right">
      <div className="flex items-center gap-4">
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

        {/* Campaign selector — скрываем на странице списка кампаний */}
        {showCampaignSelector && (
          <div className="flex items-center gap-4">
            <CampaignSelector persistSelection={true} />
          </div>
        )}
      </div>

      {/* Right side actions - Language, Theme & User Profile */}
      <div className="flex items-center gap-2">
        {/* Language Switcher */}
        <LanguageSwitcher />
        
        {/* Theme Toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="h-9 w-9"
          data-testid="button-theme-toggle"
          title={t('settings.theme')}
        >
          {resolvedTheme === 'light' ? (
            <Moon className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4" />
          )}
        </Button>

        {/* AI Assistant */}
        {onOpenAIChat && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenAIChat}
            className="h-9 w-9 relative"
            data-testid="button-ai-assistant"
            title={t('topbar.aiAssistant')}
          >
            <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 animate-pulse" />
          </Button>
        )}

        {/* Autonomous Mode Toggle */}
        {selectedCampaignId && (
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
                  <>
                  {/* SM-20: пауза видна только когда режим заведён — тогда она
                      и осмысленна. Остановка остаётся отдельной кнопкой и
                      по-прежнему сбрасывает прогресс. */}
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
                      aria-label={isAutonomousPaused ? 'Возобновить автономный режим' : 'Поставить автономный режим на паузу'}
                      title={isAutonomousPaused ? 'Возобновить' : 'Пауза'}
                    >
                      {isAutonomousPaused
                        ? <Play className="h-4 w-4 text-emerald-600" />
                        : <Pause className="h-4 w-4 text-amber-600" />}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (isAutonomousActive) {
                        stopAutonomous();
                      } else {
                        setShowModeDialog(true);
                      }
                    }}
                    className="h-9 w-9 relative"
                    data-testid="button-autonomous-toggle"
                    disabled={isTogglingAutonomous || isStoppingAutonomous}
                    aria-label={
                      isAutonomousActive
                        ? t('nav.autonomous.stopLabel')
                        : t('nav.autonomous.startLabel')
                    }
                    aria-pressed={isAutonomousActive}
                    title={
                      isAutonomousActive
                        ? t('nav.autonomous.stopLabel')
                        : t('nav.autonomous.startLabel')
                    }
                  >
                    <Bot
                      className={`h-4 w-4 transition-colors ${
                        isAutonomousActive
                          ? 'text-green-500 dark:text-green-400'
                          : hasQuotaError
                          ? 'text-yellow-500 dark:text-yellow-400'
                          : 'text-red-400 dark:text-red-500'
                      }`}
                      aria-hidden="true"
                    />
                    <span
                      className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ${
                        isAutonomousActive
                          ? 'bg-green-500 animate-pulse'
                          : hasQuotaError
                          ? 'bg-yellow-500 animate-pulse'
                          : 'bg-red-400'
                      }`}
                      aria-hidden="true"
                    />
                  </Button>
                  </>
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
        )}

        {/* TG Bot Assistant */}
        {onOpenTGBot && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenTGBot}
            className="h-9 w-9 relative bg-gradient-to-r from-blue-500 to-cyan-500 text-white hover:from-blue-600 hover:to-cyan-600"
            data-testid="button-tg-bot"
            title={t('topbar.tgAssistant')}
          >
            <Send className="h-4 w-4" />
            <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          </Button>
        )}

        {/* Pricing link */}
        <Link href="/pricing">
          <Button
            variant="ghost"
            size="sm"
            className="hidden sm:flex items-center gap-1.5 h-9 px-3 text-blue-600 dark:text-blue-400 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20"
            data-testid="button-pricing-nav"
            title={t('topbar.pricing')}
          >
            <CreditCard className="h-4 w-4" />
            <span className="text-sm font-medium">{t('topbar.pricing')}</span>
          </Button>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              className="flex items-center gap-2 h-9 px-3"
              data-testid="button-user-menu"
            >
              <User className="h-4 w-4" />
              <div className="hidden sm:flex flex-col items-start text-left">
                <span className="text-sm font-medium">{userDisplayName}</span>
                {userProfile?.email && userProfile.email !== userDisplayName && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">{userProfile.email}</span>
                )}
              </div>
              {userIsAdmin && (
                <span className="hidden md:inline-block bg-blue-500 text-white text-xs px-2 py-1 rounded">
                  {t('topbar.smmAdmin')}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem 
              onClick={onOpenProfile}
              data-testid="menu-profile"
            >
              <User className="mr-2 h-4 w-4" />
              {t('settings.profile')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={onLogout}
              className="text-red-600 dark:text-red-400"
              data-testid="menu-logout"
            >
              <LogOut className="mr-2 h-4 w-4" />
              {t('auth.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>

      {/* Диалог выбора режима автономного ассистента */}
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

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu, X, User, LogOut, Settings, Sun, Moon, Sparkles, Send, CreditCard, Bot, Zap, SlidersHorizontal, GitMerge, ClipboardList } from "lucide-react";
import { CampaignSelector } from "../CampaignSelector";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuthStore } from "@/lib/store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useThemeStore } from "@/lib/themeStore";
import { useCampaignStore } from "@/lib/campaignStore";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTranslation } from 'react-i18next';
import { Link } from "wouter";

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
  const [showModeDialog, setShowModeDialog] = useState(false);
  const [selectedMode, setSelectedMode] = useState<PipelineMode>('full_auto');
  
  // ÐÐ¾Ñ€Ð¼Ð°Ð»Ð¸Ð·ÑƒÐµÐ¼ location Ð¸ ÑÐºÑ€Ñ‹Ð²Ð°ÐµÐ¼ ÑÐµÐ»ÐµÐºÑ‚Ð¾Ñ€ Ð½Ð° Dashboard Ð¸ ÑÐ¿Ð¸ÑÐºÐµ ÐºÐ°Ð¼Ð¿Ð°Ð½Ð¸Ð¹
  const normalizedLocation = location.replace(/\/+$/, '') || '/';
  const showCampaignSelector = !['/campaigns', '/', '/dashboard'].includes(normalizedLocation);
  
  // ÐŸÐ¾Ð»ÑƒÑ‡Ð°ÐµÐ¼ Ð¸Ð½Ñ„Ð¾Ñ€Ð¼Ð°Ñ†Ð¸ÑŽ Ð¾ Ð¿Ð¾Ð»ÑŒÐ·Ð¾Ð²Ð°Ñ‚ÐµÐ»Ðµ
  const userId = useAuthStore((state) => state.userId);
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const token = useAuthStore((state) => state.token);

  // Ð¢ÐµÐºÑƒÑ‰Ð°Ñ ÐºÐ°Ð¼Ð¿Ð°Ð½Ð¸Ñ
  const { selectedCampaignId } = useCampaignStore();

  // Ð¡Ñ‚Ð°Ñ‚ÑƒÑ Ð°Ð²Ñ‚Ð¾Ð½Ð¾Ð¼Ð½Ð¾Ð³Ð¾ Ñ€ÐµÐ¶Ð¸Ð¼Ð° Ð´Ð»Ñ Ñ‚ÐµÐºÑƒÑ‰ÐµÐ¹ ÐºÐ°Ð¼Ð¿Ð°Ð½Ð¸Ð¸
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
  const hasQuotaError = !isAutonomousActive && !!autonomousStatus?.quotaError;

  // ÐÐ°ÑÑ‚Ñ€Ð¾Ð¹ÐºÐ¸ Ð°Ð²Ñ‚Ð¾Ð½Ð¾Ð¼Ð½Ð¾Ð³Ð¾ Ñ€ÐµÐ¶Ð¸Ð¼Ð° Ð¸Ð· ÐºÐ°Ð¼Ð¿Ð°Ð½Ð¸Ð¸
  const { data: campaignData } = useQuery<any>({
    queryKey: ['/api/campaigns', selectedCampaignId],
    enabled: !!selectedCampaignId && !!token,
    staleTime: 60000,
  });

  // Ð¤Ð¾Ñ€Ð¼Ð¸Ñ€ÑƒÐµÐ¼ Ð¾Ð¿Ð¸ÑÐ°Ð½Ð¸Ðµ Ð½Ð°ÑÑ‚Ñ€Ð¾ÐµÐº Ð´Ð»Ñ Ñ‚ÑƒÐ»Ñ‚Ð¸Ð¿Ð°
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
    const postWord = posts === 1 ? 'Ð¿Ð¾ÑÑ‚' : posts < 5 ? 'Ð¿Ð¾ÑÑ‚Ð°' : 'Ð¿Ð¾ÑÑ‚Ð¾Ð²';
    const imgPart = tooltipWithImages !== false ? ' Â· Ñ ÐºÐ°Ñ€Ñ‚Ð¸Ð½ÐºÐ°Ð¼Ð¸' : '';
    return `${posts} ${postWord} ÐºÐ°Ð¶Ð´Ñ‹Ðµ ${interval} Ñ‡${imgPart}`;
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
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/autonomous/status', selectedCampaignId] });
      setShowModeDialog(false);
    },
  });

  const { mutate: stopAutonomous, isPending: isStoppingAutonomous } = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/autonomous/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ campaignId: selectedCampaignId }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/autonomous/status', selectedCampaignId] });
    },
  });

  // Ð—Ð°Ð³Ñ€ÑƒÐ¶Ð°ÐµÐ¼ Ð¿Ð¾Ð»Ð½Ñ‹Ð¹ Ð¿Ñ€Ð¾Ñ„Ð¸Ð»ÑŒ Ð¿Ð¾Ð»ÑŒÐ·Ð¾Ð²Ð°Ñ‚ÐµÐ»Ñ Ð¸Ð· API
  const { data: userProfile, isLoading, error } = useQuery<UserProfile>({
    queryKey: ['/api/user/profile', userId || 'me', token],
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 1
  });


  // Ð¤Ð¾Ñ€Ð¼Ð¸Ñ€ÑƒÐµÐ¼ Ð¾Ñ‚Ð¾Ð±Ñ€Ð°Ð¶Ð°ÐµÐ¼Ð¾Ðµ Ð¸Ð¼Ñ Ð¿Ð¾Ð»ÑŒÐ·Ð¾Ð²Ð°Ñ‚ÐµÐ»Ñ
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

  // Ð¢ÐµÐ¼Ð°
  const { resolvedTheme, setColorMode } = useThemeStore();
  
  const toggleTheme = () => {
    setColorMode(resolvedTheme === 'light' ? 'dark' : 'light');
  };

  return (
    <>
    <header className="h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 lg:px-6 lg:pl-6 shadow-sm safe-area-top safe-area-left safe-area-right">
      <div className="flex items-center gap-4">
        {/* Menu button - Ð³Ð°Ð¼Ð±ÑƒÑ€Ð³ÐµÑ€ Ð½Ð° Ð¼Ð¾Ð±Ð¸Ð»ÑŒÐ½Ñ‹Ñ…, toggle ÐºÐ¾Ð»Ð»Ð°Ð¿ÑÐ° Ð½Ð° Ð´ÐµÑÐºÑ‚Ð¾Ð¿Ðµ */}
        <Button
          variant="ghost"
          size="icon"
          data-testid="button-menu"
          className="h-9 w-9"
          onClick={onMenuClick}
          title={isSidebarCollapsed ? "Ð Ð°Ð·Ð²ÐµÑ€Ð½ÑƒÑ‚ÑŒ Ð¼ÐµÐ½ÑŽ" : "Ð¡Ð²ÐµÑ€Ð½ÑƒÑ‚ÑŒ Ð¼ÐµÐ½ÑŽ"}
        >
          <Menu className="h-4 w-4" />
        </Button>

        {/* Campaign selector - ÑÐºÑ€Ñ‹Ð²Ð°ÐµÐ¼ Ð½Ð° ÑÑ‚Ñ€Ð°Ð½Ð¸Ñ†Ðµ ÑÐ¿Ð¸ÑÐºÐ° ÐºÐ°Ð¼Ð¿Ð°Ð½Ð¸Ð¹ */}
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
            title="AI ÐŸÐ¾Ð¼Ð¾Ñ‰Ð½Ð¸Ðº"
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
                )}
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[220px] text-center">
                {autonomousStatus?.pendingApprovalStep ? (
                  <div className="space-y-0.5">
                    <p className="font-medium text-amber-600 dark:text-amber-400">ÐžÐ¶Ð¸Ð´Ð°ÐµÑ‚ Ð¾Ð´Ð¾Ð±Ñ€ÐµÐ½Ð¸Ñ</p>
                    <p className="text-xs text-muted-foreground">
                      AI ÑÐ¾ÑÑ‚Ð°Ð²Ð¸Ð» ÐºÐ¾Ð½Ñ‚ÐµÐ½Ñ‚-Ð¿Ð»Ð°Ð½ â€” Ð½Ð°Ð¶Ð¼Ð¸Ñ‚Ðµ Ñ‡Ñ‚Ð¾Ð±Ñ‹ Ð¿Ñ€Ð¾ÑÐ¼Ð¾Ñ‚Ñ€ÐµÑ‚ÑŒ Ð¸ Ð¾Ð´Ð¾Ð±Ñ€Ð¸Ñ‚ÑŒ
                    </p>
                  </div>
                ) : isAutonomousActive ? (
                  <div className="space-y-0.5">
                    <p className="font-medium text-green-600 dark:text-green-400">ÐÐ²Ñ‚Ð¾Ð½Ð¾Ð¼Ð½Ñ‹Ð¹ Ñ€ÐµÐ¶Ð¸Ð¼ Ð°ÐºÑ‚Ð¸Ð²ÐµÐ½</p>
                    {buildAutonomousDesc() && (
                      <p className="text-xs text-muted-foreground">{buildAutonomousDesc()}</p>
                    )}
                    {autonomousStatus?.cyclesCompleted != null && (
                      <p className="text-xs text-muted-foreground">Ð¦Ð¸ÐºÐ»Ð¾Ð²: {autonomousStatus.cyclesCompleted} Â· ÐŸÐ¾ÑÑ‚Ð¾Ð²: {autonomousStatus.postsCreated ?? 0}</p>
                    )}
                    <p className="text-xs text-muted-foreground">ÐÐ°Ð¶Ð¼Ð¸Ñ‚Ðµ Ñ‡Ñ‚Ð¾Ð±Ñ‹ Ð¾ÑÑ‚Ð°Ð½Ð¾Ð²Ð¸Ñ‚ÑŒ</p>
                  </div>
                ) : hasQuotaError ? (
                  <div className="space-y-0.5">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">ÐÐ³ÐµÐ½Ñ‚ Ð¾ÑÑ‚Ð°Ð½Ð¾Ð²Ð»ÐµÐ½</p>
                    <p className="text-xs text-yellow-700 dark:text-yellow-300">{autonomousStatus.quotaError.message}</p>
                    <p className="text-xs text-muted-foreground">ÐÐ°Ð¶Ð¼Ð¸Ñ‚Ðµ Ñ‡Ñ‚Ð¾Ð±Ñ‹ Ð¿ÐµÑ€ÐµÐ·Ð°Ð¿ÑƒÑÑ‚Ð¸Ñ‚ÑŒ</p>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    <p className="font-medium">ÐÐ²Ñ‚Ð¾Ð½Ð¾Ð¼Ð½Ñ‹Ð¹ Ñ€ÐµÐ¶Ð¸Ð¼ Ð²Ñ‹ÐºÐ»ÑŽÑ‡ÐµÐ½</p>
                    {buildAutonomousDesc() && (
                      <p className="text-xs text-muted-foreground">{buildAutonomousDesc()}</p>
                    )}
                    <p className="text-xs text-muted-foreground">ÐÐ°Ð¶Ð¼Ð¸Ñ‚Ðµ Ñ‡Ñ‚Ð¾Ð±Ñ‹ Ð·Ð°Ð¿ÑƒÑÑ‚Ð¸Ñ‚ÑŒ ÑÐµÐ¹Ñ‡Ð°Ñ</p>
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
            title="TG ÐÑÑÐ¸ÑÑ‚ÐµÐ½Ñ‚"
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
            title="Ð¢Ð°Ñ€Ð¸Ñ„Ñ‹"
          >
            <CreditCard className="h-4 w-4" />
            <span className="text-sm font-medium">Ð¢Ð°Ñ€Ð¸Ñ„Ñ‹</span>
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
                  Ð¡ÐœÐœ ÐÐ´Ð¼Ð¸Ð½
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

    {/* Ð”Ð¸Ð°Ð»Ð¾Ð³ Ð²Ñ‹Ð±Ð¾Ñ€Ð° Ñ€ÐµÐ¶Ð¸Ð¼Ð° Ð°Ð²Ñ‚Ð¾Ð½Ð¾Ð¼Ð½Ð¾Ð³Ð¾ Ð°ÑÑÐ¸ÑÑ‚ÐµÐ½Ñ‚Ð° */}
    <Dialog open={showModeDialog} onOpenChange={setShowModeDialog}>
      <DialogContent className="sm:max-w-[520px]" data-testid="dialog-pipeline-mode">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Ð—Ð°Ð¿ÑƒÑÐº Ð°Ð²Ñ‚Ð¾Ð½Ð¾Ð¼Ð½Ð¾Ð³Ð¾ Ð°ÑÑÐ¸ÑÑ‚ÐµÐ½Ñ‚Ð°
          </DialogTitle>
          <DialogDescription>
            Ð’Ñ‹Ð±ÐµÑ€Ð¸Ñ‚Ðµ Ñ€ÐµÐ¶Ð¸Ð¼ Ñ€Ð°Ð±Ð¾Ñ‚Ñ‹ â€” Ð½Ð°ÑÐºÐ¾Ð»ÑŒÐºÐ¾ Ð°Ð²Ñ‚Ð¾Ð½Ð¾Ð¼Ð½Ð¾ Ð´Ð¾Ð»Ð¶ÐµÐ½ Ð´ÐµÐ¹ÑÑ‚Ð²Ð¾Ð²Ð°Ñ‚ÑŒ Ð°ÑÑÐ¸ÑÑ‚ÐµÐ½Ñ‚
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {[
            {
              id: 'full_auto' as PipelineMode,
              icon: <Zap className="h-5 w-5 text-green-500" />,
              title: 'ÐŸÐ¾Ð»Ð½Ñ‹Ð¹ Ð°Ð²Ñ‚Ð¾Ð¼Ð°Ñ‚',
              description: 'Ð“ÐµÐ½ÐµÑ€Ð¸Ñ€ÑƒÐµÑ‚ Ð¿Ð»Ð°Ð½, Ð¿Ð¸ÑˆÐµÑ‚ Ñ‚ÐµÐºÑÑ‚Ñ‹, ÑÐ¾Ð·Ð´Ð°Ñ‘Ñ‚ ÐºÐ°Ñ€Ñ‚Ð¸Ð½ÐºÐ¸ Ð¸ Ð¿ÑƒÐ±Ð»Ð¸ÐºÑƒÐµÑ‚ Ð¿Ð¾ Ñ€Ð°ÑÐ¿Ð¸ÑÐ°Ð½Ð¸ÑŽ â€” Ð±ÐµÐ· Ð¾ÑÑ‚Ð°Ð½Ð¾Ð²Ð¾Ðº.',
              badge: 'Ð ÐµÐºÐ¾Ð¼ÐµÐ½Ð´ÑƒÐµÑ‚ÑÑ',
              badgeColor: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
            },
            {
              id: 'mixed' as PipelineMode,
              icon: <GitMerge className="h-5 w-5 text-blue-500" />,
              title: 'Ð¡Ð¼ÐµÑˆÐ°Ð½Ð½Ñ‹Ð¹',
              description: 'ÐŸÐ¾ÐºÐ°Ð·Ñ‹Ð²Ð°ÐµÑ‚ ÐºÐ¾Ð½Ñ‚ÐµÐ½Ñ‚-Ð¿Ð»Ð°Ð½ Ð½Ð° Ð¾Ð´Ð¾Ð±Ñ€ÐµÐ½Ð¸Ðµ, Ð·Ð°Ñ‚ÐµÐ¼ ÑÐ°Ð¼Ð¾ÑÑ‚Ð¾ÑÑ‚ÐµÐ»ÑŒÐ½Ð¾ Ð¿Ð¸ÑˆÐµÑ‚, Ð³ÐµÐ½ÐµÑ€Ð¸Ñ€ÑƒÐµÑ‚ ÐºÐ°Ñ€Ñ‚Ð¸Ð½ÐºÐ¸ Ð¸ Ð¿ÑƒÐ±Ð»Ð¸ÐºÑƒÐµÑ‚.',
              badge: 'Ð¡ Ð¾Ð´Ð¾Ð±Ñ€ÐµÐ½Ð¸ÐµÐ¼ Ð¿Ð»Ð°Ð½Ð°',
              badgeColor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
            },
            {
              id: 'controlled' as PipelineMode,
              icon: <SlidersHorizontal className="h-5 w-5 text-orange-500" />,
              title: 'Ð¡ ÐºÐ¾Ð½Ñ‚Ñ€Ð¾Ð»ÐµÐ¼',
              description: 'ÐŸÐ¾ÑÐ»Ðµ ÐºÐ°Ð¶Ð´Ð¾Ð³Ð¾ ÑˆÐ°Ð³Ð° (Ð¿Ð»Ð°Ð½ â†’ Ñ‚ÐµÐºÑÑ‚Ñ‹ â†’ ÐºÐ°Ñ€Ñ‚Ð¸Ð½ÐºÐ¸) Ð¿Ð¾ÐºÐ°Ð·Ñ‹Ð²Ð°ÐµÑ‚ Ñ€ÐµÐ·ÑƒÐ»ÑŒÑ‚Ð°Ñ‚ Ð¸ Ð¶Ð´Ñ‘Ñ‚ Ð²Ð°ÑˆÐµÐ³Ð¾ Ð¾Ð´Ð¾Ð±Ñ€ÐµÐ½Ð¸Ñ.',
              badge: 'ÐœÐ°ÐºÑÐ¸Ð¼Ð°Ð»ÑŒÐ½Ñ‹Ð¹ ÐºÐ¾Ð½Ñ‚Ñ€Ð¾Ð»ÑŒ',
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
                    <span className="font-semibold text-sm">{option.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${option.badgeColor}`}>
                      {option.badge}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{option.description}</p>
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
            ÐžÑ‚Ð¼ÐµÐ½Ð°
          </Button>
          <Button
            onClick={() => startAutonomousWithMode(selectedMode)}
            disabled={isTogglingAutonomous}
            data-testid="button-mode-confirm"
            className="gap-2"
          >
            <Bot className="h-4 w-4" />
            {isTogglingAutonomous ? 'Ð—Ð°Ð¿ÑƒÑÐºÐ°ÐµÐ¼â€¦' : 'Ð—Ð°Ð¿ÑƒÑÑ‚Ð¸Ñ‚ÑŒ'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

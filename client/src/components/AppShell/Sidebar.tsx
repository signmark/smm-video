import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FileText, Search, TrendingUp, PenTool, Clock, Calendar, BarChart, Key, Users, LogOut, Home, Video, Send, Zap, Ticket, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from 'react-i18next';
import { usePlan } from '@/hooks/use-plan';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/store';

interface SidebarProps {
  isOpen: boolean;
  onClose: (open: boolean) => void;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  userIsAdmin: boolean;
  location: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

// Функция для нормализации test-id из пути
function normalizeTestId(path: string): string {
  return path.replace(/\//g, '-').replace(/^-/, '');
}

// Функция для проверки активного состояния роута
function isActiveRoute(currentLocation: string, targetPath: string): boolean {
  if (currentLocation === targetPath) return true;
  // Для дочерних роутов проверяем начало пути
  return currentLocation.startsWith(targetPath + '/') || currentLocation.startsWith(targetPath + '?');
}

const navItems = [
  { path: "/dashboard", labelKey: "nav.home", icon: Home },
  { path: "/campaigns", labelKey: "nav.campaigns", icon: FileText },
  { path: "/trends", labelKey: "nav.trends", icon: TrendingUp },
  { path: "/content", labelKey: "nav.content", icon: PenTool },
  { path: "/publish/scheduled", labelKey: "nav.scheduled", icon: Clock },
  { path: "/posts", labelKey: "nav.publish", icon: Calendar },
  { path: "/analytics", labelKey: "nav.analytics", icon: BarChart },
  { path: "/help/tutorials", labelKey: "nav.tutorial", icon: Video },
];

const adminItems = [
  { path: "/admin/global-api-keys", labelKey: "settings.apiKeys", icon: Key },
  { path: "/admin/users", labelKey: "admin.users", icon: Users },
  { path: "/admin/telegram-channels", labelKey: "admin.telegramChannels", icon: Send },
  { path: "/admin/promo-codes", labelKey: "admin.promoCodes", icon: Ticket },
];

function SidebarContent({ location, onNavigate, onLogout, userIsAdmin, isCollapsed, onToggleCollapse }: Omit<SidebarProps, 'isOpen' | 'onClose'>) {
  const { plan, effectivePlan, label, isExpired, limits } = usePlan();
  const { t } = useTranslation();
  const userId = useAuthStore((state) => state.userId);

  // Сайдбар живёт на КАЖДОЙ странице, поэтому цена этого запроса умножается на
  // всё приложение. Без своего queryFn срабатывал дефолтный — он берёт URL из
  // queryKey[0], то есть уходил голый GET /api/campaign-content: полная выдача
  // пользователя со всеми текстами и картинками, ~5 МБ на 1417 записей. И всё
  // это ради красного кружка с числом упавших публикаций. С summary=1 приезжают
  // только id/статус/даты — 293 КБ вместо 5 МБ на тех же данных.
  const { data: failedContentData } = useQuery<{ data: any[] }>({
    queryKey: ['/api/campaign-content', userId, 'summary'],
    enabled: !!userId,
    staleTime: 60000,
    queryFn: async () => {
      const response = await fetch('/api/campaign-content?summary=1', {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
      });
      if (!response.ok) throw new Error('Не удалось загрузить сводку по контенту');
      return response.json();
    },
    select: (data) => ({
      data: (data as any)?.data?.filter?.((item: any) => item.status === 'failed') || []
    })
  });
  const failedCount = failedContentData?.data?.length || 0;

  return (
    <nav 
      className="flex h-full flex-col bg-sidebar text-sidebar-foreground"
      role="navigation"
      aria-label="Main navigation"
    >
      {/* Logo + collapse toggle */}
      <div className={`${isCollapsed ? 'p-1.5' : 'p-2'} transition-all duration-300 border-b border-sidebar-border/30`}>
        <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
          {!isCollapsed && (
            <img 
              src="/smm-logo.png" 
              alt="SMM Manager" 
              className="h-8 w-auto select-none"
              style={{ userSelect: 'none' }}
            />
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
            className="flex items-center justify-center h-7 w-7 rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
            title={isCollapsed ? "Развернуть меню" : "Свернуть меню"}
            aria-label={isCollapsed ? "Развернуть меню" : "Свернуть меню"}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 flex flex-col p-2 space-y-1">
        <div className="space-y-0.5">
          {/* Main Navigation */}
          {!isCollapsed && (
            <div className="px-3 py-0.5 text-[10px] font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
              {t('nav.home')}
            </div>
          )}
          <div className="space-y-0.5">
            {navItems.map(({ path, labelKey, icon: Icon }) => {
              const label = t(labelKey);
              const showFailedBadge = path === '/content' && failedCount > 0;
              const buttonContent = (
                <button
                  key={path}
                  type="button"
                  data-testid={`nav-${normalizeTestId(path)}`}
                  aria-current={isActiveRoute(location, path) ? 'page' : undefined}
                  className={`relative w-full flex items-center gap-2 h-7 px-3 text-xs font-medium rounded-md transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none ${
                    isActiveRoute(location, path)
                      ? 'bg-primary/10 text-primary hover:bg-primary/15 shadow-sm' 
                      : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate(path);
                  }}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {!isCollapsed && <span className="truncate flex-1 text-left">{label}</span>}
                  {showFailedBadge && (
                    <span className={`${isCollapsed ? 'absolute -top-1 -right-1' : ''} inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold rounded-full bg-red-500 text-white leading-none`}>
                      {failedCount > 9 ? '9+' : failedCount}
                    </span>
                  )}
                </button>
              );

              return isCollapsed ? (
                <Tooltip key={path} delayDuration={100}>
                  <TooltipTrigger asChild>
                    {buttonContent}
                  </TooltipTrigger>
                  <TooltipContent side="right" className="font-medium">
                    {label}
                  </TooltipContent>
                </Tooltip>
              ) : (
                buttonContent
              );
            })}
          </div>
        </div>

        {/* Admin Section */}
        {userIsAdmin && (
          <div className="space-y-0.5">
            <div className="border-t border-sidebar-border/30 pt-1" />
            {!isCollapsed && (
              <div className="px-3 py-0.5 text-[10px] font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                {t('admin.title')}
              </div>
            )}
            <div className="space-y-0.5">
              {adminItems.map(({ path, labelKey, icon: Icon }) => {
                const label = t(labelKey);
                const buttonContent = (
                  <Button
                    key={path}
                    variant="ghost"
                    size="sm"
                    data-testid={`nav-${normalizeTestId(path)}`}
                    aria-current={isActiveRoute(location, path) ? 'page' : undefined}
                    className={`w-full justify-start gap-2 h-7 px-3 text-xs font-medium transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none ${
                      isActiveRoute(location, path)
                        ? 'bg-primary/10 text-primary hover:bg-primary/15 shadow-sm' 
                        : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigate(path);
                    }}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    {!isCollapsed && <span className="truncate">{label}</span>}
                  </Button>
                );

                return isCollapsed ? (
                  <Tooltip key={path} delayDuration={100}>
                    <TooltipTrigger asChild>
                      {buttonContent}
                    </TooltipTrigger>
                    <TooltipContent side="right" className="font-medium">
                      {label}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  buttonContent
                );
              })}
            </div>
          </div>
        )}

        {/* Plan Badge + Support — прибиты к низу через mt-auto, скроллятся вместе с меню на маленьких экранах */}
        <div className="mt-auto pt-2 space-y-2">
          {/* Plan Badge */}
          {!isCollapsed && (
            <div className="px-0">
              <Link href="/pricing">
                <div
                  data-testid="plan-badge"
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs cursor-pointer transition-colors ${
                    effectivePlan === 'free'
                      ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30'
                      : effectivePlan === 'basic'
                      ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30'
                      : effectivePlan === 'pro'
                      ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30'
                      : 'bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700/40 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <Zap className="h-3 w-3" />
                    <span className="font-semibold">{label}</span>
                  </div>
                  {(effectivePlan === 'free' || effectivePlan === 'basic') && (
                    <span className="text-[10px] opacity-70">Выбрать →</span>
                  )}
                </div>
              </Link>
            </div>
          )}

          {/* Support Section — only for Pro/Enterprise */}
          {limits.support && <div className="border-t border-sidebar-border/30 pt-2">
        {!isCollapsed ? (
          <div className="space-y-1">
            <div className="text-[10px] font-semibold text-sidebar-foreground/50 uppercase tracking-wider px-1">
              {t('support.title')}
            </div>
            <a 
              href="https://t.me/smm_nplanner_sup_bot" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors px-1"
              data-testid="link-support-bot"
            >
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635.099-.002.321.023.465.141.121.099.155.232.171.326.016.094.037.308.021.475z"/>
              </svg>
              <span className="truncate">{t('support.supportBot')}</span>
            </a>
            <a 
              href="https://t.me/smm_nplanner_sup_bot" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors px-1"
              data-testid="link-campaign-bot"
            >
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635.099-.002.321.023.465.141.121.099.155.232.171.326.016.094.037.308.021.475z"/>
              </svg>
              <span className="truncate">{t('support.telegramBot')}</span>
            </a>
            <div className="mt-2 pt-2 border-t border-sidebar-border/30 text-[10px] text-sidebar-foreground/40 px-1 space-y-0.5">
              <p className="font-semibold">ИП Балуров Иван Викторович</p>
              <p>ИНН: 032616690001</p>
              <p>ОРНИП: 323030000027379</p>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <a 
                  href="https://t.me/smm_nplanner_sup_bot" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center justify-center p-2 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors rounded-md hover:bg-sidebar-accent/50"
                  data-testid="link-support-bot"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635.099-.002.321.023.465.141.121.099.155.232.171.326.016.094.037.308.021.475z"/>
                  </svg>
                </a>
              </TooltipTrigger>
              <TooltipContent side="right" className="font-medium">
                {t('support.supportBot')}
              </TooltipContent>
            </Tooltip>
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <a 
                  href="https://t.me/smm_nplanner_sup_bot" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center justify-center p-2 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors rounded-md hover:bg-sidebar-accent/50"
                  data-testid="link-campaign-bot"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635.099-.002.321.023.465.141.121.099.155.232.171.326.016.094.037.308.021.475z"/>
                  </svg>
                </a>
              </TooltipTrigger>
              <TooltipContent side="right" className="font-medium">
                {t('support.telegramBot')}
              </TooltipContent>
            </Tooltip>
          </div>
        )}
        
      </div>}
        </div>{/* /mt-auto */}
      </div>{/* /flex-1 scroll area */}

    </nav>
  );
}

export function Sidebar(props: SidebarProps) {
  return (
    <TooltipProvider>
      {/* Desktop Sidebar */}
      <div 
        className={`hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 transition-all duration-300 ${
          props.isCollapsed ? 'lg:w-16' : 'lg:w-64'
        }`}
      >
        <SidebarContent {...props} />
      </div>

      {/* Mobile Sidebar - без границ */}
      {props.isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => props.onClose(false)}
          />

          {/* Mobile Sidebar Content - использует Tailwind тему */}
          <div className="fixed left-0 top-0 z-50 h-full w-64 lg:hidden bg-sidebar text-sidebar-foreground">
            <SidebarContent {...props} />
          </div>
        </>
      )}
    </TooltipProvider>
  );
}
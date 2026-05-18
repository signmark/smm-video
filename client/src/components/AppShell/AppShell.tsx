import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { AIChat } from "@/components/AIChat";
import { SupportChat } from "@/components/support/SupportChat";
import { ProfileDialog } from "@/components/ProfileDialog";
import { usePlan } from "@/hooks/use-plan";

interface AppShellProps {
  children: React.ReactNode;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  userIsAdmin: boolean;
}

export function AppShell({ children, onNavigate, onLogout, userIsAdmin }: AppShellProps) {
  const [location] = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { limits } = usePlan();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const [isAIChatOpen, setIsAIChatOpen] = useState(false);
  const [isTGBotOpen, setIsTGBotOpen] = useState(false);

  const handleNavigate = (path: string) => {
    setIsSidebarOpen(false);
    onNavigate(path);
  };

  // Нормализуем location (убираем trailing слэши)
  const normalizedLocation = location.replace(/\/+$/, '') || '/';
  
  // Показываем топбар везде для доступа к профилю
  const showTopbar = true;

  return (
    <div className="flex app-shell bg-background min-w-0">
      {/* Sidebar */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={(open) => setIsSidebarOpen(open)}
        onNavigate={handleNavigate}
        onLogout={onLogout}
        userIsAdmin={userIsAdmin}
        location={location}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      {/* Main Content Area */}
      <div 
        className={`flex flex-1 flex-col transition-all duration-300 min-w-0 ${
          isSidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'
        }`}
        onClick={(e) => {
          // Автоматически сворачиваем sidebar при клике в основной области на десктопе
          // Но только если клик не на интерактивных элементах
          const target = e.target as HTMLElement;
          const isInteractive = target.closest('button, input, select, textarea, a, [role="button"], [role="tab"], .clickable');
          
          if (window.innerWidth >= 1024 && !isSidebarCollapsed && !isInteractive) {
            setIsSidebarCollapsed(true);
          }
        }}
      >
        {/* Topbar - только на страницах с кампаниями */}
        {showTopbar && (
          <Topbar
            onMenuClick={() => setIsSidebarOpen(true)}
            onLogout={onLogout}
            onOpenProfile={() => setIsProfileDialogOpen(true)}
            onOpenAIChat={() => setIsAIChatOpen(true)}
            onOpenTGBot={() => setIsTGBotOpen(true)}
            location={location}
          />
        )}

        {/* Мобильная кнопка меню для страниц без топбара */}
        {!showTopbar && (
          <div className="lg:hidden fixed top-4 left-4 z-50">
            <Button
              variant="secondary"
              size="icon"
              className="h-10 w-10 shadow-lg bg-background border"
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 overflow-auto p-3 md:p-6 min-w-0">
          {children}
        </main>
      </div>

      {/* AI Assistant - управляется из Topbar */}
      <AIChat 
        isOpen={isAIChatOpen}
        onOpenChange={setIsAIChatOpen}
        showFloatingButton={false}
      />

      {/* TG Bot - открывается новой ссылкой */}
      {isTGBotOpen && (
        <>
          {(() => {
            const botName = import.meta.env.MODE === 'production' 
              ? 'SMM_Manager_official_Bot' 
              : 'SMM_Manager_NIAP_Bot';
            window.open(`https://t.me/${botName}`, '_blank');
            setIsTGBotOpen(false);
            return null;
          })()}
        </>
      )}

      {/* Support Chat - только для Pro/Enterprise */}
      {limits.support && <SupportChat />}

      {/* Profile Dialog */}
      <ProfileDialog 
        isOpen={isProfileDialogOpen}
        onClose={() => setIsProfileDialogOpen(false)}
      />
    </div>
  );
}
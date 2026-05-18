import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuthStore } from "@/lib/store";
import { useCampaignStore } from "@/lib/campaignStore";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppShell } from "@/components/AppShell";
import { SubscriptionExpiredBanner } from "./SubscriptionExpiredBanner";
import useCampaignOwnershipCheck from "@/hooks/useCampaignOwnershipCheck";
import { useTelegramWebApp } from "@/hooks/useTelegramWebApp";

// Проверка наличия администраторских прав у пользователя по email
// Только в случае, если не работает основная проверка через is_smm_admin
const ADMIN_EMAILS = ["lbrspb@gmail.com", "lbr.spb@gmail.com"]; 

// ID администратора
const ADMIN_USER_ID = '53921f16-f51d-4591-80b9-8caa4fde4d13';

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const [isSmmAdmin, setIsSmmAdmin] = useState<boolean>(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const token = useAuthStore((state) => state.token);
  const userId = useAuthStore((state) => state.userId);
  const setAuth = useAuthStore((state) => state.setAuth);
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const checkIsAdmin = useAuthStore((state) => state.checkIsAdmin);
  const clearSelectedCampaign = useCampaignStore((state) => state.clearSelectedCampaign);
  
  // Telegram WebApp: разворачиваем главное приложение на весь экран
  const { webApp } = useTelegramWebApp();
  
  // Используем хук проверки принадлежности кампании текущему пользователю
  useCampaignOwnershipCheck();
  
  // Разворачиваем главное приложение на весь экран в Telegram
  useEffect(() => {
    if (webApp) {
      webApp.expand();
    }
  }, [webApp]);

  // Используем существующую проверку администратора из AuthStore
  useEffect(() => {
    const checkAdminStatus = async () => {
      if (!token) return;
      
      try {
        // Используем тот же endpoint, что и в store.ts
        const adminStatus = await checkIsAdmin();
        setIsSmmAdmin(adminStatus);
        
        // Получаем email из токена для дополнительной проверки
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          if (payload.email) {
            setUserEmail(payload.email);
          }
        } catch (e) {
          console.error('Ошибка парсинга токена для получения email:', e);
        }
      } catch (error) {
        console.error('Ошибка при проверке администратора:', error);
        setIsSmmAdmin(false);
      }
    };
    
    checkAdminStatus();
  }, [token]); // Убрал checkIsAdmin из зависимостей - функция стабильна

  useEffect(() => {
    // Проверяем, находимся ли мы на странице входа
    const isLoginPage = location === '/auth/login';
    
    // Проверяем наличие токена в URL параметрах (для Telegram WebApp)
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    
    if (urlToken && !token) {
      // Если есть токен в URL и нет токена в store - авторизуемся
      console.log('[Layout] Auto-login from URL token');
      // Получаем userId из токена
      try {
        const payload = JSON.parse(atob(urlToken.split('.')[1]));
        const userId = payload.id || payload.sub;
        if (userId) {
          setAuth(urlToken, userId);
          // Убираем токен из URL для безопасности
          window.history.replaceState({}, document.title, window.location.pathname);
          return;
        }
      } catch (e) {
        console.error('Failed to parse token from URL:', e);
      }
    }
    
    // Пытаемся восстановить сессию из localStorage
    const storedToken = localStorage.getItem('auth_token');
    const storedUserId = localStorage.getItem('user_id');
    
    if (!token && storedToken && storedUserId) {

      setAuth(storedToken, storedUserId);
      return;
    }
    
    // Если нет токена и мы не на странице входа - перенаправляем
    if (!token && !isLoginPage) {
      // Redirecting to login page
      navigate("/auth/login");
    } else if (token) {
      // User authenticated with token
      
      // Если мы авторизованы и находимся на странице входа - перенаправляем на главную
      if (isLoginPage) {
        navigate("/campaigns");
      }
    }
  }, [token, location, navigate, setAuth]);

  const handleLogout = async () => {
    try {

      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
      });

      if (!response.ok) {
        throw new Error('Logout request failed');
      }


    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // Очищаем выбранную кампанию при выходе из системы

      clearSelectedCampaign();
      
      // Очищаем все данные авторизации из localStorage
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('user_id');
      localStorage.removeItem('is_admin');
      // Очищаем ВСЕ кэши admin проверок для всех пользователей
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('admin_check_cache_')) {
          localStorage.removeItem(key);
        }
      });
      
      // Очищаем состояние авторизации в store
      setAuth(null, null);
      

      // Перенаправляем на страницу входа
      navigate("/auth/login");
    }
  };

  const handleNavigation = (path: string) => {
    navigate(path);
  };

  if (!token) return null;

  // Итоговый администраторский статус - сохраняем всю существующую логику
  const userIsAdmin = isSmmAdmin || userId === ADMIN_USER_ID || (userEmail && ADMIN_EMAILS.includes(userEmail));

  // Показываем полный интерфейс везде, включая Telegram Mini App
  return (
    <ThemeProvider>
      <AppShell
        onNavigate={handleNavigation}
        onLogout={handleLogout}
        userIsAdmin={!!userIsAdmin}
      >
        <SubscriptionExpiredBanner />
        {children}
      </AppShell>
    </ThemeProvider>
  );
}

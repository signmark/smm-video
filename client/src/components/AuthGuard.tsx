import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuthStore } from '@/lib/store';
import { refreshAccessToken } from '@/lib/auth';
import { Loader2 } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

export function AuthGuard({ children }: Props) {
  const [, navigate] = useLocation();
  const [location] = useLocation();
  const [isSessionChecked, setIsSessionChecked] = useState(true); // КРИТИЧНО: true - рендерим UI сразу
  const [isRefreshing, setIsRefreshing] = useState(false);
  const token = useAuthStore((state) => state.token);
  const userId = useAuthStore((state) => state.userId);
  const setAuth = useAuthStore((state) => state.setAuth);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  // Эффект при загрузке компонента для проверки авторизации (ТОЛЬКО при первой загрузке!)
  useEffect(() => {
    // Проверяем, есть ли токен в хранилище
    const storedToken = localStorage.getItem('auth_token');
    const storedUserId = localStorage.getItem('user_id');
    const storedRefreshToken = localStorage.getItem('refresh_token');
    
    const isLoginPage = location === '/auth/login' || location === '/login';
    const isRegisterPage = location === '/auth/register';
    const isForgotPasswordPage = location === '/auth/forgot-password';
    const isResetPasswordPage = location.startsWith('/auth/reset-password');
    const isHelpPage = location.startsWith('/help'); // Страницы справки доступны без авторизации
    const isPricingPage = location === '/pricing'; // Страница тарифов доступна без авторизации
    const isPublicPage = isLoginPage || isRegisterPage || isForgotPasswordPage || isResetPasswordPage || isHelpPage || isPricingPage;
    
    // Убрано избыточное логирование

    const validateToken = async (accessToken: string): Promise<boolean> => {
      try {
        // Проверяем действительность токена через API
        const response = await fetch('/api/auth/check', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache'
          }
        });

        if (!response.ok) {
          if (response.status === 401) {
            // Токен истек, очищаем localStorage
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user_id');
            localStorage.removeItem('refresh_token');
          }
          return false;
        }

        const data = await response.json();
        // Token validation result processed
        
        return data && data.valid === true;
      } catch (error) {
        console.error('AuthGuard: Error validating token:', error);
        return false;
      }
    };

    const checkSession = async () => {
      // UI уже отображается (isSessionChecked = true), проверка токена в фоне
      // Не блокируем рендеринг - React Query сам обработает 401 и обновит токен
      
      // КРИТИЧНО: Проверяем токен из URL (Telegram WebApp) ПЕРЕД всеми проверками
      // НЕ обрабатываем ?token= на публичных страницах (reset-password передаёт HMAC-токен, не JWT)
      const urlParams = new URLSearchParams(window.location.search);
      const urlToken = isPublicPage ? null : urlParams.get('token');
      
      if (urlToken) {
        try {
          // Валидируем токен из URL
          const isValid = await validateToken(urlToken);
          
          if (isValid) {
            // Сохраняем токен в localStorage
            localStorage.setItem('auth_token', urlToken);
            
            // Получаем userId из токена (JWT payload)
            try {
              const payload = JSON.parse(atob(urlToken.split('.')[1]));
              const urlUserId = payload.id;
              
              if (urlUserId) {
                localStorage.setItem('user_id', urlUserId);
                setAuth(urlToken, urlUserId);
                
                // КРИТИЧНО: Получаем refresh_token с сервера для Telegram WebApp
                try {
                  const refreshTokenResponse = await fetch('/api/auth/get-refresh-token', {
                    method: 'GET',
                    headers: {
                      'Authorization': `Bearer ${urlToken}`,
                      'Content-Type': 'application/json'
                    }
                  });
                  
                  if (refreshTokenResponse.ok) {
                    const refreshData = await refreshTokenResponse.json();
                    if (refreshData.refresh_token) {
                      localStorage.setItem('refresh_token', refreshData.refresh_token);
                      console.log('AuthGuard: Refresh token obtained for WebApp session');
                    }
                  } else {
                    console.warn('AuthGuard: Failed to obtain refresh token:', refreshTokenResponse.status);
                  }
                } catch (refreshError) {
                  console.error('AuthGuard: Error getting refresh token:', refreshError);
                  // Продолжаем работу даже если не получили refresh_token
                }
                
                // Настраиваем автоматическое обновление токена
                const { setupTokenRefresh } = await import('@/lib/auth');
                setupTokenRefresh(900); // 15 минут
              }
            } catch (e) {
              console.error('AuthGuard: Failed to parse userId from token:', e);
            }
            
            // Удаляем токен из URL для безопасности
            window.history.replaceState({}, document.title, window.location.pathname);
            
            return;
          } else {
            console.warn('AuthGuard: Token from URL is invalid');
          }
        } catch (e) {
          console.error('AuthGuard: Error processing URL token:', e);
        }
      }
      
      // КРИТИЧНО: Проверяем наличие активной сессии в DirectusAuthManager (единая авторизация веб+бот)
      // Если залогинились в Telegram боте - сессия автоматически подхватится здесь
      if (storedToken && storedUserId) {
        try {
          const activeSessionResponse = await fetch('/api/auth/get-active-session', {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${storedToken}`,
              'Content-Type': 'application/json'
            }
          });
          
          if (activeSessionResponse.ok) {
            const sessionData = await activeSessionResponse.json();
            
            if (sessionData.hasActiveSession && sessionData.token) {
              // Обновляем localStorage свежими токенами из DirectusAuthManager
              localStorage.setItem('auth_token', sessionData.token);
              localStorage.setItem('user_id', storedUserId);
              
              if (sessionData.refresh_token) {
                localStorage.setItem('refresh_token', sessionData.refresh_token);
              }
              
              // Обновляем store
              setAuth(sessionData.token, storedUserId);
              
              // Настраиваем автоматическое обновление токена
              const { setupTokenRefresh } = await import('@/lib/auth');
              setupTokenRefresh(900); // 15 минут
              
              console.log('AuthGuard: Active session synced from DirectusAuthManager');
              setIsSessionChecked(true);
              return;
            }
          }
        } catch (error) {
          console.warn('AuthGuard: Could not check active session:', error);
          // Продолжаем обычную проверку
        }
      }
      
      // Если есть токен в store и userId, проверяем его действительность
      if (token && userId) {
        // Validating token from store
        const isValid = await validateToken(token);
        
        if (isValid) {
          // Token validation successful
          setIsSessionChecked(true);
          return;
        } else {
          // Token from store is invalid, attempting to restore from localStorage
          // Токен недействителен, пробуем взять из localStorage
        }
      }
      
      // Если есть сохраненный токен, проверяем его
      if (storedToken && storedUserId) {
        // Validating token from localStorage
        const isValid = await validateToken(storedToken);
        
        if (isValid) {
          // Stored token is valid, restoring session
          setAuth(storedToken, storedUserId);
          setIsSessionChecked(true);
          
          // ВАЖНО: Восстанавливаем автоматическое обновление токена при загрузке страницы
          // Токен Directus живет 15 минут (900 секунд)
          const { setupTokenRefresh } = await import('@/lib/auth');
          setupTokenRefresh(900); // 900 секунд = 15 минут
          
          return;
        } else {
          // Stored token is invalid, attempting to refresh
          // Сохраненный токен недействителен, пробуем обновить
        }
      }
      
      // Пробуем обновить токен
      if (storedRefreshToken) {
        try {
          // Attempting to refresh token
          setIsRefreshing(true);
          await refreshAccessToken();
          
          // После обновления проверяем, что новый токен появился в localStorage
          const refreshedToken = localStorage.getItem('auth_token');
          const refreshedUserId = localStorage.getItem('user_id');
          
          if (refreshedToken && refreshedUserId) {
            setAuth(refreshedToken, refreshedUserId);
            setIsRefreshing(false);
            setIsSessionChecked(true);
            
            // ВАЖНО: Настраиваем автоматическое обновление токена после refresh
            const { setupTokenRefresh } = await import('@/lib/auth');
            setupTokenRefresh(900); // 900 секунд = 15 минут
            
            return;
          } else {
            throw new Error('Failed to obtain new token after refresh');
          }
        } catch (error) {
          console.error('AuthGuard: Token refresh failed:', error);
          setIsRefreshing(false);
          
          // Очищаем любые устаревшие токены
          localStorage.removeItem('auth_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('user_id');
          localStorage.removeItem('is_admin'); // Важно очистить и статус админа
          clearAuth();
          
          // Если обновление не удалось, перенаправляем на страницу входа (кроме публичных страниц)
          if (!isPublicPage) {
            navigate('/auth/login');
          }
          setIsSessionChecked(true);
          return;
        }
      }
      
      // Если нет ни токена, ни возможности обновить, перенаправляем на логин (кроме публичных страниц)
      // No valid authentication found
      if (!isPublicPage) {
        navigate('/auth/login');
      }
      
      setIsSessionChecked(true);
    };

    checkSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Проверяем сессию ТОЛЬКО при монтировании компонента, не при каждой навигации!

  // Показываем загрузку пока не проверили сессию
  if (!isSessionChecked) {
    return (
      <div className="flex h-screen items-center justify-center flex-col">
        <Loader2 className="w-8 h-8 animate-spin mb-4" />
        <div className="text-lg font-medium">
          {isRefreshing ? 'Обновление сессии...' : 'Проверка сессии...'}
        </div>
      </div>
    );
  }

  // Если проверка прошла, возвращаем дочерние компоненты
  return <>{children}</>;
}
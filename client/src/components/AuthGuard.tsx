import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/lib/store';
import { refreshAuthSession } from '@/lib/refreshAuth';
import { decodeJwtPayload } from '@/lib/jwt';
import { isPublicRoute } from '@/lib/public-routes';
import { queryClient } from '@/lib/queryClient';
import { subscribeToSessionEvents } from '@/lib/sessionCoordinator';
import { logout as performLogout } from '@/lib/auth';

interface Props {
  children: React.ReactNode;
}

type ValidationResult = 'valid' | 'invalid' | 'unavailable';

async function validateToken(accessToken: string): Promise<ValidationResult> {
  try {
    const response = await fetch('/api/auth/check', {
      headers: { Authorization: `Bearer ${accessToken}`, 'Cache-Control': 'no-cache' },
      cache: 'no-store',
    });
    if (response.ok) return 'valid';
    if (response.status === 401) return 'invalid';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export function AuthGuard({ children }: Props) {
  const { t } = useTranslation();
  const [location, navigate] = useLocation();
  const [isSessionChecked, setIsSessionChecked] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const setAuth = useAuthStore((state) => state.setAuth);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  // Explicit logout from the recovery screen. Delegates to the single
  // shared logout implementation in @/lib/auth so the refresh interval,
  // server-side session, queryClient cache and localStorage are all
  // cleared in one place — no second hand-rolled flow.
  const handleExplicitLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await performLogout();
    } catch (err) {
      console.warn('[AuthGuard] explicit logout failed', err);
    } finally {
      clearAuth();
      queryClient.clear();
      // Use wouter navigation when the AuthGuard is mounted, fall back
      // to a hard redirect for the rare case wouter is not yet ready.
      if (!isPublicRoute(location)) {
        navigate('/auth/login');
      } else {
        window.location.href = '/auth/login';
      }
      setIsLoggingOut(false);
    }
  };

  useEffect(() => {
    const unsubscribe = subscribeToSessionEvents((status) => {
      if (status === 'unavailable') {
        setSessionError('Сервис авторизации временно недоступен. Данные входа сохранены.');
        setIsSessionChecked(true);
      } else if (status === 'invalid') {
        queryClient.clear();
        navigate('/auth/login');
      } else {
        if (status === 'refreshed') queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
        setRetryNonce((value) => value + 1);
      }
    });

    const onStorage = (event: StorageEvent) => {
      if (!['auth_token', 'refresh_token', 'auth_session_id'].includes(event.key || '')) return;
      const currentToken = localStorage.getItem('auth_token');
      const currentUserId = currentToken ? decodeJwtPayload(currentToken)?.id : null;
      if (currentToken && currentUserId) {
        useAuthStore.getState().syncAuth(currentToken, currentUserId);
        setRetryNonce((value) => value + 1);
      } else if (!localStorage.getItem('refresh_token')) {
        clearAuth();
        queryClient.clear();
        navigate('/auth/login');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', onStorage);
    };
  }, [clearAuth, navigate]);

  useEffect(() => {
    let cancelled = false;

    const finish = () => {
      if (!cancelled) {
        setIsRefreshing(false);
        setIsSessionChecked(true);
      }
    };

    const expireSession = () => {
      clearAuth();
      queryClient.clear();
      if (!isPublicRoute(location)) navigate('/auth/login');
    };

    const storeSession = async (accessToken: string) => {
      const userId = decodeJwtPayload(accessToken)?.id;
      if (!userId) throw new Error('AUTH_SESSION_INVALID');
      setAuth(accessToken, userId);
      const { setupTokenRefreshFromToken, startRefreshInterval } = await import('@/lib/auth');
      setupTokenRefreshFromToken(accessToken);
      startRefreshInterval();
    };

    const checkSession = async () => {
      setIsSessionChecked(false);
      setSessionError(null);

      if (isPublicRoute(location)) {
        finish();
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get('token');
      if (urlToken) {
        const validation = await validateToken(urlToken);
        if (validation === 'unavailable') {
          setSessionError('Сервис авторизации временно недоступен. Данные входа сохранены.');
          finish();
          return;
        }
        if (validation === 'valid') {
          await storeSession(urlToken);
          const refreshResponse = await fetch('/api/auth/get-refresh-token', {
            headers: { Authorization: `Bearer ${urlToken}` },
            cache: 'no-store',
          }).catch(() => null);
          if (refreshResponse?.ok) {
            const data = await refreshResponse.json();
            if (data?.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
          }
          window.history.replaceState({}, document.title, window.location.pathname);
          finish();
          return;
        }
      }

      const storedToken = localStorage.getItem('auth_token');
      if (storedToken) {
        const validation = await validateToken(storedToken);
        if (validation === 'valid') {
          await storeSession(storedToken);
          finish();
          return;
        }
        if (validation === 'unavailable') {
          setSessionError('Не удалось проверить сессию. Проверьте соединение и повторите.');
          finish();
          return;
        }
      }

      if (localStorage.getItem('refresh_token')) {
        setIsRefreshing(true);
        const result = await refreshAuthSession();
        if (result === 'refreshed' || result === 'superseded') {
          const refreshedToken = localStorage.getItem('auth_token');
          if (refreshedToken) {
            await storeSession(refreshedToken);
            finish();
            return;
          }
        }
        if (result === 'unavailable') {
          setSessionError('Не удалось обновить сессию. Данные входа сохранены — повторите попытку.');
          finish();
          return;
        }
      }

      expireSession();
      finish();
    };

    checkSession().catch(() => {
      if (!cancelled) {
        setSessionError('Не удалось проверить сессию. Повторите попытку.');
        finish();
      }
    });
    return () => { cancelled = true; };
  }, [location, retryNonce, clearAuth, navigate, setAuth]);

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

  if (sessionError && !isPublicRoute(location)) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-lg border bg-background p-6 text-center shadow-sm" data-testid="authguard-recovery">
          <h1 className="mb-2 text-lg font-semibold">Проблема с авторизацией</h1>
          <p className="mb-4 text-sm text-muted-foreground">{sessionError}</p>
          <p className="mb-4 text-xs text-muted-foreground">
            {t('auth.recovery.explanation')}
          </p>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-center sm:gap-3 gap-2">
            <button
              type="button"
              className="rounded-md border border-border bg-background px-4 py-2 text-foreground hover:bg-muted disabled:opacity-60"
              onClick={handleExplicitLogout}
              disabled={isLoggingOut}
              data-testid="authguard-logout"
            >
              {isLoggingOut ? t('auth.recovery.loggingOut') : t('auth.recovery.logoutButton')}
            </button>
            <button
              type="button"
              className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
              onClick={() => setRetryNonce((value) => value + 1)}
              disabled={isLoggingOut}
              data-testid="authguard-retry"
            >
              {t('ui.retry')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

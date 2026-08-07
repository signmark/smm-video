import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/store";
import { handleError } from "@/utils/error-handler";
import { redirectToLogin } from "@/lib/public-routes";
import { decodeJwtPayload } from './jwt';
import { getSessionSnapshot, isSameSession, type SessionSnapshot } from './sessionCoordinator';



function forceLogout() {
  useAuthStore.getState().logout();
  queryClient.clear();
  redirectToLogin();
}

function sessionChangedError() {
  const error = new Error('AUTH_SESSION_CHANGED');
  (error as any).sessionChanged = true;
  return error;
}

async function tryRefreshSession(expectedSession?: SessionSnapshot) {
  if (expectedSession && !isSameSession(expectedSession)) throw sessionChangedError();
  const { refreshAuthSession } = await import('@/lib/refreshAuth');
  const result = await refreshAuthSession();

  if (result === 'refreshed' || result === 'superseded') {
    const error = new Error('TOKEN_REFRESHED');
    (error as any).tokenRefreshed = true;
    throw error;
  }

  if (result === 'invalid') {
    forceLogout();
    const error = new Error('AUTH_FAILED');
    (error as any).authFailed = true;
    throw error;
  }

  if (result === 'session_changed') throw sessionChangedError();
  const error = new Error('Не удалось проверить или обновить сессию. Проверьте соединение и повторите запрос.');
  (error as any).authUnavailable = true;
  throw error;
}

async function throwIfResNotOk(res: Response, allowAuthRefresh = true, expectedSession?: SessionSnapshot) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;

    let errorData: any = null;
    try {
      errorData = JSON.parse(text);
    } catch {
      // Ответ не JSON — ниже будет использован исходный текст.
    }

    const isAuthFailure =
      res.status === 401 ||
      (res.status === 403 && errorData?.code === 'AUTH_SESSION_INVALID') ||
      (res.status === 500 && errorData?.details?.includes?.('TOKEN_EXPIRED'));

    if (isAuthFailure) {
      if (expectedSession && !isSameSession(expectedSession)) throw sessionChangedError();
      if (allowAuthRefresh) {
        await tryRefreshSession(expectedSession);
      }

      forceLogout();
      const error = new Error('AUTH_FAILED');
      (error as any).authFailed = true;
      throw error;
    }

    let message = text;
    if (errorData) {
      message = errorData.error || errorData.message || errorData.detail || text;
    }

    const error = new Error(message);
    (error as any).status = res.status;
    (error as any).response = { status: res.status, statusText: res.statusText };
    (error as any).config = { url: res.url };
    throw error;
  }
}

interface ApiRequestConfig {
  method?: string;
  data?: unknown;
  params?: Record<string, string>;
  headers?: Record<string, string>;
}

/**
 * Ответ на 204 No Content.
 *
 * Тела у такого ответа нет, а вызывающий ждёт объект. Приведение к `T` здесь —
 * единственное честное место: функция физически не может знать тип того, чего
 * сервер не прислал. Локальный каст вместо `any` на всей сигнатуре, чтобы
 * остальные вызовы типизировались нормально.
 */
const EMPTY_OK = { success: true } as const;

export async function apiRequest<T = any>(
  url: string,
  config: ApiRequestConfig = {}
): Promise<T> {
  const { method = 'GET', data, params } = config;
  const operationSession = getSessionSnapshot();
  
  // Вспомогательная функция для выполнения запроса
  const makeRequest = async (): Promise<Response> => {
    if (!isSameSession(operationSession)) throw sessionChangedError();
    const token = useAuthStore.getState().token;
    const userId = useAuthStore.getState().userId;

    // Проверка истекших токенов - автоматически обновляем если скоро истекут
    // КРИТИЧНО: Буфер 10 минут (600 секунд) чтобы избежать race condition с серверной проверкой
    if (token) {
      try {
        const payload = decodeJwtPayload(token);
        if (!payload) throw new Error('Invalid JWT');
        const now = Math.floor(Date.now() / 1000);
        // Если токен истекает в течение 10 минут, обновляем его превентивно
        // Увеличено с 5 до 10 минут для синхронизации с сервером (который проверяет за 7 минут)
        if (payload.exp && payload.exp < (now + 600)) {
          console.log('[queryClient] Токен скоро истечет, превентивное обновление...');
          const { refreshAuthSession } = await import('@/lib/refreshAuth');
          const refreshResult = await refreshAuthSession();
          if (refreshResult === 'invalid') {
            forceLogout();
            const error = new Error('AUTH_FAILED');
            (error as any).authFailed = true;
            throw error;
          }
          if (refreshResult === 'unavailable' && payload.exp <= now) {
            const error = new Error('Не удалось обновить истекшую сессию. Проверьте соединение и повторите вход.');
            (error as any).authUnavailable = true;
            throw error;
          }
        }
      } catch (e: any) {
        if (e?.authFailed || e?.authUnavailable) throw e;
        // Если токен поврежден, просто продолжаем - сервер вернет 401
        console.warn('[queryClient] Не удалось проверить срок действия токена');
      }
    }

    const queryString = params ? '?' + new URLSearchParams(params).toString() : '';

    const headers: Record<string, string> = {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...(useAuthStore.getState().token ? { "Authorization": `Bearer ${useAuthStore.getState().token}` } : {}),
      "x-user-id": useAuthStore.getState().userId || ''
    };

    const requestToken = useAuthStore.getState().token;
    const response = await fetch(url + queryString, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
      cache: method === 'GET' ? 'no-store' : 'default',
    });
    if (!isSameSession(operationSession)) throw sessionChangedError();
    return Object.assign(response, { __requestToken: requestToken });
  };

  try {
    const res = await makeRequest();
    if (res.status === 401 && (res as any).__requestToken !== useAuthStore.getState().token && isSameSession(operationSession)) {
      const retried = await makeRequest();
      await throwIfResNotOk(retried, false, operationSession);
      return retried.status === 204 ? (EMPTY_OK as T) : retried.json();
    }
    await throwIfResNotOk(res, true, operationSession);
    
    // Если статус 204 No Content, не пытаемся распарсить JSON
    if (res.status === 204) {
      return EMPTY_OK as T; // 204: тела нет, см. EMPTY_OK
    }
    
    return res.json();
  } catch (error: any) {
    // Если токен был обновлен, повторяем запрос
    if (error.tokenRefreshed && isSameSession(operationSession)) {
      console.log('Токен обновлен, повтор запроса...');
      const res = await makeRequest();
      await throwIfResNotOk(res, false, operationSession);
      
      if (res.status === 204) {
        return EMPTY_OK as T; // 204: тела нет, см. EMPTY_OK
      }
      
      return res.json();
    }
    throw error;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const operationSession = getSessionSnapshot();
    // Функция выполнения запроса
    const makeRequest = async (): Promise<Response> => {
      if (!isSameSession(operationSession)) throw sessionChangedError();
      const token = useAuthStore.getState().token;
      const userId = useAuthStore.getState().userId;

      const response = await fetch(queryKey[0] as string, {
        credentials: "include",
        headers: {
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
          "x-user-id": userId || ''
        }
      });
      if (!isSameSession(operationSession)) throw sessionChangedError();
      return response;
    };

    try {
      const res = await makeRequest();

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res, true, operationSession);
      return await res.json();
    } catch (error: any) {
      // КРИТИЧНО: Если токен обновился, повторяем запрос (как в apiRequest)
      if (error.tokenRefreshed && isSameSession(operationSession)) {
        console.log('[queryClient] Токен обновлен, повтор запроса...');
        const res = await makeRequest();
        
        if (unauthorizedBehavior === "returnNull" && res.status === 401) {
          return null;
        }
        
        await throwIfResNotOk(res, false, operationSession);
        return await res.json();
      }
      throw error;
    }
  };

/**
 * AI-80: Мгновенный отклик UI через кэширование данных.
 *
 * Данные показываются из кэша мгновенно при переходах между страницами.
 * Фоновое обновление происходит если данные старше 5 минут или явно
 * инвалидированы мутацией. Это даёт субъективную мгновенность без риска
 * показывать вечно устаревшие данные при забытой инвалидации.
 *
 * Параметры заданы в defaultOptions ниже.
 */
// Глобальный обработчик ошибок для QueryClient
const globalErrorHandler = (error: any) => {
  const userError = handleError(error);
  if (userError.showToUser) {
    // В любом случае обрабатываем ошибку через наш logger
    // В production будут показаны только критические
    console.error(`Ошибка: ${userError.message}${userError.action ? ` ${userError.action}` : ''}`);
  }
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      // AI-80: Мгновенный отклик UI.
      // staleTime 5 минут — данные из кэша показываются мгновенно при
      //   переходах и возврате фокуса (refetchOnMount/WindowFocus срабатывают
      //   только на stale-данных, на свежих они no-op без сети).
      //   Если инвалидацию где-то забыли — кэш самоисцелится за 5 минут.
      //   (Infinity было бы ошибкой: забытая инвалидация = вечно старые данные.)
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      staleTime: 5 * 60 * 1000, // 5 минут
      gcTime: 1000 * 60 * 5,
      retry: false,
      structuralSharing: true,
    },
    mutations: {
      retry: false,
    },
  },
});

// Подписываемся на глобальные ошибки QueryClient
queryClient.getQueryCache().config.onError = globalErrorHandler;
queryClient.getMutationCache().config.onError = globalErrorHandler;

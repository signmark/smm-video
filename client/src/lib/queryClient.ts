import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/store";
import { handleError } from "@/utils/error-handler";
import { redirectToLogin } from "@/lib/public-routes";



async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    
    // При 401 пытаемся обновить токен автоматически
    if (res.status === 401) {
      // Пробуем обновить токен в фоне
      const { refreshAuthToken } = await import('@/lib/refreshAuth');
      const refreshSuccess = await refreshAuthToken();
      
      if (refreshSuccess) {
        // Токен успешно обновлен - выбрасываем ошибку с флагом для повтора запроса
        const error = new Error('TOKEN_REFRESHED');
        (error as any).tokenRefreshed = true;
        throw error;
      } else {
        // Не удалось обновить токен - выход из системы
        useAuthStore.getState().logout();
        redirectToLogin();
        // ВАЖНО: throw вместо return, чтобы caller не пытался прочитать тело ответа
        // (тело уже прочитано через res.text() выше)
        const error = new Error('AUTH_FAILED');
        (error as any).authFailed = true;
        throw error;
      }
    }
    
    // Проверяем на истекший токен в ответе сервера
    if (res.status === 500) {
      try {
        const errorData = JSON.parse(text);
        if (errorData.details && errorData.details.includes('TOKEN_EXPIRED')) {
          // Пытаемся обновить токен
          const { refreshAuthToken } = await import('@/lib/refreshAuth');
          const refreshSuccess = await refreshAuthToken();
          
          if (refreshSuccess) {
            const error = new Error('TOKEN_REFRESHED');
            (error as any).tokenRefreshed = true;
            throw error;
          } else {
            useAuthStore.getState().logout();
            redirectToLogin();
            return;
          }
        }
      } catch (parseError) {
        // Если не удалось распарсить JSON, продолжаем обычную обработку ошибки
      }
    }
    
    const error = new Error(`${res.status}: ${text}`);
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

export async function apiRequest(
  url: string,
  config: ApiRequestConfig = {}
): Promise<any> {
  const { method = 'GET', data, params } = config;
  
  // Вспомогательная функция для выполнения запроса
  const makeRequest = async (): Promise<Response> => {
    const token = useAuthStore.getState().token;
    const userId = useAuthStore.getState().userId;

    // Проверка истекших токенов - автоматически обновляем если скоро истекут
    // КРИТИЧНО: Буфер 10 минут (600 секунд) чтобы избежать race condition с серверной проверкой
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const now = Math.floor(Date.now() / 1000);
        // Если токен истекает в течение 10 минут, обновляем его превентивно
        // Увеличено с 5 до 10 минут для синхронизации с сервером (который проверяет за 7 минут)
        if (payload.exp && payload.exp < (now + 600)) {
          console.log('[queryClient] Токен скоро истечет, превентивное обновление...');
          const { refreshAuthToken } = await import('@/lib/refreshAuth');
          await refreshAuthToken();
        }
      } catch (e) {
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

    return await fetch(url + queryString, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
      cache: method === 'GET' ? 'no-store' : 'default',
    });
  };

  try {
    const res = await makeRequest();
    await throwIfResNotOk(res);
    
    // Если статус 204 No Content, не пытаемся распарсить JSON
    if (res.status === 204) {
      return { success: true };
    }
    
    return res.json();
  } catch (error: any) {
    // Если токен был обновлен, повторяем запрос
    if (error.tokenRefreshed) {
      console.log('Токен обновлен, повтор запроса...');
      const res = await makeRequest();
      await throwIfResNotOk(res);
      
      if (res.status === 204) {
        return { success: true };
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
    // Функция выполнения запроса
    const makeRequest = async (): Promise<Response> => {
      const token = useAuthStore.getState().token;
      const userId = useAuthStore.getState().userId;

      return await fetch(queryKey[0] as string, {
        credentials: "include",
        headers: {
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
          "x-user-id": userId || ''
        }
      });
    };

    try {
      const res = await makeRequest();

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      return await res.json();
    } catch (error: any) {
      // КРИТИЧНО: Если токен обновился, повторяем запрос (как в apiRequest)
      if (error.tokenRefreshed) {
        console.log('[queryClient] Токен обновлен, повтор запроса...');
        const res = await makeRequest();
        
        if (unauthorizedBehavior === "returnNull" && res.status === 401) {
          return null;
        }
        
        await throwIfResNotOk(res);
        return await res.json();
      }
      throw error;
    }
  };

/**
 * Конфигурация React Query для кеширования данных между страницами
 * - staleTime: Infinity - данные никогда не считаются устаревшими 
 * - cacheTime: 1000 * 60 * 30 - кеш живет 30 минут
 * - structuralSharing: true - автоматически сравнивает структуру данных
 * - refetchOnMount: false - не запрашивать данные при монтировании компонента
 * - refetchOnWindowFocus: false - не запрашивать данные при фокусе окна
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
      refetchOnWindowFocus: true,
      staleTime: 30 * 1000,
      gcTime: 1000 * 60 * 5,
      retry: false,
      refetchOnMount: true,
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
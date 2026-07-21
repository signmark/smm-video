import { createContext, ReactNode, useContext, useEffect } from "react";
import {
  useQuery,
  useMutation,
  UseMutationResult,
} from "@tanstack/react-query";
import { getQueryFn, apiRequest, queryClient } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { setupTokenRefresh, setupTokenRefreshFromToken, refreshAccessToken, startRefreshInterval, stopRefreshInterval } from "@/lib/auth";
import { useAuthStore } from "@/lib/store";

const AUTH_STORAGE_KEYS = [
  'auth_token', 'refresh_token', 'user_id', 'is_admin',
  'selected_campaign_id', 'selected_campaign_name',
];

const clearAuthStorage = () => {
  AUTH_STORAGE_KEYS.forEach(key => localStorage.removeItem(key));
  sessionStorage.clear();
};

type LoginResponse = {
  access_token: string;
  refresh_token: string;
  expires: number;
  user: {
    id: string;
    email: string;
  };
};

type AuthContextType = {
  user: any | null;
  isLoading: boolean;
  error: Error | null;
  loginMutation: UseMutationResult<LoginResponse, Error, LoginData>;
  logoutMutation: UseMutationResult<void, Error, void>;
  registerMutation: UseMutationResult<LoginResponse, Error, RegisterData>;
};

type LoginData = {
  email: string;
  password: string;
};

type RegisterData = {
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
};

export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  // При загрузке приложения — обновляем токен и запускаем резервный интервал
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const refreshToken = localStorage.getItem('refresh_token');

    if (token && refreshToken) {
      setupTokenRefreshFromToken(token);
      startRefreshInterval();
    } else if (refreshToken) {
      refreshAccessToken().catch(console.error);
    }

    return () => {
      // не останавливаем интервал при размонтировании — он должен жить всё время
    };
  }, []);

  const {
    data: user,
    error,
    isLoading,
  } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: isAuthenticated,
  });

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginData) => {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Ошибка входа');
      }

      const data = await response.json();
      if (!data?.token || !data?.refresh_token || !data?.user?.id) {
        throw new Error('Сервер вернул неполную сессию');
      }
      return { access_token: data.token, refresh_token: data.refresh_token, expires: data.expires || 86400, user: data.user };
    },
    onSuccess: (data: LoginResponse) => {
      try {
        clearAuthStorage();
      } catch (e) {
        console.warn('Ошибка при очистке хранилищ:', e);
      }
      
      queryClient.clear();
      
      localStorage.setItem('auth_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      localStorage.setItem('user_id', data.user.id);
      useAuthStore.getState().setAuth(data.access_token, data.user.id);
      // expires от сервера — секунды (86400), конвертируем в мс
      const expiresInMs = data.expires * 1000;
      setupTokenRefresh(expiresInMs);
      startRefreshInterval();
      
      queryClient.setQueryData(["/api/auth/me"], data.user);
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка входа",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: RegisterData) => {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Ошибка регистрации');
      }

      const res = await response.json();
      if (!res?.token || !res?.refresh_token || !res?.user?.id) {
        throw new Error('Сервер вернул неполную сессию');
      }
      return { access_token: res.token, refresh_token: res.refresh_token, expires: res.expires || 86400, user: res.user };
    },
    onSuccess: (data: LoginResponse) => {
      // Полностью очищаем все хранилища перед установкой новых данных
      try {
        clearAuthStorage();
      } catch (e) {
        console.warn('Ошибка при очистке хранилищ:', e);
      }
      
      queryClient.clear();
      
      localStorage.setItem('auth_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      localStorage.setItem('user_id', data.user.id);
      const expiresInMsReg = data.expires * 1000;
      setupTokenRefresh(expiresInMsReg);
      startRefreshInterval();
      
      queryClient.setQueryData(["/api/auth/me"], data.user);
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка регистрации",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      stopRefreshInterval();

      const token = localStorage.getItem('auth_token');
      try {
        if (token) {
          await fetch('/api/auth/logout', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
          });
        }
      } finally {
        try {
          clearAuthStorage();
        } catch (e) {
          console.warn('Ошибка при очистке хранилищ:', e);
        }
        queryClient.setQueryData(["/api/auth/me"], null);
        queryClient.clear();
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка выхода",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        error,
        loginMutation,
        logoutMutation,
        registerMutation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

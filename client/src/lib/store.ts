import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
// Импортируем хранилище кампании из отдельного файла
import { useCampaignStore } from './campaignStore';
import { decodeJwtPayload } from './jwt';

interface AuthState {
  token: string | null;
  userId: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  setAuth: (token: string | null, userId: string | null) => void;
  clearAuth: () => void;
  getAuthToken: () => string | null;
  setIsAdmin: (isAdmin: boolean) => void;
  checkIsAdmin: () => Promise<boolean>;
  setToken: (token: string) => void;
  logout: () => void;
}

import { api } from './api';

// Функция для проверки истекшего токена
const checkTokenExpiration = (token: string | null): boolean => {
  if (!token) return false;
  try {
    const payload = decodeJwtPayload(token);
    const now = Math.floor(Date.now() / 1000);
    return Boolean(payload?.exp && payload.exp > now);
  } catch {
    return false;
  }
};

// Проверяем токен при загрузке
const storedToken = localStorage.getItem('auth_token');
const isTokenValid = checkTokenExpiration(storedToken);

// An expired access token is recoverable while the refresh token remains valid.
if (storedToken && !isTokenValid) {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('is_admin');
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: isTokenValid ? storedToken : null,
      userId: localStorage.getItem('user_id'),
      isAuthenticated: isTokenValid && !!(localStorage.getItem('auth_token') && localStorage.getItem('user_id')),
      isAdmin: isTokenValid ? localStorage.getItem('is_admin') === 'true' : false,
      setAuth: (token, userId) => {
        // Сохраняем токен и userId в localStorage для прямого доступа
        if (token) {
          localStorage.setItem('auth_token', token);
        } else {
          localStorage.removeItem('auth_token');
        }
        
        if (userId) {
          localStorage.setItem('user_id', userId);
        } else {
          localStorage.removeItem('user_id');
        }

        set({ 
          token, 
          userId, 
          isAuthenticated: !!token && !!userId,
        });
      },
      clearAuth: () => {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_id');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('is_admin'); // Очищаем статус админа при выходе
        
        // Сбрасываем выбранную кампанию при выходе пользователя из системы
        const clearCampaign = useCampaignStore.getState().clearSelectedCampaign;
        if (clearCampaign) {
          clearCampaign();
        }
        
        set({ 
          token: null, 
          userId: null, 
          isAuthenticated: false,
          isAdmin: false, // Сбрасываем статус администратора
        });
      },
      getAuthToken: () => {
        // Получить действующий токен авторизации
        const state = get();
        const token = state.token || localStorage.getItem('auth_token');
        return token;
      },

      setIsAdmin: (isAdmin) => {
        // Сохраняем статус администратора
        if (isAdmin) {
          localStorage.setItem('is_admin', 'true');
        } else {
          localStorage.removeItem('is_admin');
        }
        set({ isAdmin });
      },

      checkIsAdmin: async () => {
        try {
          // Получаем текущий токен и userId
          const token = get().getAuthToken();
          const userId = get().userId;
          if (!token || !userId) {
            get().setIsAdmin(false);
            return false;
          }

          // КЭШ: проверяем сохраненный статус админа (действует 5 минут) С ПРИВЯЗКОЙ К ПОЛЬЗОВАТЕЛЮ
          const cacheKey = `admin_check_cache_${userId}`;
          const cachedAdminCheck = localStorage.getItem(cacheKey);
          if (cachedAdminCheck) {
            try {
              const cache = JSON.parse(cachedAdminCheck);
              const now = Date.now();
              // Проверяем что кэш для этого пользователя и не истёк
              if (cache.userId === userId && cache.timestamp && (now - cache.timestamp) < 300000) {
                get().setIsAdmin(cache.isAdmin);
                return cache.isAdmin;
              }
            } catch (e) {
              // Игнорируем ошибки парсинга кэша
              localStorage.removeItem(cacheKey);
            }
          }

          // ПРИНУДИТЕЛЬНАЯ проверка токена перед запросом
          try {
            const payload = decodeJwtPayload(token);
            const now = Math.floor(Date.now() / 1000);
            if (payload?.exp && payload.exp < (now + 30)) {
              ['auth_token','refresh_token','user_id','is_admin','selected_campaign_id','selected_campaign_name'].forEach(k => localStorage.removeItem(k));
              sessionStorage.clear();
              get().logout();
              return false;
            }
          } catch (e) {
            ['auth_token','refresh_token','user_id','is_admin','selected_campaign_id','selected_campaign_name'].forEach(k => localStorage.removeItem(k));
            sessionStorage.clear();
            get().logout();
            return false;
          }
          
          const response = await fetch('/api/auth/is-admin', {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            cache: 'no-cache'
          });
          
          const data = await response.json();
          
          if (data && data.success && data.isAdmin === true) {
            get().setIsAdmin(true);
            // Кэшируем результат на 5 минут С ПРИВЯЗКОЙ К ПОЛЬЗОВАТЕЛЮ
            localStorage.setItem(cacheKey, JSON.stringify({
              userId,
              isAdmin: true,
              timestamp: Date.now()
            }));
            return true;
          } else {
            get().setIsAdmin(false);
            // Кэшируем результат на 5 минут С ПРИВЯЗКОЙ К ПОЛЬЗОВАТЕЛЮ
            localStorage.setItem(cacheKey, JSON.stringify({
              userId,
              isAdmin: false,
              timestamp: Date.now()
            }));
            return false;
          }
        } catch (error) {
          console.error('Ошибка при проверке статуса администратора:', error);
          get().setIsAdmin(false);
          return false;
        }
      },

      setToken: (token: string) => {
        localStorage.setItem('auth_token', token);
        set({ token, isAuthenticated: !!token && !!get().userId });
      },

      logout: () => {
        get().clearAuth();
      }
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ 
        token: state.token,
        userId: state.userId,
        isAuthenticated: state.isAuthenticated,
        isAdmin: state.isAdmin
      }),
    }
  )
);

// Хранилище для выбранной кампании перенесено в campaignStore.ts
// Используйте импорт из 'lib/campaignStore' для доступа к состоянию кампании

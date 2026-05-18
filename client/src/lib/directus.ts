import axios from 'axios';
import { useAuthStore } from './store';
import { redirectToLogin } from './public-routes';

// Динамическое получение URL Directus с сервера
let directusUrl = import.meta.env.VITE_DIRECTUS_URL;

// Функция для получения конфигурации с сервера
async function getServerConfig() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    return config.directusUrl;
  } catch (error) {
    console.warn('Failed to get server config, using default:', error);
    return directusUrl;
  }
}

// Обновляем URL при загрузке
getServerConfig().then(url => {
  if (url && url !== directusUrl) {
    directusUrl = url;
    directusApi.defaults.baseURL = url;
  }
});

export const DIRECTUS_URL = directusUrl;

export const directusApi = axios.create({
  baseURL: directusUrl,
  headers: {
    'Content-Type': 'application/json',
  }
});

// Вспомогательная функция для проверки и получения токена
export const getAuthToken = () => {
  return localStorage.getItem('auth_token');
};

// Вспомогательная функция для проверки авторизации
export const isAuthenticated = () => {
  return !!getAuthToken();
};

// Добавляем функцию для получения заголовков авторизации
export const getAuthHeaders = () => {
  const token = getAuthToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};

// Global variable to prevent multiple simultaneous token refresh requests
let isRefreshing = false;
let refreshPromise: Promise<string> | null = null;

// Add request interceptor to handle auth token
directusApi.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers = config.headers || {};
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor to handle errors
directusApi.interceptors.response.use(
  (response) => response,
  async (error) => {
    // If we get a 401 or 403 error and have a refresh token, try to refresh the access token
    if (error.response?.status === 401 || error.response?.status === 403) {
      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken) {
        // If already refreshing, wait for the existing refresh to complete
        if (isRefreshing && refreshPromise) {
          try {
            const newToken = await refreshPromise;
            const originalRequest = error.config;
            originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
            return axios(originalRequest);
          } catch (refreshError) {
            throw refreshError;
          }
        }

        // Start new refresh
        isRefreshing = true;
        refreshPromise = (async () => {
          try {
            // Use local API endpoint for token refresh
            const response = await fetch('/api/auth/refresh', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                refresh_token: refreshToken,
                user_id: localStorage.getItem('user_id')
              })
            });

            if (!response.ok) {
              throw new Error('Failed to refresh token');
            }

            const data = await response.json();
            
            if (!data.success || !data.token) {
              throw new Error('Invalid refresh response');
            }

            const access_token = data.token;
            localStorage.setItem('auth_token', access_token);
            if (data.refresh_token) {
              localStorage.setItem('refresh_token', data.refresh_token);
            }

            // Update auth store
            const auth = useAuthStore.getState();
            auth.setAuth(access_token, auth.userId);

            return access_token;
          } catch (refreshError) {
            // If refresh fails, clear auth and throw error
            localStorage.removeItem('auth_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('user_id');
            const auth = useAuthStore.getState();
            auth.clearAuth();
            
            // Redirect to login
            redirectToLogin();
            throw new Error('Session expired. Please log in again.');
          } finally {
            isRefreshing = false;
            refreshPromise = null;
          }
        })();

        try {
          const newToken = await refreshPromise;
          
          // Retry original request
          const originalRequest = error.config;
          originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
          return axios(originalRequest);
        } catch (refreshError) {
          throw refreshError;
        }
      } else {
        // No refresh token, redirect to login
        ['auth_token','refresh_token','user_id','is_admin','selected_campaign_id','selected_campaign_name'].forEach(k => localStorage.removeItem(k));
        const auth = useAuthStore.getState();
        auth.clearAuth();
        redirectToLogin();
      }
    }

    // For other errors, throw with meaningful message
    const message = error.response?.data?.errors?.[0]?.message || 
                   error.response?.data?.error?.message ||
                   error.message ||
                   'An error occurred';
    throw new Error(message);
  }
);
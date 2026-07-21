import axios from 'axios';
import { useAuthStore } from './store';
import { redirectToLogin } from './public-routes';
import { refreshAuthSession } from './refreshAuth';

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
    const originalRequest = error.config;
    const isInvalidSession = error.response?.status === 401
      || (error.response?.status === 403 && error.response?.data?.code === 'AUTH_SESSION_INVALID');

    if (isInvalidSession && originalRequest && !originalRequest._authRetried) {
      originalRequest._authRetried = true;
      const requestToken = String(originalRequest.headers?.Authorization || '').replace('Bearer ', '');
      const currentToken = localStorage.getItem('auth_token');

      // A different request already refreshed the session. Retry immediately and
      // do not rotate the refresh token for a stale 401.
      if (currentToken && requestToken && currentToken !== requestToken) {
        originalRequest.headers.Authorization = `Bearer ${currentToken}`;
        return directusApi(originalRequest);
      }

      const result = await refreshAuthSession();
      if (result === 'refreshed' || result === 'superseded') {
        const newToken = localStorage.getItem('auth_token');
        if (newToken) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return directusApi(originalRequest);
        }
      } else if (result === 'invalid') {
        useAuthStore.getState().clearAuth();
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

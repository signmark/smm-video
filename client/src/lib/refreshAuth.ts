/**
 * Утилита для обновления токена авторизации
 * Используется для предотвращения проблем с истекшими токенами при планировании публикаций
 */

import { useAuthStore } from "./store";

/**
 * Обновляет токен авторизации через Directus
 * @returns Promise с результатом обновления (true - успешно, false - ошибка)
 */
export async function refreshAuthToken(): Promise<boolean> {
  const token = localStorage.getItem('auth_token');
  const refreshToken = localStorage.getItem('refresh_token');
  
  if (!token && !refreshToken) {
    console.log('Невозможно обновить токен: отсутствуют токены');
    return false;
  }
  
  try {
    // Если есть refresh token, пытаемся обновить токен
    if (refreshToken) {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      
      if (response.ok) {
        const data = await response.json();
        // user_id сервер не возвращает в ответе на refresh — берём из localStorage
        const userId = data.user_id || localStorage.getItem('user_id');
        if (data.token && userId) {
          localStorage.setItem('auth_token', data.token);
          if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
          localStorage.setItem('user_id', userId);
          useAuthStore.getState().setAuth(data.token, userId);
          
          console.log('[refreshAuth] Токен успешно обновлен и сохранен');
          return true;
        }
      } else {
        console.log('Не удалось обновить токен через refresh token, пробуем прямую авторизацию');
      }
    }
    
    // Если у нас есть сохраненные учетные данные, пробуем автоматическую повторную авторизацию
    const email = localStorage.getItem('user_email');
    const password = localStorage.getItem('user_password'); // В реальном приложении не храните пароли в localStorage
    
    if (email && password) {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.token && data.user_id) {
          // КРИТИЧНО: Обновляем токен в localStorage И Zustand store
          localStorage.setItem('auth_token', data.token);
          localStorage.setItem('user_id', data.user_id);
          useAuthStore.getState().setAuth(data.token, data.user_id);
          
          console.log('[refreshAuth] Токен успешно обновлен через повторную авторизацию');
          return true;
        }
      }
    }
    
    console.log('[refreshAuth] Не удалось обновить токен - все методы исчерпаны');
    return false;
  } catch (error) {
    console.error('Ошибка при обновлении токена:', error);
    return false;
  }
}

/**
 * Проверяет валидность текущего токена через запрос к API
 * @returns Promise с результатом проверки (true - токен валидный, false - токен невалидный)
 */
export async function validateCurrentToken(): Promise<boolean> {
  const token = localStorage.getItem('auth_token');
  
  if (!token) {
    console.log('Нет токена для проверки');
    return false;
  }
  
  try {
    const response = await fetch('/api/auth/check', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    return response.ok;
  } catch (error) {
    console.error('Ошибка при проверке токена:', error);
    return false;
  }
}
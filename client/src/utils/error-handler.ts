/**
 * Обработчик ошибок для production - преобразует технические ошибки в понятные сообщения
 */

import { systemError, serviceError } from './logger';

export interface UserFriendlyError {
  message: string;
  action?: string;
  showToUser: boolean;
}

/**
 * Преобразует HTTP ошибки в понятные сообщения для пользователей
 */
export function handleApiError(error: any): UserFriendlyError {
  const status = error?.response?.status || error?.status;
  const url = error?.config?.url || error?.url || '';

  switch (status) {
    case 401:
      return {
        message: 'Сессия истекла. Войдите в систему заново.',
        action: 'Перейти к авторизации',
        showToUser: true
      };

    case 403:
      return {
        message: 'Недостаточно прав для выполнения этого действия.',
        action: 'Обратитесь к администратору',
        showToUser: true
      };

    case 404:
      return {
        message: 'Запрашиваемый ресурс не найден.',
        showToUser: false // Обычно не критично для пользователя
      };

    case 429:
      if (url.includes('imgur.com')) {
        return {
          message: 'Превышен лимит загрузок изображений. Попробуйте позже.',
          action: 'Повторить через несколько минут',
          showToUser: true
        };
      }
      return {
        message: 'Слишком много запросов. Попробуйте позже.',
        action: 'Повторить через минуту',
        showToUser: true
      };

    case 500:
      serviceError('Сервер', 'Временные технические проблемы');
      return {
        message: 'Временные технические проблемы на сервере.',
        action: 'Обратитесь к технической поддержке',
        showToUser: true
      };

    case 503:
      serviceError('Сервис', 'Временно недоступен');
      return {
        message: 'Сервис временно недоступен.',
        action: 'Повторите попытку позже',
        showToUser: true
      };

    default:
      // Неизвестная ошибка - логируем как системную
      systemError(`Неожиданная ошибка API (${status})`, error);
      return {
        message: 'Произошла неожиданная ошибка.',
        action: 'Обратитесь к технической поддержке',
        showToUser: true
      };
  }
}

/**
 * Обработка ошибок сети
 */
export function handleNetworkError(error: any): UserFriendlyError {
  if (error.code === 'NETWORK_ERROR' || error.message?.includes('Network Error')) {
    return {
      message: 'Проблемы с подключением к интернету.',
      action: 'Проверьте подключение и повторите попытку',
      showToUser: true
    };
  }

  if (error.code === 'TIMEOUT' || error.message?.includes('timeout')) {
    return {
      message: 'Время ожидания истекло.',
      action: 'Повторите попытку',
      showToUser: true
    };
  }

  systemError('Ошибка сети', error);
  return {
    message: 'Ошибка подключения к серверу.',
    action: 'Проверьте интернет-соединение',
    showToUser: true
  };
}

/**
 * Универсальный обработчик ошибок для использования в компонентах
 */
export function handleError(error: any): UserFriendlyError {
  // Ошибки навигации и отмены запросов — не показываем пользователю
  // и не логируем в console.error, так как они ожидаемы при быстром переходе
  if (
    error?.name === 'AbortError' ||
    error?.message === 'AbortError' ||
    error?.message?.includes('body stream already read') ||
    error?.message?.includes('The user aborted a request') ||
    error?.authFailed === true ||
    error?.message === 'AUTH_FAILED' ||
    error?.message === 'TOKEN_REFRESHED'
  ) {
    return { message: '', showToUser: false };
  }

  // Если это HTTP ошибка
  if (error?.response?.status || error?.status) {
    return handleApiError(error);
  }

  // Если это сетевая ошибка
  if (error?.code || error?.message?.includes('Network')) {
    return handleNetworkError(error);
  }

  // Общая обработка
  systemError('Неизвестная ошибка', error);
  return {
    message: 'Произошла неожиданная ошибка.',
    action: 'Обратитесь к технической поддержке',
    showToUser: true
  };
}

/**
 * Обработчик для специфических ошибок медиа-сервисов
 */
export function handleMediaError(error: any, service: string): UserFriendlyError {
  if (service === 'imgur') {
    const status = error?.response?.status || error?.status;
    
    if (status === 429) {
      return {
        message: 'Превышен лимит загрузок на Imgur.',
        action: 'Используйте другой сервис или повторите позже',
        showToUser: true
      };
    }
    
    if (status === 403) {
      return {
        message: 'Изображение заблокировано или недоступно.',
        action: 'Используйте другое изображение',
        showToUser: true
      };
    }
  }

  return handleApiError(error);
}
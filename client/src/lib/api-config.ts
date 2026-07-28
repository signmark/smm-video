/**
 * Конфигурация API для разных окружений
 */

export function getApiBaseUrl(): string {
  // Всегда относительный путь: API живёт на том же origin, что и фронт.
  // Раньше здесь был список продовых хостов, который возвращал
  // `https://${window.location.hostname}` — то есть тот же самый origin,
  // просто записанный явно. Из-за списка сборка знала имена доменов и на
  // новом домене вела себя иначе, хотя результат был идентичным.
  return '';
}

export function getApiUrl(endpoint: string): string {
  const baseUrl = getApiBaseUrl();
  return `${baseUrl}${endpoint}`;
}

// Экспортируем готовые URL для основных endpoint'ов
export const API_ENDPOINTS = {
  LOGIN: '/api/auth/login',
  REGISTER: '/api/auth/register',
  LOGOUT: '/api/auth/logout',
  ME: '/api/auth/me',
} as const;

export function getFullApiUrl(endpoint: keyof typeof API_ENDPOINTS): string {
  return getApiUrl(API_ENDPOINTS[endpoint]);
}
/**
 * Environment detector for multi-server deployments
 * Handles different admin credentials across Docker, Replit, and production environments
 *
 * AI-41: console.* оставлен намеренно. detectEnvironment() вызывается из
 * getEnvConfig() при инициализации логгера, поэтому не может использовать log() —
 * это bootstrap-вывод, как logToConsole в самом logger.ts.
 */

import { getRequiredServiceUrl } from "../config/service-urls";

export interface EnvironmentConfig {
  adminEmail: string;
  adminPassword: string;
  directusUrl: string;
  environment: 'development' | 'production';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  debugScheduler: boolean;
  verboseLogs: boolean;
}

let _logged = false;

/**
 * Detects current environment and returns appropriate admin credentials
 */
export function detectEnvironment(): EnvironmentConfig {
  // Используем переменную ENV для определения окружения
  const envVariable = process.env.ENV || process.env.NODE_ENV || 'production';
  const environment = envVariable === 'development' ? 'development' : 'production';

  // URL Directus. AI-89: переменная обязательна — validateRequiredServiceUrls()
  // в server/index.ts уже проверила её на старте, поэтому здесь бросаем
  // с понятным сообщением, если она вдруг не задана (например, в тестах
  // без мока env). Старая цепочка (DIRECTUS_INTERNAL_URL, dev/prod-фоллбэки)
  // убрана: они создавали риск тихого ухода в чужой Directus.
  const directusUrl = getRequiredServiceUrl('DIRECTUS_URL');

  if (!_logged) {
    console.log(`[ENV-DETECTOR] Detected environment: ${environment}, Directus URL: ${directusUrl}`);
    _logged = true;
  }

  // Конфигурация логгирования в зависимости от окружения
  const logLevel = (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') ||
    (environment === 'development' ? 'debug' : 'info');

  const debugScheduler = process.env.DEBUG_SCHEDULER === 'true';
  const verboseLogs = process.env.VERBOSE_LOGS === 'true';

  return {
    adminEmail: process.env.DIRECTUS_ADMIN_EMAIL || 'lbrspb@gmail.com',
    adminPassword: process.env.DIRECTUS_ADMIN_PASSWORD || '',
    directusUrl,
    environment,
    logLevel,
    debugScheduler,
    verboseLogs
  };
}

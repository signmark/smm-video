/**
 * Environment detector for multi-server deployments
 * Handles different admin credentials across Docker, Replit, and production environments
 */

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
import { log } from './logger';
export function detectEnvironment(): EnvironmentConfig {
  // Используем переменную ENV для определения окружения
  const envVariable = process.env.ENV || process.env.NODE_ENV || 'production';
  const environment = envVariable === 'development' ? 'development' : 'production';

  // URL Directus в зависимости от окружения
  // Поддерживаем оба имени переменной: DIRECTUS_URL (его задаёт прод — /root/docker-compose.yml)
  // и DIRECTUS_INTERNAL_URL (legacy-имя из архивных compose-файлов, см. docs/DEPLOYMENT.md)
  const directusUrl = process.env.DIRECTUS_URL ||
    process.env.DIRECTUS_INTERNAL_URL ||
    (environment === 'development' ? 'http://localhost:8055' : 'https://directus.nplanner.ru');

  if (!_logged) {
    log(`[ENV-DETECTOR] Detected environment: ${environment}, Directus URL: ${directusUrl}`);
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

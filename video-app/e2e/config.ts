/**
 * E2E config — читается из переменных окружения.
 *
 * Запуск из video-app/:
 *   VIDEO_E2E_URL=https://smm.omemo.tech/video-app/api \
 *   VIDEO_E2E_EMAIL=you@example.com \
 *   VIDEO_E2E_PASSWORD=secret \
 *   npm run test:e2e
 *
 * Без медленных тестов (генерация скрипта/видео):
 *   npm run test:e2e:fast
 *
 * Скопируй video-app/e2e/.env.example → video-app/e2e/.env и заполни.
 */

import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '.env') });
loadDotenv({ path: resolve(__dirname, '../.env') });

export const BASE_URL = (
  process.env.VIDEO_E2E_URL ??
  process.env.VIDEO_APP_URL ??
  'https://smm.omemo.tech/video-app/api'
).replace(/\/$/, '');

export const EMAIL    = process.env.VIDEO_E2E_EMAIL    ?? process.env.DIRECTUS_ADMIN_EMAIL ?? '';
export const PASSWORD = process.env.VIDEO_E2E_PASSWORD ?? process.env.DIRECTUS_ADMIN_PASSWORD ?? '';

export const TIMEOUTS = {
  /** Обычный API-запрос */
  request:       15_000,
  /** Ожидание генерации скрипта */
  script:        90_000,
  /** Ожидание пречека стока */
  stockPrecheck: 120_000,
  /** Ожидание полной генерации видео */
  generate:      600_000,
};

/** Пропустить медленные тесты (генерация). По умолчанию: false */
export const SKIP_SLOW = process.env.SKIP_SLOW === '1';
/** Пропустить тест полной генерации видео */
export const SKIP_GENERATE = !!process.env.SKIP_GENERATE;

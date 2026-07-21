/**
 * Загружает переменные окружения из Directus global_api_keys в process.env.
 * Вызывается один раз при старте сервера, ДО инициализации сервисов.
 * Не перезаписывает переменные, уже заданные в env-файле или docker compose.
 */
import { globalApiKeysService } from './global-api-keys';

const KEYS_TO_LOAD: string[] = [
  'N8N_URL',
  'N8N_TRENDS_COLLECT_WEBHOOK',
  'N8N_COLLECT_COMMENTS_WEBHOOK',
  'N8N_COLLECT_COMMENTS_SINGLE_WEBHOOK',
  'N8N_ANALYTICS_WEBHOOK',
  'N8N_TRENDS_SOURCES_WEBHOOK',
  'N8N_TRENDS_KEYWORDS_WEBHOOK',
  'SCRAPER_ANALYTICS_API_KEY',
  'BEGET_S3_ACCESS_KEY',
  'BEGET_S3_SECRET_KEY',
  'BEGET_S3_BUCKET',
  'GEMINI_API_KEY',
  'VERTEX_AI_API_KEY',
  'GEMINI_PROXY_URL',
  'FORCE_GEMINI_PROXY',
  'TELEGRAM_BOT_TOKEN',
];

// Эти ключи всегда берутся из Directus, даже если уже заданы в env
// (нужно для перекрытия устаревших/заблокированных ключей из Replit-секретов)
const ALWAYS_OVERRIDE_FROM_DIRECTUS: string[] = [
  'GEMINI_API_KEY',
  'GEMINI_PROXY_URL',
  'SCRAPER_ANALYTICS_API_KEY',
];

export async function loadEnvFromDirectus(): Promise<void> {
  const start = Date.now();
  let loaded = 0;
  let skipped = 0;

  const TOTAL_TIMEOUT_MS = 12000;

  try {
    await Promise.race([
      (async () => {
        // Параллельная загрузка всех ключей
        await Promise.all(KEYS_TO_LOAD.map(async (key) => {
          const alwaysOverride = ALWAYS_OVERRIDE_FROM_DIRECTUS.includes(key);
          if (process.env[key] && !alwaysOverride) {
            skipped++;
            return;
          }
          try {
            const value = await globalApiKeysService.getGlobalApiKey(key);
            if (value) {
              if (process.env[key] !== value) {
                console.log(`[load-env-directus] 🔄 Overriding ${key} from Directus (was: ${(process.env[key] || '').substring(0, 12)}...)`);
              }
              process.env[key] = value;
              loaded++;
            }
          } catch {
            // Не блокируем старт при ошибке одного ключа
          }
        }));
      })(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${TOTAL_TIMEOUT_MS}ms`)), TOTAL_TIMEOUT_MS)
      )
    ]);
    const ms = Date.now() - start;
    console.log(`[load-env-directus] ✅ Loaded ${loaded} keys from Directus (${skipped} skipped from env) in ${ms}ms`);
  } catch (err: any) {
    const ms = Date.now() - start;
    console.warn(`[load-env-directus] ⚠️ Partial load (${loaded} keys in ${ms}ms): ${err.message}`);
    console.warn('[load-env-directus] Services will use process.env fallbacks where available');
  }
}

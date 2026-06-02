/**
 * Minimal Directus key loader for video-app.
 * Loads .env first (video-app runs as a separate process without the main app's load-env.ts),
 * then fetches selected API keys from Directus global_api_keys collection.
 */
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

// Load .env from video-app root (one level up from server/)
const __dirname = fileURLToPath(new URL('.', import.meta.url));
dotenvConfig({ path: resolve(__dirname, '../.env'), override: false });

const KEYS_NEEDED = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_AI_API_KEY', 'HUGGINGFACE_API_KEY', 'FAL_AI_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_PROXY_URL', 'BEGET_S3_ACCESS_KEY', 'BEGET_S3_SECRET_KEY', 'BEGET_S3_BUCKET', 'BEGET_S3_ENDPOINT', 'BEGET_S3_REGION', 'PEXELS_API_KEY', 'JAMENDO_CLIENT_ID'];

// Алиасы: имя в Directus → имя env-переменной
const KEY_ALIASES: Record<string, string> = {
  claude:              'ANTHROPIC_API_KEY',
  gemini:              'GEMINI_API_KEY',
  fal_ai:              'FAL_AI_API_KEY',
  openai:              'OPENAI_API_KEY',
  deepseek:            'DEEPSEEK_API_KEY',
  huggingface:         'HUGGINGFACE_API_KEY',
  beget_s3_access_key: 'BEGET_S3_ACCESS_KEY',
  beget_s3_secret_key: 'BEGET_S3_SECRET_KEY',
  beget_s3_bucket:     'BEGET_S3_BUCKET',
  beget_s3_endpoint:   'BEGET_S3_ENDPOINT',
  beget_s3_region:     'BEGET_S3_REGION',
  PEXELS_API_KEY:      'PEXELS_API_KEY',
};

export function getDirectusBaseUrl(): string {
  // In Replit dev environment, use dev Directus
  if (process.env.REPL_ID && !process.env.REPLIT_DEPLOYMENT) {
    return 'https://directus.roboflow.space';
  }
  return process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
}

export function getDirectusToken(): string | undefined {
  // In Replit dev environment, use dev token
  if (process.env.REPL_ID && !process.env.REPLIT_DEPLOYMENT) {
    return process.env.DIRECTUS_DEV_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
  }
  return (
    process.env.DIRECTUS_PROD_TOKEN ||
    process.env.DIRECTUS_STATIC_TOKEN ||
    process.env.DIRECTUS_ADMIN_TOKEN
  );
}

async function tryLoadOnce(): Promise<boolean> {
  const baseUrl = getDirectusBaseUrl();
  const token = getDirectusToken();

  if (!baseUrl || !token) {
    console.warn('[load-keys] DIRECTUS_URL or token not set — skipping');
    return false;
  }

  try {
    const url = `${baseUrl}/items/global_api_keys?filter[is_active][_eq]=true&limit=100`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[load-keys] Directus returned ${res.status}`);
      return false;
    }

    const json = await res.json() as { data: Array<{ service_name: string; api_key: string }> };
    let loaded = 0;

    for (const item of json.data ?? []) {
      const { service_name, api_key } = item;
      if (!api_key) continue;
      if (KEYS_NEEDED.includes(service_name)) {
        process.env[service_name] = api_key;
        loaded++;
        continue;
      }
      const alias = KEY_ALIASES[service_name];
      if (alias) {
        process.env[alias] = api_key;
        loaded++;
      }
    }

    console.log(`[load-keys] Loaded ${loaded} API keys from Directus`);
    return true;
  } catch (err: any) {
    console.warn(`[load-keys] Failed: ${err.message}`);
    return false;
  }
}

// При старте: 4 попытки с задержкой 5/10/20с — Directus может стартовать позже Docker-контейнера
export async function loadKeysFromDirectus(): Promise<void> {
  const delays = [0, 5000, 10000, 20000];
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) {
      console.log(`[load-keys] Retry ${i}/${delays.length - 1} in ${delays[i] / 1000}s...`);
      await new Promise(r => setTimeout(r, delays[i]));
    }
    const ok = await tryLoadOnce();
    if (ok) return;
  }
  console.warn('[load-keys] All retries failed — running without Directus keys');
}

// Перезагрузка по требованию (вызывается перед генерацией если ключ не загружен)
export async function ensureKeysLoaded(): Promise<void> {
  if (!process.env.GEMINI_PROXY_URL && !process.env.GEMINI_API_KEY) {
    console.log('[load-keys] Keys missing — reloading from Directus...');
    await tryLoadOnce();
  }
}

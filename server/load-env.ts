/**
 * Загружает .env ДО любых других импортов.
 * Должен быть первым импортом в index.ts.
 * В Docker: .env нет в образе, используются vars от compose (env_file + environment).
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = '.env';
const envPath = path.resolve(process.cwd(), envFile);
// В Docker .env физически отсутствует в образе → dotenv не парсит ничего, override безвреден.
// На Replit/локально .env — единственный источник правды и должен пересиливать кэш Replit Secrets.
const loaded = dotenv.config({ path: envPath, override: true });
if (loaded.parsed && Object.keys(loaded.parsed).length > 0) {
  console.log(`[ENV] Loaded from: ${envFile}`);
} else {
  console.log(`[ENV] Using env from process (Docker or shell)`);
}

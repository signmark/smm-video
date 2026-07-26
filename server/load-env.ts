/**
 * Загружает .env ДО любых других импортов.
 * Должен быть первым импортом в index.ts.
 * В Docker: .env нет в образе, используются vars от compose (env_file + environment).
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = '.env';
const envPath = path.resolve(process.cwd(), envFile);

// Что уже пришло из окружения процесса — фиксируем ДО dotenv, иначе override=true
// затрёт в том числе NODE_ENV и мы не поймём, в каком режиме запустились.
const envKeysBefore = new Set(Object.keys(process.env));
const isProduction = process.env.NODE_ENV === 'production';

// В Docker .env физически отсутствует в образе (исключён в .dockerignore) → dotenv не парсит
// ничего, override безвреден. На Replit/локально .env — единственный источник правды и должен
// пересиливать кэш Replit Secrets.
// ОСТОРОЖНО: на прод-хосте всё иначе. Окружение приходит только из /root/.env через env_file
// в /root/docker-compose.yml, а файла /root/smm/.env быть не должно. Если он там появится
// (например, кто-то скопировал `cp /root/.env /root/smm/.env`), то при запуске сервера из
// /root/smm он МОЛЧА пересилит переменные окружения — отсюда предупреждение ниже.
// Подробности: docs/DEPLOYMENT.md.
const loaded = dotenv.config({ path: envPath, override: true });
const parsedKeys = loaded.parsed ? Object.keys(loaded.parsed) : [];

if (parsedKeys.length > 0) {
  console.log(`[ENV] Loaded from: ${envFile} (${parsedKeys.length} vars, override=true)`);

  const overridden = parsedKeys.filter((key) => envKeysBefore.has(key));
  if (overridden.length > 0 && isProduction) {
    // Только имена переменных, без значений.
    console.warn(
      `[ENV] ⚠️ ${envPath} пересилил ${overridden.length} уже заданных переменных окружения: ` +
        overridden.join(', '),
    );
    console.warn(
      '[ENV] ⚠️ В production окружение должно приходить только из /root/.env (env_file в ' +
        `/root/docker-compose.yml). Файла ${envPath} быть не должно — скорее всего он создан ` +
        'по ошибке. Удалите его и перезапустите. См. docs/DEPLOYMENT.md',
    );
  }
} else {
  console.log(`[ENV] Using env from process (Docker or shell)`);
}

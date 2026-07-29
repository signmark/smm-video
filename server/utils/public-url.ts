/**
 * Единственный источник правды о публичном адресе приложения.
 *
 * До этого модуля домен `smm.omemo.tech` был вкомпилирован в четыре десятка
 * мест: CORS-белый список, ссылки в письмах, redirect_uri всех OAuth-провайдеров,
 * sitemap/robots, возврат из ЮКассы. Часть кода вдобавок угадывала окружение по
 * подстроке в DIRECTUS_URL («если там omemo.tech, значит прод»), что ломалось
 * при любом переносе.
 *
 * Теперь домен задаётся один раз в .env (APP_PUBLIC_URL), и система поднимается
 * на любом домене без правок кода.
 */

/**
 * Куда падаем, если в проде не задан ни один из вариантов APP_PUBLIC_URL.
 * Исторический прод — чтобы уже работающие инсталляции не сломались молча.
 */
const LEGACY_FALLBACK_ORIGIN = 'https://smm.omemo.tech';

/** Партнёрские источники, которым разрешён cross-origin к нашему API. */
const DEFAULT_PARTNER_ORIGINS = [
  'https://t.me',
  'https://vk.needanapp.ru',
  'https://needanapp.ru',
];

let _warnedAboutFallback = false;

/**
 * Приводит значение к виду `https://host[:port]` — без пути и хвостового слеша.
 * Голый хост (`smm.example.com`) тоже принимается: к нему подставляется https.
 */
function normalizeOrigin(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;

  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    console.warn(`[public-url] Значение "${value}" не парсится как URL — игнорирую`);
    return null;
  }
}

function isProduction(): boolean {
  return (process.env.ENV || process.env.NODE_ENV || 'production') !== 'development';
}

/**
 * Публичный origin приложения: `https://smm.example.com`.
 *
 * APP_PUBLIC_URL — основной способ. Остальные имена поддерживаются, потому что
 * уже встречаются в .env разных инсталляций и в коде до рефакторинга.
 */
export function getPublicOrigin(): string {
  const fromEnv =
    normalizeOrigin(process.env.APP_PUBLIC_URL) ||
    normalizeOrigin(process.env.API_BASE_URL) ||
    normalizeOrigin(process.env.PUBLIC_URL) ||
    normalizeOrigin(process.env.APP_URL) ||
    normalizeOrigin(process.env.SMM_DOMAIN);

  if (fromEnv) return fromEnv;

  // Превью-окружение Replit само сообщает свой домен.
  const replitDomain = normalizeOrigin(process.env.REPLIT_DEV_DOMAIN);
  if (replitDomain) return replitDomain;

  if (!isProduction()) {
    return `http://localhost:${process.env.PORT || 5000}`;
  }

  if (!_warnedAboutFallback) {
    console.warn(
      `[public-url] ⚠️ APP_PUBLIC_URL не задан в проде — использую ${LEGACY_FALLBACK_ORIGIN}. ` +
      `Пропишите APP_PUBLIC_URL в .env, иначе ссылки в письмах и OAuth-callback'и уйдут на чужой домен.`
    );
    _warnedAboutFallback = true;
  }
  return LEGACY_FALLBACK_ORIGIN;
}

/** Хост без схемы: `smm.example.com`. */
export function getPublicHost(): string {
  return new URL(getPublicOrigin()).host;
}

/** Собирает абсолютный публичный URL: `publicUrl('/api/x')` → `https://…/api/x`. */
export function publicUrl(path = ''): string {
  if (!path) return getPublicOrigin();
  return `${getPublicOrigin()}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Абсолютный OAuth redirect_uri для провайдера. */
export function oauthRedirectUri(callbackPath: string): string {
  return publicUrl(callbackPath);
}

/**
 * Домены, которые обслуживает сама эта инсталляция: основной плюс APP_EXTRA_ORIGINS.
 *
 * APP_EXTRA_ORIGINS (через запятую) нужен на время переезда, когда приложение
 * должно отвечать сразу на старом и новом домене.
 */
export function getOwnOrigins(): string[] {
  const extra = (process.env.APP_EXTRA_ORIGINS || '')
    .split(',')
    .map(normalizeOrigin)
    .filter((o): o is string => Boolean(o));

  return Array.from(new Set([getPublicOrigin(), ...extra]));
}

/**
 * Origin ЭТОГО запроса — но только если он наш.
 *
 * Заголовок `Host` полностью подконтролен клиенту. До ревью 2026-07-29 из него
 * прямо собирались OAuth `redirect_uri` (`vk-oauth.ts`), ссылки на медиа для
 * Instagram (`stories.ts`) и адреса callback'ов Threads/Instagram — то есть
 * подделанный Host подставлял чужой домен в OAuth-поток и в ссылки, которые
 * потом уходили наружу.
 *
 * Правило простое: Host принимается ТОЛЬКО при точном совпадении с одним из
 * собственных доменов инсталляции (`APP_PUBLIC_URL` + `APP_EXTRA_ORIGINS`).
 * Иначе возвращается канонический origin. Сравнение идёт по нормализованному
 * origin целиком, а не через `includes()`: подстрочная проверка пропускала бы
 * и `smm.nplanner.ru.evil.com`, и `evilsmm.nplanner.ru`.
 *
 * Зачем вообще принимать чужой (свой второй) Host: на время переезда домена
 * приложение отвечает сразу на старом и новом адресе, и ссылка, выданная в
 * ответ на запрос по одному из них, должна остаться на том же домене — иначе
 * пользователя посреди OAuth-потока перекидывает на другой хост.
 */
export function resolveRequestOrigin(req: { get?: (name: string) => string | undefined; headers?: any }): string {
  const raw = (typeof req?.get === 'function' ? req.get('host') : undefined)
    ?? req?.headers?.host
    ?? '';

  const host = String(Array.isArray(raw) ? raw[0] : raw).trim();
  if (!host) return getPublicOrigin();

  const candidate = normalizeOrigin(host);
  if (!candidate) return getPublicOrigin();

  return getOwnOrigins().includes(candidate) ? candidate : getPublicOrigin();
}

/** Белый список Origin для CORS: свои домены + партнёры. */
export function getAllowedOrigins(): string[] {
  const partners = process.env.APP_PARTNER_ORIGINS
    ? process.env.APP_PARTNER_ORIGINS.split(',').map(normalizeOrigin).filter((o): o is string => Boolean(o))
    : DEFAULT_PARTNER_ORIGINS;

  return Array.from(new Set([...getOwnOrigins(), ...partners]));
}

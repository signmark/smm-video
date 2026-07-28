/**
 * HTTP-клиент для публичных прокси: ходит только туда, что прошло SSRF-проверку,
 * и остаётся там на всём пути запроса.
 *
 * Две вещи, которых не давал прямой вызов axios (находка ревью 2026-07-28):
 *
 *  1. **TOCTOU / DNS rebinding.** Проверить имя и потом дать axios резолвить его
 *     заново — значит проверить один адрес, а соединиться с другим. Здесь адреса,
 *     проверенные `resolveSafeUrl`, передаются в запрос через `lookup`, поэтому
 *     сокет уходит ровно на проверенный IP. Имя хоста при этом сохраняется — SNI и
 *     проверка сертификата продолжают работать как обычно.
 *
 *  2. **Redirect'ы.** `maxRedirects: 2` означало, что публичный URL мог отправить
 *     нас на http://127.0.0.1/ или на metadata-сервис, и axios сходил бы туда сам.
 *     Автоматические redirect'ы выключены, каждый Location проверяется заново тем
 *     же `resolveSafeUrl`.
 */

import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { resolveSafeUrl } from './ssrf-guard';

/** Сколько Location подряд готовы проверить и пройти. */
const DEFAULT_MAX_REDIRECTS = 3;

export class BlockedUrlError extends Error {
  readonly reason: string;
  constructor(reason: string, url: string) {
    super(`Заблокированный URL (${reason}): ${url.slice(0, 200)}`);
    this.name = 'BlockedUrlError';
    this.reason = reason;
  }
}

/**
 * Собирает `lookup` для http.request, отдающий только проверенные адреса.
 * Поддерживает обе формы обратного вызова — с `all: true` и без.
 */
function pinnedLookup(addresses: Array<{ address: string; family: number }>) {
  return (_hostname: string, options: any, callback: any) => {
    const cb = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'function' ? {} : (options || {});

    const wanted = opts.family
      ? addresses.filter(a => a.family === opts.family)
      : addresses;
    const usable = wanted.length ? wanted : addresses;

    if (opts.all) return cb(null, usable.map(a => ({ address: a.address, family: a.family })));
    return cb(null, usable[0].address, usable[0].family);
  };
}

export interface SafeRequestOptions {
  /** Максимум переходов по Location. По умолчанию 3. */
  maxRedirects?: number;
}

/**
 * Выполняет GET по URL, прошедшему SSRF-проверку, вручную проходя redirect'ы.
 *
 * Бросает `BlockedUrlError`, если исходный URL или любой из Location запрещён.
 * Остальные ошибки — обычные ошибки axios.
 */
export async function safeGet(
  rawUrl: string,
  config: AxiosRequestConfig = {},
  options: SafeRequestOptions = {},
): Promise<AxiosResponse> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const checked = await resolveSafeUrl(currentUrl);
    if (!checked.ok) throw new BlockedUrlError(checked.reason, currentUrl);

    const response = await axios.request({
      ...config,
      method: 'GET',
      url: checked.url.toString(),
      // Redirect'ы проходим сами — иначе axios уйдёт по непроверенному Location.
      maxRedirects: 0,
      lookup: pinnedLookup(checked.addresses),
      // 3xx не должен превращаться в исключение: мы его обрабатываем.
      validateStatus: (status: number) => status < 400,
    } as AxiosRequestConfig);

    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers?.location;
    if (!isRedirect || !location) return response;

    // Тело редиректа нам не нужно; для потоковых ответов его надо закрыть явно,
    // иначе сокет останется висеть.
    (response.data as any)?.destroy?.();

    currentUrl = new URL(String(location), checked.url).toString();
  }

  throw new BlockedUrlError('too-many-redirects', currentUrl);
}

/**
 * То же для потребителей на `fetch` (video/media proxy): они стримят `response.body`
 * и разбирают Range-заголовки, переводить их на axios ради одной проверки — переписать
 * всю обработку диапазонов. Здесь тот же цикл: каждый URL и каждый Location проходят
 * `resolveSafeUrl`, автоматические redirect'ы выключены.
 *
 * **Чем отличается от `safeGet`:** здесь нет pinned lookup. Node'овский `fetch` не
 * принимает `lookup` — его умеет только http.request, на котором работает axios.
 * Прикрутить пиннинг можно было через undici-dispatcher, но undici в зависимостях
 * проекта не объявлен (лежит транзитивно), а объявление тянет за собой обновление
 * lock-файла. Осознанный размен: остаётся узкое окно DNS rebinding между проверкой и
 * соединением — но только для эндпоинтов за `authenticateUser` (video/media proxy,
 * crawler). Публичный `/api/proxy-image`, ради которого находка и заведена, ходит
 * через `safeGet` и запиннен полностью.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: SafeRequestOptions = {},
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const checked = await resolveSafeUrl(currentUrl);
    if (!checked.ok) throw new BlockedUrlError(checked.reason, currentUrl);

    const response = await fetch(checked.url.toString(), { ...init, redirect: 'manual' });

    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) return response;

    // Тело редиректа не нужно, но его надо закрыть, иначе соединение висит.
    await response.body?.cancel().catch(() => {});

    currentUrl = new URL(location, checked.url).toString();
  }

  throw new BlockedUrlError('too-many-redirects', currentUrl);
}

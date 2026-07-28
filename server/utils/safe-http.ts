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
import http, { IncomingMessage } from 'http';
import https from 'https';
import { Readable } from 'stream';
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
 * Минимум от `Response`, который реально используют потребители: статус, заголовки,
 * тело потоком и разовое чтение целиком.
 */
export interface SafeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * То же для потребителей на `fetch` (video/media proxy): они стримят `response.body`
 * и разбирают Range-заголовки.
 *
 * Соединение идёт через `node:http`/`node:https` с `lookup`, а не через глобальный
 * `fetch`. Это принципиально: `fetch` резолвит имя заново уже после нашей проверки,
 * поэтому одна лишь предварительная валидация от DNS rebinding не защищает — между
 * проверкой и соединением адрес успевает смениться. `http.request` принимает `lookup`,
 * и мы отдаём в него ровно тот адрес, который проверили.
 *
 * Redirect'ы не следуются автоматически: каждый `Location` валидируется заново.
 */
export async function safeFetch(
  rawUrl: string,
  init: { method?: string; headers?: Record<string, string>; signal?: AbortSignal } = {},
  options: SafeRequestOptions = {},
): Promise<SafeResponse> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const checked = await resolveSafeUrl(currentUrl);
    if (!checked.ok) throw new BlockedUrlError(checked.reason, currentUrl);

    const res = await requestPinned(checked.url, checked.addresses, init);

    const location = res.headers.location;
    const status = res.statusCode ?? 0;
    if (status < 300 || status >= 400 || !location) {
      return toSafeResponse(res, status);
    }

    // Тело редиректа не нужно; поток надо закрыть, иначе сокет останется висеть.
    res.resume();
    currentUrl = new URL(String(location), checked.url).toString();
  }

  throw new BlockedUrlError('too-many-redirects', currentUrl);
}

/** Один запрос строго на проверенный адрес. Имя хоста сохраняется — SNI и TLS как обычно. */
function requestPinned(
  url: URL,
  addresses: Array<{ address: string; family: number }>,
  init: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(
      url,
      {
        method: init.method || 'GET',
        headers: init.headers,
        signal: init.signal,
        lookup: pinnedNodeLookup(addresses),
      } as any,
      resolve,
    );
    req.on('error', reject);
    req.end();
  });
}

function toSafeResponse(res: IncomingMessage, status: number): SafeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        const v = res.headers[name.toLowerCase()];
        if (v === undefined) return null;
        return Array.isArray(v) ? v.join(', ') : String(v);
      },
    },
    // Лениво: `Readable.toWeb` переводит поток в web-режим и блокирует его, поэтому
    // жадное создание `body` ломало бы последующий `arrayBuffer()` — потребитель
    // пользуется чем-то одним.
    get body() {
      return Readable.toWeb(res) as ReadableStream<Uint8Array>;
    },
    async arrayBuffer() {
      const chunks: Buffer[] = [];
      for await (const chunk of res) chunks.push(Buffer.from(chunk));
      const buf = Buffer.concat(chunks);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    },
  };
}

/** lookup для http.request: отдаёт только проверенные адреса. */
function pinnedNodeLookup(addresses: Array<{ address: string; family: number }>) {
  return (_hostname: string, opts: any, cb: any) => {
    const callback = typeof opts === 'function' ? opts : cb;
    const o = typeof opts === 'function' ? {} : (opts || {});
    const wanted = o.family ? addresses.filter(a => a.family === o.family) : addresses;
    const usable = wanted.length ? wanted : addresses;
    if (o.all) return callback(null, usable.map(a => ({ address: a.address, family: a.family })));
    return callback(null, usable[0].address, usable[0].family);
  };
}

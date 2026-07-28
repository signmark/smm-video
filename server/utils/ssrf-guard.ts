/**
 * Общая SSRF-защита для публичных прокси/краулера.
 *
 * Единый источник правды: логика раньше жила приватно в proxy-image.ts, теперь
 * её переиспользуют instagram-video-proxy и web-crawler.
 *
 * Что было сломано (находка ревью 2026-07-28):
 *  1. IPv4-mapped IPv6 проходил насквозь. `net.isIP('::ffff:127.0.0.1')` === 6, а
 *     ветка IPv6 сравнивала строку с '::1' и префиксами fc/fd/fe80 — ни одно не
 *     совпадало, и `isSafeHttpUrl('http://[::ffff:127.0.0.1]/')` возвращал ok:true.
 *     Теперь адрес разбирается в байты, а mapped/compatible/NAT64/6to4 форматы
 *     разворачиваются во вложенный IPv4 и проверяются как IPv4.
 *  2. Проверялся только литерал в hostname. Домен, резолвящийся в 127.0.0.1, guard
 *     не видел вовсе — DNS не спрашивали. Теперь есть `resolveSafeUrl`, который
 *     резолвит имя и отклоняет URL, если ЛЮБОЙ из адресов запрещён.
 *  3. Между проверкой и соединением DNS мог отдать другой адрес (rebinding/TOCTOU).
 *     Теперь `resolveSafeUrl` возвращает проверенные адреса, а запрос идёт с
 *     pinned lookup (см. utils/safe-http.ts) — соединение уходит ровно на тот адрес,
 *     который был проверен.
 *  4. Redirect'ы axios проходил сам, без повторной проверки. Публичный URL мог
 *     редиректить на loopback. Теперь автоматические redirect'ы выключены, каждый
 *     Location валидируется заново.
 */

import net from 'net';
import dns from 'dns';

const dnsLookup = dns.promises.lookup;

/** Запрещённые диапазоны IPv4: base-адрес и длина префикса. */
const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],          // «этот» хост
  ['10.0.0.0', 8],         // private A
  ['100.64.0.0', 10],      // CGNAT
  ['127.0.0.0', 8],        // loopback
  ['169.254.0.0', 16],     // link-local, в т.ч. cloud metadata 169.254.169.254
  ['172.16.0.0', 12],      // private B
  ['192.0.0.0', 24],       // IETF protocol assignments
  ['192.0.2.0', 24],       // TEST-NET-1
  ['192.88.99.0', 24],     // 6to4 relay anycast
  ['192.168.0.0', 16],     // private C
  ['198.18.0.0', 15],      // benchmark
  ['198.51.100.0', 24],    // TEST-NET-2
  ['203.0.113.0', 24],     // TEST-NET-3
  ['224.0.0.0', 4],        // multicast
  ['240.0.0.0', 4],        // reserved + 255.255.255.255
];

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

function isBlockedV4(ip: string): boolean {
  const value = v4ToInt(ip);
  if (value === null) return true; // не разобрали — считаем опасным
  for (const [base, bits] of BLOCKED_V4) {
    const baseInt = v4ToInt(base)!;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((value & mask) >>> 0 === (baseInt & mask) >>> 0) return true;
  }
  return false;
}

/** Разбирает IPv6 (включая `::` и смешанную запись с dotted-quad) в 16 байт. */
function v6ToBytes(raw: string): number[] | null {
  let text = raw.toLowerCase();
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone); // отбросить scope id

  // Смешанная запись `::ffff:127.0.0.1` — хвостовой IPv4 превращаем в две группы.
  const v4Match = text.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Match) {
    const v4 = v4ToInt(v4Match[1]);
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    text = text.slice(0, -v4Match[1].length) + `${hi}:${lo}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const parse = (chunk: string): number[] | null => {
    if (!chunk) return [];
    const groups: number[] = [];
    for (const g of chunk.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      groups.push(parseInt(g, 16));
    }
    return groups;
  };

  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (head === null || tail === null) return null;

  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...new Array(fill).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of groups) {
    bytes.push((g >> 8) & 0xff, g & 0xff);
  }
  return bytes;
}

function bytesToV4(bytes: number[], offset: number): string {
  return bytes.slice(offset, offset + 4).join('.');
}

function isBlockedV6(raw: string): boolean {
  const b = v6ToBytes(raw);
  if (!b) return true; // не разобрали — считаем опасным

  const allZero = b.every(x => x === 0);
  if (allZero) return true;                                    // :: (unspecified)
  if (b.slice(0, 15).every(x => x === 0) && b[15] === 1) return true; // ::1 loopback

  // ::ffff:a.b.c.d — IPv4-mapped. Именно этот формат guard и пропускал.
  if (b.slice(0, 10).every(x => x === 0) && b[10] === 0xff && b[11] === 0xff) {
    return isBlockedV4(bytesToV4(b, 12));
  }
  // ::a.b.c.d — устаревший IPv4-compatible.
  if (b.slice(0, 12).every(x => x === 0)) {
    return isBlockedV4(bytesToV4(b, 12));
  }
  // 64:ff9b::/96 — NAT64, последние 4 байта тоже IPv4.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b
      && b.slice(4, 12).every(x => x === 0)) {
    return isBlockedV4(bytesToV4(b, 12));
  }
  // 2002::/16 — 6to4, IPv4 зашит в байты 2..5.
  if (b[0] === 0x20 && b[1] === 0x02) {
    return isBlockedV4(bytesToV4(b, 2));
  }

  if ((b[0] & 0xfe) === 0xfc) return true;                     // fc00::/7 ULA
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;    // fe80::/10 link-local
  if (b[0] === 0xff) return true;                              // ff00::/8 multicast
  if (b[0] === 0x01 && b.slice(1, 8).every(x => x === 0)) return true; // 100::/64 discard
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // 2001:db8::/32

  return false;
}

/** Запрещён ли конкретный IP-адрес (v4 или v6). Незнакомый формат — запрещён. */
export function isBlockedIp(ip: string): boolean {
  const clean = ip.trim().replace(/^\[|\]$/g, '');
  const family = net.isIP(clean);
  if (family === 4) return isBlockedV4(clean);
  if (family === 6) return isBlockedV6(clean);
  return true;
}

/**
 * Проверка по одному лишь hostname — без DNS.
 *
 * Оставлена синхронной ради вызывающих, которым нужен быстрый отказ на явном
 * литерале. Полноценной защитой НЕ является: домен, резолвящийся в приватный
 * адрес, здесь не отсеивается. Для настоящей проверки — `resolveSafeUrl`.
 */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) {
    return true;
  }
  if (net.isIP(h)) return isBlockedIp(h);
  return false;
}

/** Разбирает и валидирует URL: только http(s) на публичные хосты (без DNS). */
export function isSafeHttpUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { ok: false, reason: 'bad-url' }; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, reason: 'protocol' };
  if (isBlockedHost(parsed.hostname)) return { ok: false, reason: 'blocked-host' };
  return { ok: true, url: parsed };
}

export type ResolvedUrl =
  | { ok: true; url: URL; addresses: Array<{ address: string; family: number }> }
  | { ok: false; reason: string };

/**
 * Полная проверка: протокол, hostname и ВСЕ адреса, в которые он резолвится.
 *
 * Возвращает проверенные адреса, чтобы запрос ушёл именно на них (pinned lookup).
 * Без этого между проверкой и соединением DNS успевает отдать другой адрес —
 * классический rebinding.
 */
export async function resolveSafeUrl(raw: string | URL): Promise<ResolvedUrl> {
  const basic = isSafeHttpUrl(typeof raw === 'string' ? raw : raw.toString());
  if (!basic.ok) return basic;

  const host = basic.url.hostname.replace(/^\[|\]$/g, '');

  // Литеральный IP резолвить не нужно — он уже проверен в isSafeHttpUrl.
  const literal = net.isIP(host);
  if (literal) {
    return { ok: true, url: basic.url, addresses: [{ address: host, family: literal }] };
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await dnsLookup(host, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: 'dns-failed' };
  }
  if (!records.length) return { ok: false, reason: 'dns-empty' };

  // Достаточно одного запрещённого адреса: если имя резолвится и в публичный, и в
  // приватный IP, выбор адреса за нами не стоит — отказываем целиком.
  for (const rec of records) {
    if (isBlockedIp(rec.address)) return { ok: false, reason: 'blocked-address' };
  }

  return { ok: true, url: basic.url, addresses: records };
}

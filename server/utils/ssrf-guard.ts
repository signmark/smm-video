/**
 * Общая SSRF-защита для публичных прокси/краулера.
 *
 * Единый источник правды: логика раньше жила приватно в proxy-image.ts, теперь
 * её переиспользуют instagram-video-proxy и web-crawler. Блокируем http(s) на
 * loopback/приватные/link-local хосты (в т.ч. cloud metadata 169.254.169.254),
 * чтобы декодированный пользовательский URL не увёл fetch во внутреннюю сеть.
 */

import net from 'net';

export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // убрать скобки IPv6
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) {
    return true;
  }
  if (net.isIP(h) === 4) {
    const p = h.split('.').map(Number);
    if (p[0] === 127) return true;                       // loopback
    if (p[0] === 10) return true;                        // private A
    if (p[0] === 192 && p[1] === 168) return true;       // private C
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // private B
    if (p[0] === 169 && p[1] === 254) return true;       // link-local / cloud metadata
    if (p[0] === 0) return true;                         // 0.0.0.0/8
  }
  if (net.isIP(h) === 6) {
    if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h === '::') {
      return true;
    }
  }
  return false;
}

/** Разбирает и валидирует URL: только http(s) на публичные хосты. */
export function isSafeHttpUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { ok: false, reason: 'bad-url' }; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, reason: 'protocol' };
  if (isBlockedHost(parsed.hostname)) return { ok: false, reason: 'blocked-host' };
  return { ok: true, url: parsed };
}

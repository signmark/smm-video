import type { Express, Request, Response } from 'express';
import axios from 'axios';
import net from 'net';
import dns from 'node:dns/promises';
import { log } from '../utils/logger';

/**
 * Публичный прокси картинок для тегов <img src="/api/proxy-image?url=...">.
 *
 * ВАЖНО: должен регистрироваться РАНО (до facebookGroupsRouter и прочих роутеров,
 * смонтированных `app.use('/api', ...)` с верхнеуровневым `router.use(authenticateUser)`
 * — те де-факто гейтят все последующие /api). Браузер НЕ шлёт Bearer к <img>, поэтому
 * эндпоинт обязан быть публичным, иначе превью картинок пустые (401).
 *
 * SSRF-защита (эндпоинт публичный, url полностью контролируется вызывающим):
 *   1) только http(s), литеральные loopback/приватные/link-local IP (в т.ч.
 *      metadata 169.254.169.254) блокируются;
 *   2) DNS pre-check: доменное имя, резолвящееся в приватный адрес, блокируется;
 *   3) каждый redirect-хоп ревалидируется (beforeRedirect) — публичный URL не
 *      может увести запрос 302-редиректом на внутренний хост.
 * Остаточный риск — TOCTOU DNS-ребиндинг между pre-check и запросом; для
 * картиночного прокси принят (см. docs/prompts/claude-review-commits-2026-07-27.md).
 *
 * Отдаём только image/* и video/* (прокси исторически используется и для превью
 * видео) — иначе через наш origin можно хостить произвольный HTML атакующего.
 */

function isBlockedHost(hostname: string): boolean {
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
    if (h.startsWith('::ffff:')) return isBlockedHost(h.slice(7)); // IPv4-mapped
  }
  return false;
}

/** Только для тестов/переиспользования. */
export function isSafeProxyImageUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { ok: false, reason: 'bad-url' }; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, reason: 'protocol' };
  if (isBlockedHost(parsed.hostname)) return { ok: false, reason: 'blocked-host' };
  return { ok: true, url: parsed };
}

/** Доменное имя не должно резолвиться в приватный адрес. Экспорт — для тестов. */
export async function resolvesToBlockedIp(hostname: string): Promise<boolean> {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(bare)) return false; // литеральный IP уже проверен isBlockedHost
  try {
    const addrs = await dns.lookup(bare, { all: true, verbatim: true });
    return addrs.some((a) => isBlockedHost(a.address));
  } catch {
    // Не резолвится — пусть падает сам запрос (502), это не SSRF-кейс.
    return false;
  }
}

/** Хук follow-redirects: ревалидация каждого redirect-хопа. Экспорт — для тестов. */
export function assertRedirectAllowed(options: { protocol?: string; hostname?: string; host?: string }): void {
  const protocol = options.protocol || '';
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error(`Redirect на неподдерживаемый протокол: ${protocol}`);
  }
  const hostname = options.hostname || options.host || '';
  if (!hostname || isBlockedHost(hostname)) {
    throw new Error(`Redirect на запрещённый хост: ${hostname}`);
  }
}

const ALLOWED_CONTENT_TYPE = /^(image|video)\//i;

export function registerProxyImageRoute(app: Express): void {
  app.get('/api/proxy-image', async (req: Request, res: Response) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL is required');

    let decoded: string;
    try { decoded = decodeURIComponent(String(url)); } catch { return res.status(400).send('Bad URL'); }

    const safe = isSafeProxyImageUrl(decoded);
    if (!safe.ok) {
      log(`[ProxyImage] Отклонён URL (${safe.reason}): ${decoded.slice(0, 120)}`, 'warn');
      return res.status(400).send('Bad or blocked URL');
    }

    if (await resolvesToBlockedIp(safe.url.hostname)) {
      log(`[ProxyImage] Отклонён URL (dns-to-private): ${decoded.slice(0, 120)}`, 'warn');
      return res.status(400).send('Bad or blocked URL');
    }

    try {
      const response = await axios.get(safe.url.toString(), {
        responseType: 'arraybuffer',
        timeout: 15000,
        maxContentLength: 25 * 1024 * 1024,
        maxRedirects: 2,
        beforeRedirect: assertRedirectAllowed,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      const contentType = String(response.headers['content-type'] || 'image/jpeg');
      if (!ALLOWED_CONTENT_TYPE.test(contentType)) {
        log(`[ProxyImage] Отклонён content-type "${contentType}" от ${safe.url.hostname}`, 'warn');
        return res.status(502).send('Unsupported content type');
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(response.data));
    } catch (e: any) {
      log(`[ProxyImage] Ошибка проксирования: ${e.message}`, 'error');
      res.status(502).send('Error proxying image');
    }
  });
}

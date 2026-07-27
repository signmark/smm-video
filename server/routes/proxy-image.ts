import type { Express, Request, Response } from 'express';
import axios from 'axios';
import net from 'net';
import { log } from '../utils/logger';

/**
 * Публичный прокси картинок для тегов <img src="/api/proxy-image?url=...">.
 *
 * ВАЖНО: должен регистрироваться РАНО (до facebookGroupsRouter и прочих роутеров,
 * смонтированных `app.use('/api', ...)` с верхнеуровневым `router.use(authenticateUser)`
 * — те де-факто гейтят все последующие /api). Браузер НЕ шлёт Bearer к <img>, поэтому
 * эндпоинт обязан быть публичным, иначе превью картинок пустые (401).
 *
 * SSRF-защита: только http(s) на публичные хосты; loopback/приватные/link-local
 * (в т.ч. metadata 169.254.169.254) блокируем.
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

    try {
      const response = await axios.get(safe.url.toString(), {
        responseType: 'arraybuffer',
        timeout: 15000,
        maxContentLength: 25 * 1024 * 1024,
        maxRedirects: 2,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      const contentType = response.headers['content-type'] || 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(response.data));
    } catch (e: any) {
      log(`[ProxyImage] Ошибка проксирования: ${e.message}`, 'error');
      res.status(502).send('Error proxying image');
    }
  });
}

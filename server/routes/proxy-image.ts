import type { Express, Request, Response } from 'express';
import { log } from '../utils/logger';
import { isSafeHttpUrl } from '../utils/ssrf-guard';
import { safeGet, BlockedUrlError } from '../utils/safe-http';

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

/** Только для тестов/переиспользования. Обёртка над общим ssrf-guard. */
export const isSafeProxyImageUrl = isSafeHttpUrl;

export function registerProxyImageRoute(app: Express): void {
  app.get('/api/proxy-image', async (req: Request, res: Response) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL is required');

    let decoded: string;
    try { decoded = decodeURIComponent(String(url)); } catch { return res.status(400).send('Bad URL'); }

    // Быстрый отказ по литералу; полная проверка (DNS + все адреса + каждый
    // Location) делается внутри safeGet.
    const safe = isSafeProxyImageUrl(decoded);
    if (!safe.ok) {
      log(`[ProxyImage] Отклонён URL (${safe.reason}): ${decoded.slice(0, 120)}`, 'warn');
      return res.status(400).send('Bad or blocked URL');
    }

    try {
      const response = await safeGet(safe.url.toString(), {
        responseType: 'arraybuffer',
        timeout: 15000,
        maxContentLength: 25 * 1024 * 1024,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      const contentType = response.headers['content-type'] || 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(response.data));
    } catch (e: any) {
      if (e instanceof BlockedUrlError) {
        log(`[ProxyImage] Отклонён URL (${e.reason}): ${decoded.slice(0, 120)}`, 'warn');
        return res.status(400).send('Bad or blocked URL');
      }
      log(`[ProxyImage] Ошибка проксирования: ${e.message}`, 'error');
      res.status(502).send('Error proxying image');
    }
  });
}

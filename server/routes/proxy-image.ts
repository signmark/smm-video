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

/** Типы, которые прокси готов отдавать. SVG нет намеренно: он исполняет скрипты. */
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/pjpeg', 'image/png', 'image/gif', 'image/webp',
  'image/avif', 'image/bmp', 'image/x-icon', 'image/vnd.microsoft.icon',
  'image/tiff', 'image/heic', 'image/heif',
]);

const FALLBACK_IMAGE_TYPE = 'image/jpeg';

/**
 * Content-Type ответа: только из allowlist, иначе image/jpeg.
 *
 * Раньше сюда попадал заголовок апстрима без разбора — в том числе text/html.
 */
export function pickSafeImageContentType(raw: unknown): string {
  if (typeof raw !== 'string') return FALLBACK_IMAGE_TYPE;

  // Отрезаем параметры (charset и прочее) и нормализуем регистр.
  const base = raw.split(';')[0].trim().toLowerCase();
  return ALLOWED_IMAGE_TYPES.has(base) ? base : FALLBACK_IMAGE_TYPE;
}

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
      // Content-Type апстрима наружу как есть не отдаём. Прокси публичный и
      // отвечает с НАШЕГО origin: text/html от чужого сервера исполнялся бы в
      // контексте приложения, а auth_token лежит в localStorage — то есть это
      // прямой угон сессии (находка ревью 2026-07-28).
      const contentType = pickSafeImageContentType(response.headers['content-type']);
      res.setHeader('Content-Type', contentType);
      // Страховка на случай, если тип всё же окажется рендерящимся: файл
      // скачивается, а не исполняется, и не наследует наш origin.
      res.setHeader('Content-Disposition', 'inline; filename="image"');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
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

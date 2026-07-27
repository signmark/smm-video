/**
 * Регистрация публичных OAuth/token callback'ов ДО всей middleware-цепочки.
 *
 * Внешние провайдеры (Google/VK/Instagram/Threads/TikTok) и needanapp.ru (прокси
 * VK) стучат сюда БЕЗ Bearer-токена приложения. Чтобы их не отбил глобальный
 * `app.use('/api', authMiddleware)`, handler'ы монтируются напрямую в самом начале.
 *
 * Тело парсим ТОЧЕЧНО на каждом POST-callback и ТОЛЬКО с лимитом 1mb. Раньше это
 * делали два `app.use('/api', express.json({ limit: '1mb' }))` на ВЕСЬ /api — и
 * они перехватывали каждый /api-запрос раньше глобального 50mb-парсера, из-за чего
 * обычные API-запросы 1–50mb становились недостижимы (413/усечение). Точечный
 * парсер снимает конфликт: callback получает распарсенное тело (>1mb → 413), а
 * обычные /api доходят до общего express.json({ limit: '50mb' }).
 */

import express, { type Express } from 'express';

export const PUBLIC_CALLBACK_BODY_LIMIT = '1mb';

export interface PublicOAuthCallback {
  router: any;
  routerPath: string;
  publicPath: string;
  method: 'get' | 'post' | 'options';
  /** Доп. middleware перед хендлером (например rate limiter для публичного POST). */
  middleware?: express.RequestHandler[];
}

type BypassLogger = { warn: (m: string) => void; info: (m: string) => void };

export function registerPublicOAuthBypass(
  app: Express,
  callbacks: PublicOAuthCallback[],
  logger: BypassLogger = console,
): void {
  // Один парсер на все POST-callback'и: маленький лимит, тело нужно до хендлера.
  const callbackJson = express.json({ limit: PUBLIC_CALLBACK_BODY_LIMIT });

  for (const { router, routerPath, publicPath, method, middleware = [] } of callbacks) {
    // Находим внутренний handler в router'е по path и method.
    const layer = (router as any).stack.find(
      (l: any) => l.route && l.route.path === routerPath && l.route.methods[method],
    );
    if (!layer) {
      logger.warn(`[oauth-bypass] ⚠️ Не найден handler для ${method.toUpperCase()} ${publicPath} в роутере — пропускаю`);
      continue;
    }
    const innerHandler = layer.route.stack[0].handle;
    // 1mb-парсер вешаем только на POST: GET-редиректы и OPTIONS-preflight тела не несут.
    if (method === 'get') app.get(publicPath, ...middleware, innerHandler);
    else if (method === 'post') app.post(publicPath, ...middleware, callbackJson, innerHandler);
    else if (method === 'options') app.options(publicPath, ...middleware, innerHandler);
    logger.info(`[oauth-bypass] ✅ ${method.toUpperCase()} ${publicPath} → смонтирован до всех middleware (body limit ${PUBLIC_CALLBACK_BODY_LIMIT} для POST)`);
  }
}

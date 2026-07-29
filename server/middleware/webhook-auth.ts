/**
 * Аутентификация машинных вебхуков (n8n → приложение).
 *
 * Находка ревью 2026-07-28 (P0): `POST /update-status` и
 * `POST /update-status/:platform` смонтированы в корень — вне `/api`, то есть
 * мимо гейта авторизации вообще, — и правят `campaign_content` по произвольному
 * `id` админским токеном Directus. Аноним мог менять статус, `postUrl` и
 * `published_at` любого чужого контента.
 *
 * Это вызовы между сервисами, а не пользовательские: пользовательской сессии у
 * n8n нет. Поэтому проверяем общий секрет, а не токен пользователя.
 *
 * Fail-closed: если `STATUS_WEBHOOK_SECRET` не задан, вебхук отвечает 503, а не
 * работает «пока без проверки». Секрет должен быть выставлен и в окружении
 * приложения, и в заголовке `x-webhook-secret` у вызывающих workflow n8n —
 * без этого статусы публикаций перестанут доезжать.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import log from '../utils/logger';

export const WEBHOOK_SECRET_HEADER = 'x-webhook-secret';
const SECRET_ENV = 'STATUS_WEBHOOK_SECRET';

/** Сравнение без утечки длины совпавшего префикса по времени. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual требует одинаковой длины, поэтому сначала уравниваем её
  // хешированием — иначе сама длина отвечала бы раньше сравнения.
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function readProvidedSecret(req: Request): string | null {
  const header = req.headers[WEBHOOK_SECRET_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value === 'string' && value.length > 0) return value;

  // Bearer в Authorization — на случай, если workflow удобнее слать так.
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    if (token) return token;
  }

  return null;
}

/**
 * Пропускает только запросы с корректным секретом вебхука.
 *
 * @param label префикс для логов, чтобы отличать вебхуки друг от друга
 */
export function requireWebhookSecret(label: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const expected = process.env[SECRET_ENV];

    if (!expected) {
      log.error(
        `[${label}] ${SECRET_ENV} не задан — вебхук отключён. ` +
        `Пока переменная не выставлена, статусы публикаций не принимаются.`,
      );
      return res.status(503).json({
        success: false,
        error: 'Вебхук не сконфигурирован',
      });
    }

    const provided = readProvidedSecret(req);
    if (!provided || !secretsMatch(provided, expected)) {
      // Тело не логируем: в нём приходят contentId и ссылки на публикации.
      log.warn(`[${label}] Отклонён вызов вебхука без корректного секрета (ip=${req.ip})`);
      return res.status(401).json({
        success: false,
        error: 'Требуется авторизация вебхука',
      });
    }

    return next();
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Колбэки трендов (внешний скрейпер → приложение)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Собственный секрет колбэков трендов.
 *
 * Отдельный от `STATUS_WEBHOOK_SECRET` намеренно: это другой отправитель
 * (скрейпер, а не n8n) и другой класс данных. Компрометация одного не должна
 * открывать второй.
 */
const TRENDS_SECRET_ENV = 'TRENDS_WEBHOOK_SECRET';

/**
 * Токен, привязанный к конкретному колбэку.
 *
 * Зачем он нужен помимо заголовка. Колбэки трендов вызывает внешний скрейпер
 * (`SCRAPER_BASE`), которым мы не управляем: он POSTит ровно на тот
 * `callback_url`, который мы ему передали, и произвольный заголовок к нему не
 * приложит. Поэтому у канонической (заголовочной) проверки есть вторая,
 * совместимая форма: секрет уезжает сегментом ПУТИ того самого callback_url,
 * который мы же и выдаём.
 *
 * Именно путь, а не query: query-строка требованием запрещена, и она заметно
 * охотнее протекает в Referer, в закладки и в аналитику. Схема та же, что у
 * вебхуков Telegram Bot API (токен в пути).
 *
 * Токен детерминированный — перезапуск приложения не должен ломать задачи,
 * которые уже уехали в скрейпер с выданным ранее URL. И он привязан к метке
 * конкретного колбэка: токен от `tg-webhook` не открывает `vk-webhook`.
 */
export function trendsCallbackToken(label: string): string | null {
  const secret = process.env[TRENDS_SECRET_ENV];
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(`trends-callback:${label}`).digest('hex').slice(0, 32);
}

/**
 * Абсолютный URL колбэка с уже вшитым токеном.
 *
 * Если секрет не задан, возвращает путь без токена — тогда сам эндпоинт всё
 * равно ответит 503 (fail-closed), и это будет видно в логах, а не тихо
 * работать без проверки.
 */
export function trendsCallbackUrl(origin: string, path: string, label: string): string {
  const token = trendsCallbackToken(label);
  const base = `${origin.replace(/\/+$/, '')}${path}`;
  return token ? `${base}/${token}` : base;
}

/**
 * Пропускает только вызовы колбэков трендов с корректным секретом.
 *
 * Принимает секрет двумя способами: заголовком `x-webhook-secret` /
 * `Authorization: Bearer` (канонический — для отправителей, которых мы
 * настраиваем) либо токеном в сегменте пути `:callbackToken` (совместимый —
 * для внешнего скрейпера).
 *
 * Fail-closed: без `TRENDS_WEBHOOK_SECRET` эндпоинт отвечает 503 и не работает
 * «пока без проверки». Пустой секрет — то же самое: `process.env` пустую строку
 * отдаёт как `''`, и она не проходит проверку истинности.
 */
export function requireTrendsWebhookSecret(label: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const expected = process.env[TRENDS_SECRET_ENV];

    if (!expected) {
      log.error(
        `[${label}] ${TRENDS_SECRET_ENV} не задан — колбэк отключён. ` +
        `Пока переменная не выставлена, результаты сбора трендов не принимаются.`,
      );
      return res.status(503).json({ success: false, error: 'Вебхук не сконфигурирован' });
    }

    // 1. Канонический путь: секрет в заголовке. Express приводит имена
    //    заголовков к нижнему регистру, поэтому регистр отправителя не важен.
    const provided = readProvidedSecret(req);
    if (provided && secretsMatch(provided, expected)) return next();

    // 2. Совместимый путь: токен сегментом URL, выданного нами же.
    const pathToken = (req.params as any)?.callbackToken;
    const validToken = trendsCallbackToken(label);
    if (
      typeof pathToken === 'string' && pathToken.length > 0
      && validToken && secretsMatch(pathToken, validToken)
    ) {
      return next();
    }

    // Тело не логируем: в нём приходят посты и ссылки.
    log.warn(`[${label}] Отклонён колбэк без корректного секрета (ip=${req.ip})`);
    return res.status(401).json({ success: false, error: 'Требуется авторизация вебхука' });
  };
}

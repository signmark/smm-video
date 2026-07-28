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

import { Request } from 'express';
import { getOwnOrigins, getPublicOrigin } from './public-url';

/**
 * Базовый URL приложения для ссылок в письмах.
 *
 * Вынесено из api/password-reset.ts, чтобы ссылка подтверждения смены почты
 * собиралась тем же способом, что и ссылка сброса пароля, а не второй копией
 * этой же логики.
 *
 * Заголовок Host по-прежнему не является источником правды: он принимается,
 * только если совпал с одним из наших собственных доменов из .env. Иначе
 * подделанный Host увёл бы ссылку из письма на чужой домен. Раньше здесь был
 * фиксированный список доменов — теперь он берётся из APP_PUBLIC_URL и
 * APP_EXTRA_ORIGINS, но свойство «Host только по белому списку» сохранено.
 */
export function getAppBaseUrl(req: Request): string {
  const host = req.get('host') || '';
  if (host.includes('replit.dev')) return `https://${host}`;

  const requested = `https://${host}`;
  if (host && getOwnOrigins().includes(requested)) return requested;

  return getPublicOrigin();
}

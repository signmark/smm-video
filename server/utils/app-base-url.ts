import { Request } from 'express';

/**
 * Базовый URL приложения для ссылок в письмах.
 *
 * Вынесено из api/password-reset.ts, чтобы ссылка подтверждения смены почты
 * собиралась тем же способом, что и ссылка сброса пароля, а не второй копией
 * этой же логики.
 *
 * Хост из запроса используется только для превью-окружения replit.dev;
 * во всех остальных случаях адрес берётся из фиксированного списка, а не из
 * заголовка Host. Иначе подделанный Host в запросе увёл бы ссылку из письма
 * на чужой домен.
 */
export function getAppBaseUrl(req: Request): string {
  const host = req.get('host') || '';
  if (host.includes('replit.dev')) return `https://${host}`;
  if (host.includes('roboflow.space')) return 'https://smm.roboflow.space';
  return 'https://smm.omemo.tech';
}

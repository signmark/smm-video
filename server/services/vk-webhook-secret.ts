/**
 * Постоянный per-campaign секрет для публичного VK token-webhook.
 *
 * Проблема: POST-приём токенов от needanapp публичный (needanapp постит без
 * Bearer) и патчит user_campaigns админ-токеном по campaignId из URL. Без
 * привязки любой мог записать токены в чужую кампанию.
 *
 * Прошлое (неудачное) решение — одноразовый in-memory `state` с TTL 30 мин —
 * не совместимо с реальным needanapp: тот сохраняет ОДИН webhook URL и постит
 * на него при каждом реконнекте (~раз в 24ч). Одноразовость → второй пост 403;
 * TTL 30 мин ≪ 24ч → 403; in-memory → любой рестарт/деплой обнуляет state → 401.
 *
 * Текущее решение — стандартный webhook-secret: криптослучайный секрет,
 * привязанный к кампании и хранящийся ВМЕСТЕ с настройками VK в Directus
 * (social_media_settings.vk.webhookSecret). URL стабилен, переиспользуется на
 * каждый реконнект и переживает деплои. Публичный callback обязан предъявить
 * секрет (в сегменте пути) — сравниваем константно-временно ДО любого PATCH.
 * Attacker без секрета не запишет в кампанию. Секрет наружу и в логи не пишем.
 */

import crypto from 'crypto';

/** Криптослучайный секрет для webhook URL (url-safe, ~43 симв.). */
export function generateVkWebhookSecret(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Константно-временное сравнение секретов. Возвращает false для пустых значений
 * и при несовпадении длины (без утечки длины через раннее ветвление таймингом
 * можно пренебречь — секрет фиксированной длины у нас).
 */
export function vkWebhookSecretMatches(
  provided: string | undefined | null,
  stored: string | undefined | null,
): boolean {
  if (!provided || !stored) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

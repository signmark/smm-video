/**
 * Одноразовый серверный state для публичного VK token-webhook.
 *
 * Проблема: POST /api/vk/token-webhook/:campaignId публичный (needanapp постит
 * без Bearer) и патчит user_campaigns админ-токеном по campaignId из URL. Без
 * привязки любой мог записать токены в чужую кампанию.
 *
 * Решение: при инициации подключения авторизованный пользователь получает
 * криптослучайный nonce, серверно привязанный к campaignId и userId, с TTL и
 * одноразовостью. Callback обязан предъявить валидный state ДО любых admin
 * GET/PATCH. Replay, чужая кампания, протухший или отсутствующий state — отказ.
 *
 * Хранилище in-memory (как pendingOAuth для VK OAuth в этом же роутере): единый
 * процесс, рестарт обнуляет незавершённые подключения — пользователь начинает
 * заново. Секреты/nonce наружу и в логи не пишем.
 */

import crypto from 'crypto';

interface VkWebhookState {
  campaignId: string;
  userId: string;
  createdAt: number;
  used: boolean;
}

// needanapp-флоу (открыть сайт, получить токен, вставить URL) занимает минуты.
export const VK_WEBHOOK_STATE_TTL_MS = 30 * 60 * 1000;

const store = new Map<string, VkWebhookState>();

function sweep(now = Date.now()): void {
  for (const [nonce, s] of store) {
    if (now - s.createdAt > VK_WEBHOOK_STATE_TTL_MS) store.delete(nonce);
  }
}

export function createVkWebhookState(campaignId: string, userId: string): string {
  sweep();
  const nonce = crypto.randomBytes(32).toString('base64url');
  store.set(nonce, { campaignId, userId, createdAt: Date.now(), used: false });
  return nonce;
}

export type VkStateFailure = 'missing' | 'expired' | 'used' | 'campaign_mismatch';
export type ConsumeResult =
  | { ok: true; campaignId: string; userId: string }
  | { ok: false; reason: VkStateFailure };

/**
 * Проверяет и ГАСИТ state (одноразово). Возвращает ok только если nonce
 * существует, не протух, не использован и привязан к тому же campaignId.
 */
export function consumeVkWebhookState(
  nonce: string | undefined | null,
  campaignId: string,
): ConsumeResult {
  // Здесь НЕ вызываем sweep(): он удалил бы протухший nonce раньше явной
  // проверки, и replay/expired было бы не отличить от 'missing'. Память чистит
  // sweep() в create.
  if (!nonce) return { ok: false, reason: 'missing' };
  const s = store.get(nonce);
  if (!s) return { ok: false, reason: 'missing' };
  if (Date.now() - s.createdAt > VK_WEBHOOK_STATE_TTL_MS) {
    store.delete(nonce);
    return { ok: false, reason: 'expired' };
  }
  if (s.used) return { ok: false, reason: 'used' };
  if (s.campaignId !== campaignId) return { ok: false, reason: 'campaign_mismatch' };
  // Одноразовость: помечаем used, но оставляем до TTL — повтор ловится как
  // 'used' (осознанный replay), а не 'missing'.
  s.used = true;
  return { ok: true, campaignId: s.campaignId, userId: s.userId };
}

/** Только для тестов. */
export function __resetVkWebhookStateStore(): void {
  store.clear();
}

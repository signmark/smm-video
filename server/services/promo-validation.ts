/**
 * Серверная проверка промокода и расчёт итоговой цены.
 *
 * Почему отдельный модуль: те же правила нужны и в `/api/promo/validate` (клиент
 * показывает скидку в модалке), и в момент создания платежа. Раньше правила жили
 * только в роуте промокодов, а `POST /api/payments/create` брал готовую сумму с
 * фронта — то есть клиентская проверка работала как security boundary, и платёж
 * на 1 ₽ давал полный тариф. Проверка на фронте остаётся, но только ради UX:
 * сумма к списанию считается здесь и больше нигде.
 */

import { getRequiredServiceUrl } from "../config/service-urls";
const DIRECTUS_URL = getRequiredServiceUrl('DIRECTUS_URL');
const ADMIN_TOKEN =
  process.env.DIRECTUS_STATIC_TOKEN;

export type PromoType = 'discount' | 'extra_days' | 'pro_upgrade';

export interface PromoRecord {
  id: string;
  code: string;
  type: PromoType;
  value: number;
  description?: string | null;
  is_active?: boolean;
  expires_at?: string | null;
  max_uses?: number | null;
  used_count?: number | null;
}

export type PromoValidation =
  | { valid: true; promo: PromoRecord }
  | { valid: false; reason: string; message: string };

/** ЮКасса не принимает платёж дешевле рубля — ниже не опускаемся даже при скидке 100%. */
export const MIN_CHARGE_RUB = 1;

/**
 * Проверяет промокод для конкретного пользователя.
 *
 * Ошибка сети/Directus — это `valid: false`, а не «скидка есть»: не сумев проверить
 * код, скидку давать нельзя (fail-closed).
 */
export async function validatePromoCode(rawCode: string, userId: string): Promise<PromoValidation> {
  const code = String(rawCode || '').toUpperCase().trim();
  if (!code) return { valid: false, reason: 'empty', message: 'Укажите код' };
  if (!userId) return { valid: false, reason: 'no-user', message: 'Требуется авторизация' };

  try {
    const codeRes = await fetch(
      `${DIRECTUS_URL}/items/promo_codes?filter[code][_eq]=${encodeURIComponent(code)}&limit=1`,
      { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } },
    );
    if (!codeRes.ok) {
      return { valid: false, reason: 'lookup-failed', message: 'Не удалось проверить промокод' };
    }
    const codeData = await codeRes.json();
    const promo: PromoRecord | undefined = codeData?.data?.[0];

    if (!promo) return { valid: false, reason: 'not-found', message: 'Промокод не найден' };
    if (!promo.is_active) return { valid: false, reason: 'inactive', message: 'Промокод деактивирован' };
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
      return { valid: false, reason: 'expired', message: 'Срок действия промокода истёк' };
    }
    if (promo.max_uses !== null && promo.max_uses !== undefined && (promo.used_count ?? 0) >= promo.max_uses) {
      return { valid: false, reason: 'exhausted', message: 'Промокод исчерпал лимит использований' };
    }

    const usesRes = await fetch(
      `${DIRECTUS_URL}/items/promo_code_uses?filter[promo_code_id][_eq]=${encodeURIComponent(promo.id)}`
      + `&filter[user_id][_eq]=${encodeURIComponent(userId)}&limit=1`,
      { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } },
    );
    if (!usesRes.ok) {
      return { valid: false, reason: 'lookup-failed', message: 'Не удалось проверить промокод' };
    }
    const usesData = await usesRes.json();
    if (usesData?.data?.length > 0) {
      return { valid: false, reason: 'already-used', message: 'Вы уже использовали этот промокод' };
    }

    return { valid: true, promo };
  } catch (err: any) {
    console.error('[promo-validation] Ошибка проверки промокода:', err?.message);
    return { valid: false, reason: 'lookup-failed', message: 'Не удалось проверить промокод' };
  }
}

/**
 * Считает сумму к списанию. Скидку даёт только тип `discount`; `extra_days` и
 * `pro_upgrade` применяются отдельной ручкой `/api/promo/redeem` и на цену платежа
 * не влияют.
 *
 * Формула округления совпадает с витриной (`client/src/pages/pricing.tsx`), иначе
 * пользователь увидит одну цифру, а спишется другая.
 */
export function applyPromoDiscount(
  basePrice: number,
  promo: PromoRecord | null,
): { amount: number; discountPercent: number } {
  if (!promo || promo.type !== 'discount') return { amount: basePrice, discountPercent: 0 };

  const percent = Number(promo.value);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    return { amount: basePrice, discountPercent: 0 };
  }

  const discounted = Math.round(basePrice * (1 - percent / 100));
  return { amount: Math.max(MIN_CHARGE_RUB, discounted), discountPercent: percent };
}

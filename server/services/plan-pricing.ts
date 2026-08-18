import { globalApiKeysService } from './global-api-keys';
import { logEvent } from '../utils/logger';

/**
 * Единый источник «фактической» цены тарифа.
 *
 * Приоритет (фактическая цена — первой, дальше запасные переменные):
 *   1. Directus global_api_keys  (PLAN_PRICE_<KEY> / _ORIGINAL)
 *   2. env                       (PLAN_PRICE_<KEY>, затем VITE_PLAN_PRICE_<KEY>)
 *   3. хардкод-fallback          (только если ничего выше не задано)
 *
 * Раньше эту цепочку дублировали routes.ts (/api/config/pricing) и subscriptions.ts,
 * а платёж (yookassa.ts) вообще брал отдельный хардкод 670 — из-за чего списываемая
 * сумма расходилась с ценой на витрине. Теперь и витрина, и письма, и платёж берут
 * цену отсюда.
 */

export type PlanPriceKey = 'pro' | 'basic';

const FALLBACKS: Record<PlanPriceKey, { price: number; original: number }> = {
  pro: { price: 670, original: 1990 },
  basic: { price: 390, original: 990 },
};

async function getNum(key: string, fallback: number): Promise<number> {
  try {
    const val = await globalApiKeysService.getGlobalApiKey(key);
    if (val) return Number(val);
  } catch (e: any) {
    // AI-65. Дальше подставится значение из окружения или зашитое в код. Человеку
    // покажут цену, и он по ней заплатит — а настроенная владельцем цена при этом
    // молча не применилась. Расхождение обнаруживалось только при сверке.
    logEvent(
      'plan.price_source_unavailable',
      { operation: 'resolve-price', reason: e?.message ? String(e.message) : 'unknown' },
      'warn',
      'plan-pricing',
      'Настроенная цена не прочитана — показывается запасная',
    );
  }
  return Number(process.env[key] ?? process.env[`VITE_${key}`] ?? fallback);
}

export async function resolvePlanPrice(
  key: PlanPriceKey,
): Promise<{ price: number; original: number }> {
  const fb = FALLBACKS[key];
  const upper = key.toUpperCase();
  const [price, original] = await Promise.all([
    getNum(`PLAN_PRICE_${upper}`, fb.price),
    getNum(`PLAN_PRICE_${upper}_ORIGINAL`, fb.original),
  ]);
  return { price, original };
}

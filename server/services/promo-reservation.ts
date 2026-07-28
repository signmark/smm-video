/**
 * Атомарное резервирование скидочного промокода под конкретный платёж.
 *
 * Находка ревью: промокод только проверялся и записывался в metadata платежа. Ни
 * `promo_code_uses`, ни `used_count` в платёжном потоке не трогались — один
 * пользователь мог получать скидку сколько угодно раз, а `max_uses` не расходовался.
 *
 * Схема держится на трёх уникальных индексах одной строки `promo_reservations`
 * (коллекция заводится `scripts/directus/create_payment_collections.js`):
 *
 *   payment_id — одна бронь на платёж. Повторный вызов идемпотентен.
 *   user_lock  — `<promo>:<user>`, один скидочный код одному пользователю один раз.
 *   slot_lock  — `<promo>:#<n>`, n-е использование кода.
 *
 * Вставка либо проходит целиком, либо отвергается по первому же занятому ключу, —
 * то есть проверка и захват неразделимы. Read-then-increment счётчика `used_count`
 * здесь принципиально не используется: два параллельных запроса прочитали бы одно
 * число и оба записали бы одно и то же, пропустив лишнее использование.
 *
 * `max_uses` соблюдается через слоты: претендент вычисляет номер слота и пытается его
 * занять; проигравший в гонке получает конфликт уникальности и берёт следующий номер.
 * Когда номера кончились — код исчерпан.
 *
 * Брошенный платёж код не сжигает: `release` обнуляет `user_lock` и `slot_lock`
 * (в Postgres уникальный индекс допускает сколько угодно NULL), и слот снова свободен.
 */

import { log } from '../utils/logger';
import type { PromoRecord } from './promo-validation';

const COLLECTION = 'promo_reservations';

/** Сколько попыток занять слот подряд, прежде чем сдаться. */
const MAX_SLOT_ATTEMPTS = 25;

function directusUrl(): string {
  return process.env.DIRECTUS_URL || '';
}

function adminToken(): string {
  return (
    process.env.DIRECTUS_STATIC_TOKEN
    || process.env.DIRECTUS_ADMIN_TOKEN
    || process.env.DIRECTUS_TOKEN
    || ''
  );
}

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${adminToken()}`, 'Content-Type': 'application/json' };
}

export class PromoReservationUnavailableError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(`promo-reservation: ${message}`);
    this.name = 'PromoReservationUnavailableError';
  }
}

export type ReserveResult =
  | { ok: true; reservationId: string; slotIndex: number }
  | { ok: false; reason: 'already-used'; message: string }
  | { ok: false; reason: 'exhausted'; message: string };

function isUniqueViolation(body: string): boolean {
  return /unique|RECORD_NOT_UNIQUE|has to be unique|duplicate/i.test(body);
}

async function query(path: string): Promise<any[]> {
  const res = await fetch(`${directusUrl()}/items/${COLLECTION}${path}`, {
    headers: { Authorization: `Bearer ${adminToken()}` },
  });
  if (!res.ok) throw new PromoReservationUnavailableError(`чтение броней → ${res.status}`);
  const data = await res.json();
  return data?.data ?? [];
}

/** Готова ли коллекция броней. Без неё скидочные коды в оплате запрещены. */
export async function isReservationStoreReady(): Promise<boolean> {
  try {
    if (!directusUrl() || !adminToken()) return false;
    const res = await fetch(`${directusUrl()}/items/${COLLECTION}?limit=1&fields=id`, {
      headers: { Authorization: `Bearer ${adminToken()}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Бронь по платежу, если есть. */
export async function getReservationByPayment(paymentId: string): Promise<any | null> {
  const rows = await query(`?filter[payment_id][_eq]=${encodeURIComponent(paymentId)}&limit=1`);
  return rows[0] ?? null;
}

/** Сколько слотов кода занято сейчас (брони и погашения; освобождённые не считаются). */
async function activeUses(promoId: string): Promise<number> {
  const rows = await query(
    `?filter[promo_code_id][_eq]=${encodeURIComponent(promoId)}`
    + `&filter[status][_in]=reserved,completed&limit=-1&fields=slot_index,status`,
  );
  return rows.length;
}

async function releaseRow(rowId: string, reason: string): Promise<void> {
  const res = await fetch(`${directusUrl()}/items/${COLLECTION}/${rowId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({
      status: 'released',
      released_at: new Date().toISOString(),
      // Обнуление замков и есть освобождение: NULL уникальному индексу не мешает.
      user_lock: null,
      slot_lock: null,
    }),
  });
  if (!res.ok) throw new PromoReservationUnavailableError(`освобождение брони → ${res.status}`);
  log(`[promo] Бронь ${rowId} освобождена: ${reason}`, 'promo', 'warn');
}

/**
 * Освобождает брони, чьи платежи уже не состоятся. Возвращает, сколько освободила.
 */
async function reclaimDeadReservations(
  promoId: string,
  isSlotHolderDead: (holder: { yookassa_payment_id?: string | null; reserved_at?: string | null }) => Promise<boolean>,
): Promise<number> {
  const held = await query(
    `?filter[promo_code_id][_eq]=${encodeURIComponent(promoId)}&filter[status][_eq]=reserved&limit=-1`,
  );
  let freed = 0;
  for (const row of held) {
    try {
      if (await isSlotHolderDead(row)) {
        await releaseRow(row.id, `платёж брони ${row.payment_id} не состоится`);
        freed++;
      }
    } catch (err: any) {
      log(`[promo] Не удалось проверить бронь ${row.payment_id}: ${err?.message}`, 'promo', 'warn');
    }
  }
  return freed;
}

/**
 * Занимает скидочный промокод под платёж.
 *
 * `isSlotHolderDead` — необязательная проверка «платёж, державший слот, не состоится».
 * Передаётся снаружи, чтобы этот модуль не зависел от ЮКассы. Освобождаем чужую бронь
 * по подтверждённому статусу платежа, а не по одному лишь таймауту: догадка здесь
 * означала бы выдачу лишней скидки.
 */
export async function reservePromo(params: {
  promo: PromoRecord;
  userId: string;
  /** Наш order_id: бронь берётся до создания платежа, id ЮКассы ещё не существует. */
  paymentId: string;
  isSlotHolderDead?: (holder: { yookassa_payment_id?: string | null; reserved_at?: string | null }) => Promise<boolean>;
}): Promise<ReserveResult> {
  const { promo, userId, paymentId, isSlotHolderDead } = params;
  const promoId = String(promo.id);
  const userLock = `${promoId}:${userId}`;
  const maxUses = promo.max_uses ?? null;

  // Бронь по этому платежу уже есть — повторный вызов ничего не меняет.
  const existing = await getReservationByPayment(paymentId);
  if (existing) {
    if (existing.status === 'released') {
      return { ok: false, reason: 'already-used', message: 'Бронь по этому платежу отменена' };
    }
    return { ok: true, reservationId: existing.id, slotIndex: existing.slot_index ?? -1 };
  }

  let slot = await activeUses(promoId);
  let reclaimTried = false;

  for (let attempt = 0; attempt < MAX_SLOT_ATTEMPTS; attempt++) {
    if (maxUses !== null && slot >= maxUses) {
      // Прежде чем объявить код исчерпанным, освобождаем слоты, которые держат
      // платежи, уже точно не состоявшиеся. Без этого брошенная оплата сжигала бы
      // промокод навсегда — а проверка «мёртв ли держатель» до сюда просто не
      // доходила, потому что счётчик отсекал раньше вставки.
      if (!reclaimTried && isSlotHolderDead) {
        reclaimTried = true;
        const freed = await reclaimDeadReservations(promoId, isSlotHolderDead);
        if (freed > 0) {
          slot = await activeUses(promoId);
          continue;
        }
      }
      return { ok: false, reason: 'exhausted', message: 'Промокод исчерпал лимит использований' };
    }

    const res = await fetch(`${directusUrl()}/items/${COLLECTION}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        payment_id: paymentId,
        promo_code_id: promoId,
        user_id: userId,
        user_lock: userLock,
        slot_lock: `${promoId}:#${slot}`,
        slot_index: slot,
        status: 'reserved',
        reserved_at: new Date().toISOString(),
      }),
    });

    if (res.ok) {
      const created = await res.json();
      return { ok: true, reservationId: created?.data?.id, slotIndex: slot };
    }

    const body = await res.text();
    if (!isUniqueViolation(body)) {
      throw new PromoReservationUnavailableError(`бронирование → ${res.status}: ${body.slice(0, 200)}`);
    }

    // Конфликт уникальности. Выясняем, какой именно замок занят.
    const byUser = await query(`?filter[user_lock][_eq]=${encodeURIComponent(userLock)}&limit=1`);
    if (byUser.length > 0) {
      return { ok: false, reason: 'already-used', message: 'Вы уже использовали этот промокод' };
    }

    const bySlot = await query(`?filter[slot_lock][_eq]=${encodeURIComponent(`${promoId}:#${slot}`)}&limit=1`);
    const holder = bySlot[0];

    // Слот держит бронь под платёж, который уже отменён — освобождаем и пробуем снова
    // этот же номер. Иначе просто берём следующий.
    if (holder && holder.status === 'reserved' && isSlotHolderDead) {
      try {
        if (await isSlotHolderDead(holder)) {
          await releaseRow(holder.id, `платёж брони ${holder.payment_id} не состоится`);
          continue;
        }
      } catch (err: any) {
        log(`[promo] Не удалось проверить бронь ${holder.payment_id}: ${err?.message}`, 'promo', 'warn');
      }
    }

    slot++;
  }

  throw new PromoReservationUnavailableError('не удалось занять слот за отведённое число попыток');
}

/**
 * Погашает бронь после успешной активации подписки. Идемпотентно: повторный вызов по
 * уже погашенной броне ничего не меняет.
 */
export async function completePromoReservation(paymentId: string): Promise<{ completed: boolean; promoId?: string; userId?: string }> {
  const row = await getReservationByPayment(paymentId);
  if (!row) return { completed: false };
  if (row.status === 'completed') return { completed: false, promoId: row.promo_code_id, userId: row.user_id };
  if (row.status === 'released') return { completed: false };

  const res = await fetch(`${directusUrl()}/items/${COLLECTION}/${row.id}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ status: 'completed', completed_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new PromoReservationUnavailableError(`погашение брони → ${res.status}`);

  return { completed: true, promoId: row.promo_code_id, userId: row.user_id };
}

/** Привязывает к брони id платежа ЮКассы — по нему потом сверяется её судьба. */
export async function attachPaymentId(orderId: string, yookassaPaymentId: string): Promise<void> {
  const row = await getReservationByPayment(orderId);
  if (!row) return;
  await fetch(`${directusUrl()}/items/${COLLECTION}/${row.id}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ yookassa_payment_id: yookassaPaymentId }),
  }).catch(() => {});
}

/** Освобождает бронь: платёж не состоялся, код должен остаться доступным. */
export async function releasePromoReservation(paymentId: string, reason: string): Promise<void> {
  const row = await getReservationByPayment(paymentId);
  if (!row || row.status !== 'reserved') return;
  await releaseRow(row.id, reason);
}

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
import { getRequiredServiceUrl } from "../config/service-urls";
import type { PromoRecord } from './promo-validation';

const COLLECTION = 'promo_reservations';

/**
 * Запас попыток СВЕРХ ёмкости кода.
 *
 * Раньше здесь стояло жёсткое 25, и при 26 одновременных покупателях промокод
 * ложно отвечал «исчерпан» или 503, хотя свободные слоты были: каждый проигрыш
 * в гонке съедал попытку (находка ревью 2026-07-29). Теперь лимит считается от
 * фактической ёмкости, а запас покрывает конкурентные конфликты.
 */
const SLOT_ATTEMPT_MARGIN = 100;

/**
 * Сколько попыток подряд БЕЗ наблюдаемого прогресса считаем безнадёжными.
 *
 * Для кода без `max_uses` здесь раньше стоял жёсткий потолок в 200 попыток. Это
 * скрытая бизнес-ёмкость: 201-й одновременный покупатель мог проиграть гонки за
 * слоты 0..199 и получить ошибку, хотя слот 200 свободен, — у кода «без лимита»
 * появлялся лимит (находка ревью 2026-07-29, P3).
 *
 * Считать попытки от числа покупателей нельзя — оно и есть неизвестное. Поэтому
 * критерий не «сколько раз мы попробовали», а «двигается ли вообще система»:
 * пока занятость слотов меняется между попытками, конкуренты делают прогресс и
 * ждать имеет смысл. Как только столько попыток подряд не изменили картину —
 * это уже не гонка, а зацикливание, и лучше отдать retryable-ошибку.
 */
const NO_PROGRESS_ATTEMPTS = 100;

/**
 * Потолок попыток для кода с известной ёмкостью — пропорционален ей.
 * `null` означает «ограничения по числу попыток нет, критерий — прогресс».
 */
function slotAttemptBudget(maxUses: number | null): number | null {
  if (maxUses === null) return null;
  return maxUses + SLOT_ATTEMPT_MARGIN;
}

/** Снимок занятости — по нему видно, изменилось ли состояние между попытками. */
function occupancySignature(occupied: Set<number>): string {
  let max = -1;
  for (const n of occupied) if (n > max) max = n;
  return `${occupied.size}:${max}`;
}

function directusUrl(): string {
  return getRequiredServiceUrl('DIRECTUS_URL');
}

function adminToken(): string {
  return (
    process.env.DIRECTUS_STATIC_TOKEN
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
  // Строго массив: Directus на некоторых ответах отдаёт объект, а вызывающие
  // перебирают результат — молчаливый `{}` здесь ронял бы создание платежа.
  return Array.isArray(data?.data) ? data.data : [];
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

/**
 * Фиксирует, что по этой брони НАЧАТО обращение к платёжной системе.
 *
 * Ключ к денежному инварианту (находка ревью 2026-07-29). Бронь без
 * `yookassa_payment_id` раньше через 30 минут объявлялась сиротой — «процесс
 * умер между бронированием и созданием платежа, висеть ей незачем». Но ровно
 * так же выглядит и совсем другой случай: платёж создан, а привязка сорвалась.
 * По одному пустому полю эти два состояния неотличимы, и автоматика выбирала
 * то, что дороже: освобождала слот под живым платежом.
 *
 * Маркер ставится ДО обращения к ЮКассе и разделяет их однозначно: нет
 * маркера — до платёжной системы не дошли, сирота; есть маркер и нет
 * `yookassa_payment_id` — внешний платёж мог быть создан, слот держим.
 *
 * Ошибка записи НЕ проглатывается: если маркер не встал, платёж создавать
 * нельзя — иначе возвращается ровно та неразличимость, ради которой он и нужен.
 * Вызывающий обязан прервать оплату, а бронь освободится штатным путём.
 */
export async function markPaymentAttempt(orderId: string): Promise<void> {
  const row = await getReservationByPayment(orderId);
  // Ручка зовёт это только при живой брони. Нет строки — либо бронь исчезла
  // между резервированием и оплатой, либо Directus отдал пустой ответ на сбое.
  // Молчаливый возврат означал бы «маркер поставлен», и слот потом освободили
  // бы как сироту при живом платеже. Прерываем оплату.
  if (!row) {
    throw new PromoReservationUnavailableError(
      `бронь по заказу ${orderId} не найдена — отметить начало оплаты не по чему`,
    );
  }

  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${directusUrl()}/items/${COLLECTION}/${row.id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ payment_attempt_at: new Date().toISOString() }),
      });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err: any) {
      lastError = err?.message || 'network error';
    }
  }

  throw new PromoReservationUnavailableError(
    `не удалось отметить начало оплаты по брони ${row.id}: ${lastError}`,
  );
}

/**
 * Помечает бронь как требующую ручного разбора и оставляет причину.
 *
 * Нужна там, где автоматика не смогла привести систему к однозначному
 * состоянию: платёж в ЮКассе создан, связать его с бронью не удалось, а отмену
 * платежа подтвердить не получилось. Такую бронь освобождать НЕЛЬЗЯ — иначе
 * скидку получат дважды. Пусть слот останется занятым, а расхождение будет
 * видно.
 *
 * Ответ Directus проверяется: раньше success-лог «помечена на ручной разбор»
 * писался и после HTTP 500, то есть расхождение оставалось невидимым ровно
 * тогда, когда оно и возникало (находка ревью 2026-07-29).
 *
 * Бросать наружу всё же не начинаем — вызывающий и так идёт по ветке отказа, —
 * но денежный инвариант на этот флаг больше не опирается: слот удерживает
 * `payment_attempt_at`, который встал раньше и по другому пути.
 *
 * @param extra дополнительные поля, которые обязаны лечь ТЕМ ЖЕ PATCH. Сюда
 *        передаётся `yookassa_payment_id`, если штатный `attachPaymentId` не
 *        справился: разбирать расхождение руками без id платежа невозможно, а
 *        отдельным запросом он мог бы не долететь и остаться потерянным
 *        (требование handoff 29.07.2026). Одна операция — либо оба поля, либо ни одного.
 * @returns удалось ли фактически поставить пометку
 */
export async function flagReservationReconciliation(
  paymentId: string,
  reason: string,
  extra: Record<string, any> = {},
): Promise<boolean> {
  let lastError = '';
  try {
    const row = await getReservationByPayment(paymentId);
    if (!row) return false;

    const patchOnce = async (payload: Record<string, any>): Promise<boolean> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(`${directusUrl()}/items/${COLLECTION}/${row.id}`, {
            method: 'PATCH',
            headers: headers(),
            body: JSON.stringify(payload),
          });
          if (res.ok) return true;
          lastError = `HTTP ${res.status}`;
        } catch (err: any) {
          lastError = err?.message || 'network error';
        }
      }
      return false;
    };

    const marker = { needs_reconciliation: true, last_error: reason.slice(0, 500) };

    if (await patchOnce({ ...extra, ...marker })) {
      log(`[promo] Бронь ${row.id} помечена на ручной разбор: ${reason}`, 'promo', 'error');
      return true;
    }

    // Сюда попадаем, когда совместная запись не прошла. Причина сбоя привязки
    // могла быть именно в поле `yookassa_payment_id` — тогда пометка утонет
    // вместе с ним, а она нужнее: без неё реклеймер снова считает бронь своей.
    // Поэтому последний заход — только маркер, без дополнительных полей.
    if (Object.keys(extra).length > 0 && await patchOnce(marker)) {
      log(
        `[promo] Бронь ${row.id} помечена на ручной разбор БЕЗ сопутствующих полей `
        + `(${Object.keys(extra).join(', ')} записать не удалось: ${lastError}): ${reason}`,
        'promo',
        'error',
      );
      return true;
    }

    log(
      `[promo] СВЕРКА: бронь ${row.id} требует разбора (${reason}), но пометку записать не удалось: ${lastError}. `
      + `Слот остаётся занятым по payment_attempt_at.`,
      'promo',
      'error',
    );
    return false;
  } catch (err: any) {
    log(`[promo] Не удалось пометить бронь на разбор (${paymentId}): ${err?.message}`, 'promo', 'error');
    return false;
  }
}

/** Бронь по платежу, если есть. */
export async function getReservationByPayment(paymentId: string): Promise<any | null> {
  const rows = await query(`?filter[payment_id][_eq]=${encodeURIComponent(paymentId)}&limit=1`);
  return rows[0] ?? null;
}

/**
 * Номера слотов, занятых прямо сейчас (брони и погашения; освобождённые — нет).
 *
 * Раньше здесь считалось только КОЛИЧЕСТВО занятых, и претендент стартовал с
 * него, двигаясь только вверх. Освобождённый слот с номером ниже верхней границы
 * не пробовался никогда: при `max_uses=3` и одном сорвавшемся платеже код
 * отвечал «исчерпан», хотя занято было 2 из 3 (находка ревью 2026-07-28).
 */
async function occupiedSlots(promoId: string): Promise<Set<number>> {
  const rows = await query(
    `?filter[promo_code_id][_eq]=${encodeURIComponent(promoId)}`
    + `&filter[status][_in]=reserved,completed&limit=-1&fields=slot_index,status`,
  );

  const occupied = new Set<number>();
  for (const row of rows) {
    const index = Number(row?.slot_index);
    if (Number.isInteger(index) && index >= 0) occupied.add(index);
  }
  return occupied;
}

/**
 * Минимальный свободный номер слота из [0, maxUses) — то есть «дыра» в нумерации
 * переиспользуется. `null` означает, что свободных номеров не осталось.
 *
 * Для кодов без `max_uses` номера не ограничены сверху: ищем первую дыру, а её
 * заведомо найдём не позже чем за `occupied.size + 1` шагов.
 */
function nextFreeSlot(occupied: Set<number>, maxUses: number | null): number | null {
  const limit = maxUses ?? occupied.size + 1;
  for (let n = 0; n < limit; n++) {
    if (!occupied.has(n)) return n;
  }
  return null;
}

/**
 * Условный переход состояния брони — единственный способ её менять.
 *
 * Раньше и `releaseRow`, и погашение делали read-then-PATCH по id: прочитали
 * статус, потом безусловно записали новый. Между чтением и записью реклеймер
 * успевал освободить бронь, которую в этот же момент погашал вебхук, — и
 * оплаченная скидка исчезала, либо, наоборот, погашенная бронь обнулялась
 * (находка ревью 2026-07-29).
 *
 * Здесь используется update-by-query Directus: фильтр включает и `id`, и
 * ОЖИДАЕМЫЙ статус, поэтому условие проверяется той же операцией, что и запись.
 * Проигравший гонку получает пустой массив изменённых строк, а не «успех».
 *
 * @returns изменённая строка, либо `null` если переход не состоялся (кто-то
 *          успел раньше и статус уже не `from`).
 */
async function transitionReservation(
  rowId: string,
  from: 'reserved' | 'completed',
  patch: Record<string, any>,
  extraFilter: Record<string, any> = {},
): Promise<any | null> {
  const res = await fetch(`${directusUrl()}/items/${COLLECTION}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({
      query: {
        filter: {
          id: { _eq: rowId },
          // Условие перехода. Directus применит изменение только к строкам,
          // которые ему удовлетворяют ПРЯМО СЕЙЧАС.
          status: { _eq: from },
          ...extraFilter,
        },
      },
      data: patch,
    }),
  });

  if (!res.ok) {
    throw new PromoReservationUnavailableError(`переход брони ${from} → ${patch.status} → ${res.status}`);
  }

  const body = await res.json();
  const updated = Array.isArray(body?.data) ? body.data : [];
  // Пустой массив означает «условие не выполнилось»: строка уже в другом
  // состоянии. Это штатный исход гонки, а не ошибка.
  return updated.length > 0 ? updated[0] : null;
}

/**
 * Освобождает бронь. Только из `reserved`: погашенную бронь освободить нельзя
 * никаким путём — иначе оплаченная скидка пропадала бы.
 *
 * @returns true, если освободили именно мы.
 */
async function releaseRow(rowId: string, reason: string, opts: { onlyIfNotFlagged?: boolean } = {}): Promise<boolean> {
  const updated = await transitionReservation(
    rowId,
    'reserved',
    {
      status: 'released',
      released_at: new Date().toISOString(),
      // Обнуление замков и есть освобождение: NULL уникальному индексу не мешает.
      user_lock: null,
      slot_lock: null,
    },
    // Автоматический реклейм не имеет права трогать бронь, отложенную на ручной
    // разбор. Условие идёт В ФИЛЬТР перехода, а не проверяется отдельным чтением:
    // между чтением и записью пометку могли поставить, и проверка бы её проспала.
    // «Не помечена» — это NULL ЛИБО false, и написать это нужно явно.
    //
    // Раньше здесь стоял один `_neq: true`. Directus (проверено на боевом
    // 11.2.2) ведёт себя как SQL: `<> true` НЕ пропускает NULL, потому что
    // сравнение с NULL даёт unknown. А `needs_reconciliation` — nullable, и у
    // всех броней, заведённых до появления этого поля, там именно NULL.
    // То есть условие отсекало не только помеченные строки, но и всё легаси:
    // такие брони не освобождались никогда и держали слот скидки вечно.
    //
    // Мой прежний тест этого не поймал, потому что fake Directus моделировал
    // `_neq` наоборот — считал NULL проходящим (находка приёмки 30.07.2026).
    opts.onlyIfNotFlagged
      ? { _or: [{ needs_reconciliation: { _null: true } }, { needs_reconciliation: { _eq: false } }] }
      : {},
  );

  if (!updated) {
    log(`[promo] Бронь ${rowId} освободить не удалось: уже не в состоянии reserved (${reason})`, 'promo', 'warn');
    return false;
  }

  log(`[promo] Бронь ${rowId} освобождена: ${reason}`, 'promo', 'warn');
  return true;
}

/** Бронь отложена на ручной разбор — автоматике её трогать нельзя. */
function isFlaggedForReconciliation(row: any): boolean {
  return row?.needs_reconciliation === true || row?.needs_reconciliation === 'true';
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
    // Бронь на ручном разборе автоматика не трогает НИКОГДА: её оставили
    // занятой намеренно, потому что платёж по ней, возможно, жив.
    if (isFlaggedForReconciliation(row)) {
      log(`[promo] Бронь ${row.payment_id} на ручном разборе — реклейм пропущен`, 'promo', 'warn');
      continue;
    }
    try {
      if (await isSlotHolderDead(row)) {
        await releaseRow(row.id, `платёж брони ${row.payment_id} не состоится`, { onlyIfNotFlagged: true });
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

  let occupied = await occupiedSlots(promoId);
  let reclaimTried = false;

  const attemptBudget = slotAttemptBudget(maxUses);
  // Прогресс наблюдаем по занятости: пока она меняется, конкуренты двигаются.
  let signature = occupancySignature(occupied);
  let stalled = 0;
  let attempt = 0;

  /** Учесть перечитанное состояние: сбросить или увеличить счётчик простоя. */
  const noteProgress = () => {
    const next = occupancySignature(occupied);
    if (next === signature) stalled++;
    else { stalled = 0; signature = next; }
  };

  for (
    ;
    attemptBudget === null ? stalled < NO_PROGRESS_ATTEMPTS : attempt < attemptBudget;
    attempt++
  ) {
    const slot = nextFreeSlot(occupied, maxUses);

    if (slot === null) {
      // Прежде чем объявить код исчерпанным, освобождаем слоты, которые держат
      // платежи, уже точно не состоявшиеся. Без этого брошенная оплата сжигала бы
      // промокод навсегда — а проверка «мёртв ли держатель» до сюда просто не
      // доходила, потому что счётчик отсекал раньше вставки.
      if (!reclaimTried && isSlotHolderDead) {
        reclaimTried = true;
        const freed = await reclaimDeadReservations(promoId, isSlotHolderDead);
        if (freed > 0) {
          occupied = await occupiedSlots(promoId);
          noteProgress();
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
    const userHolder = byUser[0];
    if (userHolder) {
      // Замок держит бронь ЭТОГО же пользователя. Если её платёж не состоится,
      // освобождаем и пробуем снова: иначе брошенная оплата запирала бы код за
      // пользователем навсегда — повторить попытку он не мог никогда, а для кодов
      // без max_uses сюда не доходил и общий reclaim (находка ревью 2026-07-28).
      if (userHolder.status === 'reserved' && !isFlaggedForReconciliation(userHolder) && isSlotHolderDead) {
        try {
          if (await isSlotHolderDead(userHolder)) {
            await releaseRow(userHolder.id, `платёж брони ${userHolder.payment_id} не состоится`, { onlyIfNotFlagged: true });
            occupied = await occupiedSlots(promoId);
          noteProgress();
            continue;
          }
        } catch (err: any) {
          log(`[promo] Не удалось проверить бронь ${userHolder.payment_id}: ${err?.message}`, 'promo', 'warn');
        }
      }
      return { ok: false, reason: 'already-used', message: 'Вы уже использовали этот промокод' };
    }

    const bySlot = await query(`?filter[slot_lock][_eq]=${encodeURIComponent(`${promoId}:#${slot}`)}&limit=1`);
    const holder = bySlot[0];

    // Слот держит бронь под платёж, который уже отменён — освобождаем и пробуем снова
    // этот же номер. Иначе помечаем номер занятым и берём следующий свободный.
    if (holder && holder.status === 'reserved' && !isFlaggedForReconciliation(holder) && isSlotHolderDead) {
      try {
        if (await isSlotHolderDead(holder)) {
          await releaseRow(holder.id, `платёж брони ${holder.payment_id} не состоится`, { onlyIfNotFlagged: true });
          occupied = await occupiedSlots(promoId);
          noteProgress();
          continue;
        }
      } catch (err: any) {
        log(`[promo] Не удалось проверить бронь ${holder.payment_id}: ${err?.message}`, 'promo', 'warn');
      }
    }

    // Гонку за этот номер мы проиграли. Пока мы ходили в Directus, соседние
    // запросы могли и занять, и освободить любые слоты — поэтому перечитываем
    // фактическое состояние, и оно же единственный источник истины.
    //
    // Раньше здесь стоял ещё и безусловный `occupied.add(slot)`. Он ломал
    // ровно тот случай, ради которого перечитывание и делается: если победитель
    // успел освободить слот между конфликтом и перечитыванием, слот свободен, а
    // пометка снова объявляла его занятым. При max_uses=1 свободных номеров
    // после этого не оставалось, и второй покупатель получал «промокод
    // исчерпан» на пустом коде (находка ревью 2026-07-29).
    //
    // Живой держатель и так присутствует в перечитанном множестве, а
    // исчезнувший — нет, и тот же номер честно пробуется снова. Цикл при этом
    // остаётся конечным: код с ёмкостью ограничен attemptBudget, код без неё —
    // требованием наблюдаемого прогресса.
    occupied = await occupiedSlots(promoId);
    noteProgress();
  }

  throw new PromoReservationUnavailableError(
    attemptBudget === null
      ? `не удалось занять слот: ${NO_PROGRESS_ATTEMPTS} попыток подряд без изменений занятости `
        + `(${attempt} всего, код без лимита)`
      : `не удалось занять слот за ${attemptBudget} попыток (ёмкость ${maxUses})`,
  );
}

/**
 * Погашает бронь после успешной активации подписки. Идемпотентно: повторный вызов по
 * уже погашенной броне ничего не меняет.
 */
export async function completePromoReservation(paymentId: string): Promise<{
  completed: boolean;
  /** Бронь уже погашена — этим же платежом, повторным вызовом. Финализация не нужна. */
  alreadyCompleted?: boolean;
  /** Бронь освобождена раньше, чем платёж дошёл: расхождение, чинится вручную. */
  releasedBeforeCompletion?: boolean;
  promoId?: string;
  userId?: string;
}> {
  const row = await getReservationByPayment(paymentId);
  if (!row) return { completed: false };

  // Переход условный: `reserved → completed` выигрывает ровно один вызов.
  // Реклеймер, дошедший до этой строки одновременно, увидит статус completed и
  // освободить её уже не сможет — releaseRow тоже ходит через CAS.
  const updated = await transitionReservation(row.id, 'reserved', {
    status: 'completed',
    completed_at: new Date().toISOString(),
  });

  if (updated) {
    return { completed: true, promoId: row.promo_code_id, userId: row.user_id };
  }

  // Условие не выполнилось — перечитываем, чтобы отличить «уже погашено» от
  // «успели освободить». Второе означает, что скидку мог получить кто-то другой.
  const current = await getReservationByPayment(paymentId);
  if (current?.status === 'completed') {
    return { completed: false, alreadyCompleted: true, promoId: current.promo_code_id, userId: current.user_id };
  }
  if (current?.status === 'released') {
    log(
      `[promo] СВЕРКА: платёж ${paymentId} успешен, но бронь ${row.id} была освобождена раньше погашения`,
      'promo',
      'error',
    );
    return { completed: false, releasedBeforeCompletion: true, promoId: current.promo_code_id, userId: current.user_id };
  }

  return { completed: false };
}

/**
 * Привязывает к брони id платежа ЮКассы — по нему потом сверяется её судьба.
 *
 * Сбой здесь НЕ проглатывается. Бронь без `yookassa_payment_id` через 30 минут
 * считается брошенной и реклеймится, а платёж при этом может быть настоящим:
 * деньги списаны, скидка отдана другому — расхождение, которое чинится только
 * руками (находка ревью 2026-07-28). Пара повторов покрывает сетевой всплеск,
 * дальше вызывающий обязан узнать об ошибке.
 */
export async function attachPaymentId(orderId: string, yookassaPaymentId: string): Promise<void> {
  const row = await getReservationByPayment(orderId);
  // Как и в markPaymentAttempt: пропажа строки — аномалия, а не «нечего
  // делать». Тихий возврат оставлял бы платёж без связи с бронью, и через
  // 30 минут слот ушёл бы другому покупателю.
  if (!row) {
    throw new PromoReservationUnavailableError(
      `бронь по заказу ${orderId} не найдена — платёж ${yookassaPaymentId} привязать не к чему`,
    );
  }

  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${directusUrl()}/items/${COLLECTION}/${row.id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ yookassa_payment_id: yookassaPaymentId }),
      });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err: any) {
      lastError = err?.message || 'network error';
    }
  }

  throw new PromoReservationUnavailableError(
    `не удалось привязать платёж ${yookassaPaymentId} к брони ${row.id}: ${lastError}`,
  );
}

/** Освобождает бронь: платёж не состоялся, код должен остаться доступным. */
export async function releasePromoReservation(paymentId: string, reason: string): Promise<void> {
  const row = await getReservationByPayment(paymentId);
  if (!row || row.status !== 'reserved') return;
  await releaseRow(row.id, reason);
}

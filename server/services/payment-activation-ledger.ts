/**
 * Журнал обработанных платежей — защита от повторной активации подписки.
 *
 * Один succeeded-платёж должен выдавать 30 дней ровно один раз. Без журнала каждый
 * повторный вызов `/activate` двигал `expire_date` ещё на 30 дней от «сейчас», слал
 * ещё одно Telegram-уведомление и ещё один partner postback.
 *
 * **Только durable-хранилище.** Прежняя версия при недоступности Directus падала на
 * запасной журнал в памяти процесса. В проде коллекции тогда не было, то есть журнал
 * был в памяти ВСЕГДА — и после каждого рестарта контейнера старый успешный paymentId
 * можно было активировать заново. Запасной путь удалён целиком: если журнала нет,
 * оплата выключается (см. `isLedgerReady`), а не работает без защиты.
 *
 * **Атомарность** держится на уникальном индексе `payment_id`: захват — это сама
 * вставка строки. Кто вставил, тот и активирует; всем остальным Directus отвечает
 * нарушением уникальности. Проверка «нет ли уже такой строки» отдельным запросом не
 * годится — между SELECT и INSERT помещается второй запрос.
 *
 * Коллекция заводится `scripts/directus/create_payment_collections.js` (штатный
 * механизм схемы: сервисный токен прав на DDL не имеет).
 */

import { log } from '../utils/logger';

const COLLECTION = 'payment_activations';

/** Сколько «зависшая» заявка считается живой, прежде чем уйти на разбор вручную. */
const STALE_CLAIM_MS = 15 * 60 * 1000;

/** Насколько кешируется ответ «журнал готов». */
const READINESS_TTL_MS = 60 * 1000;

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

/**
 * Журнал недоступен. Отдельный класс, потому что вызывающий обязан различать
 * «платёж уже обработан» (успех) и «мы не смогли это выяснить» (повторяемая ошибка).
 */
export class LedgerUnavailableError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(`payment-activation-ledger: ${message}`);
    this.name = 'LedgerUnavailableError';
  }
}

export interface PaymentClaimInfo {
  paymentId: string;
  userId: string;
  plan: string;
  amount: string;
  currency: string;
  /** Откуда пришла активация — для разбора инцидентов. */
  source: 'activate' | 'webhook';
}

export type ClaimResult =
  | { claimed: true; recordId: string }
  | { claimed: false; reason: 'already-processed' }
  /**
   * Захват свежий и ещё в работе: либо прямо сейчас активирует параллельный запрос,
   * либо POST оборвался по сети уже после коммита строки и владельца у неё нет.
   * Отвечать «уже обработан» нельзя — подписки может не быть; правильный ответ
   * вызывающему «идёт обработка, повторите позже».
   */
  | { claimed: false; reason: 'in-progress' }
  /** Захват висит слишком долго: активацию мог оборвать умерший инстанс. Разбор вручную. */
  | { claimed: false; reason: 'needs-reconciliation' };

let readinessCache: { ready: boolean; checkedAt: number } | null = null;

/**
 * Готов ли durable-журнал принимать записи.
 *
 * Проверяется чтением коллекции: если её нет или Directus недоступен, оплата обязана
 * быть выключена. Результат кешируется на минуту — эту функцию дёргает публичный
 * `/api/payments/available`.
 */
export async function isLedgerReady(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && readinessCache && now - readinessCache.checkedAt < READINESS_TTL_MS) {
    return readinessCache.ready;
  }

  let ready = false;
  try {
    const url = directusUrl();
    const token = adminToken();
    if (url && token) {
      const res = await fetch(`${url}/items/${COLLECTION}?limit=1&fields=id`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      ready = res.ok;
      if (!res.ok) {
        log(`[payments] Журнал недоступен: HTTP ${res.status}`, 'payments', 'error');
      }
    } else {
      log('[payments] Журнал недоступен: нет DIRECTUS_URL или токена', 'payments', 'error');
    }
  } catch (err: any) {
    log(`[payments] Журнал недоступен: ${err?.message}`, 'payments', 'error');
  }

  readinessCache = { ready, checkedAt: now };
  return ready;
}

async function findClaim(paymentId: string): Promise<any | null> {
  const res = await fetch(
    `${directusUrl()}/items/${COLLECTION}?filter[payment_id][_eq]=${encodeURIComponent(paymentId)}&limit=1`,
    { headers: { Authorization: `Bearer ${adminToken()}` } },
  );
  if (!res.ok) throw new LedgerUnavailableError(`чтение журнала → ${res.status}`);
  const data = await res.json();
  return data?.data?.[0] ?? null;
}

/** Помечает запись как требующую ручного разбора. Ошибку глушим — это диагностика. */
async function flagReconciliation(recordId: string, reason: string): Promise<void> {
  try {
    await fetch(`${directusUrl()}/items/${COLLECTION}/${recordId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ needs_reconciliation: true, last_error: reason.slice(0, 500) }),
    });
  } catch { /* пусто: запись и так останется в processing */ }
  log(`[payments] Платёж требует ручного разбора (запись ${recordId}): ${reason}`, 'payments', 'error');
}

/**
 * Пытается захватить платёж в обработку.
 *
 * `{claimed:true}` — захват наш, можно активировать; после успеха обязательно
 * `completePaymentActivation`, после провала — `releasePaymentActivation`.
 * `{claimed:false, already-processed}` — платёж уже обработан, ответить успехом.
 * `{claimed:false, needs-reconciliation}` — захват завис; активировать нельзя.
 *
 * Бросает `LedgerUnavailableError`, если журнал недоступен. Деградации в память нет:
 * не сумев отметить платёж обработанным, активировать его нельзя.
 */
export async function claimPaymentActivation(info: PaymentClaimInfo): Promise<ClaimResult> {
  const now = new Date().toISOString();

  let res: Response;
  try {
    res = await fetch(`${directusUrl()}/items/${COLLECTION}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payment_id: info.paymentId,
        user_id: info.userId,
        plan: info.plan,
        amount: info.amount,
        currency: info.currency,
        source: info.source,
        status: 'processing',
        claimed_at: now,
      }),
    });
  } catch (err: any) {
    throw new LedgerUnavailableError(`захват платежа: ${err?.message}`);
  }

  if (res.ok) {
    const created = await res.json();
    const recordId = created?.data?.id;
    if (!recordId) throw new LedgerUnavailableError('журнал не вернул id записи');
    return { claimed: true, recordId };
  }

  // Вставка не прошла. Единственная ожидаемая причина — уникальность payment_id,
  // то есть платёж уже кем-то взят. Всё остальное (403, 5xx, таймаут) — недоступность
  // журнала, и она обязана быть повторяемой ошибкой, а не поводом активировать.
  const body = await res.text();
  const isUniqueViolation = /unique|RECORD_NOT_UNIQUE|has to be unique|duplicate/i.test(body);
  if (!isUniqueViolation) {
    throw new LedgerUnavailableError(`захват платежа → ${res.status}: ${body.slice(0, 200)}`);
  }

  const existing = await findClaim(info.paymentId);
  if (!existing) {
    // Строка была и пропала между вставкой и чтением: кто-то её снял. Повторим позже.
    throw new LedgerUnavailableError('запись журнала исчезла между вставкой и чтением');
  }

  if (existing.status === 'completed') {
    return { claimed: false, reason: 'already-processed' };
  }

  // Заявка висит в processing. Автоматически её НЕ перехватываем: без CAS два процесса
  // прочитали бы одну и ту же зависшую запись, оба сделали бы PATCH и оба выдали бы
  // подписку. Свежая заявка — идёт параллельная обработка; протухшая — на разбор.
  const claimedAt = existing.claimed_at ? new Date(existing.claimed_at).getTime() : 0;
  const isStale = Number.isFinite(claimedAt) && Date.now() - claimedAt > STALE_CLAIM_MS;
  if (isStale) {
    await flagReconciliation(existing.id, `захват висит с ${existing.claimed_at}`);
    return { claimed: false, reason: 'needs-reconciliation' };
  }

  // Свежий processing — обработка идёт (или строка осиротела из-за оборванного
  // POST). Раньше здесь возвращалось already-processed, и плательщик получал
  // «уже обработан» без подписки (находка ревью 2026-07-28).
  return { claimed: false, reason: 'in-progress' };
}

/**
 * Отмечает платёж окончательно обработанным.
 *
 * Бросает, если отметку поставить не удалось: подписка уже выдана, и вызывающий обязан
 * об этом узнать. Запись остаётся в processing и помечается на разбор — повторный
 * запрос по такому платежу получит already-processed или needs-reconciliation, но
 * второй подписки не выдаст.
 */
export async function completePaymentActivation(recordId: string): Promise<void> {
  if (!recordId) return;
  let res: Response;
  try {
    res = await fetch(`${directusUrl()}/items/${COLLECTION}/${recordId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed', completed_at: new Date().toISOString() }),
    });
  } catch (err: any) {
    await flagReconciliation(recordId, `не удалось закрыть запись: ${err?.message}`);
    throw new LedgerUnavailableError(`закрытие записи: ${err?.message}`);
  }
  if (!res.ok) {
    await flagReconciliation(recordId, `не удалось закрыть запись: HTTP ${res.status}`);
    throw new LedgerUnavailableError(`закрытие записи → ${res.status}`);
  }
}

/**
 * Освобождает захват, если активация не удалась: оплативший должен иметь возможность
 * повторить, а не упереться в «уже обработано» из-за нашей же ошибки.
 */
export async function releasePaymentActivation(recordId: string): Promise<void> {
  if (!recordId) return;
  try {
    const res = await fetch(`${directusUrl()}/items/${COLLECTION}/${recordId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken()}` },
    });
    if (!res.ok) await flagReconciliation(recordId, `не удалось снять захват: HTTP ${res.status}`);
  } catch (err: any) {
    await flagReconciliation(recordId, `не удалось снять захват: ${err?.message}`);
  }
}

/** Только для тестов: сбрасывает кеш готовности. */
export function resetLedgerCache(): void {
  readinessCache = null;
}

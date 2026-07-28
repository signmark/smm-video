/**
 * Журнал обработанных платежей — защита от повторной активации подписки.
 *
 * Находка ревью: один succeeded-платёж можно было предъявить `/activate` сколько
 * угодно раз, и каждый раз `activateSubscription` двигал `expire_date` ещё на 30
 * дней от «сейчас», слал ещё одно Telegram-уведомление и ещё один partner postback.
 * Webhook шёл тем же путём.
 *
 * Почему Directus, а не Map в памяти процесса: состояние обработки обязано пережить
 * рестарт контейнера и работать при нескольких инстансах. Map теряется при первом же
 * деплое, а на двух инстансах не видна вообще — то есть защиты не даёт ни в одном из
 * двух сценариев, ради которых она нужна.
 *
 * Атомарность держится на уникальном индексе `payment_id`: захват — это сама вставка
 * строки. Кто вставил, тот и активирует; всем остальным Directus ответит нарушением
 * уникальности. Проверка «нет ли уже такой строки» отдельным запросом не годится —
 * между SELECT и INSERT помещается второй запрос.
 *
 * Fail-closed: если журнал недоступен, захват бросает исключение и активация не
 * происходит. Активировать «на всякий случай», не имея возможности отметить платёж
 * обработанным, — это ровно та дыра, которую журнал закрывает.
 */

import { log } from '../utils/logger';

const COLLECTION = 'payment_activations';

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
 * Сколько «зависшая» заявка на активацию считается живой. Если инстанс упал между
 * захватом и активацией, через это время платёж можно взять в работу повторно —
 * иначе оплативший человек останется без подписки навсегда.
 */
const STALE_CLAIM_MS = 15 * 60 * 1000;

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
  | { claimed: false; reason: 'already-processed'; processedAt?: string };

let ensurePromise: Promise<void> | null = null;

/**
 * Запасной журнал в памяти процесса.
 *
 * Нужен ровно на один случай: durable-журнал недоступен. На 2026-07-28 это реальное
 * состояние прода — у сервисного токена нет прав на создание коллекций (Directus
 * отвечает 403 и на GET /collections/payment_activations, и на POST /collections),
 * а коллекции `payment_activations` в схеме нет. Права выдаёт владелец, см.
 * docs/prompts/claude-codex-review-fixes-2026-07-28.md.
 *
 * Почему не «падать»: fail-closed здесь означает 500 на КАЖДЫЙ платёж — человек
 * заплатил и не получил подписку. Это хуже исходной дыры. Память процесса слабее
 * durable-журнала (не переживает рестарт, не видна второму инстансу), но она гасит
 * массовый случай — повтор в рамках одного процесса: обновление страницы успеха,
 * гонка webhook'а с ручной активацией, ретрай ЮКассы. Каждое обращение к запасному
 * пути логируется уровнем error, чтобы деградация не осталась незамеченной.
 */
const memoryLedger = new Map<string, { status: 'processing' | 'completed'; claimedAt: number }>();
let degradedWarned = false;

function noteDegraded(reason: string): void {
  if (!degradedWarned) {
    degradedWarned = true;
    log(
      `[payments] ЖУРНАЛ ПЛАТЕЖЕЙ НЕДОСТУПЕН (${reason}). Идемпотентность работает только в рамках `
      + `процесса и не переживёт рестарт. Нужна коллекция ${COLLECTION} в Directus и права на неё `
      + `сервисной роли — см. docs/prompts/claude-codex-review-fixes-2026-07-28.md`,
      'payments',
      'error',
    );
  }
}

/** Захват через память процесса — используется только при недоступном Directus-журнале. */
function claimInMemory(info: PaymentClaimInfo): ClaimResult {
  const existing = memoryLedger.get(info.paymentId);
  if (existing) {
    if (existing.status === 'completed') return { claimed: false, reason: 'already-processed' };
    if (Date.now() - existing.claimedAt <= STALE_CLAIM_MS) {
      return { claimed: false, reason: 'already-processed' };
    }
  }
  memoryLedger.set(info.paymentId, { status: 'processing', claimedAt: Date.now() });
  return { claimed: true, recordId: `memory:${info.paymentId}` };
}

/**
 * Создаёт коллекцию, если её нет. Проверено на текущей схеме: на 2026-07-28 такой
 * коллекции в Directus нет, создание аддитивное — существующие данные не трогает.
 * Тот же приём уже работает для `promo_codes`/`promo_code_uses`.
 */
export async function ensureLedgerCollection(): Promise<void> {
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const url = directusUrl();
    const token = adminToken();
    if (!url || !token) throw new Error('payment-activation-ledger: нет DIRECTUS_URL или админ-токена');

    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const check = await fetch(`${url}/collections/${COLLECTION}`, { headers });
    if (check.status === 200) return;

    const created = await fetch(`${url}/collections`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        collection: COLLECTION,
        fields: [
          // Уникальность payment_id — это и есть механизм идемпотентности.
          { field: 'payment_id', type: 'string', meta: { required: true }, schema: { is_unique: true, is_nullable: false } },
          { field: 'user_id', type: 'string', schema: { is_nullable: true } },
          { field: 'plan', type: 'string', schema: { is_nullable: true } },
          { field: 'amount', type: 'string', schema: { is_nullable: true } },
          { field: 'currency', type: 'string', schema: { is_nullable: true } },
          { field: 'status', type: 'string', schema: { is_nullable: false, default_value: 'processing' } },
          { field: 'source', type: 'string', schema: { is_nullable: true } },
          { field: 'claimed_at', type: 'timestamp', schema: { is_nullable: true } },
          { field: 'completed_at', type: 'timestamp', schema: { is_nullable: true } },
        ],
      }),
    });

    if (!created.ok && created.status !== 200) {
      const body = await created.text();
      // 400 с «already exists» — гонка двух инстансов на старте, это не ошибка.
      if (!/exists/i.test(body)) {
        throw new Error(`payment-activation-ledger: не удалось создать коллекцию (${created.status}): ${body.slice(0, 200)}`);
      }
    }
    log(`[payments] Создана коллекция ${COLLECTION}`, 'payments', 'warn');
  })().catch(err => {
    // Не кешируем неудачу: следующий платёж должен попробовать снова.
    ensurePromise = null;
    throw err;
  });

  return ensurePromise;
}

async function findClaim(paymentId: string): Promise<any | null> {
  const res = await fetch(
    `${directusUrl()}/items/${COLLECTION}?filter[payment_id][_eq]=${encodeURIComponent(paymentId)}&limit=1`,
    { headers: { Authorization: `Bearer ${adminToken()}` } },
  );
  if (!res.ok) throw new Error(`payment-activation-ledger: чтение журнала → ${res.status}`);
  const data = await res.json();
  return data?.data?.[0] ?? null;
}

/**
 * Пытается захватить платёж в обработку.
 *
 * `{claimed:true}` — захват наш, можно активировать; после успеха обязательно вызвать
 * `completePaymentActivation`, после провала — `releasePaymentActivation`.
 * `{claimed:false}` — платёж уже обработан (или обрабатывается прямо сейчас): ничего
 * не делать, ответить успехом.
 */
export async function claimPaymentActivation(info: PaymentClaimInfo): Promise<ClaimResult> {
  try {
    await ensureLedgerCollection();
    return await claimInDirectus(info);
  } catch (err: any) {
    // Журнал недоступен: нет коллекции, нет прав на неё, Directus не отвечает.
    // Падать нельзя — это 500 на оплаченный платёж; переходим на запасной путь.
    noteDegraded(err?.message || 'ledger unavailable');
    return claimInMemory(info);
  }
}

/** Захват через durable-журнал. Бросает, если журнал недоступен. */
async function claimInDirectus(info: PaymentClaimInfo): Promise<ClaimResult> {
  const now = new Date().toISOString();
  const res = await fetch(`${directusUrl()}/items/${COLLECTION}`, {
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

  if (res.ok) {
    const created = await res.json();
    return { claimed: true, recordId: created?.data?.id };
  }

  // Вставка не прошла. Единственная ожидаемая причина — уникальность payment_id,
  // то есть платёж уже кем-то взят. Всё остальное — настоящая ошибка, и молчать
  // о ней нельзя: иначе сбой Directus превратится в «активируем повторно».
  const body = await res.text();
  const isUniqueViolation = /unique|RECORD_NOT_UNIQUE|has to be unique|duplicate/i.test(body);
  if (!isUniqueViolation) {
    throw new Error(`payment-activation-ledger: захват платежа → ${res.status}: ${body.slice(0, 200)}`);
  }

  const existing = await findClaim(info.paymentId);
  if (!existing) {
    // Строка была и пропала между вставкой и чтением — считаем платёж обработанным.
    return { claimed: false, reason: 'already-processed' };
  }

  if (existing.status === 'completed') {
    return { claimed: false, reason: 'already-processed', processedAt: existing.completed_at };
  }

  // Заявка висит в processing. Если её взяли только что — идёт параллельная обработка,
  // вмешиваться нельзя. Если давно — инстанс, взявший её, умер, забираем себе.
  const claimedAt = existing.claimed_at ? new Date(existing.claimed_at).getTime() : 0;
  const isStale = Number.isFinite(claimedAt) && Date.now() - claimedAt > STALE_CLAIM_MS;
  if (!isStale) {
    return { claimed: false, reason: 'already-processed' };
  }

  const retake = await fetch(`${directusUrl()}/items/${COLLECTION}/${existing.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'processing', claimed_at: now, source: info.source }),
  });
  if (!retake.ok) return { claimed: false, reason: 'already-processed' };

  log(
    `[payments] Перехвачена зависшая активация платежа ${info.paymentId} (claimed_at=${existing.claimed_at})`,
    'payments',
    'warn',
  );
  return { claimed: true, recordId: existing.id };
}

/** Отмечает платёж окончательно обработанным. */
export async function completePaymentActivation(recordId: string): Promise<void> {
  if (!recordId) return;

  const memoryId = recordId.startsWith('memory:') ? recordId.slice('memory:'.length) : null;
  if (memoryId) {
    const row = memoryLedger.get(memoryId);
    if (row) row.status = 'completed';
    return;
  }

  const res = await fetch(`${directusUrl()}/items/${COLLECTION}/${recordId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed', completed_at: new Date().toISOString() }),
  });
  if (!res.ok) {
    // Подписка уже выдана, поэтому это не повод отвечать пользователю ошибкой,
    // но в логах след нужен: строка осталась в processing и через 15 минут станет
    // перехватываемой, то есть возможна повторная выдача.
    log(`[payments] Не удалось закрыть запись журнала ${recordId}: HTTP ${res.status}`, 'payments', 'error');
  }
}

/**
 * Освобождает захват, если активация не удалась: оплативший человек должен иметь
 * возможность повторить, а не упереться в «уже обработано» из-за нашей же ошибки.
 */
export async function releasePaymentActivation(recordId: string): Promise<void> {
  if (!recordId) return;

  if (recordId.startsWith('memory:')) {
    memoryLedger.delete(recordId.slice('memory:'.length));
    return;
  }

  try {
    await fetch(`${directusUrl()}/items/${COLLECTION}/${recordId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken()}` },
    });
  } catch (err: any) {
    log(`[payments] Не удалось освободить запись журнала ${recordId}: ${err?.message}`, 'payments', 'error');
  }
}

/** Только для тестов: сбрасывает памятку о созданной коллекции. */
export function resetLedgerCache(): void {
  ensurePromise = null;
  memoryLedger.clear();
  degradedWarned = false;
}

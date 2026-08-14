import { log } from '../utils/logger';
import { directusApi } from '../directus';

/**
 * SM-20 Phase 2 (task A): durable reservation ledger for autonomous cycle items.
 *
 * Shape copied from the proven publication-lock-manager.ts:
 * - Directus collection `autonomous_cycle_items` with a SINGLE-FIELD unique
 *   constraint on `item_key` (format: `${runId}:${cycleId}:${itemIndex}`).
 * - Atomicity: concurrent INSERTs on the same item_key -> exactly one succeeds
 *   (unique constraint violation -> RECORD_NOT_UNIQUE). A second attempt to
 *   reserve the same slot gets nothing, so a duplicate is IMPOSSIBLE (DB-enforced),
 *   not "unlikely".
 * - State transitions via compare-and-set (Directus update-by-query): filter by
 *   the current state, and the response array length tells us whether we won the
 *   race. No cross-collection transaction is needed; one row updates in one
 *   UPDATE with WHERE.
 *
 * States: reserved (slot claimed, content not yet created) -> filled (created,
 * no content_id) -> consumed (pause converted it / naturally published) |
 * tombstone (user deleted the content; slot stays consumed for remainder count).
 *
 * The ledger is the AUTHORITATIVE source of cycle progress; `campaign_content`
 * is derived. Its rows survive content deletion, which is how the
 * "deleted item stays consumed, do not regenerate" rule is enforced.
 */

const LEDGER_COLLECTION = 'autonomous_cycle_items';
const MAX_WS_RETRIES = 3;

function ledgerAuthHeaders(): Record<string, string> {
  const token = process.env.DIRECTUS_STATIC_TOKEN;
  if (!token) {
    log('🚨 AutonomousCycleLedger: DIRECTUS_STATIC_TOKEN is not set — ledger will not work', 'cycle-ledger');
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

function isUniqueViolation(err: any): boolean {
  try {
    return err?.response?.data?.errors?.[0]?.extensions?.code === 'RECORD_NOT_UNIQUE';
  } catch {
    return false;
  }
}

/** Выбирает state по query-обновлению с CAS; возвращает число обновлённых строк. */
function affectedCount(response: any): number {
  // Directus PATCH-by-query возвращает обновлённые строки в data[]
  return Array.isArray(response?.data?.data) ? response.data.data.length : 0;
}

export interface CycleItemRef {
  campaignId: string;
  userId: string;
  runId: string;
  cycleId: string;
  itemIndex: number;
  /** preallocated content_id (UUID), известна до вызова модели. */
  contentId: string;
}

export type CycleItemState = 'reserved' | 'filled' | 'consumed' | 'tombstone';

export class AutonomousCycleLedger {
  /** Опциональная проба коллекции на старте (аналог publication_locks). */
  async probeCollectionHealth(): Promise<boolean> {
    try {
      await directusApi.get(`/items/${LEDGER_COLLECTION}`, { params: { limit: 1 }, headers: ledgerAuthHeaders() });
      return true;
    } catch (err: any) {
      log(`🚨 AutonomousCycleLedger: collection '${LEDGER_COLLECTION}' NOT FOUND/inaccessible: ${err?.message}`, 'cycle-ledger');
      return false;
    }
  }

  itemKey(ref: CycleItemRef): string {
    return `${ref.runId}:${ref.cycleId}:${ref.itemIndex}`;
  }

  /**
   * Резервирует слот ДО генерации. Если слот уже зарезервирован (из другой
   * реплики/повторного захода) — RECORD_NOT_UNIQUE, возвращаем false. Именно
   * это делает дубль невозможным на уровне БД.
   */
  async reserveItem(ref: CycleItemRef): Promise<boolean> {
    const key = this.itemKey(ref);
    // Тенант-изоляция: слот нельзя создать без владельца кампании/пользователя.
    if (!ref.campaignId || !ref.userId) {
      log(`⛔ CycleLedger: reserve ${key} без tenant (campaign/user) невозможно — отказ`, 'cycle-ledger');
      return false;
    }
    try {
      await directusApi.post(`/items/${LEDGER_COLLECTION}`, {
        item_key: key,
        campaign_id: ref.campaignId,
        user_id: ref.userId,
        run_id: ref.runId,
        cycle_id: ref.cycleId,
        item_index: ref.itemIndex,
        // preallocated UUID (SM-20 Phase2 A): известен ДО модели; создание
        // campaign_content с этим id делает материализацию идемпотентной.
        content_id: ref.contentId,
        state: 'reserved',
      }, { headers: ledgerAuthHeaders() });
      log(`🔖 CycleLedger: reserved ${key} -> ${ref.contentId}`, 'cycle-ledger');
      return true;
    } catch (err: any) {
      if (isUniqueViolation(err)) {
        log(`🔖 CycleLedger: slot ${key} already reserved — skip (dup impossible)`, 'cycle-ledger');
        return false;
      }
      // SM-20 Phase2 (A) B1 fail-close: любая НЕ-unique ошибка (нет коллекции,
      // нет схемы, транспортная) — THROW, а не тихий false с нулём слотов.
      // Иначе «резервирование молча не сработало» выглядит как «слот потерян».
      log(`⛔ CycleLedger: reserve hard-fail for ${key}: ${err?.message}`, 'cycle-ledger');
      throw err;
    }
  }

  /**
   * CAS-заполнение: слот переводится reserved -> filled ТОЛЬКО если он ещё
   * reserved. Если пауза уже перевела его в consumed — update-by-query вернёт
   * 0 строк, и запись отбрасывается (поздняя генерация безвредна).
   */
  async fillItem(ref: CycleItemRef, contentId: string): Promise<boolean> {
    const key = this.itemKey(ref);
    try {
      const resp = await directusApi.patch(
        `/items/${LEDGER_COLLECTION}`,
        { query: { filter: { item_key: { _eq: key }, state: { _eq: 'reserved' } } }, data: { state: 'filled', content_id: contentId } },
        { headers: ledgerAuthHeaders() },
      );
      const n = affectedCount(resp);
      if (n === 0) {
        log(`🔖 CycleLedger: fill CAS miss for ${key} — slot no longer reserved, discard`, 'cycle-ledger');
        return false;
      }
      log(`🔖 CycleLedger: filled ${key} -> ${contentId}`, 'cycle-ledger');
      return true;
    } catch (err: any) {
      log(`⛔ CycleLedger: fill failed for ${key}: ${err?.message}`, 'cycle-ledger');
      return false;
    }
  }

  /** CAS-перевод одного слота в state. Возвращает true, если переход произошёл. */
  async setState(ref: CycleItemRef, from: CycleItemState, to: CycleItemState): Promise<boolean> {
    const key = this.itemKey(ref);
    try {
      const resp = await directusApi.patch(
        `/items/${LEDGER_COLLECTION}`,
        { query: { filter: { item_key: { _eq: key }, state: { _eq: from } } }, data: { state: to } },
        { headers: ledgerAuthHeaders() },
      );
      const n = affectedCount(resp);
      log(`🔖 CycleLedger: state ${from}->${to} on ${key} (${n} rows)`, 'cycle-ledger');
      return n > 0;
    } catch (err: any) {
      log(`⛔ CycleLedger: setState failed for ${key}: ${err?.message}`, 'cycle-ledger');
      return false;
    }
  }

  /** Читает состояние всех слотов цикла по run_id+cycle_id. NULL, если запросить не смогли. */
  async getCycleItems(runId: string, cycleId: string): Promise<Array<{
    itemKey: string; itemIndex: number; state: CycleItemState; contentId: string | null;
  }> | null> {
    try {
      const resp = await directusApi.get(`/items/${LEDGER_COLLECTION}`, {
        params: {
          filter: {
            _and: [
              { run_id: { _eq: runId } },
              { cycle_id: { _eq: cycleId } },
            ],
          },
          sort: ['item_index'],
          limit: 500,
          fields: ['item_key', 'item_index', 'state', 'content_id'],
        },
        headers: ledgerAuthHeaders(),
      });
      const rows = resp?.data?.data || [];
      return rows.map((r: any) => ({
        itemKey: r.item_key,
        itemIndex: Number(r.item_index),
        state: r.state as CycleItemState,
        contentId: r.content_id || null,
      }));
    } catch (err: any) {
      log(`⛔ CycleLedger: getCycleItems failed for ${runId}:${cycleId}: ${err?.message}`, 'cycle-ledger');
      return null;
    }
  }

  /** Читает строку реестра по item_key. */
  private async findItem(ref: CycleItemRef): Promise<any | null> {
    const key = this.itemKey(ref);
    try {
      const resp = await directusApi.get(`/items/${LEDGER_COLLECTION}`, {
        params: {
          filter: { item_key: { _eq: key } },
          limit: 1,
          fields: ['item_key', 'campaign_id', 'user_id', 'run_id', 'cycle_id', 'item_index', 'content_id', 'state'],
        },
        headers: ledgerAuthHeaders(),
      });
      const data = resp?.data?.data;
      return data?.length ? data[0] : null;
    } catch (err: any) {
      log(`⛔ CycleLedger: findItem failed for ${key}: ${err?.message}`, 'cycle-ledger');
      return null;
    }
  }

  /**
   * SM-20 Phase2 (A): reconciliation после crash между «создан контент» и
   * «обновился реестр». Читает слот по item_key, подтверждает ownership
   * (campaign/user/run/cycle/item/content совпадают), затем CAS reserved→filled.
   * Чужая запись с совпавшим ключом — hard integrity error, не filled.
   */
  async reconcileAndFill(ref: CycleItemRef): Promise<'filled' | 'still_reserved' | 'integrity_error' | 'absent' | 'content_missing'> {
    const item = await this.findItem(ref);
    if (!item) return 'absent';
    const ok =
      String(item.campaign_id) === String(ref.campaignId) &&
      String(item.user_id) === String(ref.userId) &&
      String(item.run_id) === String(ref.runId) &&
      String(item.cycle_id) === String(ref.cycleId) &&
      Number(item.item_index) === Number(ref.itemIndex) &&
      String(item.content_id) === String(ref.contentId);
    if (!ok) {
      log(`⛔ CycleLedger: INTEGRITY ERROR ${this.itemKey(ref)} — собственник не совпадает`, 'cycle-ledger');
      return 'integrity_error';
    }
    if (item.state !== 'reserved') {
      return item.state === 'filled' ? 'filled' : 'still_reserved';
    }
    // SM-20 Phase2 (A): НЕ помечаем filled только по ownership-матчу реестра.
    // Сначала убеждаемся, что campaign_content для preallocated content_id реально
    // существует И принадлежит той же кампании/пользователю. Если контента нет
    // (crash после reserve / после модели ДО создания) — слот остаётся reserved
    // (восстановимый), not filled. Чужой контент с тем же id — hard integrity error.
    try {
      const resp = await directusApi.get(`/items/campaign_content/${ref.contentId}`, {
        params: { fields: ['id', 'campaign_id', 'user_id', 'status'] },
        headers: ledgerAuthHeaders(),
      });
      const content = resp?.data?.data;
      if (!content || !content.id) return 'content_missing';
      if (String(content.campaign_id) !== String(ref.campaignId) ||
          String(content.user_id) !== String(ref.userId)) {
        log(`⛔ CycleLedger: INTEGRITY ERROR ${this.itemKey(ref)} — campaign_content принадлежит другой кампании`, 'cycle-ledger');
        return 'integrity_error';
      }
    } catch (err: any) {
      const code = err?.response?.data?.errors?.[0]?.extensions?.code;
      if (code === 'RECORD_NOT_FOUND' || code === 'FORBIDDEN') {
        return 'content_missing';
      }
      log(`⛔ CycleLedger: reconcile read content failed for ${ref.contentId}: ${err?.message}`, 'cycle-ledger');
      return 'still_reserved';
    }
    const filled = await this.fillItem(ref, ref.contentId);
    return filled ? 'filled' : 'still_reserved';
  }
}

export const autonomousCycleLedger = new AutonomousCycleLedger();

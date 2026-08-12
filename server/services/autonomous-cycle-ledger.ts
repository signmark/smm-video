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
    try {
      await directusApi.post(`/items/${LEDGER_COLLECTION}`, {
        item_key: key,
        campaign_id: ref.campaignId,
        user_id: ref.userId,
        run_id: ref.runId,
        cycle_id: ref.cycleId,
        item_index: ref.itemIndex,
        state: 'reserved',
      }, { headers: ledgerAuthHeaders() });
      log(`🔖 CycleLedger: reserved ${key}`, 'cycle-ledger');
      return true;
    } catch (err: any) {
      if (isUniqueViolation(err)) {
        log(`🔖 CycleLedger: slot ${key} already reserved — skip (dup impossible)`, 'cycle-ledger');
        return false;
      }
      log(`⛔ CycleLedger: reserve failed for ${key}: ${err?.message}`, 'cycle-ledger');
      return false;
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
}

export const autonomousCycleLedger = new AutonomousCycleLedger();

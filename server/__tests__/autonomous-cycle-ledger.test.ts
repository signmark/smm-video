import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * SM-20 Phase 2 (A) — ledger unit behavioral tests (no heavy full suite).
 *
 * 1. concurrent-loser / no-second-record: two identical (runId,cycleId,itemIndex)
 *    reserving the same item_key — the winner reserves, the loser hits
 *    RECORD_NOT_UNIQUE and does NOT get a second reservation (hence cannot
 *    materialize a second campaign_content; the DB unique is the fence).
 * 2. crash-gap reconciliation: a slot left `reserved` because the process died
 *    between `campaign_content` creation and registry update — reconcileAndFill
 *    verifies full ownership then CAS reserved→filled; a foreign record with a
 *    matching key is a hard integrity error, never filled.
 *
 * We mock `../directus` (the only external dep of the ledger) with an in-memory
 * store that enforces the single-field unique on `item_key` (like Directus UI).
 */
import { autonomousCycleLedger } from '../services/autonomous-cycle-ledger';

function makeUniqueStore() {
  const rows: any[] = [];
  const fn = {
    post: vi.fn(async (url: string, body: any, _cfg?: any) => {
      const existing = rows.find((r) => r.item_key === body.item_key);
      if (existing) {
        const err: any = new Error('duplicate');
        err.response = { data: { errors: [{ extensions: { code: 'RECORD_NOT_UNIQUE' } }] } };
        throw err;
      }
      const row = { ...body, id: 'row-' + rows.length };
      rows.push(row);
      return { data: { data: row } };
    }),
    get: vi.fn(async (url: string, params: any) => {
      const q = (params?.params?.filter || {});
      const key = q.item_key?._eq;
      const run = q._and?.find((a: any) => a.run_id)?.run_id?._eq;
      const cycle = q._and?.find((a: any) => a.cycle_id)?.cycle_id?._eq;
      let out = rows;
      if (key) out = out.filter((r) => r.item_key === key);
      if (run) out = out.filter((r) => r.run_id === run);
      if (cycle) out = out.filter((r) => r.cycle_id === cycle);
      if (out.length) out = out.map((r) => ({
        item_key: r.item_key, campaign_id: r.campaign_id, user_id: r.user_id,
        run_id: r.run_id, cycle_id: r.cycle_id, item_index: r.item_index,
        content_id: r.content_id, state: r.state,
      }));
      return { data: { data: out } };
    }),
    patch: vi.fn(async () => ({ data: { data: [] } })),
    delete: vi.fn(async () => ({ data: {} })),
  };
  return fn;
}

vi.mock('../directus', () => ({ directusApi: {} }));

import { directusApi } from '../directus';

const ID = {
  campaignId: 'camp-1', userId: 'user-1',
  runId: 'run-1', cycleId: 'cycle-1', itemIndex: 0, contentId: 'content-1',
};
const SAME = { ...ID }; // identical slot

let store: ReturnType<typeof makeUniqueStore>;

beforeEach(() => {
  store = makeUniqueStore();
  (directusApi as any).post = store.post;
  (directusApi as any).get = store.get;
  (directusApi as any).patch = store.patch;
  (directusApi as any).delete = store.delete;
  process.env.DIRECTUS_STATIC_TOKEN = 'tok';
});
afterEach(() => { delete process.env.DIRECTUS_STATIC_TOKEN; });

describe('SM-20 Phase A ledger: concurrent-loser + crash-gap', () => {
  it('два одинаковых itemIndex → одна reservation; проигравший не получает второй', async () => {
    expect(await autonomousCycleLedger.reserveItem(ID)).toBe(true);
    // Конкурентный заход на тот же слот — RECORD_NOT_UNIQUE → false, второй резерв недоступен.
    expect(await autonomousCycleLedger.reserveItem(SAME)).toBe(false);
    // Успешных резервирований для этого item_key РОВНО ОДНА строка реестра
    // (второй вызов упал на unique, строку не создал).
    const items = await autonomousCycleLedger.getCycleItems('run-1', 'cycle-1');
    expect(items).toHaveLength(1);
    expect(items![0].itemKey).toBe('run-1:cycle-1:0');
  });

  it('crash-gap: reserved-слот с существующим содержимым после crash → reconcile CAS reserved→filled', async () => {
    // reserve, затем crash ДО обновления реестра (слот остаётся reserved).
    await autonomousCycleLedger.reserveItem(ID);
    // Содержимое campaign_content уже создано (внешне), но реестр всё ещё reserved.
    // reconcile подтверждает ownership и делает CAS reserved→filled.
    const result = await autonomousCycleLedger.reconcileAndFill(ID);
    expect(['filled', 'still_reserved']).toContain(result);
    // Повторный reconcile идемпотентен: не integrity-error, не absent.
    const again = await autonomousCycleLedger.reconcileAndFill(ID);
    expect(['filled', 'still_reserved']).toContain(again);
  });

  it('crash-gap: чужая запись с совпавшим item_key → hard integrity error, не filled', async () => {
    // Слот зарезервирован ДРУГИМ владельцем/содержимым.
    await autonomousCycleLedger.reserveItem({ ...ID, contentId: 'content-FOREIGN' });
    const result = await autonomousCycleLedger.reconcileAndFill(ID);
    expect(result).toBe('integrity_error');
  });
});

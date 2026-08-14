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
  // campaign_content store, keyed by id — empty by default (content_missing).
  const contentRows = new Map<string, any>();
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
      const u = String(url);
      // campaign_content read by id
      const m = u.match(/\/items\/campaign_content\/([^/?]+)/);
      if (m) {
        const item = contentRows.get(m[1]);
        if (!item) {
          const err: any = new Error('not found');
          err.response = { data: { errors: [{ extensions: { code: 'RECORD_NOT_FOUND' } }] } };
          throw err;
        }
        return { data: { data: { ...item } } };
      }
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
    patch: vi.fn(async (url: string, params: any) => {
      // CAS: PATCH по query-фильтру обновляет только совпавшие строки.
      const q = (params?.query?.filter || {});
      const key = q.item_key?._eq;
      const state = q.state?._eq;
      const data = params?.data || {};
      const affected = rows.filter((r) =>
        (!key || r.item_key === key) && (!state || r.state === state)
      );
      const count = affected.length;
      affected.forEach((r) => { Object.assign(r, data); });
      return { data: { data: rows.slice(0, count).map((r) => ({ item_key: r.item_key })) } };
    }),
    delete: vi.fn(async () => ({ data: {} })),
    setContent: (id: string, campaignId: string, userId: string) => {
      contentRows.set(id, {
        id, campaign_id: campaignId, user_id: userId,
        run_id: contentRows.get(id)?.run_id, cycle_id: contentRows.get(id)?.cycle_id,
        item_index: contentRows.get(id)?.item_index, content_id: contentRows.get(id)?.content_id,
      });
    },
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
    // Содержимое campaign_content УЖЕ создано (тот же tenant) — reconcile должен
    // подтвердить ownership контента и тогда CAS reserved→filled.
    store.setContent(ID.contentId, ID.campaignId, ID.userId);
    const result = await autonomousCycleLedger.reconcileAndFill(ID);
    expect(result).toBe('filled');
    // Повторный reconcile идемпотентен: уже filled, не integrity/absent.
    const again = await autonomousCycleLedger.reconcileAndFill(ID);
    expect(result).toBe('filled');
    expect(again).toBe('filled');
  });

  it('crash-gap: reserved-слот БЕЗ созданного контента (crash после reserve/модели) → content_missing, слот остаётся reserved (восстановимый)', async () => {
    await autonomousCycleLedger.reserveItem(ID);
    // Контента нет (crash после reserve / после модели ДО создания) — reconcile
    // НЕ должен пометить filled только по ownership-матчу реестра.
    const result = await autonomousCycleLedger.reconcileAndFill(ID);
    expect(result).toBe('content_missing');
    const items = await autonomousCycleLedger.getCycleItems('run-1', 'cycle-1');
    expect(items![0].state).toBe('reserved'); // остаётся reserved, восстановимый
  });

  it('crash-gap: реестр-ownership совпал, но campaign_content принадлежит ДРУГОЙ кампании → integrity_error, не filled', async () => {
    await autonomousCycleLedger.reserveItem(ID);
    // campaign_content существует, но принадлежит другому арендатору (campaign-B).
    store.setContent(ID.contentId, 'camp-B', ID.userId);
    const result = await autonomousCycleLedger.reconcileAndFill(ID);
    expect(result).toBe('integrity_error');
    const items = await autonomousCycleLedger.getCycleItems('run-1', 'cycle-1');
    expect(items![0].state).toBe('reserved');
  });

  it('crash-gap: чужая запись с совпавшим item_key → hard integrity error, не filled', async () => {
    // Слот зарезервирован ДРУГИМ владельцем/содержимым.
    await autonomousCycleLedger.reserveItem({ ...ID, contentId: 'content-FOREIGN' });
    const result = await autonomousCycleLedger.reconcileAndFill(ID);
    expect(result).toBe('integrity_error');
  });

  it('CAS-success: реальный PATCH affected row → reserved→filled; на не-reserved CAS miss (0 affected) → false, state не меняется', async () => {
    // Reserve (slot = reserved).
    expect(await autonomousCycleLedger.reserveItem(ID)).toBe(true);
    // fillItem выполняет CAS PATCH с фильтром state='reserved'; слот резeрвирован → успех.
    expect(await autonomousCycleLedger.fillItem(ID, ID.contentId)).toBe(true);
    let items = await autonomousCycleLedger.getCycleItems('run-1', 'cycle-1');
    expect(items![0].state).toBe('filled');

    // Теперь переводим слот (filled) в consumed — fillItem повторно обязан дать CAS miss
    // (0 affected), а не «успех». Удаление фильтра state='reserved' или трактовка
    // 0 affected как успех → этот тест краснеет (state не изменился бы/вернулся true).
    const casMiss = await autonomousCycleLedger.setState({ ...ID, contentId: ID.contentId }, 'filled', 'consumed');
    expect(casMiss).toBe(true);
    expect(await autonomousCycleLedger.fillItem(ID, ID.contentId)).toBe(false);
    items = await autonomousCycleLedger.getCycleItems('run-1', 'cycle-1');
    expect(items![0].state).toBe('consumed'); // не перезаписан на filled
  });

  it('cross-tenant: резерв арендатора A НЕ заполняется владельцем B (ownership-предикаты обязательны)', async () => {
    // Арендатор A резервирует слот (owned by campaign-a/user-a).
    const tenantA = ID;
    expect(await autonomousCycleLedger.reserveItem(tenantA)).toBe(true);
    // Арендатор B пытается reconcile С тем же item_key/содержимым, но ДРУГОЙ кампанией/user.
    const tenantB = { ...ID, campaignId: 'camp-B', userId: 'user-B' };
    const result = await autonomousCycleLedger.reconcileAndFill(tenantB);
    expect(result).toBe('integrity_error'); // ownership не совпал → hard error, не filled
    // Слот остаётся reserved (не заполнен чужим).
    const items = await autonomousCycleLedger.getCycleItems('run-1', 'cycle-1');
    expect(items![0].state).toBe('reserved');
  });
});

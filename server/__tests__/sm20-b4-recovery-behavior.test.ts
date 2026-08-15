/**
 * SM-20 Phase A B4 — ПОВЕДЕНЧЕСКИЙ тест восстановления прерванного цикла.
 *
 * Чем отличается от `autonomous-cycle-recovery.test.ts`: тот читает исходник и
 * проверяет, что вызов восстановления написан в нужном месте. Такой тест зелёный
 * и когда восстановление сломано — что и произошло: ссылка на слот собиралась без
 * preallocated content_id, сверка владельца заведомо не сходилась, и КАЖДЫЙ
 * прерванный слот объявлялся нарушением целостности вместо восстановления.
 *
 * Здесь выполняется настоящий путь: реальный `recoverInterruptedCycle`, реальный
 * `AutonomousCycleLedger`, подменён только транспорт к Directus (in-memory стор с
 * тем же unique на item_key и той же семантикой CAS-обновления по фильтру).
 * Утверждения — по РЕЗУЛЬТАТУ: сколько слотов восстановлено, сколько осталось
 * зарезервированными, сохранился ли идентификатор цикла, не потерян и не задвоен
 * ли хоть один слот.
 *
 * Мутация, которая обязана красить: вернуть выбор данных к прежнему (ссылка без
 * content_id или чтение реестра по новому cycleId) — краснеет СЧЁТ слотов, а не
 * наличие строки в файле.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../directus', () => {
  const stub: any = {};
  return {
    directusApi: stub,
    directusApiManager: { instance: stub, getInstance: () => stub },
    default: stub,
  };
});
vi.mock('../utils/logger', () => ({
  log: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

import { directusApi } from '../directus';
import { autonomousCycleLedger } from '../services/autonomous-cycle-ledger';
import { recoverInterruptedCycle } from '../services/autonomous-ai';

/** In-memory Directus: unique на item_key + CAS-обновление по фильтру. */
function makeStore() {
  const rows: any[] = [];
  const content = new Map<string, any>();
  let contentWrites = 0;

  const api = {
    post: vi.fn(async (url: string, body: any) => {
      if (String(url).includes('campaign_content')) {
        contentWrites++;
        content.set(body.id, body);
        return { data: { data: body } };
      }
      if (rows.some((r) => r.item_key === body.item_key)) {
        const err: any = new Error('duplicate');
        err.response = { data: { errors: [{ extensions: { code: 'RECORD_NOT_UNIQUE' } }] } };
        throw err;
      }
      const row = { ...body, id: `row-${rows.length}` };
      rows.push(row);
      return { data: { data: row } };
    }),

    get: vi.fn(async (url: string, cfg?: any) => {
      const u = String(url);
      const byId = u.match(/\/items\/campaign_content\/([^/?]+)/);
      if (byId) {
        const item = content.get(byId[1]);
        if (!item) {
          const err: any = new Error('not found');
          err.response = { data: { errors: [{ extensions: { code: 'RECORD_NOT_FOUND' } }] } };
          throw err;
        }
        return { data: { data: { ...item } } };
      }
      const filter = cfg?.params?.filter || {};
      const key = filter.item_key?._eq;
      const run = filter._and?.find((a: any) => a.run_id)?.run_id?._eq;
      const cycle = filter._and?.find((a: any) => a.cycle_id)?.cycle_id?._eq;
      let out = rows;
      if (key) out = out.filter((r) => r.item_key === key);
      if (run) out = out.filter((r) => r.run_id === run);
      if (cycle) out = out.filter((r) => r.cycle_id === cycle);
      return {
        data: {
          data: out.map((r) => ({
            item_key: r.item_key, campaign_id: r.campaign_id, user_id: r.user_id,
            run_id: r.run_id, cycle_id: r.cycle_id, item_index: r.item_index,
            content_id: r.content_id, state: r.state,
          })),
        },
      };
    }),

    patch: vi.fn(async (_url: string, body: any) => {
      const filter = body?.query?.filter || {};
      const key = filter.item_key?._eq;
      const fromState = filter.state?._eq;
      const affected = rows.filter(
        (r) => (!key || r.item_key === key) && (!fromState || r.state === fromState),
      );
      affected.forEach((r) => Object.assign(r, body?.data || {}));
      return { data: { data: affected.map((r) => ({ item_key: r.item_key })) } };
    }),

    delete: vi.fn(async () => ({ data: {} })),
  };

  return {
    api,
    rows,
    /** Кладём готовый campaign_content того же или чужого арендатора. */
    putContent(id: string, campaignId: string, userId: string) {
      content.set(id, { id, campaign_id: campaignId, user_id: userId, status: 'draft' });
    },
    contentWrites: () => contentWrites,
    states: () => rows.slice().sort((a, b) => a.item_index - b.item_index).map((r) => r.state),
    keys: () => rows.map((r) => r.item_key).sort(),
    count: (state: string) => rows.filter((r) => r.state === state).length,
  };
}

const CAMPAIGN = 'camp-1';
const USER = 'user-1';
const RUN = 'run-1';
const CYCLE = 'cycle-interrupted';

/** Состояние сессии, восстановленное из БД: незавершённый цикл уже в нём. */
function restoredState(cycleId: string = CYCLE): any {
  return { campaignId: CAMPAIGN, userId: USER, runId: RUN, cycleId };
}

async function reserveSlots(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let itemIndex = 0; itemIndex < count; itemIndex++) {
    const contentId = `content-${itemIndex}`;
    await autonomousCycleLedger.reserveItem({
      campaignId: CAMPAIGN, userId: USER, runId: RUN, cycleId: CYCLE, itemIndex, contentId,
    });
    ids.push(contentId);
  }
  return ids;
}

let store: ReturnType<typeof makeStore>;

beforeEach(() => {
  store = makeStore();
  Object.assign(directusApi as any, store.api);
  process.env.DIRECTUS_STATIC_TOKEN = 'tok';
});

afterEach(() => {
  delete process.env.DIRECTUS_STATIC_TOKEN;
  vi.clearAllMocks();
});

describe('SM-20 B4: восстановление прерванного цикла — по результату, не по тексту исходника', () => {
  it('сбой между созданием контента и записью в реестр → слоты с готовым контентом восстановлены, без контента остаются reserved', async () => {
    await reserveSlots(3);
    // Контент успел создаться для слотов 0 и 2; слот 1 не дожил до создания.
    store.putContent('content-0', CAMPAIGN, USER);
    store.putContent('content-2', CAMPAIGN, USER);

    const state = restoredState();
    await recoverInterruptedCycle(state);

    // Результат: ровно два слота восстановлены, один честно остался утраченным.
    expect(store.count('filled')).toBe(2);
    expect(store.count('reserved')).toBe(1);
    expect(store.states()).toEqual(['filled', 'reserved', 'filled']);

    // Ни один слот не потерян и не задвоен: тот же набор ключей, что и был.
    expect(store.keys()).toEqual([
      `${RUN}:${CYCLE}:0`, `${RUN}:${CYCLE}:1`, `${RUN}:${CYCLE}:2`,
    ]);
    expect(store.rows).toHaveLength(3);

    // Восстановление не создаёт контент заново — дублей быть не может.
    expect(store.contentWrites()).toBe(0);

    // Идентификатор цикла не перегенерирован: продолжаем прерванный, а не новый.
    expect(state.cycleId).toBe(CYCLE);
  });

  it('контент с тем же id принадлежит другой кампании → слот не восстанавливается', async () => {
    await reserveSlots(1);
    store.putContent('content-0', 'camp-other', 'user-other');

    await recoverInterruptedCycle(restoredState());

    expect(store.count('filled')).toBe(0);
    expect(store.count('reserved')).toBe(1);
    expect(store.contentWrites()).toBe(0);
  });

  it('уже заполненные и погашенные слоты не трогаются повторно', async () => {
    await reserveSlots(2);
    store.rows[0].state = 'filled';
    store.rows[1].state = 'consumed';
    store.putContent('content-0', CAMPAIGN, USER);
    store.putContent('content-1', CAMPAIGN, USER);

    store.api.patch.mockClear();
    await recoverInterruptedCycle(restoredState());

    expect(store.states()).toEqual(['filled', 'consumed']);
    // Ни одного обновления состояния: нечего восстанавливать.
    expect(store.api.patch).not.toHaveBeenCalled();
  });

  it('строка реестра без content_id не восстанавливается и не роняет проход', async () => {
    await reserveSlots(2);
    store.rows[0].content_id = null; // запись из более старой схемы
    store.putContent('content-1', CAMPAIGN, USER);

    await recoverInterruptedCycle(restoredState());

    expect(store.states()).toEqual(['reserved', 'filled']);
    expect(store.count('filled')).toBe(1);
  });

  it('незавершённого цикла нет → ни одного обращения на изменение состояния', async () => {
    await recoverInterruptedCycle(restoredState('cycle-never-existed'));

    expect(store.rows).toHaveLength(0);
    expect(store.api.patch).not.toHaveBeenCalled();
    expect(store.contentWrites()).toBe(0);
  });

  it('сессия без идентификатора цикла → восстановление не запускается', async () => {
    await reserveSlots(1);
    store.putContent('content-0', CAMPAIGN, USER);
    store.api.patch.mockClear();

    const withoutCycle: any = { campaignId: CAMPAIGN, userId: USER, runId: RUN, cycleId: undefined };
    await recoverInterruptedCycle(withoutCycle);

    expect(store.count('filled')).toBe(0);
    expect(store.api.patch).not.toHaveBeenCalled();
  });
});

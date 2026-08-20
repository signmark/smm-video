/**
 * SM-20 Phase 2 (B) — ПОВЕДЕНЧЕСКИЙ тест паузы посреди идущего цикла.
 *
 * До этой правки пауза снимала только таймеры: если в момент нажатия цикл уже
 * шёл, он спокойно досчитывал, создавал посты и ставил их в расписание. Именно
 * на это жаловались, ради этого тикет и заводился.
 *
 * Здесь проверяется РЕЗУЛЬТАТ, а не наличие строк в исходнике:
 *  - сколько слотов осталось на продолжение и те ли это слоты (по их исходным
 *    preallocated content_id, а не по новым);
 *  - сколько записей реально ушло из расписания обратно в черновики;
 *  - в какой фазе оказался режим после паузы при идущем цикле и без него.
 *
 * Мутация, которая обязана красить: продолжение берёт НОВЫЙ cycleId вместо
 * сохранённого — краснеет СЧЁТ слотов к догенерации (2 → 0), а не наличие
 * вызова в файле.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const holder = vi.hoisted(() => ({ crud: null as any }));

vi.mock('../directus', () => {
  const stub: any = {};
  return {
    directusApi: stub,
    directusApiManager: { instance: stub, getInstance: () => stub },
    default: stub,
  };
});

vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    getById: (...a: any[]) => holder.crud.getById(...a),
    update: (...a: any[]) => holder.crud.update(...a),
    list: (...a: any[]) => holder.crud.list(...a),
    create: (...a: any[]) => holder.crud.create(...a),
  },
  DirectusCrud: class {},
}));

vi.mock('../utils/logger', () => ({
  log: Object.assign(vi.fn(), { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }), debug: vi.fn(), error: vi.fn(), warn: vi.fn(),
}));

import { directusApi } from '../directus';
import { autonomousCycleLedger } from '../services/autonomous-cycle-ledger';
import {
  collectResumableSlots,
  unscheduleCyclePosts,
  finalizePausedCycle,
  pauseAutonomousExternal,
  resumeAutonomousExternal,
  __registerAutonomousStateForTests,
  __clearAutonomousStatesForTests,
} from '../services/autonomous-ai';

const CAMPAIGN = 'camp-b';
const USER = 'user-b';
const RUN = 'run-b';
const CYCLE = 'cycle-paused';

/** Реестр слотов: unique на item_key + CAS-обновление по фильтру, как в бою. */
function makeLedgerStore() {
  const rows: any[] = [];
  const api = {
    post: vi.fn(async (_url: string, body: any) => {
      if (rows.some(r => r.item_key === body.item_key)) {
        const err: any = new Error('duplicate');
        err.response = { data: { errors: [{ extensions: { code: 'RECORD_NOT_UNIQUE' } }] } };
        throw err;
      }
      const row = { ...body, id: `row-${rows.length}` };
      rows.push(row);
      return { data: { data: row } };
    }),
    get: vi.fn(async (_url: string, cfg?: any) => {
      const filter = cfg?.params?.filter || {};
      const run = filter._and?.find((a: any) => a.run_id)?.run_id?._eq;
      const cycle = filter._and?.find((a: any) => a.cycle_id)?.cycle_id?._eq;
      let out = rows;
      if (run) out = out.filter(r => r.run_id === run);
      if (cycle) out = out.filter(r => r.cycle_id === cycle);
      return {
        data: {
          data: out.map(r => ({
            item_key: r.item_key, item_index: r.item_index,
            state: r.state, content_id: r.content_id,
          })),
        },
      };
    }),
    patch: vi.fn(async () => ({ data: { data: [] } })),
    delete: vi.fn(async () => ({ data: {} })),
  };
  return { api, rows };
}

/** Хранилище campaign_content: только то, что нужно снятию с расписания. */
function makeContentStore(items: Record<string, any>) {
  const store = { ...items };
  return {
    store,
    getById: vi.fn(async (_c: string, id: string) => store[id] || null),
    update: vi.fn(async (_c: string, id: string, data: any) => {
      store[id] = { ...store[id], ...data };
      return store[id];
    }),
    list: vi.fn(async () => []),
    create: vi.fn(async (_c: string, data: any) => data),
  };
}

async function reserveSlots(count: number, cycleId = CYCLE) {
  for (let itemIndex = 0; itemIndex < count; itemIndex++) {
    await autonomousCycleLedger.reserveItem({
      campaignId: CAMPAIGN, userId: USER, runId: RUN, cycleId,
      itemIndex, contentId: `content-${itemIndex}`,
    });
  }
}

let ledger: ReturnType<typeof makeLedgerStore>;

beforeEach(() => {
  ledger = makeLedgerStore();
  Object.assign(directusApi as any, ledger.api);
  holder.crud = makeContentStore({});
  process.env.DIRECTUS_STATIC_TOKEN = 'tok';
});

afterEach(() => {
  delete process.env.DIRECTUS_STATIC_TOKEN;
  __clearAutonomousStatesForTests();
  vi.clearAllMocks();
});

describe('SM-20 B: остаток прерванного цикла определяется по реестру, а не по памяти', () => {
  it('пауза посреди цикла → к догенерации ровно неотработанные слоты, с их исходными content_id', async () => {
    await reserveSlots(3);
    // Первый слот успел материализоваться до паузы.
    ledger.rows[0].state = 'filled';

    const state: any = { campaignId: CAMPAIGN, userId: USER, runId: RUN, cycleId: CYCLE };
    const res = await collectResumableSlots(state);

    expect(res).not.toBeNull();
    // Счёт, а не наличие строки: осталось ровно два слота.
    expect(res!.pending).toHaveLength(2);
    expect(res!.pending.map(p => p.itemIndex)).toEqual([1, 2]);
    // Те же самые преаллоцированные идентификаторы: контент не будет создан заново.
    expect(res!.pending.map(p => p.contentId)).toEqual(['content-1', 'content-2']);
    // Пост, созданный до паузы, не потерян — он поедет в расписание вместе с остатком.
    expect(res!.alreadyFilled).toEqual(['content-0']);
  });

  it('продолжение с ЧУЖИМ (новым) cycleId ничего не находит — остаток был бы потерян', async () => {
    await reserveSlots(3);

    const state: any = { campaignId: CAMPAIGN, userId: USER, runId: RUN, cycleId: 'cycle-new-uuid' };
    expect(await collectResumableSlots(state)).toBeNull();
  });

  it('все слоты отработаны → продолжать нечего', async () => {
    await reserveSlots(2);
    ledger.rows.forEach(r => { r.state = 'filled'; });

    const state: any = { campaignId: CAMPAIGN, userId: USER, runId: RUN, cycleId: CYCLE };
    expect(await collectResumableSlots(state)).toBeNull();
  });

  it('строка без content_id в остаток не попадает — восстановить её нельзя', async () => {
    await reserveSlots(2);
    ledger.rows[0].content_id = null;

    const state: any = { campaignId: CAMPAIGN, userId: USER, runId: RUN, cycleId: CYCLE };
    const res = await collectResumableSlots(state);

    expect(res!.pending).toHaveLength(1);
    expect(res!.pending[0].itemIndex).toBe(1);
  });

  it('сессия без идентификаторов цикла → продолжать нечего', async () => {
    await reserveSlots(2);
    expect(await collectResumableSlots({ campaignId: CAMPAIGN, userId: USER } as any)).toBeNull();
  });
});

describe('SM-20 B: на паузе запланированное возвращается в черновики', () => {
  it('снимается только запланированное; черновики и опубликованное не трогаются', async () => {
    holder.crud = makeContentStore({
      'c-sched': { id: 'c-sched', status: 'scheduled', scheduled_at: '2026-08-16T10:00:00Z' },
      'c-draft': { id: 'c-draft', status: 'draft', scheduled_at: null },
      'c-pub': { id: 'c-pub', status: 'published', scheduled_at: '2026-08-14T10:00:00Z' },
    });

    const moved = await unscheduleCyclePosts(['c-sched', 'c-draft', 'c-pub']);

    // Счёт: переведена ровно одна запись.
    expect(moved).toBe(1);
    expect(holder.crud.store['c-sched'].status).toBe('draft');
    expect(holder.crud.store['c-sched'].scheduled_at).toBeNull();
    // Остальные не менялись — и не переписывались вовсе.
    expect(holder.crud.store['c-draft'].status).toBe('draft');
    expect(holder.crud.store['c-pub'].status).toBe('published');
    expect(holder.crud.update).toHaveBeenCalledTimes(1);
  });

  it('несколько запланированных постов цикла снимаются все', async () => {
    holder.crud = makeContentStore({
      'a': { id: 'a', status: 'scheduled', scheduled_at: '2026-08-16T10:00:00Z' },
      'b': { id: 'b', status: 'scheduled', scheduled_at: '2026-08-16T11:00:00Z' },
    });

    expect(await unscheduleCyclePosts(['a', 'b'])).toBe(2);
    expect(Object.values(holder.crud.store).every((x: any) => x.status === 'draft')).toBe(true);
  });

  it('пропавшая запись не роняет проход и не считается снятой', async () => {
    holder.crud = makeContentStore({ 'a': { id: 'a', status: 'scheduled', scheduled_at: 'x' } });
    expect(await unscheduleCyclePosts(['a', 'no-such-id'])).toBe(1);
  });
});

describe('SM-20 B: пауза различает идущий цикл и простой', () => {
  function activeState(overrides: any = {}): any {
    return {
      campaignId: CAMPAIGN, userId: USER, interval: 4, postsPerCycle: 2,
      autoSchedule: true, platforms: ['telegram'], withImages: false,
      startedAt: new Date('2026-08-15T09:00:00Z'), cyclesCompleted: 1,
      postsCreated: 2, errors: [], paused: false, phase: 'running',
      runId: RUN, cycleId: CYCLE, lastCycleAt: new Date('2026-08-15T09:30:00Z'),
      ...overrides,
    };
  }

  it('пауза во время идущего цикла переводит режим в состояние «останавливаюсь»', async () => {
    const state = activeState({ cycleRunning: true });
    __registerAutonomousStateForTests(state);

    const res: any = await pauseAutonomousExternal(CAMPAIGN);

    expect(res.success).toBe(true);
    expect(res.cyclePausing).toBe(true);
    expect(state.phase).toBe('pausing');
    // Идентификатор цикла сохранён — иначе остаток некому будет найти.
    expect(state.cycleId).toBe(CYCLE);
  });

  it('пауза в простое сразу даёт «на паузе», без промежуточного состояния', async () => {
    const state = activeState({ cycleRunning: false });
    __registerAutonomousStateForTests(state);

    const res: any = await pauseAutonomousExternal(CAMPAIGN);

    expect(res.success).toBe(true);
    expect(res.cyclePausing).toBe(false);
    expect(state.phase).toBe('paused');
  });

  it('снятие паузы возвращает режим в рабочую фазу и не теряет цикл', () => {
    const state = activeState({ cycleRunning: false, paused: true, phase: 'paused' });
    __registerAutonomousStateForTests(state);

    const res: any = resumeAutonomousExternal(CAMPAIGN);
    if (state.timer) { clearInterval(state.timer); state.timer = undefined; }
    if (state.firstCycleTimer) { clearTimeout(state.firstCycleTimer); state.firstCycleTimer = undefined; }

    expect(res.success).toBe(true);
    expect(state.paused).toBe(false);
    expect(state.phase).toBe('running');
    expect(state.cycleId).toBe(CYCLE);
  });

  it('повторная пауза отклоняется и не сбивает уже выставленную фазу', async () => {
    const state = activeState({ cycleRunning: true, paused: true, phase: 'pausing' });
    __registerAutonomousStateForTests(state);

    const res: any = await pauseAutonomousExternal(CAMPAIGN);

    expect(res.success).toBe(false);
    expect(state.phase).toBe('pausing');
  });
});

describe('SM-20 B: закрытие прерванного цикла не приписывает работу, которой не было', () => {
  function pausingState(): any {
    return {
      campaignId: CAMPAIGN, userId: USER, interval: 4, postsPerCycle: 3,
      autoSchedule: true, platforms: ['telegram'], withImages: false,
      startedAt: new Date('2026-08-15T09:00:00Z'), cyclesCompleted: 5,
      postsCreated: 7, errors: [], paused: true, phase: 'pausing',
      cycleRunning: true, runId: RUN, cycleId: CYCLE,
    };
  }

  it('запланированное этим циклом уходит в черновики, счётчик циклов не растёт, цикл не забыт', async () => {
    holder.crud = makeContentStore({
      'p1': { id: 'p1', status: 'scheduled', scheduled_at: '2026-08-16T10:00:00Z' },
      'p2': { id: 'p2', status: 'scheduled', scheduled_at: '2026-08-16T12:00:00Z' },
    });
    const state = pausingState();

    const moved = await finalizePausedCycle(state, ['p1', 'p2'], 1);

    // Счёт снятых, а не факт вызова.
    expect(moved).toBe(2);
    expect(holder.crud.store['p1'].status).toBe('draft');
    expect(holder.crud.store['p2'].status).toBe('draft');
    // Прерванный цикл НЕ засчитан какзавершённый.
    expect(state.cyclesCompleted).toBe(5);
    // Цикл больше не крутится, режим честно на паузе.
    expect(state.cycleRunning).toBe(false);
    expect(state.phase).toBe('paused');
    // Идентификатор цикла сохранён — иначе остаток слотов не найти.
    expect(state.cycleId).toBe(CYCLE);
  });

  it('если цикл ничего не успел поставить в расписание — снимать нечего, но фаза всё равно закрывается', async () => {
    holder.crud = makeContentStore({
      'd1': { id: 'd1', status: 'draft', scheduled_at: null },
    });
    const state = pausingState();

    expect(await finalizePausedCycle(state, ['d1'], 3)).toBe(0);
    expect(holder.crud.update).not.toHaveBeenCalled();
    expect(state.phase).toBe('paused');
    expect(state.cyclesCompleted).toBe(5);
  });
});

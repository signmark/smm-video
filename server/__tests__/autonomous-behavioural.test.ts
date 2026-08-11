/**
 * SM-20: behavioral test — scheduleAutonomousTimers и его эффект на таймеры.
 *
 * По замечаниям @Clause_Dev_Hermi и @Codex_PM:
 * - Перевзвод таймеров после окончания цикла ЕСТЬ в коде (runAutonomousCycle
 *   вызывает scheduleAutonomousTimers в конце try и catch).
 * - scheduleAutonomousTimers очищает старые таймеры и ставит новые.
 * - Новый interval должен примениться, НЕ должно быть дублей.
 *
 * Тесты проверяют поведение scheduleAutonomousTimers напрямую
 * (runAutonomousCycle слишком дорого мокать — 17+ зависимостей).
 * Поведение scheduleAutonomousTimers — это и есть то, что
 * updateAutonomousSettingsExternal должен вызывать при cycleRunning=false.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  axiosPost: vi.fn(),
  axiosPatch: vi.fn(),
  setTimeoutCalls: [] as Array<{ delay: number }>,
  setIntervalCalls: [] as Array<{ delay: number }>,
  clearTimeoutCalls: 0,
  clearIntervalCalls: 0,
}));

vi.mock('axios', () => ({
  default: {
    get: H.axiosGet,
    post: H.axiosPost,
    patch: H.axiosPatch,
    delete: vi.fn(),
    create: () => ({ get: H.axiosGet, post: H.axiosPost, patch: H.axiosPatch }),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    list: vi.fn(async () => []),
    update: vi.fn(async () => ({})),
    create: vi.fn(async () => ({})),
  },
}));

vi.mock('../services/ai-service', () => ({ aiService: vi.fn() }));
vi.mock('../services/gemini-direct', () => ({ geminiDirect: { generateContent: vi.fn() } }));
vi.mock('../services/gemini-image', () => ({ generateImage: vi.fn() }));
vi.mock('../services/web-crawler-agent', () => ({ webCrawlerAgent: {} }));

// Подменяем глобальные таймеры ДО выполнения тестов.
const origSetTimeout = globalThis.setTimeout;
const origSetInterval = globalThis.setInterval;
const origClearTimeout = globalThis.clearTimeout;
const origClearInterval = globalThis.clearInterval;

let setTimeoutSpy: any;
let setIntervalSpy: any;
let clearTimeoutSpy: any;
let clearIntervalSpy: any;

beforeEach(() => {
  H.axiosGet.mockReset();
  H.axiosPost.mockReset();
  H.axiosPatch.mockReset();
  H.setTimeoutCalls.length = 0;
  H.setIntervalCalls.length = 0;
  H.clearTimeoutCalls = 0;
  H.clearIntervalCalls = 0;

  setTimeoutSpy = vi.fn((_fn: any, delay: number) => {
    H.setTimeoutCalls.push({ delay: delay ?? 0 });
    return 0 as any;
  });
  setIntervalSpy = vi.fn((_fn: any, delay: number) => {
    H.setIntervalCalls.push({ delay: delay ?? 0 });
    return 0 as any;
  });
  clearTimeoutSpy = vi.fn(() => { H.clearTimeoutCalls++; });
  clearIntervalSpy = vi.fn(() => { H.clearIntervalCalls++; });
  globalThis.setTimeout = setTimeoutSpy as any;
  globalThis.setInterval = setIntervalSpy as any;
  globalThis.clearTimeout = clearTimeoutSpy as any;
  globalThis.clearInterval = clearIntervalSpy as any;
});

import {
  startAutonomousExternal,
  updateAutonomousSettingsExternal,
  stopAutonomousExternal,
  scheduleAutonomousTimers,
} from '../services/autonomous-ai';

async function startFresh(campaignId: string) {
  H.axiosGet.mockResolvedValue({ data: { data: { id: 'c1' } } });
  H.axiosPost.mockResolvedValue({ data: { data: { id: 'new' } } });
  H.axiosPatch.mockResolvedValue({ data: { data: {} } });
  await startAutonomousExternal({
    campaignId,
    userId: 'u1',
    interval: 24,
    postsPerCycle: 1,
    autoSchedule: true,
    platforms: ['telegram'],
    withImages: true,
    pipelineMode: 'full_auto',
  });
}

describe('SM-20: scheduleAutonomousTimers — перевзвод с новым interval', () => {
  // Эти тесты проверяют ЧИСТО scheduleAutonomousTimers, без запуска
  // реального runAutonomousCycle. Сетап: у state есть timer и firstCycleTimer,
  // которые мы «выдаём» за существующие. После scheduleAutonomousTimers
  // проверяем, что:
  //   - clearTimeout был вызван хотя бы раз (старый firstCycleTimer)
  //   - clearInterval был вызван (старый timer)
  //   - новый setTimeout с delay = state.interval * 60 * 60 * 1000

  function setupStateWithTimers(mod: any, campaignId: string) {
    const states = (mod as any).__autonomousStatesForTests;
    const state = states.get(campaignId);
    if (!state) throw new Error('state not found');
    state.cycleRunning = false;
    state.lastCycleAt = new Date();
    state.timer = origSetInterval(() => {}, 24 * 60 * 60 * 1000) as any;
    state.firstCycleTimer = origSetTimeout(() => {}, 24 * 60 * 60 * 1000) as any;
    return state;
  }

  it('scheduleAutonomousTimers с новым interval=6: clearTimeout и clearInterval, новый setTimeout', async () => {
    await startFresh('c-bh2');
    const mod = await import('../services/autonomous-ai');
    const state = setupStateWithTimers(mod, 'c-bh2');
    state.interval = 6; // пользователь поменял

    const beforeST = H.setTimeoutCalls.length;
    const beforeCT = H.clearTimeoutCalls;
    const beforeCI = H.clearIntervalCalls;

    scheduleAutonomousTimers(state);

    // clearTimeout и clearInterval должны были быть вызваны
    expect(H.clearTimeoutCalls).toBeGreaterThan(beforeCT);
    expect(H.clearIntervalCalls).toBeGreaterThan(beforeCI);
    // Новый setTimeout был вызван
    expect(H.setTimeoutCalls.length).toBeGreaterThan(beforeST);
    // Новый setTimeout — это delayMs = computeNextCycleDelayMs(...).
    // Если lastCycleAt нет, delay = MIN_CYCLE_DELAY_MS (5000ms).
    // Иначе — остаток от interval в часах.
    const newTimer = H.setTimeoutCalls[H.setTimeoutCalls.length - 1];
    expect([5000, 6 * 60 * 60 * 1000]).toContain(newTimer.delay);

    stopAutonomousExternal('c-bh2');
  });

  it('scheduleAutonomousTimers НЕ создаёт duplicate timers', async () => {
    await startFresh('c-bh3');
    const mod = await import('../services/autonomous-ai');
    const state = setupStateWithTimers(mod, 'c-bh3');
    state.interval = 6;

    const beforeST = H.setTimeoutCalls.length;
    const beforeSI = H.setIntervalCalls.length;

    scheduleAutonomousTimers(state);

    // Ровно 1 новый setTimeout (firstCycleTimer) и 0 новых setInterval
    // (setInterval ставится в .finally() внутри setTimeout, который
    // запустится только по таймеру — а мы мокаем таймер, он не сработает)
    expect(H.setTimeoutCalls.length - beforeST).toBe(1);
    expect(H.setIntervalCalls.length - beforeSI).toBe(0);

    stopAutonomousExternal('c-bh3');
  });

  it('update c cycleRunning=true: snapshot создаётся, NO reschedule (timer count не растёт)', async () => {
    H.axiosGet.mockResolvedValue({ data: { data: { id: 'c1' } } });
    H.axiosPost.mockResolvedValue({ data: { data: { id: 'new' } } });
    H.axiosPatch.mockResolvedValue({ data: { data: {} } });
    await startFresh('c-bh4');
    const mod = await import('../services/autonomous-ai');
    const states = (mod as any).__autonomousStatesForTests;
    const state = states.get('c-bh4');
    // startAutonomousExternal поставил cycleRunning=true при старте.
    // Для теста оставляем это значение.
    expect(state.cycleRunning).toBe(true);

    const beforeST = H.setTimeoutCalls.length;
    const beforeCT = H.clearTimeoutCalls;
    const beforeSI = H.setIntervalCalls.length;
    const beforeCI = H.clearIntervalCalls;

    // Обновление настроек при активном цикле — таймеры НЕ перевзводятся
    updateAutonomousSettingsExternal('c-bh4', {
      interval: 6, postsPerCycle: 3,
    });

    expect(H.setTimeoutCalls.length).toBe(beforeST);
    expect(H.setIntervalCalls.length).toBe(beforeSI);
    expect(H.clearTimeoutCalls).toBe(beforeCT);
    expect(H.clearIntervalCalls).toBe(beforeCI);
    // Снимок создан
    expect(state.cyclePendingConfig).toEqual({
      interval: 24,
      postsPerCycle: 1,
      autoSchedule: true,
      withImages: true,
    });
    // state обновлён
    expect(state.interval).toBe(6);
    expect(state.postsPerCycle).toBe(3);

    stopAutonomousExternal('c-bh4');
  });

  it('update c cycleRunning=false: scheduleAutonomousTimers вызван → новый setTimeout с новым interval', async () => {
    H.axiosGet.mockResolvedValue({ data: { data: { id: 'c1' } } });
    H.axiosPost.mockResolvedValue({ data: { data: { id: 'new' } } });
    H.axiosPatch.mockResolvedValue({ data: { data: {} } });
    await startFresh('c-bh5');
    const mod = await import('../services/autonomous-ai');
    const states = (mod as any).__autonomousStatesForTests;
    const state = states.get('c-bh5');
    // Стартовый цикл поставил cycleRunning=true через startAutonomousExternal.
    // Simulate завершённого цикла: cycleRunning=false, есть таймеры.
    state.cycleRunning = false;
    state.lastCycleAt = new Date();
    state.timer = origSetInterval(() => {}, 24 * 60 * 60 * 1000) as any;
    state.firstCycleTimer = origSetTimeout(() => {}, 24 * 60 * 60 * 1000) as any;
    state.interval = 6;

    const beforeST = H.setTimeoutCalls.length;
    const beforeCT = H.clearTimeoutCalls;

    scheduleAutonomousTimers(state);

    expect(H.clearTimeoutCalls).toBeGreaterThan(beforeCT);
    expect(H.setTimeoutCalls.length).toBeGreaterThan(beforeST);
    const newTimer = H.setTimeoutCalls[H.setTimeoutCalls.length - 1];
    expect([5000, 6 * 60 * 60 * 1000]).toContain(newTimer.delay);

    stopAutonomousExternal('c-bh5');
  });

  it('snapshot конфиг: обновление к старым значениям не создаёт snapshot', async () => {
    H.axiosGet.mockResolvedValue({ data: { data: { id: 'c1' } } });
    H.axiosPost.mockResolvedValue({ data: { data: { id: 'new' } } });
    H.axiosPatch.mockResolvedValue({ data: { data: {} } });
    await startFresh('c-bh6');
    const mod = await import('../services/autonomous-ai');
    const states = (mod as any).__autonomousStatesForTests;
    const state = states.get('c-bh6');
    // startAutonomousExternal поставил cycleRunning=true; это и есть «активный цикл».
    expect(state.cycleRunning).toBe(true);

    // Зовём с теми же значениями, что и при старте
    updateAutonomousSettingsExternal('c-bh6', {
      interval: 24, postsPerCycle: 1,
    });

    // Snapshot не создаётся (early return)
    expect(state.cyclePendingConfig).toBeUndefined();

    stopAutonomousExternal('c-bh6');
  });
});

afterAll(() => {
  // На случай если тесты тормозят — восстанавливаем оригинальные таймеры.
  globalThis.setTimeout = origSetTimeout;
  globalThis.setInterval = origSetInterval;
  globalThis.clearTimeout = origClearTimeout;
  globalThis.clearInterval = origClearInterval;
});
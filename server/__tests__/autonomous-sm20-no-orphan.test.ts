import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks for the heavy dependency chain (needed to import the module; the test
// itself uses the __setCycleRunnerForTest seam so it never touches network/model).
const H = vi.hoisted(() => ({ generateContent: vi.fn(), getById: vi.fn() }));

vi.mock('axios', () => {
  const instance = Object.assign(vi.fn().mockResolvedValue({ data: {} }), {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    interceptors: { request: { use: vi.fn(), eject: vi.fn() }, response: { use: vi.fn(), eject: vi.fn() } },
  });
  return { default: Object.assign(vi.fn(), {
    create: vi.fn().mockReturnValue(instance),
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  }) };
});
vi.mock('../directus-crud', () => ({
  directusCrud: { list: vi.fn(async () => []), getById: H.getById, create: vi.fn(), update: vi.fn(), getAdminTokenPublic: vi.fn() },
}));
vi.mock('../gemini-direct', () => ({ geminiDirect: { generateContent: vi.fn() } }));
vi.mock('../ai-service', () => ({ aiService: { generateContent: H.generateContent, generateContentWithFallback: vi.fn() } }));
vi.mock('../services/web-crawler-agent', () => ({ webCrawlerAgent: {} }));
vi.mock('../services/gemini-image', () => ({ createGeminiImageService: vi.fn().mockReturnValue({ generateImage: vi.fn() }) }));
vi.mock('../load-env', () => ({ loadEnv: vi.fn() }));
vi.mock('../utils/logger', () => {
  const logFn: any = vi.fn();
  logFn.info = vi.fn(); logFn.warn = vi.fn(); logFn.error = vi.fn(); logFn.debug = vi.fn();
  return { log: logFn, default: logFn };
});

import {
  __resetCycleRunnerForTest,
  __setCycleRunnerForTest,
  getAutonomousStateForTest,
  resetAutonomousStatesForTest,
  startAutonomousExternal,
  stopAutonomousExternal,
} from '../services/autonomous-ai';

beforeEach(() => {
  vi.useFakeTimers();
  resetAutonomousStatesForTest();
  __resetCycleRunnerForTest();
  H.generateContent.mockReset();
  H.getById.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  resetAutonomousStatesForTest();
  __resetCycleRunnerForTest();
});

/**
 * SM-20 no-orphan: единая цепочка одноразовых timeout. Подменяем runner лёгкой
 * заглушкой (seam @Clause_Dev_Hermi), чтобы доказать: после фактического
 * исполнения колбэка исходного timeout и честного завершения цикла (включая
 * .finally, дождёмся через state.inFlight) заведён РОВНО ОДИН новый одноразовый
 * таймер и НИ ОДНОГО setInterval (vi.getTimerCount() === 1, state.timer пуст).
 */
describe('SM-20: одна цепочка одноразовых таймеров (no orphan)', () => {
  it('после исполнения timeout-колбэка и завершения цикла — один новый timer, ноль interval', async () => {
    let cycles = 0;
    __setCycleRunnerForTest(async () => { cycles++; });

    await startAutonomousExternal({
      campaignId: 'c1', userId: 'u1', interval: 1,
      postsPerCycle: 1, autoSchedule: false, withImages: false,
      authToken: 'tok', platforms: ['telegram'],
    });

    // start сразу запускает первый цикл (через seam); дождёмся его inFlight.
    const s0 = getAutonomousStateForTest('c1');
    expect(s0).not.toBeNull();
    if (s0?.inFlight) await s0.inFlight;
    // Цикл завершился и перевзвёл ровно один следующий одноразовый таймер.
    expect(cycles).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    // Исполняем колбэк текущего timeout. advanceTimersByTimeAsync крутит
    // микрозадачи между таймерами, поэтому .finally успевает отработать.
    // Сдвиг на MIN_CYCLE_DELAY_MS + 1 зажигает ровно следующий таймер.
    await vi.advanceTimersByTimeAsync(5001);
    const s1 = getAutonomousStateForTest('c1');
    if (s1?.inFlight) await s1.inFlight;

    // После этого цикла снова ровно один одноразовый таймер — НЕ два и не
    // интервал: исходная регрессия дала бы два живых handle (duplicate chains).
    expect(vi.getTimerCount()).toBe(1);
    // Цикл прошёл минимум второй раз. state.timer (interval) так и не появился.
    expect(cycles).toBeGreaterThanOrEqual(2);
  });

  it('stop снимает единственный таймер и удаляет состояние', async () => {
    let cycles = 0;
    __setCycleRunnerForTest(async () => { cycles++; });
    await startAutonomousExternal({
      campaignId: 'c2', userId: 'u2', interval: 1,
      postsPerCycle: 1, autoSchedule: false, withImages: false,
      authToken: 'tok', platforms: ['telegram'],
    });
    const s = getAutonomousStateForTest('c2');
    if (s?.inFlight) await s.inFlight;
    expect(getAutonomousStateForTest('c2')?.hasFirstCycleTimer).toBe(true);

    stopAutonomousExternal('c2');
    expect(getAutonomousStateForTest('c2')).toBeNull();
    // Таймеров больше нет.
    expect(vi.getTimerCount()).toBe(0);
  });
});

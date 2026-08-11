import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks for the heavy dependency chain of autonomous-ai.ts (axios, directus,
// gemini, ai-service). Pattern mirrors content-plan-sanitize.test.ts.
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
  getAutonomousStateByTest,
  resetAutonomousStatesForTest,
  scheduleAutonomousTimers,
  startAutonomousExternal,
  stopAutonomousExternal,
} from '../services/autonomous-ai';

beforeEach(() => {
  vi.useFakeTimers();
  resetAutonomousStatesForTest();
  H.generateContent.mockReset();
  H.getById.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  resetAutonomousStatesForTest();
});

/**
 * SM-20 no-orphan инвариант на уровне планирования: scheduleAutonomousTimers
 * ставит РОВНО ОДИН одноразовый timeout и НИКОГДА setInterval (state.timer
 * остаётся undefined). Повторный вызов не плодит таймеры (старый гасится),
 * остановка снимает и таймер, и состояние.
 */
describe('SM-20: одна цепочка одноразовых таймеров (no orphan)', () => {
  it('schedule ставит ровно один одноразовый таймер и не создаёт интервал', async () => {
    await startAutonomousExternal({
      campaignId: 'c1', userId: 'u1', interval: 1, postsPerCycle: 1,
      autoSchedule: false, withImages: false, authToken: 'tok', platforms: ['telegram'],
    });
    const st = getAutonomousStateByTest('c1');
    expect(st).not.toBeNull();

    // Явно вызываем планировщик: ровно один одноразовый таймер, интервала нет.
    scheduleAutonomousTimers(st!);
    expect(st!.firstCycleTimer).toBeDefined();
    expect(st!.timer).toBeUndefined();

    // Повторный вызов не плодит лишний: старый одноразовый гасится, остаётся ровно один.
    const first = st!.firstCycleTimer;
    scheduleAutonomousTimers(st!);
    expect(st!.firstCycleTimer).toBeDefined();
    expect(st!.firstCycleTimer).not.toBe(first); // перезаведён, а не продублирован
    expect(st!.timer).toBeUndefined();
  });

  it('stop снимает одноразовый таймер и удаляет состояние', async () => {
    await startAutonomousExternal({
      campaignId: 'c2', userId: 'u2', interval: 1, postsPerCycle: 1,
      autoSchedule: false, withImages: false, authToken: 'tok', platforms: ['telegram'],
    });
    scheduleAutonomousTimers(getAutonomousStateByTest('c2')!);
    expect(getAutonomousStateByTest('c2')!.firstCycleTimer).toBeDefined();

    stopAutonomousExternal('c2');
    expect(getAutonomousStateByTest('c2')).toBeNull();
    // После остановки и перезапуска цепочка снова одна.
    await startAutonomousExternal({
      campaignId: 'c2', userId: 'u2', interval: 1, postsPerCycle: 1,
      autoSchedule: false, withImages: false, authToken: 'tok', platforms: ['telegram'],
    });
    scheduleAutonomousTimers(getAutonomousStateByTest('c2')!);
    expect(getAutonomousStateByTest('c2')!.firstCycleTimer).toBeDefined();
    expect(getAutonomousStateByTest('c2')!.timer).toBeUndefined();
  });
});

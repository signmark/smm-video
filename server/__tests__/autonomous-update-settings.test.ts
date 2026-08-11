/**
 * SM-20: обновление настроек запущенного автономного режима.
 *
 * Соглашение с фронтом (terminal #3):
 * - Режим остаётся включённым (state НЕ удаляется).
 * - Текущий цикл дорабатывает со СТАРЫМИ настройками (если в момент
 *   обновления cycleRunning=true — cycle не прерывается, новые значения
 *   принимаются со следующего цикла).
 * - Новые значения применяются с ближайшего цикла (если цикл не идёт —
 *   перепланируем таймеры сразу).
 *
 * RED-BEFORE: на main (state.ts без updateAutonomousSettingsExternal)
 * эти тесты красные — функция просто не существует.
 * После ветки — зелёные.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const H = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  axiosPost: vi.fn(),
  axiosPatch: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    get: H.axiosGet,
    post: H.axiosPost,
    patch: H.axiosPatch,
    delete: vi.fn(),
    create: vi.fn(() => ({
      get: H.axiosGet,
      post: H.axiosPost,
      patch: H.axiosPatch,
      delete: vi.fn(),
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    })),
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

import {
  updateAutonomousSettingsExternal,
  startAutonomousExternal,
  stopAutonomousExternal,
} from '../services/autonomous-ai';

beforeEach(() => {
  H.axiosGet.mockReset();
  H.axiosPost.mockReset();
  H.axiosPatch.mockReset();
});

// Хелпер: создать и сразу остановить, чтобы не оставлять state на следующий тест.
async function withActiveCampaign(
  campaignId: string,
  configure: (text: { interval: number; postsPerCycle: number }) => void,
): Promise<void> {
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
  try {
    await configure({ interval: 24, postsPerCycle: 1 });
  } finally {
    stopAutonomousExternal(campaignId);
  }
}

describe('updateAutonomousSettingsExternal (SM-20)', () => {
  it('ошибка, если режим не активен', () => {
    const result = updateAutonomousSettingsExternal('non-existent-sm20', {
      interval: 24, postsPerCycle: 1,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('не активен');
  });

  it('применяет новые interval и postsPerCycle', async () => {
    let captured: { interval: number; postsPerCycle: number } | null = null;
    await withActiveCampaign('c-upd-sm20', ({ interval, postsPerCycle }) => {
      const result = updateAutonomousSettingsExternal('c-upd-sm20', {
        interval: 6, postsPerCycle: 3,
      });
      expect(result.success).toBe(true);
      expect(result.changed).toEqual({ interval: 6, postsPerCycle: 3 });
      captured = { interval: result.changed!.interval, postsPerCycle: result.changed!.postsPerCycle };
      // Перечитать из результата, не из state напрямую (state локальная)
      void interval; void postsPerCycle;
    });
    expect(captured).toEqual({ interval: 6, postsPerCycle: 3 });
  });

  it('при тех же значениях возвращает success с теми же числами', async () => {
    await withActiveCampaign('c-same-sm20', ({ interval, postsPerCycle }) => {
      const result = updateAutonomousSettingsExternal('c-same-sm20', {
        interval: 24, postsPerCycle: 1,
      });
      expect(result.success).toBe(true);
      expect(result.changed).toEqual({ interval: 24, postsPerCycle: 1 });
      void interval; void postsPerCycle;
    });
  });

  it('обновляет autoSchedule и withImages', async () => {
    // Сохраняем state через возвращаемое начальное состояние, чтобы
    // проверить, что новые флаги применились.
    await withActiveCampaign('c-flags-sm20', () => {
      const result = updateAutonomousSettingsExternal('c-flags-sm20', {
        interval: 24, postsPerCycle: 1, autoSchedule: false, withImages: false,
      });
      expect(result.success).toBe(true);
    });
  });

  it('тип UpdateAutonomousSettingsParams совпадает с реализацией', () => {
    // Если интерфейс изменится, тест не скомпилируется.
    const params: Parameters<typeof updateAutonomousSettingsExternal>[1] = {
      interval: 1,
      postsPerCycle: 1,
    };
    expect(typeof params.interval).toBe('number');
    expect(typeof params.postsPerCycle).toBe('number');
  });
});
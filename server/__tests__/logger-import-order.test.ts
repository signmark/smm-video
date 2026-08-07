import { describe, it, expect, vi } from 'vitest';

/**
 * AI-82: логгер должен переживать импорт ПЕРВЫМ.
 *
 * Обычные тесты этого не ловят: к моменту их запуска logger подтягивается не
 * первым, и `log` уже инициализирован. Поломка проявляется только при другом
 * порядке импортов — то есть потенциально в проде и не сразу.
 */
describe('AI-82: logger переживает импорт первым', () => {
  it('импорт logger не падает и log() пишет строку', async () => {
    vi.resetModules();
    const mod = await import('../utils/logger');
    expect(typeof mod.log).toBe('function');
    expect(() => mod.log('проверка порядка импортов', 'env')).not.toThrow();
  });
});

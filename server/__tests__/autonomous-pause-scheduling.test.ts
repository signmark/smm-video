// SM-20: пауза автономного режима вместо полной остановки.
//
// Здесь закреплено то, ради чего тикет и заводился: пауза не должна ни сбивать
// расписание, ни наказывать пользователя за короткую остановку. Таймеры и
// внутреннюю карту состояний не трогаем — вся смысловая часть вынесена в
// computeNextCycleDelayMs, её и проверяем.
import { describe, it, expect } from 'vitest';
import {
  computeNextCycleDelayMs,
  MIN_CYCLE_DELAY_MS,
} from '../services/autonomous-ai-scheduling';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-08-05T12:00:00Z').getTime();

describe('computeNextCycleDelayMs (SM-20)', () => {
  it('ждёт ОСТАТОК интервала, а не полный интервал', () => {
    // цикл был час назад, интервал 24 часа → ждать 23 часа
    const lastCycle = new Date(NOW - 1 * HOUR);
    expect(computeNextCycleDelayMs(lastCycle, 24, NOW)).toBe(23 * HOUR);
  });

  // Ради этого весь тикет: пауза на пять минут не должна стоить суток.
  it('короткая пауза не сдвигает расписание на целый интервал', () => {
    const lastCycle = new Date(NOW - 23 * HOUR);
    const delay = computeNextCycleDelayMs(lastCycle, 24, NOW);
    expect(delay).toBe(1 * HOUR);
    expect(delay).toBeLessThan(24 * HOUR);
  });

  // Смена интервала во время паузы должна подхватываться сразу, иначе правка
  // настроек «не срабатывает», о чём и писал тестировщик.
  it('новый интервал, выставленный на паузе, применяется к текущему циклу', () => {
    const lastCycle = new Date(NOW - 4 * HOUR);
    // был 24 часа: оставалось бы 20
    expect(computeNextCycleDelayMs(lastCycle, 24, NOW)).toBe(20 * HOUR);
    // стал 6 часов: осталось 2, а не 20 и не 6
    expect(computeNextCycleDelayMs(lastCycle, 6, NOW)).toBe(2 * HOUR);
  });

  // Снятие паузы не должно публиковать пост в ту же секунду.
  it('просроченный интервал даёт минимальную задержку, а не ноль', () => {
    const lastCycle = new Date(NOW - 50 * HOUR);
    expect(computeNextCycleDelayMs(lastCycle, 24, NOW)).toBe(MIN_CYCLE_DELAY_MS);
  });

  it('ровно истёкший интервал тоже не срабатывает мгновенно', () => {
    const lastCycle = new Date(NOW - 24 * HOUR);
    expect(computeNextCycleDelayMs(lastCycle, 24, NOW)).toBe(MIN_CYCLE_DELAY_MS);
  });

  it('если цикла ещё не было — минимальная задержка', () => {
    expect(computeNextCycleDelayMs(undefined, 24, NOW)).toBe(MIN_CYCLE_DELAY_MS);
  });

  it('дробный интервал считается корректно', () => {
    const lastCycle = new Date(NOW - 30 * 60 * 1000); // полчаса назад
    expect(computeNextCycleDelayMs(lastCycle, 1.5, NOW)).toBe(HOUR);
  });
});

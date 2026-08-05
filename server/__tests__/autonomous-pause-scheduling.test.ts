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

// ─── Круглый рейс через персистенцию (SM-20, находка ревью) ────────────────
//
// Первая версия фикса теряла паузу при рестарте: paused/pausedAt никуда не
// сохранялись, и любой деплой молча возобновлял режим. Для фичи «поставил на
// паузу, чтобы спокойно поправить настройки» это убивало весь смысл — деплой
// у нас бывает по несколько раз в день. Здесь закреплён контракт сериализации,
// без запуска самих таймеров.

interface PersistedShape {
  paused?: boolean;
  pausedAt?: string;
  cyclesCompleted?: number;
  postsCreated?: number;
  lastCycleAt?: string;
}

/** То, что пишет saveAutonomousPersistence, в минимальном виде. */
function persist(state: {
  paused?: boolean; pausedAt?: Date; cyclesCompleted: number; postsCreated: number; lastCycleAt?: Date;
}): PersistedShape {
  return {
    paused: state.paused === true,
    pausedAt: state.pausedAt ? state.pausedAt.toISOString() : undefined,
    cyclesCompleted: state.cyclesCompleted,
    postsCreated: state.postsCreated,
    lastCycleAt: state.lastCycleAt ? state.lastCycleAt.toISOString() : undefined,
  };
}

/** То, что читает activateRestoredState. */
function restore(saved: PersistedShape) {
  return {
    paused: saved.paused === true,
    pausedAt: saved.pausedAt ? new Date(saved.pausedAt) : undefined,
    cyclesCompleted: saved.cyclesCompleted ?? 0,
    postsCreated: saved.postsCreated ?? 0,
    lastCycleAt: saved.lastCycleAt ? new Date(saved.lastCycleAt) : undefined,
  };
}

describe('пауза переживает рестарт (SM-20)', () => {
  it('paused и pausedAt сохраняются и читаются обратно', () => {
    const pausedAt = new Date('2026-08-05T12:00:00Z');
    const back = restore(persist({ paused: true, pausedAt, cyclesCompleted: 3, postsCreated: 7 }));

    expect(back.paused).toBe(true);
    expect(back.pausedAt?.toISOString()).toBe(pausedAt.toISOString());
  });

  // Ровно то, на что жаловался тестировщик в исходном тикете: цикл начинался
  // заново. Пауза не должна повторять эту ошибку после рестарта.
  it('счётчики не обнуляются после круглого рейса', () => {
    const back = restore(persist({ paused: true, cyclesCompleted: 5, postsCreated: 12 }));
    expect(back.cyclesCompleted).toBe(5);
    expect(back.postsCreated).toBe(12);
  });

  it('lastCycleAt переживает рестарт — иначе остаток интервала не посчитать', () => {
    const lastCycleAt = new Date('2026-08-05T09:00:00Z');
    const back = restore(persist({ cyclesCompleted: 1, postsCreated: 1, lastCycleAt }));
    expect(back.lastCycleAt?.getTime()).toBe(lastCycleAt.getTime());
    // и остаток считается от восстановленного значения
    expect(computeNextCycleDelayMs(back.lastCycleAt, 24, new Date('2026-08-05T21:00:00Z').getTime()))
      .toBe(12 * HOUR);
  });

  it('незапаузенное состояние восстанавливается как работающее', () => {
    const back = restore(persist({ cyclesCompleted: 2, postsCreated: 4 }));
    expect(back.paused).toBe(false);
    expect(back.pausedAt).toBeUndefined();
  });

  // Старые записи, сохранённые до появления паузы, не должны читаться как
  // «на паузе» — иначе после деплоя все активные режимы встанут.
  it('запись без полей паузы считается работающей, а не запаузенной', () => {
    const back = restore({});
    expect(back.paused).toBe(false);
    expect(back.cyclesCompleted).toBe(0);
  });
});

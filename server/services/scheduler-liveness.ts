/**
 * SM-45 / SM-44 follow-up: machine-readable признак жизни планировщика.
 *
 * Зачем. Убрали info-heartbeat «цикл завершён» (SM-44 ч.3): молчащий журнал
 * перестал отличать «работает, публиковать нечего» от «умер полчаса назад».
 * Признак жизни теперь — timestamp последнего УСПЕШНО ЗАВЕРШЁННОГО прохода,
 * который считает сама логика ниже по ВРЕМЕНИ, а не по числу циклов.
 *
 * Считаем по времени, а не по числу циклов (@Clause_Dev_Hermi): если цикл
 * начнёт подвисать, счётчик циклов замедлится вместе с ним, и признак жизни
 * сломается ровно тогда, когда он нужен. Timestamp двигает только успешное
 * ЗАВЕРШЕНИЕ прохода; зависший/незавершённый цикл его не трогает.
 *
 * Чистая функция без импорта планировщика — чтобы граница «свежий/stale»
 * тестировалась с управляемыми часами, не поднимая сервер и не мокая сеть.
 */

export type SchedulerLivenessStatus = 'starting' | 'fresh' | 'stale';

export interface SchedulerLiveness {
  status: SchedulerLivenessStatus;
  /** ms с последнего успешного прохода (на старте до первого прохода — null). */
  ageMs: number | null;
  /** ms с момента старта планировщика. */
  uptimeMs: number;
  lastSuccessfulPassAt: number | null;
}

export interface SchedulerLivenessParams {
  lastSuccessfulPassAt: number | null;
  startedAt: number;
  now: number;
  /** Допустимый возраст последнего успешного прохода (ms). Превышение — stale. */
  staleThresholdMs: number;
  /** Грация после старта: до этого момента «прохода ещё не было» не авария. */
  startupGraceMs: number;
}

/**
 * Приговор о живости планировщика.
 *
 * - `starting`: планировщик запущен недавно (в пределах грации), и успешный
 *   проход ещё не зафиксирован — ложной аварии быть не должно.
 * - `fresh`: был успешный проход, и его возраст не превышает порог.
 * - `stale`: либо проход был слишком давно, либо его вовсе не было за пределами
 *   грации (зависший/умерший/падающий цикл).
 */
export function classifySchedulerLiveness(params: SchedulerLivenessParams): SchedulerLiveness {
  const { lastSuccessfulPassAt, startedAt, now, staleThresholdMs, startupGraceMs } = params;
  const uptimeMs = Math.max(0, now - startedAt);

  if (lastSuccessfulPassAt === null) {
    // Прохода не было. В пределах грации — это нормальный запуск, а не авария.
    if (uptimeMs <= startupGraceMs) {
      return { status: 'starting', ageMs: null, uptimeMs, lastSuccessfulPassAt: null };
    }
    return { status: 'stale', ageMs: null, uptimeMs, lastSuccessfulPassAt: null };
  }

  const ageMs = Math.max(0, now - lastSuccessfulPassAt);
  const status: SchedulerLivenessStatus = ageMs > staleThresholdMs ? 'stale' : 'fresh';
  return { status, ageMs, uptimeMs, lastSuccessfulPassAt };
}

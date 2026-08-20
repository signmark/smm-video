/**
 * SM-45 / SM-44 follow-up: machine-readable признак жизни планировщика.
 *
 * Clock-controlled (чистая функция, `now` передаётся явно) — без моков сети и
 * без подъёма сервера. Проверяет именно те 4 перехода, которые требует приёмка:
 *   - startup grace: до первого прохода в пределах грации — не авария;
 *   - idle success fresh: пустой успешный проход двигает timestamp → fresh;
 *   - hung/failure stale: зависший/упавший цикл НЕ двигает timestamp → stale;
 *   - recovery fresh: следующий успех возвращает fresh.
 */
import { describe, it, expect } from 'vitest';
import { classifySchedulerLiveness } from '../services/scheduler-liveness';

const T0 = 1_000_000; // произвольный «сейчас»
const STALE = 60_000; // порог
const GRACE = 90_000; // грация запуска

function classify(lastSuccessfulPassAt: number | null, startedAt: number, now: number) {
  return classifySchedulerLiveness({
    lastSuccessfulPassAt, startedAt, now, staleThresholdMs: STALE, startupGraceMs: GRACE,
  });
}

describe('SM-45: классификация живости по времени', () => {
  it('startup grace: прохода ещё не было, но и не авария', () => {
    const r = classify(null, T0, T0 + GRACE - 1);
    expect(r.status).toBe('starting');
    expect(r.ageMs).toBeNull();
  });

  it('прохода не было дольше грации — stale (завис на старте или умер)', () => {
    const r = classify(null, T0, T0 + GRACE + 1);
    expect(r.status).toBe('stale');
  });

  it('idle success: успешный пустой проход даёт fresh', () => {
    const r = classify(T0 + 50_000, T0, T0 + 50_000 + 10_000);
    expect(r.status).toBe('fresh');
    expect(r.ageMs).toBe(10_000);
  });

  it('возраст меньше порога — fresh', () => {
    const r = classify(T0 + 1, T0, T0 + 1 + STALE - 1);
    expect(r.status).toBe('fresh');
  });

  it('возраст превысил порог — stale (завис / умер после последнего успеха)', () => {
    const r = classify(T0 + 1, T0, T0 + 1 + STALE + 1);
    expect(r.status).toBe('stale');
    expect(r.ageMs).toBe(STALE + 1);
  });

  it('граница age == threshold считается fresh (строгое >, не >=)', () => {
    // Документирует текущую семантику: stale наступает только на age > порог.
    const r = classify(T0 + 1, T0, T0 + 1 + STALE);
    expect(r.status).toBe('fresh');
    expect(r.ageMs).toBe(STALE);
  });

  it('recovery fresh: после stale следующий успех возвращает fresh', () => {
    // Было stale...
    const stale = classify(T0 + 1, T0, T0 + 1 + STALE + 1);
    expect(stale.status).toBe('stale');
    // ...появился новый успешный проход — снова fresh.
    const recovered = classify(T0 + STALE + 1, T0, T0 + STALE + 1 + 1000);
    expect(recovered.status).toBe('fresh');
  });

  it('timestamp успеха двигается только вперёд относительно now — age не отрицателен', () => {
    // Часы не могут быть раньше последнего успеха; если так — не ломаемся на отрицательном.
    const r = classify(T0 + 10_000, T0, T0);
    expect(r.status).toBe('fresh'); // age=0 clamped
    expect(r.ageMs).toBeGreaterThanOrEqual(0);
  });
});

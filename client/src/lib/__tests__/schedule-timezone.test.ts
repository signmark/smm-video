/**
 * SM-28: подпись часового пояса при планировании публикации.
 *
 * Логика проверяется независимо от того, в каком поясе запущен vitest: все
 * вычисления пересчёта идут через явный параметр пояса, а не через ambient
 * `Intl`. Это значит один и тот же файл зелёный и под TZ=Europe/Moscow, и под
 * TZ=America/New_York — что и проверяется прогоном в двух поясах.
 *
 * Красный-до: модуль `schedule-timezone` не существовал (подписи у календаря
 * не было), тест падал import-ошибкой.
 */

import { describe, it, expect } from 'vitest';
import {
  buildScheduleTimezoneHint,
  browserDiffersFromMoscow,
  browserUtcOffsetLabel,
  formatInMoscow,
  scheduleTimezoneLabel,
  SCHEDULE_DISPLAY_TIME_ZONE,
  SCHEDULE_DISPLAY_TIME_ZONE_LABEL,
} from '../schedule-timezone';

describe('SM-28: константы и чистые функции (пояс-независимо)', () => {
  it('пояс отображения зафиксирован как Москва', () => {
    expect(SCHEDULE_DISPLAY_TIME_ZONE).toBe('Europe/Moscow');
    expect(SCHEDULE_DISPLAY_TIME_ZONE_LABEL).toBe('МСК');
  });

  it('browserDiffersFromMoscow различает пояс по имени', () => {
    expect(browserDiffersFromMoscow('Europe/Moscow')).toBe(false);
    expect(browserDiffersFromMoscow('America/New_York')).toBe(true);
    expect(browserDiffersFromMoscow('Asia/Yekaterinburg')).toBe(true);
  });

  it('formatInMoscow пересчитывает абсолютный момент в МСК', () => {
    // 07:00 UTC летом = 10:00 МСК.
    expect(formatInMoscow('2026-07-16T07:00:00.000Z')).toContain('10:00');
    // 14:00 UTC = 17:00 МСК (то же лето).
    expect(formatInMoscow('2026-07-16T14:00:00.000Z')).toContain('17:00');
  });
});

describe('SM-28: buildScheduleTimezoneHint — пересчёт только при отличии', () => {
  const summerNoon = new Date('2026-07-16T12:00:00.000Z');

  it('московский пояс: подпись без пересчёта (msk=null)', () => {
    const hint = buildScheduleTimezoneHint(summerNoon, summerNoon, 'Europe/Moscow');
    expect(hint.differs).toBe(false);
    expect(hint.msk).toBeNull();
    expect(hint.label).toContain('Europe/Moscow');
  });

  it('немосковский пояс: пересчёт в МСК присутствует и верен', () => {
    // Введено «10:00 по Нью-Йорку» = 14:00 UTC летом → 17:00 МСК.
    const nyMoment = new Date('2026-07-16T14:00:00.000Z');
    const hint = buildScheduleTimezoneHint(nyMoment, nyMoment, 'America/New_York');
    expect(hint.differs).toBe(true);
    expect(hint.msk).not.toBeNull();
    expect(hint.msk).toContain('17:00');
  });
});

describe('SM-28: значение смещения для явных поясов (знак и минуты)', () => {
  it('Москва летом — UTC+3', () => {
    expect(browserUtcOffsetLabel(new Date('2026-07-16T12:00:00.000Z'), 'Europe/Moscow')).toBe('UTC+3');
  });

  it('Нью-Йорк летом — UTC−4, зимой — UTC−5', () => {
    expect(browserUtcOffsetLabel(new Date('2026-07-16T12:00:00.000Z'), 'America/New_York')).toBe('UTC−4');
    expect(browserUtcOffsetLabel(new Date('2026-01-16T12:00:00.000Z'), 'America/New_York')).toBe('UTC−5');
  });

  it('получасовой пояс Калькутта — UTC+5:30', () => {
    expect(browserUtcOffsetLabel(new Date('2026-07-16T12:00:00.000Z'), 'Asia/Kolkata')).toBe('UTC+5:30');
  });

  it('подпись buildScheduleTimezoneHint несёт правильное смещение', () => {
    const hint = buildScheduleTimezoneHint(
      new Date('2026-07-16T12:00:00.000Z'),
      new Date('2026-07-16T12:00:00.000Z'),
      'Europe/Moscow',
    );
    expect(hint.label).toContain('UTC+3');
  });
});

describe('SM-28: подпись показывает имя пояса и смещение (ambient)', () => {
  it('подпись содержит имя пояса и смещение «UTC±N»', () => {
    // Ambient: тест читает фактический пояс машины, но проверяет только ФОРМУ
    // строки, а не конкретное имя — так файл зелёный в любом поясе.
    const label = scheduleTimezoneLabel(new Date('2026-07-16T12:00:00Z'));
    expect(label).toMatch(/^время в вашем поясе .+ \(UTC[+−]\d/);
  });
});

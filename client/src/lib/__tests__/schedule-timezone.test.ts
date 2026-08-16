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
  formatInZone,
  instantToMoscowWall,
  moscowWallToInstant,
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

describe('AI-113: buildScheduleTimezoneHint — подпись московская, пересчёт в пояс пользователя', () => {
  const summerNoon = new Date('2026-07-16T12:00:00.000Z');

  it('московский пояс: подпись московская, второй строки нет', () => {
    const hint = buildScheduleTimezoneHint(summerNoon, summerNoon, 'Europe/Moscow');
    expect(hint.differs).toBe(false);
    expect(hint.local).toBeNull();
    expect(hint.label).toContain('по Москве');
    expect(hint.label).toContain('МСК');
  });

  it('немосковский пояс: подпись всё равно московская', () => {
    const hint = buildScheduleTimezoneHint(summerNoon, summerNoon, 'America/New_York');
    // Ключевое отличие от SM-28: имя пояса пользователя в подписи НЕ звучит,
    // потому что применяется не он.
    expect(hint.label).toContain('по Москве');
    expect(hint.label).not.toContain('America/New_York');
  });

  it('немосковский пояс: пересчёт в пояс пользователя присутствует и верен', () => {
    // 15:00 МСК летом = 12:00 UTC = 08:00 по Нью-Йорку.
    const hint = buildScheduleTimezoneHint(summerNoon, summerNoon, 'America/New_York');
    expect(hint.differs).toBe(true);
    expect(hint.local).not.toBeNull();
    expect(hint.local).toContain('08:00');
  });
});

describe('AI-113: московское «настенное» время ↔ абсолютный момент', () => {
  it('10:00 по Москве летом — это 07:00 UTC', () => {
    expect(moscowWallToInstant(2026, 7, 16, 10, 0).toISOString()).toBe('2026-07-16T07:00:00.000Z');
  });

  it('10:00 по Москве зимой — тоже 07:00 UTC (в России нет перевода часов)', () => {
    expect(moscowWallToInstant(2026, 1, 16, 10, 0).toISOString()).toBe('2026-01-16T07:00:00.000Z');
  });

  it('полночь по Москве не съезжает на соседний день', () => {
    expect(moscowWallToInstant(2026, 7, 16, 0, 0).toISOString()).toBe('2026-07-15T21:00:00.000Z');
  });

  it('обратный пересчёт возвращает те же настенные части', () => {
    const instant = moscowWallToInstant(2026, 7, 16, 10, 30);
    const wall = instantToMoscowWall(instant);
    expect(wall.getFullYear()).toBe(2026);
    expect(wall.getMonth() + 1).toBe(7);
    expect(wall.getDate()).toBe(16);
    expect(wall.getHours()).toBe(10);
    expect(wall.getMinutes()).toBe(30);
  });

  it('результат не зависит от пояса машины: сверка с явным форматированием', () => {
    // Если бы трактовка утекла в ambient TZ, эта пара разошлась бы под
    // TZ=America/New_York — ровно тот дефект, который чинит AI-113.
    const instant = moscowWallToInstant(2026, 7, 16, 10, 0);
    expect(formatInZone(instant, 'Europe/Moscow')).toContain('10:00');
  });
});

describe('AI-113: оба пути планирования дают один момент', () => {
  it('«16.07.2026 10:00» из календаря совпадает с тем, что понимает AI-команда', () => {
    // AI-команда (server/utils/ru-datetime) трактует названное время как
    // московское. Здесь зафиксирован ОБЩИЙ ожидаемый момент — тот же самый
    // литерал стоит в серверном тесте ru-datetime, и разъехаться молча они
    // уже не могут.
    const SHARED = '2026-07-16T07:00:00.000Z';
    expect(moscowWallToInstant(2026, 7, 16, 10, 0).toISOString()).toBe(SHARED);
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

describe('AI-113: подпись называет московский пояс, а не пояс машины (ambient)', () => {
  it('подпись московская и не зависит от пояса машины', () => {
    // Ambient: раньше здесь проверялась только ФОРМА строки, потому что имя
    // пояса зависело от машины. Теперь применяется фиксированная Москва —
    // значит подпись обязана быть одинаковой в любом поясе, и это проверяется
    // точным равенством.
    const label = scheduleTimezoneLabel(new Date('2026-07-16T12:00:00Z'));
    expect(label).toMatch(/^время указывается по Москве \(МСК, UTC\+3\)$/);
  });
});

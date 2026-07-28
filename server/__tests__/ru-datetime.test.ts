/**
 * parseRussianSchedule — разбор «завтра в 10:00» и подобного в момент публикации.
 * Всё, что говорит пользователь, трактуется как МСК (UTC+3); результат — UTC.
 *
 * До этого ассистент время из фразы вообще игнорировал и раскидывал посты
 * по захардкоженным слотам 9/12/18/21 МСК.
 */
import { describe, it, expect } from 'vitest';
import { parseRussianSchedule, formatMskLabel } from '../utils/ru-datetime';

/** 27 июля 2026, 12:00 UTC = 15:00 МСК. Понедельник. */
const NOW = new Date('2026-07-27T12:00:00.000Z');

describe('parseRussianSchedule — дата и время', () => {
  it('«завтра в 10:00» → 28 июля 07:00 UTC (10:00 МСК)', () => {
    const parsed = parseRussianSchedule('запланируй пост о новинке на завтра в 10:00', NOW);
    expect(parsed?.iso).toBe('2026-07-28T07:00:00.000Z');
    expect(parsed?.hasExplicitTime).toBe(true);
    expect(parsed?.hasExplicitDate).toBe(true);
  });

  it('«сегодня в 18:30» ещё не наступило → сегодня', () => {
    const parsed = parseRussianSchedule('опубликуй сегодня в 18:30', NOW);
    expect(parsed?.iso).toBe('2026-07-27T15:30:00.000Z');
  });

  it('«послезавтра» без времени → 10:00 МСК по умолчанию', () => {
    const parsed = parseRussianSchedule('запланируй послезавтра', NOW);
    expect(parsed?.iso).toBe('2026-07-29T07:00:00.000Z');
    expect(parsed?.hasExplicitTime).toBe(false);
    expect(parsed?.hasExplicitDate).toBe(true);
  });

  it('«5 августа в 9:30» → конкретная дата', () => {
    const parsed = parseRussianSchedule('запланируй на 5 августа в 9:30', NOW);
    expect(parsed?.iso).toBe('2026-08-05T06:30:00.000Z');
  });

  it('«05.08.2026 в 12:00» — числовая дата', () => {
    const parsed = parseRussianSchedule('поставь на 05.08.2026 в 12:00', NOW);
    expect(parsed?.iso).toBe('2026-08-05T09:00:00.000Z');
  });
});

describe('parseRussianSchedule — только время', () => {
  it('время, которое сегодня уже прошло, переносится на завтра', () => {
    // 09:00 МСК уже прошло — сейчас 15:00 МСК
    const parsed = parseRussianSchedule('в 9:00', NOW);
    expect(parsed?.iso).toBe('2026-07-28T06:00:00.000Z');
  });

  it('время, которое сегодня ещё будет, остаётся на сегодня', () => {
    const parsed = parseRussianSchedule('в 21:00', NOW);
    expect(parsed?.iso).toBe('2026-07-27T18:00:00.000Z');
  });

  it('«вечером» → 19:00 МСК, точным временем не считается', () => {
    const parsed = parseRussianSchedule('запланируй вечером', NOW);
    expect(parsed?.iso).toBe('2026-07-27T16:00:00.000Z');
    expect(parsed?.hasExplicitTime).toBe(true);
    expect(parsed?.hasExplicitDate).toBe(false);
  });

  it('«завтра утром» → 09:00 МСК', () => {
    const parsed = parseRussianSchedule('завтра утром', NOW);
    expect(parsed?.iso).toBe('2026-07-28T06:00:00.000Z');
  });

  it('«в 7 вечера» → 19:00 МСК', () => {
    const parsed = parseRussianSchedule('запланируй в 7 вечера', NOW);
    expect(parsed?.iso).toBe('2026-07-27T16:00:00.000Z');
  });
});

describe('parseRussianSchedule — стык суток и МСК', () => {
  it('«завтра в 01:00» на исходе московских суток не уезжает на день назад', () => {
    // 22:30 UTC = 01:30 МСК уже СЛЕДУЮЩЕГО дня (28 июля по МСК)
    const lateNight = new Date('2026-07-27T22:30:00.000Z');
    const parsed = parseRussianSchedule('завтра в 01:00', lateNight);
    // «завтра» по МСК — это 29 июля, 01:00 МСК = 28 июля 22:00 UTC
    expect(parsed?.iso).toBe('2026-07-28T22:00:00.000Z');
  });

  it('«сегодня» поздним вечером по UTC — это уже московское завтра', () => {
    const lateNight = new Date('2026-07-27T22:30:00.000Z'); // 28 июля 01:30 МСК
    const parsed = parseRussianSchedule('сегодня в 10:00', lateNight);
    expect(parsed?.iso).toBe('2026-07-28T07:00:00.000Z');
  });
});

describe('parseRussianSchedule — относительное и дни недели', () => {
  it('«через 2 часа»', () => {
    const parsed = parseRussianSchedule('опубликуй через 2 часа', NOW);
    expect(parsed?.iso).toBe('2026-07-27T14:00:00.000Z');
  });

  it('«через 30 минут»', () => {
    const parsed = parseRussianSchedule('через 30 минут', NOW);
    expect(parsed?.iso).toBe('2026-07-27T12:30:00.000Z');
  });

  it('«в пятницу в 12:00» — ближайшая пятница', () => {
    // NOW — понедельник 27 июля, пятница = 31 июля
    const parsed = parseRussianSchedule('запланируй в пятницу в 12:00', NOW);
    expect(parsed?.iso).toBe('2026-07-31T09:00:00.000Z');
  });

  it('день недели, названный в этот же день, означает следующую неделю', () => {
    const parsed = parseRussianSchedule('в понедельник в 12:00', NOW);
    expect(parsed?.iso).toBe('2026-08-03T09:00:00.000Z');
  });
});

describe('parseRussianSchedule — когда времени нет', () => {
  it('фраза без даты и времени → null, вызывающий откатывается на автослоты', () => {
    expect(parseRussianSchedule('запланируй эти посты в инстаграм', NOW)).toBeNull();
    expect(parseRussianSchedule('', NOW)).toBeNull();
    expect(parseRussianSchedule('опубликуй всё', NOW)).toBeNull();
  });

  it('дата в прошлом → null, а не публикация задним числом', () => {
    expect(parseRussianSchedule('запланируй на 5 января 2020', NOW)).toBeNull();
  });

  it('мусорные значения не роняют разбор', () => {
    expect(parseRussianSchedule(null as any, NOW)).toBeNull();
    expect(parseRussianSchedule(undefined as any, NOW)).toBeNull();
    expect(parseRussianSchedule('в 99:99', NOW)).toBeNull();
  });
});

describe('formatMskLabel', () => {
  it('показывает московское время, а не серверное UTC', () => {
    expect(formatMskLabel('2026-07-28T07:00:00.000Z')).toContain('10:00');
  });
});

/**
 * Календарная валидация (регрессия ревью 2026-07-28).
 *
 * `31.02.2027 в 12:00` нормализовалось в 03.03.2027: проверялось только `day <= 31`,
 * а Date.UTC молча переносит несуществующую дату в соседний месяц. Публикация уезжала
 * на другой день, и пользователь об этом не узнавал.
 */
describe('parseRussianSchedule — несуществующие даты', () => {
  const now = new Date('2026-07-28T09:00:00Z');

  it.each([
    '31.02.2027 в 12:00',
    '30.02.2027 в 12:00',
    '31.04.2027 в 12:00',
    '31.06.2027 в 12:00',
    '31.09.2027 в 12:00',
    '31.11.2027 в 12:00',
  ])('%s не разбирается (возвращает null, а не другую дату)', (input) => {
    expect(parseRussianSchedule(input, now)).toBeNull();
  });

  it('31 февраля словами тоже отклоняется', () => {
    expect(parseRussianSchedule('31 февраля 2027 в 12:00', now)).toBeNull();
  });

  it('31 апреля словами отклоняется', () => {
    expect(parseRussianSchedule('31 апреля 2027 в 10:00', now)).toBeNull();
  });

  it('29 февраля високосного года разбирается', () => {
    const result = parseRussianSchedule('29.02.2028 в 12:00', now);
    expect(result).not.toBeNull();
    expect(result!.iso).toBe('2028-02-29T09:00:00.000Z'); // 12:00 МСК
  });

  it('29 февраля невисокосного года отклоняется', () => {
    expect(parseRussianSchedule('29.02.2027 в 12:00', now)).toBeNull();
  });

  it('29 февраля словами: високосный — да, невисокосный — нет', () => {
    expect(parseRussianSchedule('29 февраля 2028 в 12:00', now)).not.toBeNull();
    expect(parseRussianSchedule('29 февраля 2027 в 12:00', now)).toBeNull();
  });

  it('1900 не високосный (правило столетий), 2000 високосный', () => {
    expect(parseRussianSchedule('29.02.2100 в 12:00', now)).toBeNull();
    expect(parseRussianSchedule('29.02.2400 в 12:00', now)).not.toBeNull();
  });

  it('последние дни месяцев остаются валидными', () => {
    expect(parseRussianSchedule('31.12.2027 в 12:00', now)).not.toBeNull();
    expect(parseRussianSchedule('30.04.2027 в 12:00', now)).not.toBeNull();
    expect(parseRussianSchedule('28.02.2027 в 12:00', now)).not.toBeNull();
  });
});

/**
 * SM-9: раскладка публикаций по дням идёт по МОСКОВСКИМ суткам.
 *
 * Это вторая половина тикета, не закрытая d5e370817. Тот коммит перевёл на
 * Москву вывод времени, а календарь и дашборд продолжали сравнивать даты через
 * startOfDay/isSameDay/isToday — то есть по локальной полуночи ЗРИТЕЛЯ.
 *
 * Воспроизведение: публикация на 01:00 МСК 29 июля хранится как 22:00Z 28-го.
 * У браузера в UTC карточка показывала правильные 01:00 МСК, но календарь
 * относил запись к 28-му, а дашборд не считал её сегодняшней. Один сдвиг, два
 * симптома — и починен был только один.
 *
 * Тесты гоняются с TZ=UTC, то есть ровно в тех условиях, где баг и ловится:
 * на прежнем коде (локальные сутки) они краснеют.
 */

import { describe, it, expect } from 'vitest';
import {
  displayDayKeysOf,
  hasAnyDisplayDay,
  matchesDisplayDay,
  platformsOnDisplayDay,
  toWallDateKey,
} from '../publication-day';

/** 01:00 МСК 29 июля = 22:00Z 28 июля. Ровно случай из тикета. */
const ONE_AM_MSK_29 = '2026-07-28T22:00:00.000Z';
/** 23:00 МСК 29 июля = 20:00Z 29 июля. Другой конец тех же суток. */
const LATE_EVENING_MSK_29 = '2026-07-29T20:00:00.000Z';

/** Клетка календаря «29 июля» так, как её отдаёт виджет: локальная полночь. */
const CELL_29 = toWallDateKey(new Date(2026, 6, 29));
const CELL_28 = toWallDateKey(new Date(2026, 6, 28));

describe('раскладка по дням', () => {
  it('ночная публикация относится к 29-му, хотя её UTC-дата — 28-е', () => {
    // Условие, при котором баг и возникал: локальная дата момента ≠ московская.
    expect(new Date(ONE_AM_MSK_29).getUTCDate()).toBe(28);

    expect(displayDayKeysOf({ scheduledAt: ONE_AM_MSK_29 })).toEqual(['2026-07-29']);
  });

  it('публикация из ночи 29-го видна в календарной клетке 29-го', () => {
    expect(matchesDisplayDay({ scheduledAt: ONE_AM_MSK_29 }, CELL_29)).toBe(true);
  });

  it('и НЕ видна в клетке 28-го', () => {
    expect(matchesDisplayDay({ scheduledAt: ONE_AM_MSK_29 }, CELL_28)).toBe(false);
  });

  it('оба конца московских суток попадают в один день', () => {
    expect(matchesDisplayDay({ scheduledAt: ONE_AM_MSK_29 }, CELL_29)).toBe(true);
    expect(matchesDisplayDay({ publishedAt: LATE_EVENING_MSK_29 }, CELL_29)).toBe(true);
  });

  it('граница 23:59 МСК остаётся в уходящих сутках', () => {
    // 23:59 МСК 29-го = 20:59Z 29-го.
    expect(matchesDisplayDay({ scheduledAt: '2026-07-29T20:59:00.000Z' }, CELL_29)).toBe(true);
  });

  it('граница 00:01 МСК уже в следующих сутках', () => {
    // 00:01 МСК 30-го = 21:01Z 29-го. Календарная дата UTC — всё ещё 29-е.
    expect(matchesDisplayDay({ scheduledAt: '2026-07-29T21:01:00.000Z' }, CELL_29)).toBe(false);
    expect(matchesDisplayDay({ scheduledAt: '2026-07-29T21:01:00.000Z' }, toWallDateKey(new Date(2026, 6, 30)))).toBe(true);
  });

  it('строки Directus без пояса считаются UTC, а не местным временем', () => {
    // Directus отдаёт часть timestamp'ов без Z. Без единой трактовки к сдвигу
    // пояса добавлялся бы ещё один.
    expect(displayDayKeysOf({ scheduledAt: '2026-07-28T22:00:00' })).toEqual(['2026-07-29']);
  });

  it('платформенные даты тоже участвуют в раскладке', () => {
    const post = {
      socialPlatforms: {
        telegram: { publishedAt: ONE_AM_MSK_29 },
        vk: { scheduledAt: '2026-07-30T09:00:00.000Z' },
      },
    };

    expect(matchesDisplayDay(post, CELL_29)).toBe(true);
    expect(displayDayKeysOf(post)).toEqual(['2026-07-29', '2026-07-30']);
  });

  it('подсвечиваются только те платформы, что публиковали в этот день', () => {
    const post = {
      socialPlatforms: {
        telegram: { publishedAt: ONE_AM_MSK_29 },
        vk: { scheduledAt: '2026-07-30T09:00:00.000Z' },
      },
    };

    expect(platformsOnDisplayDay(post, CELL_29)).toEqual(['telegram']);
  });

  it('запись без дат не относится ни к какому дню', () => {
    expect(hasAnyDisplayDay({})).toBe(false);
    expect(matchesDisplayDay({}, CELL_29)).toBe(false);
  });

  it('запись с датой считается имеющей день', () => {
    expect(hasAnyDisplayDay({ scheduledAt: ONE_AM_MSK_29 })).toBe(true);
  });
});

describe('выбранный день — стенная дата', () => {
  it('клетка 29 июля даёт ключ 2026-07-29 независимо от пояса машины', () => {
    // Виджет собирает Date из ЛОКАЛЬНОЙ полуночи. Прогонять её через пересчёт
    // поясов нельзя: у зрителя западнее Москвы выбор уехал бы на сутки.
    expect(toWallDateKey(new Date(2026, 6, 29, 0, 0, 0))).toBe('2026-07-29');
    // Полдень той же клетки — тот же день: время внутри клетки роли не играет.
    expect(toWallDateKey(new Date(2026, 6, 29, 12, 0, 0))).toBe('2026-07-29');
  });

  it('невалидная дата ключа не даёт', () => {
    expect(toWallDateKey(new Date('чепуха'))).toBeNull();
    expect(toWallDateKey(null)).toBeNull();
  });
});

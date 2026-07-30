/**
 * Перенос публикации мышью сохраняет МОСКОВСКОЕ время (AI-48 п.7).
 *
 * Последний остаток SM-9. Раскладку по дням и форматирование уже перевели на
 * `Europe/Moscow`, но два места продолжали читать локальные компоненты Date:
 *
 *  - `PublicationCalendar` при drag-and-drop доставал час и минуту через
 *    `getHours()/getMinutes()` и передавал их как «сохранить это же время».
 *    У зрителя западнее Москвы пост, стоявший на 15:00 МСК, после обычного
 *    перетаскивания на другой день оказывался на 12:00 МСК — время менялось
 *    молча, при действии, которое вообще не про время;
 *  - «Лучшее время публикации» на странице публикаций считало часы по
 *    локальному поясу зрителя, то есть у разных людей показывало разные
 *    «оптимальные» часы по одним и тем же данным.
 *
 * Тесты гоняются при `TZ=UTC` (расхождение с Москвой 3 часа) и отдельно
 * проверяют не-UTC пояс — как требует чек-лист ревью.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { startOfMonth } from 'date-fns';
import {
  displayToday,
  displayTodayKey,
  formatTimeWithTimezone,
  toWallDateKey,
} from '../date-utils';

/** 15:00 МСК 29 июля = 12:00Z. */
const THREE_PM_MSK = '2026-07-29T12:00:00.000Z';
/** 01:00 МСК 29 июля = 22:00Z 28-го — момент, переходящий через полночь. */
const ONE_AM_MSK = '2026-07-28T22:00:00.000Z';

const CALENDAR = readFileSync(
  resolve(__dirname, '../../components/PublicationCalendar.tsx'),
  'utf-8',
);
const POSTS_PAGE = readFileSync(
  resolve(__dirname, '../../pages/posts/index.tsx'),
  'utf-8',
);

describe('время переноса берётся по Москве', () => {
  it('TZ=UTC: 15:00 МСК остаётся 15:00, а не превращается в 12:00', () => {
    expect(process.env.TZ ?? 'UTC').toMatch(/^UTC$|^$/);
    expect(formatTimeWithTimezone(THREE_PM_MSK)).toBe('15:00');
  });

  it('момент за полночь по Москве не уезжает в предыдущий день', () => {
    expect(formatTimeWithTimezone(ONE_AM_MSK)).toBe('01:00');
  });

  it('в не-UTC поясе результат тот же', () => {
    const original = process.env.TZ;
    try {
      // Нью-Йорк: −4 от UTC, −7 от Москвы. Локальное чтение дало бы 08:00.
      process.env.TZ = 'America/New_York';
      expect(formatTimeWithTimezone(THREE_PM_MSK)).toBe('15:00');
      // Токио: +9, восточнее Москвы — ошибка в другую сторону (21:00).
      process.env.TZ = 'Asia/Tokyo';
      expect(formatTimeWithTimezone(THREE_PM_MSK)).toBe('15:00');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe('«сегодня» и стартовый месяц — московские', () => {
  const withTZ = (tz: string, fn: () => void) => {
    const original = process.env.TZ;
    try {
      process.env.TZ = tz;
      fn();
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  };

  afterEach(() => vi.useRealTimers());

  it('за полчаса ДО московской полуночи день ещё вчерашний во всех поясах', () => {
    // 23:30 МСК 29 июля = 20:30Z. В Токио уже 30-е, в Нью-Йорке ещё 29-е.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T20:30:00.000Z'));

    for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
      withTZ(tz, () => {
        expect(displayTodayKey(), tz).toBe('2026-07-29');
        expect(toWallDateKey(displayToday()), tz).toBe('2026-07-29');
      });
    }
  });

  it('через полчаса ПОСЛЕ московской полуночи день уже новый во всех поясах', () => {
    // 00:30 МСК 30 июля = 21:30Z 29-го. В UTC и Нью-Йорке ещё 29-е.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T21:30:00.000Z'));

    for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
      withTZ(tz, () => {
        expect(displayTodayKey(), tz).toBe('2026-07-30');
        expect(toWallDateKey(displayToday()), tz).toBe('2026-07-30');
      });
    }
  });

  it('стартовый месяц берётся от московского дня, а не от браузерного', () => {
    // 00:30 МСК 1 августа = 21:30Z 31 июля: в UTC ещё июль, в Москве уже август.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T21:30:00.000Z'));

    withTZ('UTC', () => {
      expect(toWallDateKey(startOfMonth(displayToday()))).toBe('2026-08-01');
      // Контроль: браузерное «сегодня» дало бы июль — ошибка, которую чиним.
      expect(toWallDateKey(startOfMonth(new Date()))).toBe('2026-07-01');
    });
  });

  it('обе страницы инициализируют дату московским хелпером', () => {
    expect(CALENDAR).toContain('displayToday()');
    expect(POSTS_PAGE).toContain('displayToday()');
    // Голый new Date() в useState-инициализаторах не остался.
    expect(CALENDAR).not.toMatch(/useState<Date>\(new Date\(\)\)/);
    expect(POSTS_PAGE).not.toMatch(/useState<Date>\(new Date\(\)\)/);
    expect(POSTS_PAGE).not.toMatch(/startOfMonth\(new Date\(\)\)/);
  });
});

describe('локальные компоненты Date не используются для времени', () => {
  it('календарь не читает getHours/getMinutes', () => {
    const offenders = CALENDAR.split('\n').filter((l) => /getHours\(\)|getMinutes\(\)/.test(l));
    expect(offenders, 'время публикации обязано читаться по Москве').toEqual([]);
  });

  it('страница публикаций не читает getHours', () => {
    const offenders = POSTS_PAGE.split('\n').filter((l) => /getHours\(\)|getMinutes\(\)/.test(l));
    expect(offenders, 'статистика часов обязана считаться по Москве').toEqual([]);
  });

  it('обе страницы зовут московский форматтер', () => {
    expect(CALENDAR).toContain('formatTimeWithTimezone');
    expect(POSTS_PAGE).toContain('formatTimeWithTimezone');
  });
});

/**
 * AI-115: момент публикации не должен зависеть от пояса процесса.
 *
 * Колонки scheduled_at/published_at объявлены без часового пояса, Directus отдаёт
 * их голой строкой, и до этой правки такая строка скармливалась в new Date() —
 * то есть читалась в поясе процесса. Совпадало с истиной только потому, что у
 * контейнера приложения TZ пустой. Проверки ниже падают, если это вернётся.
 *
 * Пояс процесса меняется прямо в тесте: Node >= 16 перечитывает process.env.TZ.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  STORED_TIME_ZONE,
  ensureIsoWithTimezone,
  parseStoredInstant,
  isSameStoredInstant,
  getContentAggregateTimes,
  getCanonicalScheduledAt,
} from '../schedule-time';

const ZONES = ['UTC', 'Europe/Moscow', 'America/New_York', 'Asia/Yekaterinburg'];

// Голая метка из базы и тот же момент в явном виде.
const STORED_NAIVE = '2026-08-16 09:00:00';
const STORED_NAIVE_T = '2026-08-16T09:00:00';
const SAME_INSTANT_ISO = '2026-08-16T09:00:00.000Z';

describe('AI-115: хранимое время читается одинаково в любом поясе процесса', () => {
  const originalTz = process.env.TZ;
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('договорённость о поясе хранения записана в коде, а не подразумевается', () => {
    expect(STORED_TIME_ZONE).toBe('UTC');
  });

  describe.each(ZONES)('пояс процесса %s', (zone) => {
    beforeAll(() => {
      process.env.TZ = zone;
    });

    it('голая метка из базы читается как UTC, а не как местное время', () => {
      expect(parseStoredInstant(STORED_NAIVE)?.toISOString()).toBe(SAME_INSTANT_ISO);
      expect(parseStoredInstant(STORED_NAIVE_T)?.toISOString()).toBe(SAME_INSTANT_ISO);
    });

    it('метка с явным поясом не трогается', () => {
      expect(parseStoredInstant(SAME_INSTANT_ISO)?.toISOString()).toBe(SAME_INSTANT_ISO);
      expect(parseStoredInstant('2026-08-16T12:00:00+03:00')?.toISOString()).toBe(SAME_INSTANT_ISO);
    });

    it('голая метка и её ISO-представление — один и тот же момент', () => {
      expect(isSameStoredInstant(STORED_NAIVE, SAME_INSTANT_ISO)).toBe(true);
      expect(isSameStoredInstant(SAME_INSTANT_ISO, STORED_NAIVE)).toBe(true);
      expect(isSameStoredInstant(STORED_NAIVE, '2026-08-16T10:00:00.000Z')).toBe(false);
    });

    it('круг запись-чтение сходится: что записали, то и прочитали', () => {
      const written = parseStoredInstant(STORED_NAIVE)!.toISOString();
      const storedBack = written.replace('T', ' ').replace('.000Z', '');
      expect(parseStoredInstant(storedBack)!.getTime()).toBe(parseStoredInstant(STORED_NAIVE)!.getTime());
    });

    it('агрегаты контента дают один и тот же момент', () => {
      const platforms = {
        telegram: { status: 'scheduled', scheduledAt: STORED_NAIVE },
        vk: { status: 'scheduled', scheduled_at: '2026-08-16 11:00:00' },
      };
      expect(getCanonicalScheduledAt(platforms)).toBe(SAME_INSTANT_ISO);
      expect(getContentAggregateTimes(platforms, 'scheduled', { scheduledAt: STORED_NAIVE }).scheduledAt)
        .toBe(SAME_INSTANT_ISO);
    });

    it('пустое и дата без времени не ломаются', () => {
      expect(parseStoredInstant(null)).toBeNull();
      expect(parseStoredInstant(undefined)).toBeNull();
      expect(parseStoredInstant('')).toBeNull();
      expect(ensureIsoWithTimezone('2026-08-16')).toBe('2026-08-16');
      expect(parseStoredInstant('2026-08-16')?.toISOString()).toBe('2026-08-16T00:00:00.000Z');
      expect(parseStoredInstant('не дата')).toBeNull();
    });
  });
});

describe('AI-115: результат совпадает между поясами, а не только сам с собой', () => {
  const originalTz = process.env.TZ;
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('один и тот же вход даёт один и тот же момент во всех поясах', () => {
    const results = ZONES.map((zone) => {
      process.env.TZ = zone;
      return parseStoredInstant(STORED_NAIVE)!.getTime();
    });
    expect(new Set(results).size).toBe(1);
  });

  it('агрегат платформ одинаков во всех поясах', () => {
    const platforms = { telegram: { status: 'scheduled', scheduledAt: STORED_NAIVE } };
    const results = ZONES.map((zone) => {
      process.env.TZ = zone;
      return getCanonicalScheduledAt(platforms);
    });
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe(SAME_INSTANT_ISO);
  });
});

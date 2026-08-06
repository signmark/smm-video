/**
 * Разбор серверных timestamp'ов (AI-73).
 *
 * Directus хранит время в `timestamp without time zone`, поэтому часть значений
 * приходит без 'Z': '2026-08-05T09:33:37'. Голый `new Date()` считает такую
 * строку местным временем браузера — в Москве это момент на 3 часа раньше
 * настоящего. Один и тот же дефект тестировщики заводили трижды: SM-9, SM-14,
 * SM-16, каждый раз на новом экране.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { serverDate, serverDateOrNull } from '../date-utils';

describe('AI-73: serverDate', () => {
  it('строку без пояса читает как UTC, а не как местное время', () => {
    // Ровно тот формат, что приходит из Directus.
    expect(serverDate('2026-08-05T09:33:37').toISOString()).toBe('2026-08-05T09:33:37.000Z');
  });

  it('не сдвигает значение, у которого пояс указан', () => {
    expect(serverDate('2026-08-05T09:33:37Z').toISOString()).toBe('2026-08-05T09:33:37.000Z');
    expect(serverDate('2026-08-05T12:33:37+03:00').toISOString()).toBe('2026-08-05T09:33:37.000Z');
  });

  it('расходится с голым new Date() ровно на смещение пояса', () => {
    const naive = '2026-08-05T09:33:37';
    const diff = serverDate(naive).getTime() - new Date(naive).getTime();

    // Знак важен и легко ошибиться. getTimezoneOffset() отдаёт «UTC минус
    // местное», то есть для Москвы -180. serverDate читает строку как UTC, а
    // голый new Date() — как местное время, поэтому serverDate оказывается
    // ПОЗЖЕ на величину смещения: +3 часа, а не -3.
    //
    // 0 - x вместо -x: при нулевом смещении (UTC) унарный минус даёт -0,
    // а toBe сравнивает через Object.is, для которого 0 !== -0.
    expect(diff).toBe(0 - new Date(naive).getTimezoneOffset() * 60_000);
  });

  it('в московском поясе разрыв составляет ровно три часа', () => {
    // Предыдущая проверка в UTC вырождается в 0 === 0 и потому ничего не
    // стережёт: именно так ошибка в знаке и доехала до main, пройдя прогон на
    // UTC-хосте. Здесь пояс задан явно, поэтому проверка осмысленна везде.
    const naive = '2026-08-05T09:33:37';
    const asUtc = serverDate(naive).getTime();
    const asMoscow = new Date('2026-08-05T09:33:37+03:00').getTime();

    expect(asUtc - asMoscow).toBe(3 * 60 * 60 * 1000);
  });

  it('Date возвращает как есть', () => {
    const d = new Date('2026-08-05T09:33:37Z');
    expect(serverDate(d)).toBe(d);
  });
});

describe('AI-73: serverDateOrNull', () => {
  it('пустые значения дают null, а не Invalid Date', () => {
    expect(serverDateOrNull(null)).toBeNull();
    expect(serverDateOrNull(undefined)).toBeNull();
    expect(serverDateOrNull('')).toBeNull();
  });

  it('мусор даёт null вместо NaN-даты', () => {
    expect(serverDateOrNull('не дата')).toBeNull();
  });

  it('нормальное значение разбирает как UTC', () => {
    expect(serverDateOrNull('2026-08-05T09:33:37')?.toISOString()).toBe('2026-08-05T09:33:37.000Z');
  });
});

describe('AI-73: класс ошибки не возвращается', () => {
  it('в client/src нет голого new Date() над серверным полем', () => {
    // Точечные правки живут ровно до следующего разработчика, который напишет
    // new Date(post.publishedAt) заново. Поэтому стережём шаблон, а не список.
    const root = join(__dirname, '..', '..');
    const offenders: string[] = [];
    const pattern =
      /new Date\((?:post|content|item|trend|topic|campaign|channel|comment|platform|user|message|style|source)[A-Za-z]*\.[a-zA-Z_]*(?:At|_at|Date|date)\b/;

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__') continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (/\.test\.tsx?$/.test(entry.name)) continue;
        // date-utils сам объясняет ошибку в комментарии — это не вызов.
        if (entry.name === 'date-utils.ts') continue;

        readFileSync(full, 'utf-8')
          .split('\n')
          .forEach((line, i) => {
            if (pattern.test(line)) offenders.push(`${full.replace(root, '')}:${i + 1}: ${line.trim()}`);
          });
      }
    };
    walk(root);

    expect(offenders).toEqual([]);
  });
});

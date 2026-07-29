/**
 * SM-9, остаток: страница «Публикации» (`client/src/pages/posts/index.tsx`).
 *
 * `701526e04` перевёл на московские сутки календарь и дашборд, но эта страница
 * осталась на локальных границах дня (находка ревью Codex 29.07.2026, P2):
 *
 *  - один `dayKey = format(date, 'yyyy-MM-dd')` применялся И к МОМЕНТАМ
 *    (timestamp публикации), И к КЛЕТКАМ календаря. Это разные сущности:
 *    момент надо перевести в московские сутки, клетку — не трогать вовсе;
 *  - выбор ближайшей даты с постами шёл через `isSameDay`/`startOfDay`, то есть
 *    по локальной полуночи зрителя;
 *  - `new Date(dateString)` обходил нормализацию строк Directus без `Z`.
 *
 * Граничный пример из тикета: `2026-07-28T22:00:00Z` — это 29 июля 01:00 МСК.
 * Тесты гоняются при TZ=UTC, то есть ровно там, где расхождение и проявляется.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { normalizeTimestamp, toDisplayDateKey, toWallDateKey } from '../date-utils';

/** 01:00 МСК 29 июля = 22:00Z 28 июля. */
const ONE_AM_MSK_29 = '2026-07-28T22:00:00.000Z';

const PAGE = readFileSync(
  resolve(__dirname, '../../pages/posts/index.tsx'),
  'utf-8',
);

describe('нормализация timestamp без часового пояса', () => {
  it('строка Directus без Z читается как UTC, а не как местное время', () => {
    // Directus отдаёт часть значений в таком виде. Голый new Date() в браузере
    // с TZ=UTC совпал бы случайно, поэтому проверяем именно момент.
    expect(normalizeTimestamp('2026-07-28T22:00:00').toISOString())
      .toBe('2026-07-28T22:00:00.000Z');
  });

  it('строка с Z и объект Date не искажаются', () => {
    expect(normalizeTimestamp(ONE_AM_MSK_29).toISOString()).toBe(ONE_AM_MSK_29);
    const d = new Date(ONE_AM_MSK_29);
    expect(normalizeTimestamp(d)).toBe(d);
  });

  it('ночная публикация 29-го попадает в московские сутки 29-го', () => {
    // UTC-дата у неё 28-е — именно на этом расхождении баг и держался.
    expect(new Date(ONE_AM_MSK_29).getUTCDate()).toBe(28);
    expect(toDisplayDateKey(normalizeTimestamp('2026-07-28T22:00:00'))).toBe('2026-07-29');
  });

  it('клетка календаря остаётся тем днём, в который ткнул пользователь', () => {
    // Клетку через пояса не пересчитывают: это «стена», а не момент.
    expect(toWallDateKey(new Date(2026, 6, 29))).toBe('2026-07-29');
  });

  it('момент и клетка сходятся на одном дне — то, чего не делал isSameDay', () => {
    expect(toDisplayDateKey(ONE_AM_MSK_29)).toBe(toWallDateKey(new Date(2026, 6, 29)));
  });
});

/**
 * Раскладка по дням живёт внутри React-компонента, поэтому инвариант
 * стережётся по исходнику — так же, как `topbar-encoding` и
 * `social-facade-imports`. Дешевле, чем рендерить страницу, и ловит именно
 * возврат к локальным суткам.
 */
describe('страница публикаций не считает дни по локальному поясу', () => {
  it('не импортирует isSameDay/startOfDay из date-fns', () => {
    const dateFnsImport = PAGE.match(/import \{([^}]*)\} from 'date-fns'/);
    expect(dateFnsImport).toBeTruthy();
    expect(dateFnsImport![1]).not.toMatch(/\bisSameDay\b/);
    expect(dateFnsImport![1]).not.toMatch(/\bstartOfDay\b/);
  });

  it('использует общие helpers московских суток', () => {
    expect(PAGE).toMatch(/toDisplayDateKey/);
    expect(PAGE).toMatch(/toWallDateKey/);
    expect(PAGE).toMatch(/normalizeTimestamp/);
  });

  it('не собирает ключ дня локальным format(..., yyyy-MM-dd) как единственный путь', () => {
    // Разрешён только фолбэк внутри momentDayKey/cellDayKey; отдельного
    // `const dayKey = (date) => format(date, 'yyyy-MM-dd')` быть не должно.
    expect(PAGE).not.toMatch(/const dayKey\s*=\s*\(date: Date\)\s*=>\s*format\(/);
  });

  it('момент и клетка разведены разными функциями', () => {
    expect(PAGE).toMatch(/const momentDayKey/);
    expect(PAGE).toMatch(/const cellDayKey/);
  });

  it('время публикации не парсится голым new Date(dateString)', () => {
    expect(PAGE).not.toMatch(/typeof dateString === 'string' \? new Date\(dateString\)/);
  });
});

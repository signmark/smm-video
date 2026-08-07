/**
 * Храповик на прямые вызовы console.* в серверном коде (AI-41).
 *
 * Зачем. В server/utils/logger.ts есть редактирование секретов: вырезаются
 * Bearer-схемы, секреты в query, в путях и в key-value. Но console.* идёт МИМО
 * логгера, а значит мимо редактирования. То есть заявленная в AI-41 проблема
 * «логи содержат токены и персональные данные» закрыта только для тех мест,
 * что уже переведены на log(). Остальные 2103 вызова пишут как есть.
 *
 * Почему храповик, а не запрет. Разом переписать 2103 вызова нельзя: это
 * недели работы, а пока она идёт, новые console.* продолжают появляться —
 * ровно так это число и выросло. Тест фиксирует текущее количество и падает,
 * если оно увеличилось. Мигрировать можно по каталогам, любыми порциями, и
 * каждая порция опускает планку.
 *
 * Как понижать планку: уменьшить BASELINE до нового значения из вывода теста.
 * Поднимать BASELINE нельзя — если понадобилось, значит в код добавили console.*
 * вместо log(), и правильный шаг противоположный.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Замерено на c275df6b2 ЭТОЙ ЖЕ функцией подсчёта, а не грепом.
 *
 * Разница принципиальная: `grep -c` считает СТРОКИ с совпадением, а тест
 * считает сами совпадения, и на строке их может быть несколько. Планка,
 * снятая грепом, оказалась на 2 больше факта — то есть храповик пропускал
 * бы пару новых вызовов молча. Проверено: с завышенной планкой добавленный
 * console.log тест не ронял.
 *
 * Число обязано только уменьшаться.
 */
const BASELINE = 2031;

const CONSOLE_CALL = /\bconsole\.(log|error|warn|info|debug)\s*\(/g;

function countConsoleCalls(dir: string): { total: number; byFile: Array<[string, number]> } {
  const byFile: Array<[string, number]> = [];
  let total = 0;

  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        // Тесты не считаем: там console — нормальный инструмент отладки,
        // и секретов в них нет по построению.
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;

      const matches = readFileSync(full, 'utf-8').match(CONSOLE_CALL);
      if (matches?.length) {
        byFile.push([full.slice(full.indexOf('server/')), matches.length]);
        total += matches.length;
      }
    }
  };
  walk(dir);

  byFile.sort((a, b) => b[1] - a[1]);
  return { total, byFile };
}

describe('AI-41: console.* не должен расти', () => {
  it(`в server/ не больше ${BASELINE} прямых вызовов console.*`, () => {
    const { total, byFile } = countConsoleCalls(join(__dirname, '..'));

    if (total > BASELINE) {
      const worst = byFile.slice(0, 5).map(([f, n]) => `  ${f}: ${n}`).join('\n');
      throw new Error(
        `console.* выросло: ${total} против планки ${BASELINE}.\n` +
          `Эти вызовы идут мимо logger.ts и мимо редактирования секретов — ` +
          `используйте log() из server/utils/logger.\n` +
          `Больше всего в:\n${worst}`,
      );
    }

    expect(total).toBeLessThanOrEqual(BASELINE);
  });

  it('планка отражает реальность, а не занижена запасом', () => {
    // Если BASELINE окажется выше факта, храповик перестаёт держать: разницу
    // можно молча «съесть» новыми вызовами. Поэтому запаса не допускаем вовсе —
    // планка обязана равняться факту. Опустили число вызовов, опустите и планку.
    const { total } = countConsoleCalls(join(__dirname, '..'));

    expect(BASELINE).toBe(total);
  });
});

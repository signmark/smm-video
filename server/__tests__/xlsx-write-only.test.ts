/**
 * Гейт: SheetJS используется только на запись (AI-70 / task #40, 09.08.2026).
 *
 * ЗАЧЕМ. В `xlsx` (SheetJS) есть две незакрытые уязвимости, патча от апстрима нет:
 *   - Prototype Pollution — GHSA-4r6h-8v6p-xvw6
 *   - ReDoS              — GHSA-5pgg-2g8v-p4x9
 * Обе срабатывают на РАЗБОРЕ подсунутого файла. Мы файлы только пишем
 * (`server/services/report-generator.ts`: book_new / aoa_to_sheet /
 * book_append_sheet / write), поэтому вектора нет и замена библиотеки не нужна.
 *
 * ЧТО ИМЕННО ОХРАНЯЕТСЯ. Вывод «уязвимость недостижима» верен ровно до тех пор,
 * пока никто не добавил чтение. Стоит появиться `XLSX.read(файл_от_пользователя)`
 * — и обе уязвимости становятся настоящими МОЛЧА: audit будет показывать те же
 * пять находок, что и вчера, а exposure изменится с нулевого на реальный.
 * Автоматически это не заметит никто, поэтому проверка живёт в тестах.
 *
 * ЕСЛИ ЭТОТ ТЕСТ УПАЛ — это не повод его поправить. Появился read-путь, значит
 * нужен отдельный security-review: либо замена библиотеки, либо изоляция разбора
 * (отдельный процесс, лимиты, недоверенный вход), либо обоснование, почему вход
 * доверенный. Ослаблять список запрещённых вызовов нельзя.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SCAN_DIRS = ['server', join('client', 'src')];
const SKIP_DIRS = new Set(['node_modules', '__tests__', 'dist', 'build']);
const EXTS = ['.ts', '.tsx'];

function collect(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (EXTS.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

/** Разбор входного файла — единственное, что активирует уязвимости SheetJS. */
const READ_CALL = /\bXLSX\s*\.\s*(read|readFile)\s*\(|\bsheet_to_json\s*\(/;

describe('AI-70 / task #40: SheetJS только на запись', () => {
  it('в server/ и client/src нет вызовов разбора xlsx', () => {
    const offenders: string[] = [];
    for (const base of SCAN_DIRS) {
      for (const file of collect(join(ROOT, base))) {
        readFileSync(file, 'utf-8')
          .split('\n')
          .forEach((line, i) => {
            if (READ_CALL.test(line)) {
              offenders.push(`${file.replace(ROOT + '/', '')}:${i + 1}: ${line.trim().slice(0, 120)}`);
            }
          });
      }
    }
    expect(
      offenders,
      'Появился разбор xlsx — обоснование «уязвимость недостижима» больше не действует.\n' +
        'Нужен security-review (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9), а не правка теста.\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });
});

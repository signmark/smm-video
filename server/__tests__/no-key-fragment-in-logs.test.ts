/**
 * Гейт против фрагментов ключей в логах (AI-84, 09.08.2026).
 *
 * ЗАЧЕМ ИМЕННО СКАНОМ ИСХОДНИКОВ. Редактор логов (`redactText`) вырезает секрет
 * только там, где рядом стоит «говорящее» имя: `token=`, `api_key:`, `Bearer …`.
 * Строка вида «Проверка API ключа YouTube: ${apiKey.slice(0, 5)}…» под это НЕ
 * попадает — перед двоеточием стоит слово «YouTube», а в `SECRET_WORD` его нет.
 * То есть от такого фрагмента защищает не рантайм, а только отсутствие подобного
 * кода. Значит проверять надо исходник.
 *
 * История: AI-84 закрыл `ai-service.ts`, но такой же `apiKey.slice(0, 5)` остался
 * в `social-api-validator.ts` и печатался в прод. Один и тот же класс дефекта во
 * втором месте — ровно то, что ловится сканом, а не точечным тестом.
 *
 * Прибавление длины (`[redacted len=N]`) допустимо: длина не восстанавливает ключ,
 * но отличает «ключа нет» от «ключ не тот».
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '__tests__', 'dist']);

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Вызов логирования, внутри которого ключ режется на подстроку. */
const LEAK = /(?:\blog|console\.\w+|logger\.\w+)\s*\([^\n]*\b\w*(?:apiKey|api_key|token|secret)\w*\s*\??\.\s*(?:slice|substring|substr)\s*\(/i;

describe('AI-84: фрагменты ключей не попадают в логи', () => {
  it('в server/**/*.ts нет логирования подстроки ключа или токена', () => {
    const offenders: string[] = [];
    for (const file of collect(ROOT)) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        if (LEAK.test(line)) offenders.push(`${file.replace(ROOT, 'server')}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(offenders, `Печать фрагмента ключа в лог:\n${offenders.join('\n')}`).toEqual([]);
  });
});

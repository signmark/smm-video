/**
 * Сторож против затенения маршрутов Express (AI-92).
 *
 * ПОЧЕМУ. Express отдаёт ПЕРВЫЙ совпавший обработчик, остальные с тем же
 * методом и путём недостижимы ни при каком запросе. Это молчаливый класс
 * дефектов: компилятор доволен, сборка проходит, а тестов на мёртвый
 * обработчик нет по определению — его никто не вызывает.
 *
 * Мы поймали его трижды за двое суток:
 *   AI-88 — второй GET /status/:userId в мастере Instagram, читавший БД,
 *           был недостижим, и подключение не переживало рестарт;
 *   AI-92 — второй POST discover-instagram-accounts в одном файле и копия
 *           GET instagram-settings в другом, причём мёртвая копия не
 *           проверяла принадлежность кампании пользователю;
 *   там же — комментарий у монтирования утверждал, что более поздняя
 *           регистрация даёт приоритет. Она даёт недостижимость.
 *
 * ЧТО ПРОВЕРЯЕМ. Два правила, у которых нет законных исключений:
 *   1) в одном файле не бывает двух регистраций с одинаковыми методом и путём;
 *   2) абсолютный путь (начинается с /api/) не регистрируется дважды — такие
 *      пути не зависят от точки монтирования, поэтому совпадение всегда
 *      означает затенение.
 *
 * Относительные пути в разных файлах не сравниваем: они зависят от префикса
 * монтирования, и одинаковый '/start' в двух роутерах — норма.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SERVER = join(__dirname, '..');
const REGISTRATION = /\b(?:router|app)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

type Reg = { method: string; path: string; file: string; line: number };

function registrations(): Reg[] {
  const found: Reg[] = [];
  for (const file of tsFiles(SERVER)) {
    const lines = readFileSync(file, 'utf-8').split('\n');
    lines.forEach((line, i) => {
      // Закомментированная регистрация ничего не затеняет. Без этой проверки
      // сторож ловил `// app.post("/api/trends/collect", ...)` как дубль живого
      // обработчика в другом файле — ложная тревога, которая обесценивает сторожа.
      const code = line.trim();
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
      const m = REGISTRATION.exec(line);
      if (!m) return;
      found.push({
        method: m[1].toLowerCase(),
        path: m[2].replace(/\/+$/, ''),
        file: file.slice(SERVER.length + 1),
        line: i + 1,
      });
    });
  }
  return found;
}

function duplicates(regs: Reg[], key: (r: Reg) => string): string[] {
  const map = new Map<string, Reg[]>();
  for (const r of regs) {
    const k = key(r);
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return [...map.entries()]
    .filter(([, v]) => v.length > 1)
    .map(([k, v]) => `${k} -> ${v.map((r) => `${r.file}:${r.line}`).join(', ')}`);
}

describe('AI-92: маршруты не затеняют друг друга', () => {
  it('в одном файле нет двух регистраций с одинаковыми методом и путём', () => {
    const regs = registrations();
    // Сканер должен что-то находить: пустой результат означает сломанный обход,
    // а не порядок в коде, и такой «зелёный» ничего не доказывает.
    expect(regs.length).toBeGreaterThan(100);
    const dup = duplicates(regs, (r) => `${r.file} ${r.method.toUpperCase()} ${r.path}`);
    expect(dup, `Затенённые обработчики, Express отдаёт первый:\n${dup.join('\n')}`).toEqual([]);
  });

  it('абсолютный путь /api/... не регистрируется дважды', () => {
    const regs = registrations().filter((r) => r.path.startsWith('/api/'));
    const dup = duplicates(regs, (r) => `${r.method.toUpperCase()} ${r.path}`);
    expect(dup, `Затенённые абсолютные маршруты:\n${dup.join('\n')}`).toEqual([]);
  });

  it('мёртвый мастер /api/instagram-setup удалён и не смонтирован', () => {
    const index = readFileSync(join(SERVER, 'index.ts'), 'utf-8');
    expect(index).not.toContain('instagram-setup');
  });
});

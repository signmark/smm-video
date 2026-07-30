/**
 * Обход исходников для source-scan тестов — на Node `fs`, без системного `grep`.
 *
 * Тесты, проверяющие «в активном коде не осталось X», раньше звали `grep` через
 * `execFileSync`. На Windows его нет, и обязательный `npx vitest run` падал с
 * `spawnSync grep ENOENT` — то есть гейт качества работал только на Linux
 * (находка приёмки 30.07.2026).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** Каталоги, в которые никогда не заходим: чужой код и артефакты сборки. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.cache',
  '.claude', 'custom_modules', '_archive',
]);

export interface SourceHit {
  /** Путь относительно корня репозитория, всегда через `/`. */
  file: string;
  /** Номер строки, 1-based. */
  line: number;
  text: string;
}

export interface ScanOptions {
  /** Корень обхода (абсолютный). */
  root: string;
  /** Относительные каталоги, которые нужно просмотреть. */
  dirs: string[];
  /** Расширения файлов с точкой, например ['.ts', '.tsx']. */
  extensions?: string[];
  /** Пропустить файлы, чей относительный путь удовлетворяет предикату. */
  skipFile?: (relativePath: string) => boolean;
}

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json'];

function* walk(root: string, dir: string, extensions: string[]): Generator<string> {
  const absolute = path.join(root, dir);
  let entries: string[];
  try {
    entries = readdirSync(absolute);
  } catch {
    return; // каталога может не быть — это не ошибка теста
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;

    const relative = path.posix.join(dir.split(path.sep).join('/'), entry);
    const full = path.join(root, relative);

    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue; // битая ссылка
    }

    if (stats.isDirectory()) {
      yield* walk(root, relative, extensions);
    } else if (extensions.includes(path.extname(entry))) {
      yield relative;
    }
  }
}

/** Строки исходников, совпавшие с образцом. Регистр игнорируется. */
export function scanSources(pattern: RegExp | string, options: ScanOptions): SourceHit[] {
  const { root, dirs, extensions = DEFAULT_EXTENSIONS, skipFile } = options;
  const regexp = typeof pattern === 'string'
    ? new RegExp(pattern, 'i')
    : new RegExp(pattern.source, pattern.flags.includes('i') ? pattern.flags : `${pattern.flags}i`);

  const hits: SourceHit[] = [];

  for (const dir of dirs) {
    for (const relative of walk(root, dir, extensions)) {
      if (skipFile?.(relative)) continue;

      let content: string;
      try {
        content = readFileSync(path.join(root, relative), 'utf8');
      } catch {
        continue;
      }
      if (!regexp.test(content)) continue;

      content.split('\n').forEach((text, index) => {
        // Свежий regexp на каждую строку: глобальный флаг сохраняет lastIndex.
        if (new RegExp(regexp.source, regexp.flags.replace('g', '')).test(text)) {
          hits.push({ file: relative, line: index + 1, text: text.trim() });
        }
      });
    }
  }

  return hits;
}

/** Только пути файлов, в которых есть совпадение. */
export function scanSourceFiles(pattern: RegExp | string, options: ScanOptions): string[] {
  return Array.from(new Set(scanSources(pattern, options).map(h => h.file)));
}

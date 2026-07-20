import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Регрессия Task 9 (social/index.ts:126): битый dynamic import
 * './social-platforms/youtube-shorts-service' ронял публикацию YouTube Shorts
 * через легаси-фасад в рантайме — tsc динамические импорты с неверным
 * относительным путём не ловит.
 *
 * Тест резолвит каждый относительный спецификатор (static и dynamic)
 * во всех файлах легаси-иерархии services/social/ и требует, чтобы цель
 * существовала на диске.
 */

const SOCIAL_DIR = resolve(__dirname, '../services/social');

// Доказуемо мёртвые файлы: импортируют несуществующие модули, т.е. не могут
// быть загружены никем (иначе рантайм упал бы на резолве). Удаление — по
// решению владельца, см. docs/platform-convergence-table.md.
const KNOWN_DEAD = new Set(['telegram-proxy-service.ts']);

function resolvesToFile(fromDir: string, specifier: string): boolean {
  const base = resolve(fromDir, specifier);
  return ['.ts', '.tsx', '.js', ''].some(ext => existsSync(base + ext))
    || existsSync(resolve(base, 'index.ts'));
}

describe('services/social — относительные импорты резолвятся', () => {
  const files = readdirSync(SOCIAL_DIR)
    .filter(f => f.endsWith('.ts') && !KNOWN_DEAD.has(f));

  it.each(files)('%s: все относительные import-спецификаторы существуют', (file) => {
    const fullPath = resolve(SOCIAL_DIR, file);
    const source = readFileSync(fullPath, 'utf8');
    const specifiers = [
      // static: import ... from '...'; export ... from '...'
      ...source.matchAll(/from\s+['"](\.[^'"]+)['"]/g),
      // dynamic: import('...')
      ...source.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g),
    ].map(match => match[1]);

    for (const specifier of specifiers) {
      expect(
        resolvesToFile(dirname(fullPath), specifier),
        `${file}: импорт '${specifier}' не резолвится в существующий файл`,
      ).toBe(true);
    }
  });
});

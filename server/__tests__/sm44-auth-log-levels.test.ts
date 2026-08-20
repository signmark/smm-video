/**
 * SM-44 ч.2 (auth/admin log noise) — attributable guard.
 *
 * Один поход за admin-флагом раньше писал до ШЕСТИ info-строк из ТРЁХ источников:
 *   1) user-auth.ts    fetchAdminStatus — GET url / status / result
 *   2) api/auth-routes.ts  «Проверка статуса админа» / «Результат проверки»
 *   3) routes-global-api-keys.ts  «Проверка прав администратора»
 * Все шесть — штатные (routine), должны быть log.debug, а не log(...)/log.info(...).
 *
 * Failure-пути обязаны остаться видимыми: log.error для сбоя токена/HTTP/исключения
 * и отказ «без токена». Тест падает (red), если какую-то из шести штатных строк
 * вернут на info, или если уберут error-диагностику.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf-8');
}

const ROUTINE_MARKERS: Array<{ file: string; pattern: RegExp }> = [
  { file: 'middleware/user-auth.ts', pattern: /fetchAdminStatus: GET / },
  { file: 'middleware/user-auth.ts', pattern: /fetchAdminStatus: status=/ },
  { file: 'middleware/user-auth.ts', pattern: /fetchAdminStatus: userId=.*is_smm_admin=/ },
  { file: 'api/auth-routes.ts', pattern: /Проверка статуса админа/ },
  { file: 'api/auth-routes.ts', pattern: /Результат проверки администратора:/ },
  { file: 'routes-global-api-keys.ts', pattern: /Проверка прав администратора/ },
];

describe('SM-44 ч.2: шесть штатных admin-строк — debug, а не info', () => {
  it('все шесть штатных строк идут через log.debug (не log(... info))', () => {
    for (const { file, pattern } of ROUTINE_MARKERS) {
      const src = read(file);
      const matches = src.match(new RegExp(`log[.](debug\\()?[^\n]*${pattern.source}`, 'g'));
      expect(matches).toBeTruthy();
      // Каждая найденная строка должна быть log.debug(..., а не голым log( / log.info(.
      for (const m of matches!) {
        const isDebug = /log\.debug\s*\(/.test(m) || /log\([^\n]*,\s*'[^']*',\s*'debug'\)/.test(m);
        expect(isDebug, `${file}: ${m.trim()} должен быть debug`).toBe(true);
      }
    }
  });

  it('ни одна штатная строка не осталась на info (голый log без level debug)', () => {
    for (const { file, pattern } of ROUTINE_MARKERS) {
      const src = read(file);
      // Ищем голый log(...) или log.info(...) с этим маркером — его быть не должно.
      const infoHits = src.match(new RegExp(`log\\.info\\s*\\([^\n]*${pattern.source}`, 'g')) || [];
      const bareHits = src.match(new RegExp(`(^|[^.])log\\s*\\([^\n]*${pattern.source}`, 'gm')) || [];
      expect(infoHits, `${file}: ${pattern.source} не должен быть info`).toHaveLength(0);
      expect(bareHits, `${file}: ${pattern.source} не должен быть голым log()`).toHaveLength(0);
    }
  });

  it('failure-диагностика сохранена: log.error для токена/HTTP/исключения', () => {
    const ua = read('middleware/user-auth.ts');
    expect(ua).toMatch(/log\.error\([^\n]*fetchAdminStatus: не удалось получить служебный токен/);
    expect(ua).toMatch(/log\.error\([^\n]*fetchAdminStatus: ошибка/);
    expect(ua).toMatch(/log\.error\([^\n]*fetchAdminStatus: исключение/);

    const ar = read('api/auth-routes.ts');
    expect(ar).toMatch(/Ошибка при проверке статуса администратора/);
    // «без токена» — отказ, остаётся видимым.
    expect(ar).toMatch(/Запрос на проверку админа без токена/);

    const ak = read('routes-global-api-keys.ts');
    expect(ak).toMatch(/Нет токена для проверки прав администратора/);
  });
});

/**
 * XMLRiver удалён полностью (решение владельца 2026-07-29, AI-48 п.1).
 *
 * Интеграция «чинилась» дважды и оба раза оживала частично: маршруты убрали,
 * а enum, UI-секция настроек и форматирование ключей с захардкоженным
 * user_id 16797 оставались. Этот тест — источник правды: XMLRiver не должен
 * возвращаться ни кодом, ни маршрутом, ни упоминанием в активных исходниках.
 *
 * До зачистки хвостов тест краснел на каждом пункте: enum в api-keys.ts,
 * маппинги клиента, секция SettingsDialog, диалог KeywordSelector,
 * run-test-api-keys.js.
 */

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { isPublicApiPath } from '../middleware/api-auth-gate';
import { scanSourceFiles } from './helpers/source-scan';

const ROOT = path.resolve(__dirname, '..', '..');

/** Активный код, в котором XMLRiver запрещён. */
const ACTIVE_DIRS = ['server', 'client/src', 'shared', 'test_scripts', 'scripts'];

/**
 * Единственное допустимое упоминание — комментарий в api-keys.ts о том,
 * почему в SERVICE_INDEX_MAPPING пропущен индекс 4.
 */
const ALLOWED = new Set(['server/services/api-keys.ts']);

function grepXmlriver(): string[] {
  return scanSourceFiles('xmlriver', { root: ROOT, dirs: ACTIVE_DIRS });
}

describe('XMLRiver полностью удалён', () => {
  it('исходники интеграции не существуют', () => {
    expect(existsSync(path.join(ROOT, 'server/api/xmlriver-routes.ts'))).toBe(false);
    expect(existsSync(path.join(ROOT, 'server/services/xmlriver-client.ts'))).toBe(false);
  });

  it('в активном коде нет упоминаний xmlriver (кроме комментария об индексе)', () => {
    const hits = grepXmlriver().filter(
      (f) => !f.includes('__tests__') && !ALLOWED.has(f),
    );
    expect(hits).toEqual([]);
  });

  it('/api/xmlriver/* не входит в публичные исключения гейта', () => {
    for (const p of [
      '/api/xmlriver/search',
      '/api/xmlriver/wordstat',
      '/api/xmlriver/test-search',
    ]) {
      expect(isPublicApiPath(p, 'GET'), p).toBe(false);
      expect(isPublicApiPath(p, 'POST'), p).toBe(false);
    }
  });
});

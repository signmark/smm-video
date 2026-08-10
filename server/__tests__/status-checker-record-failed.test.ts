/**
 * SM-15 / AI-85: status-checker должен считать publish_succeeded_record_failed
 * как «опубликовано» для parent-статуса.
 *
 * ЗАЧЕМ. Когда post-publish запись в Directus провалилась, helper
 * confirmPublishRecord пишет маркер `publish_succeeded_record_failed`.
 * Пост реально висит на платформе. В UI раздела «Публикации» (фильтр
 * по `status=published`) эта запись НЕ должна пропадать — иначе
 * пользователь увидит «не опубликовано» и опубликует руками → дубль.
 *
 * Status-checker агрегирует платформенные статусы в parent-статус. Если
 * все платформы published → parent = 'published'. Если хотя бы одна
 * `publish_succeeded_record_failed` — её нужно считать как published
 * для parent-статуса (пост висит на платформе).
 *
 * ДЕФЕКТ (до AI-85). Status-checker имел filter:
 *   pendingPlatforms: status !== 'published' && status !== 'failed' && !error
 * Маркер `publish_succeeded_record_failed` с полем `originalError` имел
 * `error: undefined`, поэтому попадал в pendingPlatforms. Parent-статус
 * оставался draft, и запись пропадала из UI.
 *
 * Тест — структурный сторож: проверяет, что status-checker при
 * вычислении publishedPlatforms и pendingPlatforms корректно учитывает
 * `publish_succeeded_record_failed` как published.
 *
 * RED-BEFORE: временно убрать упоминание нового статуса → тест красный.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STATUS_CHECKER_PATH = join(__dirname, '..', 'services', 'status-checker.ts');

function readStatusChecker(): string {
  return readFileSync(STATUS_CHECKER_PATH, 'utf8');
}

describe('AI-85: status-checker учитывает publish_succeeded_record_failed как published', () => {
  it('publishedPlatforms включает publish_succeeded_record_failed', () => {
    const src = readStatusChecker();
    // Ищем filter publishedPlatforms с упоминанием publish_succeeded_record_failed
    expect(src).toMatch(
      /status\s*===\s*['"]publish_succeeded_record_failed['"][\s\S]*?\.map\(\(\[platform\]\)\s*=>\s*platform\)/,
    );
  });

  it('pendingPlatforms ИСКЛЮЧАЕТ publish_succeeded_record_failed', () => {
    const src = readStatusChecker();
    // pendingPlatforms filter не должен содержать platformData со статусом publish_succeeded_record_failed
    // Ищем фильтр pendingPlatforms и проверяем, что в нём есть исключение
    expect(src).toMatch(
      /status\s*!==\s*['"]publish_succeeded_record_failed['"][\s\S]*?\.map\(\(\[platform\]\)\s*=>\s*platform\)/,
    );
  });

  it('комментарий упоминает SM-15 или AI-85', () => {
    const src = readStatusChecker();
    expect(src).toMatch(/SM-15\s*\/\s*AI-85/);
  });
});
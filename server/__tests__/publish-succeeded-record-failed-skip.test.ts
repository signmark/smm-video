/**
 * SM-15 / AI-85: планировщик должен пропускать платформы с publish_succeeded_record_failed.
 *
 * ЗАЧЕМ. Когда post-publish запись в Directus провалилась, helper
 * confirmPublishRecord пишет маркер `publish_succeeded_record_failed`. Это
 * значит:
 *   - пост реально опубликован (висит на платформе);
 *   - в БД не зафиксировано;
 *   - повторная отправка даст дубль на платформе (Telegram sendMessage не
 *     идемпотентен).
 *
 * Планировщик НЕ должен ретрить платформы с этим статусом. Тест читает
 * исходник publish-scheduler.ts и проверяет, что skip-блок для этого
 * статуса есть и стоит ДО acquireLock. Это структурный сторож (по AI-85
 * принципам Clause): правильный skip в scheduler пишется и стоит раньше
 * lock acquire.
 *
 * ДЕФЕКТ (до AI-85). Scheduler не имел такого skip'а. При ретрае (по 1-5
 * минутам) он отправлял бы тот же текст ещё раз → дубль на платформе.
 *
 * RED-BEFORE (по §1). Временно убрать skip → grep не находит его →
 * тест красный.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEDULER_PATH = join(__dirname, '..', 'services', 'publish-scheduler.ts');

function readScheduler(): string {
  return readFileSync(SCHEDULER_PATH, 'utf8');
}

describe('AI-85: scheduler skip на publish_succeeded_record_failed (структурный сторож)', () => {
  it('skip-блок для publish_succeeded_record_failed присутствует в scheduler', () => {
    const src = readScheduler();
    // Skip-блок: `if (data.status === 'publish_succeeded_record_failed') { ... continue; }`
    expect(src).toMatch(
      /data\.status\s*===\s*['"]publish_succeeded_record_failed['"][\s\S]*?continue\s*;/,
    );
  });

  it('skip стоит ДО acquireLock (структурно)', () => {
    const src = readScheduler();
    const skipIdx = src.indexOf("publish_succeeded_record_failed");
    const acquireIdx = src.indexOf('acquireLock(');
    expect(skipIdx).toBeGreaterThan(0);
    expect(acquireIdx).toBeGreaterThan(0);
    expect(skipIdx).toBeLessThan(acquireIdx);
  });

  it('skip содержит пояснение (comment) про дубль', () => {
    const src = readScheduler();
    // Конкретно: skip-блок содержит SM-15 или AI-85 комментарий
    const blockMatch = src.match(
      /data\.status\s*===\s*['"]publish_succeeded_record_failed['"][\s\S]*?continue\s*;/,
    );
    expect(blockMatch).not.toBeNull();
    expect(blockMatch![0]).toMatch(/SM-15|AI-85|do not re-send|дубл/);
  });

  it('pending НЕ попадает в этот skip — pending ретрится нормально', () => {
    const src = readScheduler();
    // pending не должен быть внутри блока publish_succeeded_record_failed.
    const blockMatch = src.match(
      /data\.status\s*===\s*['"]publish_succeeded_record_failed['"][\s\S]*?continue\s*;/,
    );
    expect(blockMatch).not.toBeNull();
    expect(blockMatch![0]).not.toMatch(/status\s*===\s*['"]pending['"]/);
  });
});
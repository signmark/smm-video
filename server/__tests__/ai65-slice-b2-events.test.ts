import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AI-65 срез B2 (task #65): события `cron.started` и `publish.scheduled` эмитятся
 * через ЕДИНУЮ точку — `logEvent` (машинный ключ + поля), не через console/сырой log.
 * По ним строятся оповещения «крон замолчал» и «появился запланированный пост».
 *
 * Source-guard на server/services/publish-scheduler.ts: обход logEvent (вернуть к
 * console/log) должен краснить; publish.scheduled эмитится ТОЛЬКО когда контент
 * реально остаётся запланированным (single-point + без спама).
 */

const scheduler = () => readFileSync(join(__dirname, '../services/publish-scheduler.ts'), 'utf-8');

describe('AI-65 срез B2: доменные события через единый logEvent', () => {
  it('cron.started эмитится через logEvent на старте периода (машинный ключ, не console)', () => {
    const s = scheduler();
    const idx = s.indexOf("logEvent('cron.started'");
    expect(idx).toBeGreaterThan(0);
    // Параметры: ключ + поля + level/source — это единая эмиссия через logEvent.
    const window = s.slice(idx, idx + 220);
    expect(window).toContain("'info'");
    expect(window).toContain("'scheduler'");
    // Не заглушен console.log'ом в этом месте.
    expect(s.slice(s.indexOf('const cycleStartedAt'), idx)).not.toContain('console.log');
    // Запрещено фальшивить «cron.started» через сырой log(...) без машинного ключа.
    expect(s).toContain("logEvent('cron.started'");
  });

  it('publish.scheduled эмитится через logEvent ТОЛЬКО когда контент остаётся scheduled (без спама)', () => {
    const s = scheduler();
    const idx = s.indexOf("logEvent('publish.scheduled'");
    expect(idx).toBeGreaterThan(0);
    // Строго под условием finalContentStatus === 'scheduled' — не на error/partially.
    const guardIdx = s.indexOf("if (finalContentStatus === 'scheduled')", idx - 400);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(idx);
    // Через logEvent с машинными полями.
    const window = s.slice(idx, idx + 240);
    expect(window).toContain('contentId: content.id');
    expect(window).toContain("'info'");
    expect(window).toContain("'scheduler'");
  });

  it('в publish-scheduler нет «самодельной» эмиссии этих ключей мимо logEvent', () => {
    const s = scheduler();
    // Ищем СЫРОЙ console.log / log (не logEvent) с текстом ключа внутри строки-аргумента.
    const raw = s.match(/console\.log\([^)]*['"]cron\.started['"]|log\([^)]*['"]publish\.scheduled['"]/g);
    expect(raw || []).toEqual([]);
    // Но оба ключа обязаны присутствовать как ПЕРВЫЙ аргумент logEvent (машинная эмиссия).
    expect((s.match(/logEvent\('cron\.started'/g) || []).length).toBeGreaterThan(0);
    expect((s.match(/logEvent\('publish\.scheduled'/g) || []).length).toBeGreaterThan(0);
  });
});

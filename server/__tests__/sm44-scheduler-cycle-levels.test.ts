/**
 * SM-44 ч.3 (фоновые циклы) — attributable guard.
 *
 * Планировщик писал «обработано 122, отправлено 0» (и «запланированного
 * контента нет») каждые 30 секунд на уровне info — штатный idle-шум. Пустой
 * проход должен быть debug, ненулевой результат и failure — видимыми.
 *
 * Тест падает (red), если:
 *  - «запланированного контента нет» вернут на info;
 *  - «обработано…/отправлено…» перестанет зависеть от publishedCount>0;
 *  - уберут failure-события (cron.failed / token_reset_failed / API error).
 *
 * Проверяется по исходнику (не выполнением) — уровень лога это статическая
 * константа/тернар в коде, а не рантайм-поведение.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'services', 'publish-scheduler.ts'), 'utf-8');

describe('SM-44 ч.3: пустой цикл планировщика молчит на info', () => {
  it('«запланированного контента нет» уходит в debug, а не info', () => {
    const idx = SRC.indexOf("'Цикл планировщика: запланированного контента нет'");
    expect(idx).toBeGreaterThan(-1);
    // Окно кода самого logEvent — уровень один из шести полей перед текстом.
    const window = SRC.slice(Math.max(0, idx - 220), idx);
    expect(window).toContain("'debug'");
    expect(window).not.toContain("'info'");
  });

  it('«обработано/отправлено» зависит от publishedCount>0: пусто — debug, ненулевое — info', () => {
    // Тернар должен существовать.
    expect(SRC).toMatch(/cycleLevel\s*[:=].*publishedCount\s*>\s*0\s*\?\s*'info'\s*:\s*'debug'/);
    // И использоваться в качестве уровня в logEvent.
    const idx = SRC.indexOf('`Цикл планировщика: обработано ${processedCount}');
    expect(idx).toBeGreaterThan(-1);
    const before = SRC.slice(0, idx);
    expect(before).toMatch(/cycleLevel,\s*\n\s*'scheduler',/);
  });

  it('failure-события остаются видимыми (error)', () => {
    expect(SRC).toMatch(/'scheduler\.token_reset_failed'/);
    expect(SRC).toMatch(/'cron\.failed'/);
    // token_reset_failed — error.
    expect(SRC).toMatch(/'scheduler\.token_reset_failed',\s*\n\s*\{[^}]*\},\s*\n\s*'error'/);
  });

  it('B2: cron.failed остаётся на error (мутация error→info красит)', () => {
    // Точная структура logEvent для cron.failed: событие, поля, уроо, источник.
    // Уровень обязан быть 'error' — если его сменить на 'info', тест краснеет.
    expect(SRC).toMatch(/'cron\.failed',\s*\n\s*\{ operation: 'publish-scheduler', reason: [^}]+ \},\s*\n\s*'error',\s*\n\s*'scheduler',/);
    // И явно: НЕ должно быть cron.failed на info.
    expect(SRC).not.toMatch(/'cron\.failed',\s*\n\s*\{[^}]*\},\s*\n\s*'info',/);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * SM-44 (часть 1, @Deepseek_Intern_Hermi): обычные исходящие запросы скрапера больше
 * НЕ пишутся уровнем warn (это штатная активность, а не повод для алерта). В warn остаются
 * ТОЛЬКО настоящие ошибки/отказы (включая security-отказы), которые обязаны быть видимыми.
 *
 * @Clause_Dev_Hermi: «Тихий лог, в котором не видно отказов по безопасности, хуже шумного.»
 * Поэтому стороже: (1) рутинный запрос пишется в info, (2) error-catch не понижен до info.
 */

const src = () => readFileSync(join(__dirname, '../services/scraper-analytics.ts'), 'utf-8');

describe('SM-44 ч.1: scraper-analytics — верные уровни (info для рутины, warn для ошибок)', () => {
  it('рутинный исходящий запрос логируется info, а не warn', () => {
    const s = src();
    // logAnalyticsRequest — обёртка лога каждого исходящего запроса.
    const fnStart = s.indexOf('function logAnalyticsRequest(');
    expect(fnStart).toBeGreaterThan(0);
    const fnBody = s.slice(fnStart, s.indexOf('// ─── Типы', fnStart));
    expect(fnBody).toContain("log.info(`scraper request=");
    expect(fnBody).not.toContain("log.warn(");
  });

  it('настоящие ошибки/отказы остаются на warn (не понижены до info)', () => {
    const s = src();
    // error-catch'и вокруг HTTP-вызовов с getAnalyticsErrorMessage обязаны остаться warn.
    const getCatch = s.indexOf("getAnalyticsErrorMessage('GET'");
    expect(getCatch).toBeGreaterThan(0);
    const catchWindow = s.slice(getCatch, getCatch + 400);
    expect(catchWindow).toContain('log.warn(');
    // force-parse ошибки тоже warn.
    expect(s).toContain("log.warn(message, 'analytics')");
  });
});

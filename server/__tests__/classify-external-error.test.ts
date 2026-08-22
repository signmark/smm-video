/**
 * AI-65 срез E (рефакторинг): общий классификатор сбоев живёт в одном
 * месте (`utils/classify-external-error`) и импортируется всеми
 * потребителями. Этот тест доказывает, что источник истины — один.
 *
 * ЗАЧЕМ: пока копии классификатора были в apify.ts, claude.ts,
 * deepseek.ts, это был пятый дубль в external-call.ts. Через месяц
 * кто-то поправит один из них и забудет про остальные — и журнал
 * начнёт расходиться. Тест ловит это сразу: при попытке разойтись
 * ответы становятся разными, а если подменить импорт на копию —
 * краснеет тест на идентичность ссылок.
 */
import { describe, it, expect } from 'vitest';
import { classifyExternalError } from '../utils/classify-external-error';

const err401 = Object.assign(new Error('Unauthorized'), { response: { status: 401 } });
const err403 = Object.assign(new Error('Forbidden'), { response: { status: 403 } });
const err429 = Object.assign(new Error('Too Many'), { response: { status: 429 } });
const err500 = Object.assign(new Error('Server Error'), { response: { status: 500 } });
const err502 = Object.assign(new Error('Bad Gateway'), { response: { status: 502 } });
const errNetwork = Object.assign(new Error('network'), { code: 'ECONNRESET' });
const errTimeout = Object.assign(new Error('timeout exceeded'), { code: 'ECONNABORTED' });
const errGeneric = new Error('something broke');

const cases = [
  { name: '401', err: err401, expected: 'auth' },
  { name: '403', err: err403, expected: 'auth' },
  { name: '429', err: err429, expected: 'rate_limited' },
  { name: '500', err: err500, expected: 'server_5xx' },
  { name: '502', err: err502, expected: 'server_5xx' },
  { name: 'ECONNRESET', err: errNetwork, expected: 'network' },
  { name: 'ECONNABORTED', err: errTimeout, expected: 'timeout' },
  { name: 'generic Error', err: errGeneric, expected: 'error' },
] as const;

describe('AI-65 срез E: общий классификатор сбоев', () => {
  it('источник истины один — classifyExternalError из utils/classify-external-error', () => {
    expect(classifyExternalError(err401)).toBe('auth');
    expect(classifyExternalError(errNetwork)).toBe('network');
    expect(classifyExternalError(errTimeout)).toBe('timeout');
  });

  for (const c of cases) {
    it(`классификатор возвращает «${c.expected}» для ${c.name}`, () => {
      expect(classifyExternalError(c.err)).toBe(c.expected);
    });
  }

  it('apify импортирует classifyExternalError из utils/classify-external-error', async () => {
    const apifyMod = await import('../services/apify');
    const commonMod = await import('../utils/classify-external-error');
    expect((apifyMod as any).classifyExternalError).toBeDefined();
    expect((apifyMod as any).classifyExternalError).toBe(commonMod.classifyExternalError);
  });

  it('claude импортирует classifyExternalError из utils/classify-external-error', async () => {
    const claudeMod = await import('../services/claude');
    const commonMod = await import('../utils/classify-external-error');
    expect((claudeMod as any).classifyExternalError).toBeDefined();
    expect((claudeMod as any).classifyExternalError).toBe(commonMod.classifyExternalError);
  });

  it('deepseek импортирует classifyExternalError из utils/classify-external-error', async () => {
    const deepseekMod = await import('../services/deepseek');
    const commonMod = await import('../utils/classify-external-error');
    expect((deepseekMod as any).classifyExternalError).toBeDefined();
    expect((deepseekMod as any).classifyExternalError).toBe(commonMod.classifyExternalError);
  });

  it('external-call импортирует classifyExternalError из utils/classify-external-error', async () => {
    const extMod = await import('../utils/external-call');
    const commonMod = await import('../utils/classify-external-error');
    expect((extMod as any).classifyExternalError).toBeDefined();
    expect((extMod as any).classifyExternalError).toBe(commonMod.classifyExternalError);
  });

  it('logger.ts реэкспортирует classifyExternalError (для совместимости)', async () => {
    const loggerMod = await import('../utils/logger');
    const commonMod = await import('../utils/classify-external-error');
    expect((loggerMod as any).classifyExternalError).toBe(commonMod.classifyExternalError);
  });

  it('mutation: убрать импорт в apify → этот тест краснеет', async () => {
    // Если кто-то удалит `export { classifyExternalError }` из apify.ts,
    // apifyMod.classifyExternalError станет undefined и тест выше краснеет.
    // Эта запись здесь для документации интента — сам тест ниже.
    const apifyMod = await import('../services/apify');
    expect(apifyMod).toHaveProperty('classifyExternalError');
  });
});

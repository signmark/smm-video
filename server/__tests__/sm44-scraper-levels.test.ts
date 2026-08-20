import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * SM-44 (часть 1): обычные исходящие запросы скрапера не должны шуметь уровнем warn и не
 * должны ложиться в журнал по три строки с телом ответа. Итог: ОДНА строка на запрос
 * (метод, путь, код ответа, длительность) и БЕЗ тела ответа; настоящие ошибки/отказы
 * (включая security-отказы) остаются warn и видимыми — «тихий лог без видимости security-отказов
 * хуже шумного» (@Clause_Dev_Hermi). Это source-guard на server/services/scraper-analytics.ts.
 */

const src = () => readFileSync(join(__dirname, '../services/scraper-analytics.ts'), 'utf-8');

describe('SM-44 ч.1: scraper-analytics — одна строка исхода на запрос, без тела; ошибки в warn', () => {
  it('каждый request-хелпер пишет ОДНУ info-строку исхода (метод/путь/статус/длительность), без тела ответа', () => {
    const s = src();
    const getBody = s.slice(s.indexOf('async function analyticsGet'), s.indexOf('async function analyticsPost'));
    const postBody = s.slice(s.indexOf('async function analyticsPost'), s.indexOf('async function analyticsDelete'));
    const delBody = s.slice(s.indexOf('async function analyticsDelete'), s.indexOf('// ─── Мониторинг каналов'));

    // Ни одного старого многострочного «→/←» и ни одного дампа response= в журнал.
    expect(postBody).not.toContain('→ POST');
    expect(postBody).not.toContain('← POST');
    expect(postBody).not.toContain('response=JSON.stringify(response.data)');
    // Ровно одна info-строка исхода в каждом хелпере, и она несёт путь+статус.
    for (const [label, block, method] of [
      ['GET', getBody, 'GET'],
      ['POST', postBody, 'POST'],
      ['DELETE', delBody, 'DELETE'],
    ] as const) {
      const infos = (block.match(/log\.info\(`\[ScraperAnalytics\] /g) || []).length;
      expect(infos, `${label}: ровно одна info-строка исхода`).toBe(1);
      expect(block).toContain(`] ${method} `);
    }
  });

  it('настоящие ошибки остаются на warn (не понижены до info) и не светят ключ', () => {
    const s = src();
    const catchWindow = s.slice(s.indexOf("getAnalyticsErrorMessage('GET'"));
    expect(catchWindow).toContain('log.warn(message');
    expect(s).not.toContain("log.warn(`scraper request=");
  });
});

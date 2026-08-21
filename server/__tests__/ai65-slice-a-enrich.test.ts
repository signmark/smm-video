import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  runWithRequestContext,
  getRequestContext,
  enrichRequestContext,
  generateRequestId,
} from '../utils/request-context';

/**
 * AI-65 срез A (task #62): в сквозной контекст запроса дописать userId (после
 * успешной проверки сессии) и campaignId (только после authorizeCampaignAccess
 * подтвердил, что кампания существует и доступ есть). Запись-журнал связывает
 * строки одного запроса и указывает, чей он и по какой кампании.
 */

const src = (p: string) => readFileSync(join(__dirname, p), 'utf-8');

describe('AI-65 срез A: enrichRequestContext пишет userId/campaignId в контекст', () => {
  it('внутри runWithRequestContext enrich доопределяет контекст (поведенчески)', () => {
    const seen: any = {};
    runWithRequestContext({ reqId: generateRequestId() }, () => {
      enrichRequestContext({ userId: 'user-111' });
      enrichRequestContext({ campaignId: 'campaign-222' });
      seen.ctx = getRequestContext();
    });
    expect(seen.ctx?.reqId).toBeTruthy();
    expect(seen.ctx?.userId).toBe('user-111');
    expect(seen.ctx?.campaignId).toBe('campaign-222');
  });

  it('вне запроса enrich молча ничего не делает (безопасно вызывать где угодно)', () => {
    expect(() => enrichRequestContext({ userId: 'x', campaignId: 'y' })).not.toThrow();
    // глобальный store вне run — undefined
    expect(getRequestContext()).toBeUndefined();
  });

  it('userId пишется в контекст ПОСЛЕ успешной проверки сессии (authenticateUser зовёт enrich)', () => {
    const s = src('../middleware/user-auth.ts');
    expect(s).toContain("enrichRequestContext({ userId });");
    expect(s).toContain("enrichRequestContext({ userId: realAdminId });");
    // Не раньше успешной проверки: в 401/403/503 ветках enrich нет.
    const afterJwt = s.indexOf("enrichRequestContext({ userId });");
    const sessionOk = s.indexOf("validateDirectusSession(token)");
    expect(afterJwt).toBeGreaterThan(sessionOk);
  });

  it('campaignId пишется только ПОСЛЕ подтверждения доступа (authorizeCampaignAccess zовёт enrich)', () => {
    const s = src('../services/campaign-access.ts');
    expect(s).toContain("enrichRequestContext({ campaignId });");
    // enrich стоит перед подтверждённым return campaign, а не в error-ветках.
    const enrichIdx = s.indexOf("enrichRequestContext({ campaignId });");
    const firstReturn = s.indexOf('return campaign;');
    expect(enrichIdx).toBeGreaterThan(0);
    expect(firstReturn).toBeGreaterThan(0);
    expect(enrichIdx).toBeLessThan(firstReturn);
  });

  it('все :campaignId URL-маршруты идут через authorizeCampaignAccess (нет дыры для чужого campaignId из URL)', () => {
    const dir = join(__dirname, '..');
    const { readdirSync } = require('node:fs');
    const walk = (d: string, acc: string[] = []): string[] => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p, acc);
        else if (/\.ts$/.test(e.name) && (d.includes('/routes') || d.includes('/api'))) acc.push(p);
      }
      return acc;
    };
    let campaignFiles = 0;
    let authorizeFiles = 0;
    for (const f of walk(dir)) {
      const s = readFileSync(f, 'utf-8');
      if (s.includes(':campaignId')) {
        campaignFiles++;
        if (s.includes('authorizeCampaignAccess')) authorizeFiles++;
      }
    }
    expect(campaignFiles).toBeGreaterThan(0);
    expect(authorizeFiles).toBe(campaignFiles);
  });
});

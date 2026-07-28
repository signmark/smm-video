/**
 * extractPostDate — повреждённая дата одной записи не должна ронять всю выдачу.
 *
 * Находка ревью 2026-07-28: `Number.isFinite(1e300)` истинно и `1e300 > 0`, поэтому
 * вызывался `new Date(1e300).toISOString()` → RangeError: Invalid time value.
 * Исключение улетало из .map() в catch роута и превращало весь /api/campaign-trends
 * в 500 — одна битая запись убивала всю выдачу кампании.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(), post: vi.fn(),
    create: vi.fn().mockReturnValue({
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
      get: vi.fn(), post: vi.fn(),
    }),
  },
}));
vi.mock('../directus', () => ({ directusApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('../services/directus-crud', () => ({
  directusCrud: { getAdminTokenPublic: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock('../services/directus-auth-manager', () => ({ directusAuthManager: { getAdminToken: vi.fn() } }));
vi.mock('../services/gemini-direct', () => ({ geminiDirect: { generateContent: vi.fn() } }));
vi.mock('../services/analytics-service', () => ({
  AnalyticsService: { refreshCampaignAnalytics: vi.fn(), getCampaignAnalytics: vi.fn() },
}));
vi.mock('../services/campaign-access', () => ({
  authorizeCampaignAccess: vi.fn(),
  CampaignAccessError: class CampaignAccessError extends Error {},
}));
vi.mock('../services/oauth-response-sanitizer', () => ({ sanitizeOAuthSecrets: (v: any) => v }));
vi.mock('../routes-global-api-keys', () => ({ isUserAdmin: vi.fn().mockResolvedValue(false) }));
vi.mock('../middleware/user-auth', () => ({
  authenticateUser: (req: any, _res: any, next: () => void) => next(),
  requireSmmAdmin: (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock('../utils/logger', () => {
  const logFn: any = vi.fn();
  logFn.info = vi.fn(); logFn.warn = vi.fn(); logFn.error = vi.fn(); logFn.debug = vi.fn();
  return { log: logFn, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
});

import { extractPostDate } from '../routes/analytics';

describe('extractPostDate — битые значения дают null, а не исключение', () => {
  it.each([
    ['огромное число', 1e300],
    ['ещё большее число', Number.MAX_VALUE],
    ['за верхней границей Date (8.64e15)', 8.64e15 + 1],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['NaN', NaN],
  ])('%s → null', (_label, value) => {
    expect(() => extractPostDate({ date: value })).not.toThrow();
    expect(extractPostDate({ date: value })).toBeNull();
  });

  it.each([
    ['огромная числовая строка', '1e300'],
    ['длинная цифровая строка', '999999999999999999999'],
  ])('%s → null', (_label, value) => {
    expect(() => extractPostDate({ timestamp: value })).not.toThrow();
    expect(extractPostDate({ timestamp: value })).toBeNull();
  });

  it('битая дата не мешает соседнему валидному полю', () => {
    // date битая, но следом идёт корректный timestamp
    expect(extractPostDate({ date: 1e300, timestamp: 1753600000 }))
      .toBe(new Date(1753600000 * 1000).toISOString());
  });
});

describe('extractPostDate — нормальные значения продолжают работать', () => {
  it('unix-секунды', () => {
    expect(extractPostDate({ date: 1753600000 })).toBe('2025-07-27T07:06:40.000Z');
  });

  it('unix-миллисекунды', () => {
    expect(extractPostDate({ timestamp: 1753600000000 })).toBe('2025-07-27T07:06:40.000Z');
  });

  it('секунды строкой', () => {
    expect(extractPostDate({ taken_at: '1753600000' })).toBe('2025-07-27T07:06:40.000Z');
  });

  it('ISO-строка', () => {
    expect(extractPostDate({ published_at: '2026-07-20T10:00:00Z' })).toBe('2026-07-20T10:00:00.000Z');
  });

  it('raw_source_data строкой с JSON внутри', () => {
    expect(extractPostDate('{"date":1753600000}')).toBe('2025-07-27T07:06:40.000Z');
  });

  it('нераспознаваемая строка → null', () => {
    expect(extractPostDate({ date: 'позавчера' })).toBeNull();
  });

  it('пустой вход → null', () => {
    expect(extractPostDate(null)).toBeNull();
    expect(extractPostDate({})).toBeNull();
  });
});

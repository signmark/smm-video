/**
 * AI-65 срез B1 — события входа. Четыре стабильных машиночитаемых события:
 *   auth.login (успех), auth.login_failed (неверные учётные данные),
 *   auth.token_expired (протух JWT в /api/auth/me), auth.password_reset_used.
 *
 * Проверка поведением: гоняем роутеры, ловим logEvent и сверяем имя события и
 * разрешённые поля; убеждаемся, что в поля не попадают ни токен, ни пароль, ни
 * email (allowlist их не пропускает — email мы сознательно не кладём).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => ({
  logEvent: vi.fn(),
  directusPost: vi.fn(async () => ({ data: { data: { access_token: 'tok', refresh_token: 'rtok', expires_at: Date.now() + 86400000 } } })),
  directusGet: vi.fn(async () => ({ data: { data: { id: 'u-1', email: 'u@example.com', first_name: 'U', last_name: 'L', role: 'user' } } })),
  isUserAdmin: vi.fn(async () => false),
  downgradeExpiredPlan: vi.fn(async () => {}),
  validateDirectusSession: vi.fn(async () => 'valid' as const),
  consumeResetToken: vi.fn(() => true),
  invalidateUserResetTokens: vi.fn(),
}));

vi.mock('../utils/logger', () => {
  const log: any = vi.fn();
  log.debug = vi.fn(); log.info = vi.fn(); log.warn = vi.fn(); log.error = vi.fn();
  return { log, logEvent: H.logEvent, default: log };
});
vi.mock('../directus', () => ({
  directusApiManager: {
    post: H.directusPost,
    get: H.directusGet,
    cacheAuthToken: vi.fn(),
  },
}));
vi.mock('../services/directus-auth-manager', () => ({
  directusAuthManager: { upsertSession: vi.fn() },
}));
vi.mock('../routes-global-api-keys', () => ({ isUserAdmin: H.isUserAdmin }));
vi.mock('../utils/environment-detector', () => ({
  detectEnvironment: vi.fn(() => ({ environment: 'production', logLevel: 'info', directusUrl: 'http://directus.test' })),
}));
vi.mock('../services/partner-postback', () => ({ sendRegistrationPostback: vi.fn() }));
vi.mock('../services/directus-session-validator', () => ({ validateDirectusSession: H.validateDirectusSession }));
vi.mock('../services/directus-refresh-service', () => ({ refreshDirectusSession: vi.fn() }));
vi.mock('../services/plan-expiry', () => ({ downgradeExpiredPlan: H.downgradeExpiredPlan }));
vi.mock('../services/email', () => ({ sendEmail: vi.fn() }));
vi.mock('../utils/html-escape', () => ({ escapeHtml: (s: string) => s }));
vi.mock('../utils/app-base-url', () => ({ getAppBaseUrl: () => 'http://app.test' }));
vi.mock('../utils/password-reset-tokens', () => ({
  rememberResetToken: vi.fn(async () => ({ token: 't', ts: Date.now() })),
  consumeResetToken: H.consumeResetToken,
  invalidateUserResetTokens: H.invalidateUserResetTokens,
}));

import { registerAuthRoutes } from '../api/auth-routes';
import { registerPasswordResetRoutes } from '../api/password-reset';

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  app = express();
  app.use(express.json());
  registerAuthRoutes(app);
  registerPasswordResetRoutes(app);
});

function events() {
  return H.logEvent.mock.calls.map((c) => ({ event: c[0], fields: c[1], level: c[2], source: c[3] }));
}

describe('AI-65 срез B1: события входа', () => {
  it('успешный вход даёт auth.login с userId, без токена/пароля/email', async () => {
    await request(app).post('/api/auth/login').send({ email: 'u@example.com', password: 'hunter2' });

    const login = events().find((e) => e.event === 'auth.login');
    expect(login).toBeTruthy();
    expect(login!.fields).toEqual({ userId: 'u-1' });
    expect(JSON.stringify(login!.fields)).not.toContain('hunter2');
    expect(JSON.stringify(login!.fields)).not.toContain('tok');
    expect(login!.level).toBe('info');
  });

  it('неверные учётные данные дают auth.login_failed с reason, без email/пароля', async () => {
    H.directusPost.mockRejectedValueOnce({ response: { status: 401, data: {} } });

    const res = await request(app).post('/api/auth/login').send({ email: 'u@example.com', password: 'bad' });
    expect(res.status).toBe(401);

    const failed = events().find((e) => e.event === 'auth.login_failed');
    expect(failed).toBeTruthy();
    expect(failed!.fields).toEqual({ reason: 'invalid_credentials' });
    expect(JSON.stringify(failed!.fields)).not.toContain('u@example.com');
    expect(JSON.stringify(failed!.fields)).not.toContain('bad');
    expect(failed!.level).toBe('warn');
  });

  it('протухший токен в /api/auth/check даёт auth.token_expired с userId', async () => {
    // JWT с exp в прошлом (payload {id:'u-9', exp: 1}).
    const payload = Buffer.from(JSON.stringify({ id: 'u-9', exp: 1 })).toString('base64');
    const expired = `x.${payload}.y`;

    const res = await request(app).get('/api/auth/check').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);

    const te = events().find((e) => e.event === 'auth.token_expired');
    expect(te).toBeTruthy();
    expect(te!.fields).toEqual({ userId: 'u-9' });
    expect(te!.level).toBe('warn');
  });

  it('повторный полл /api/auth/check в пределах часа не дублирует auth.token_expired', async () => {
    const payload = Buffer.from(JSON.stringify({ id: 'u-dedup', exp: 1 })).toString('base64');
    const expired = `x.${payload}.y`;

    const res1 = await request(app).get('/api/auth/check').set('Authorization', `Bearer ${expired}`);
    expect(res1.status).toBe(401);
    const te1 = events().filter((e) => e.event === 'auth.token_expired');
    expect(te1).toHaveLength(1);

    // Тот же протухший токен снова — cooldown, события НЕ добавляется.
    const res2 = await request(app).get('/api/auth/check').set('Authorization', `Bearer ${expired}`);
    expect(res2.status).toBe(401);
    const te2 = events().filter((e) => e.event === 'auth.token_expired');
    expect(te2).toHaveLength(1); // по-прежнему одно
  });

  it('смена пароля даёт auth.password_reset_used с userId', async () => {
    process.env.APP_SIGNING_SECRET = 'test-secret';
    const ts = Math.floor(Date.now() / 1000) - 30;
    const expected = require('crypto').createHmac('sha256', 'test-secret').update(`u-1:${ts}`).digest('hex').slice(0, 40);
    (global.fetch as any) = vi.fn(async () => ({ ok: true, json: async () => ({ data: { email: 'u@example.com' } }) }));

    const res = await request(app).post('/api/auth/password-reset/confirm').send({
      userId: 'u-1', ts, token: expected, password: 'newpass123',
    });

    expect(res.status).toBe(200);
    expect(H.invalidateUserResetTokens).toHaveBeenCalled();

    const pr = events().find((e) => e.event === 'auth.password_reset_used');
    expect(pr).toBeTruthy();
    expect(pr!.fields).toEqual({ userId: 'u-1' });
    expect(pr!.level).toBe('info');
  });
});

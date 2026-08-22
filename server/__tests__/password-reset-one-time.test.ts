/**
 * Ссылка сброса пароля обязана быть одноразовой.
 *
 * Токен — подписанный HMAC, но подпись ничего не знает об использовании:
 * чистый HMAC(userId:ts) жил весь TTL и срабатывал сколько угодно раз, а смена
 * пароля его не гасила. Здесь проверяем серверное состояние, которое это чинит,
 * плюс сравнение подписи за постоянное время и отсутствие фолбэк-секрета.
 *
 * Гоняется РЕАЛЬНЫЙ роутер сброса в мини-Express; на границах моками закрыты
 * fetch к Directus и отправка почты.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';

const H = vi.hoisted(() => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock('../services/email', () => ({ sendEmail: H.sendEmail }));

// Постоянство времени сравнения поведением не проверяется — равенство подписей
// даёт тот же ответ и через !==. Поэтому оборачиваем реальный timingSafeEqual
// и убеждаемся, что сравнение идёт именно через него.
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  const timingSafeEqual = vi.fn(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual, default: { ...actual, timingSafeEqual } };
});

import { registerPasswordResetRoutes } from '../api/password-reset';
import { __clearResetTokenStore } from '../utils/password-reset-tokens';

const USER = { id: 'user-42', email: 'owner@example.com', first_name: 'Дмитрий' };
const ADMIN_TOKEN = 'test-admin-token';

const makeApp = () => {
  const app = express();
  app.use(express.json());
  registerPasswordResetRoutes(app);
  return app;
};

/** Мок Directus: поиск пользователя, PATCH пароля, чтение для уведомления. */
function stubDirectus(options: { patchOk?: boolean } = {}) {
  const patchOk = options.patchOk !== false;
  const patchCalls: string[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: any) => {
      if (init?.method === 'PATCH') {
        patchCalls.push(String(url));
        return patchOk
          ? { ok: true, json: async () => ({ data: USER }) }
          : { ok: false, text: async () => 'directus error' };
      }
      // GET: и поиск по email, и чтение профиля для письма-уведомления
      if (String(url).includes('filter[email]')) {
        return { ok: true, json: async () => ({ data: [USER] }) };
      }
      return { ok: true, json: async () => ({ data: USER }) };
    }),
  );

  return { patchCalls };
}

const currentTs = () => Math.floor(Date.now() / 1000);

function signToken(userId: string, ts: number, secret = ADMIN_TOKEN) {
  return crypto.createHmac('sha256', secret).update(`${userId}:${ts}`).digest('hex').slice(0, 40);
}

/** Запрашивает сброс и достаёт из письма параметры ссылки. */
async function requestReset(app: express.Express) {
  const res = await request(app)
    .post('/api/auth/password-reset/request')
    .send({ email: USER.email });
  expect(res.status).toBe(200);

  const html = H.sendEmail.mock.calls.at(-1)?.[0]?.html as string;
  const match = html.match(/userId=([^&]+)&ts=(\d+)&token=([a-f0-9]+)/);
  if (!match) throw new Error('В письме нет ссылки сброса');
  return { userId: match[1], ts: Number(match[2]), token: match[3] };
}

beforeEach(() => {
  vi.clearAllMocks();
  __clearResetTokenStore();
  process.env.DIRECTUS_URL = 'http://directus.test';
  process.env.APP_SIGNING_SECRET = ADMIN_TOKEN;
  process.env.DIRECTUS_STATIC_TOKEN = 'test-static-token';
  // AI-89: getPublicOrigin() в проде бросает без APP_PUBLIC_URL
  // (раньше был silent fallback на smm.omemo.tech). Тест проверяет
  // password-reset, а не публичный URL — ставим заглушку.
  process.env.APP_PUBLIC_URL = 'http://app.test';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('одноразовость ссылки сброса', () => {
  it('первое использование меняет пароль, второе — отказ', async () => {
    stubDirectus();
    const app = makeApp();
    const link = await requestReset(app);

    const first = await request(app)
      .post('/api/auth/password-reset/confirm')
      .send({ ...link, password: 'FAKE-PWD-FOR-TEST-B' });
    expect(first.status).toBe(200);
    expect(first.body.success).toBe(true);

    // Та же самая ссылка второй раз — уже нерабочая.
    const second = await request(app)
      .post('/api/auth/password-reset/confirm')
      .send({ ...link, password: 'attacker-pass' });
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/использована|недействительн/i);
  });

  it('второй заход не доходит до Directus (пароль не переписывается)', async () => {
    const { patchCalls } = stubDirectus();
    const app = makeApp();
    const link = await requestReset(app);

    await request(app).post('/api/auth/password-reset/confirm').send({ ...link, password: 'FAKE-PWD-FOR-TEST-B' });
    const patchesAfterFirst = patchCalls.length;

    await request(app).post('/api/auth/password-reset/confirm').send({ ...link, password: 'attacker-pass' });
    expect(patchCalls.length).toBe(patchesAfterFirst);
  });

  it('новая ссылка гасит предыдущую', async () => {
    stubDirectus();
    const app = makeApp();
    const firstLink = await requestReset(app);

    // ts должен реально отличаться, иначе подпись совпадёт и это будет
    // физически та же ссылка. Двигаем часы явно, а не надеемся на то, что
    // выполнение теста пересечёт границу секунды.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date((currentTs() + 5) * 1000));
    const secondLink = await requestReset(app);
    expect(secondLink.ts).not.toBe(firstLink.ts);
    expect(secondLink.token).not.toBe(firstLink.token);

    const stale = await request(app)
      .post('/api/auth/password-reset/confirm')
      .send({ ...firstLink, password: 'FAKE-PWD-FOR-TEST-B' });
    expect(stale.status).toBe(400);

    const fresh = await request(app)
      .post('/api/auth/password-reset/confirm')
      .send({ ...secondLink, password: 'FAKE-PWD-FOR-TEST-B' });
    expect(fresh.status).toBe(200);
    vi.useRealTimers();
  });

  it('смена пароля из профиля гасит выданную ссылку', async () => {
    stubDirectus();
    const app = makeApp();
    const link = await requestReset(app);

    // Профиль дергает тот же helper при обновлении пароля.
    const { invalidateUserResetTokens } = await import('../utils/password-reset-tokens');
    expect(invalidateUserResetTokens(USER.id)).toBeGreaterThan(0);

    const res = await request(app)
      .post('/api/auth/password-reset/confirm')
      .send({ ...link, password: 'FAKE-PWD-FOR-TEST-B' });
    expect(res.status).toBe(400);
  });

  it('неудачная смена пароля не оставляет ссылку рабочей', async () => {
    stubDirectus({ patchOk: false });
    const app = makeApp();
    const link = await requestReset(app);

    const failed = await request(app)
      .post('/api/auth/password-reset/confirm')
      .send({ ...link, password: 'FAKE-PWD-FOR-TEST-B' });
    expect(failed.status).toBe(500);

    // Токен гасится до обращения к Directus — повтор запрещён.
    const retry = await request(app)
      .post('/api/auth/password-reset/confirm')
      .send({ ...link, password: 'FAKE-PWD-FOR-TEST-B' });
    expect(retry.status).toBe(400);
  });
});

describe('подпись токена', () => {
  it('чужая/подделанная подпись отклоняется', async () => {
    stubDirectus();
    const app = makeApp();
    await requestReset(app);

    const ts = currentTs();
    const res = await request(app).post('/api/auth/password-reset/confirm').send({
      userId: USER.id,
      ts,
      token: signToken(USER.id, ts, 'wrong-secret'),
      password: 'FAKE-PWD-FOR-TEST-B',
    });
    expect(res.status).toBe(400);
  });

  it('сравнение идёт через timingSafeEqual, а не через !==', async () => {
    stubDirectus();
    const app = makeApp();
    const link = await requestReset(app);
    (crypto.timingSafeEqual as any).mockClear();

    await request(app)
      .post('/api/auth/password-reset/confirm')
      .send({ ...link, password: 'FAKE-PWD-FOR-TEST-B' });

    expect(crypto.timingSafeEqual).toHaveBeenCalled();
  });

  it('токен другой длины не роняет обработчик (timingSafeEqual)', async () => {
    stubDirectus();
    const app = makeApp();
    const ts = currentTs();

    const res = await request(app).post('/api/auth/password-reset/confirm').send({
      userId: USER.id,
      ts,
      token: 'ab',
      password: 'FAKE-PWD-FOR-TEST-B',
    });
    // Именно 400, а не 500: разная длина обрабатывается, а не бросает.
    expect(res.status).toBe(400);
  });

  it('без настроенного секрета — ошибка конфигурации, а не подпись известной строкой', async () => {
    stubDirectus();
    const app = makeApp();
    const ts = currentTs();
    // Токен, который подписан выпиленным публичным фолбэком из репозитория.
    const legacyToken = signToken(USER.id, ts, 'smm-reset-secret');

    delete process.env.APP_SIGNING_SECRET;
    process.env.DIRECTUS_STATIC_TOKEN = 'test-static-token';

    const res = await request(app).post('/api/auth/password-reset/confirm').send({
      userId: USER.id,
      ts,
      token: legacyToken,
      password: 'FAKE-PWD-FOR-TEST-B',
    });

    // Раньше фолбэк 'smm-reset-secret' сделал бы такую ссылку валидной.
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(500);
  });
});

describe('уведомление о смене пароля', () => {
  it('уходит письмо на почту пользователя', async () => {
    stubDirectus();
    const app = makeApp();
    const link = await requestReset(app);
    H.sendEmail.mockClear();

    await request(app)
      .post('/api/auth/password-reset/confirm')
      .send({ ...link, password: 'FAKE-PWD-FOR-TEST-B' });

    expect(H.sendEmail).toHaveBeenCalledTimes(1);
    const mail = H.sendEmail.mock.calls[0][0] as any;
    expect(mail.to).toBe(USER.email);
    expect(mail.subject).toMatch(/Пароль изменён/i);
  });

  it('падение отправки письма не ломает уже успешную смену пароля', async () => {
    stubDirectus();
    const app = makeApp();
    const link = await requestReset(app);
    H.sendEmail.mockRejectedValueOnce(new Error('smtp down'));

    const res = await request(app)
      .post('/api/auth/password-reset/confirm')
      .send({ ...link, password: 'FAKE-PWD-FOR-TEST-B' });
    expect(res.status).toBe(200);
  });
});

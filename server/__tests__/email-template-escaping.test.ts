/**
 * Подстановки в письмах экранируются, а письмо сброса говорит, ДЛЯ КАКОГО
 * аккаунта и КОГДА запрошен сброс.
 *
 * Имя пользователя подставлялось в разметку письма как есть (`<b>${firstName}</b>`).
 * Стреляет слабо — письмо уходит на адрес самого зарегистрировавшегося, — но
 * это неэкранированная интерполяция в разметку, и чинится она в одном месте.
 *
 * Вторая половина файла про содержание: когда чужой сброс это реальный
 * сценарий, получателю нужно понимать, его это действие или нет.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('../services/email', () => ({ sendEmail: H.sendEmail }));

import { escapeHtml } from '../utils/html-escape';
import { registerPasswordResetRoutes } from '../api/password-reset';
import { __clearResetTokenStore } from '../utils/password-reset-tokens';

const EVIL_NAME = '<img src=x onerror=alert(1)>"Вася"';
const USER = { id: 'user-42', email: 'owner@example.com', first_name: EVIL_NAME };

const makeApp = () => {
  const app = express();
  app.use(express.json());
  registerPasswordResetRoutes(app);
  return app;
};

beforeEach(() => {
  vi.clearAllMocks();
  __clearResetTokenStore();
  process.env.DIRECTUS_URL = 'http://directus.test';
  process.env.APP_SIGNING_SECRET = 'test-admin-token';
  process.env.DIRECTUS_STATIC_TOKEN = 'test-static-token';
  // AI-89: getPublicOrigin() в public-url.ts бросает в проде без
  // APP_PUBLIC_URL (раньше был silent fallback на smm.omemo.tech —
  // data-leak risk). Тест проверяет email, а не публичный URL,
  // поэтому ставим здесь, чтобы маршрут мог построить ссылку.
  process.env.APP_PUBLIC_URL = 'http://app.test';

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('filter[email]')) {
        return { ok: true, json: async () => ({ data: [USER] }) };
      }
      return { ok: true, json: async () => ({ data: USER }) };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('escapeHtml', () => {
  it('экранирует символы разметки и кавычки', () => {
    expect(escapeHtml('<b>x</b>')).toBe('&lt;b&gt;x&lt;/b&gt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml(`"'`)).toBe('&quot;&#39;');
  });

  it('амперсанд экранируется первым (без двойного экранирования)', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('null и undefined дают пустую строку, а не "null"', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('письмо сброса пароля', () => {
  it('имя пользователя экранируется, а не вставляется как разметка', async () => {
    await request(makeApp())
      .post('/api/auth/password-reset/request')
      .send({ email: USER.email });

    const html = (H.sendEmail.mock.calls[0][0] as any).html as string;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('указан аккаунт, для которого запрошен сброс', async () => {
    await request(makeApp())
      .post('/api/auth/password-reset/request')
      .send({ email: USER.email });

    const html = (H.sendEmail.mock.calls[0][0] as any).html as string;
    expect(html).toContain(USER.email);
  });

  it('указано время запроса', async () => {
    await request(makeApp())
      .post('/api/auth/password-reset/request')
      .send({ email: USER.email });

    const html = (H.sendEmail.mock.calls[0][0] as any).html as string;
    expect(html).toMatch(/Запрос сделан/);
    // Дата в формате ru-RU: ДД.ММ.ГГГГ, ЧЧ:ММ:СС
    expect(html).toMatch(/\d{2}\.\d{2}\.\d{4}/);
  });
});

describe('письмо об изменённом пароле', () => {
  it('имя экранируется и в уведомлении', async () => {
    const app = makeApp();
    await request(app).post('/api/auth/password-reset/request').send({ email: USER.email });
    const linkHtml = (H.sendEmail.mock.calls[0][0] as any).html as string;
    const m = linkHtml.match(/userId=([^&]+)&ts=(\d+)&token=([a-f0-9]+)/)!;
    H.sendEmail.mockClear();

    // PATCH в Directus должен пройти успешно — стаб выше отдаёт ok на всё.
    await request(app)
      .post('/api/auth/password-reset/confirm')
      .send({ userId: m[1], ts: m[2], token: m[3], password: 'FAKE-PWD-FOR-TEST-B' });

    const html = (H.sendEmail.mock.calls[0][0] as any).html as string;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});

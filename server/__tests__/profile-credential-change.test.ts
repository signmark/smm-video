/**
 * Смена пароля и почты в профиле требует подтверждения (F-14).
 *
 * Было: PUT /api/user/profile принимал new_password и email и слал их в
 * Directus без единой проверки. Одного украденного токена сессии хватало,
 * чтобы забрать аккаунт целиком — сменить пароль, не зная старого, и
 * переписать почту на свою, после чего законный владелец терял и вход, и
 * возможность восстановления.
 *
 * Стало: обе операции требуют текущий пароль, а почта меняется только после
 * перехода по ссылке, отправленной на новый адрес; на старый адрес уходит
 * предупреждение.
 *
 * Гоняются РЕАЛЬНЫЕ роутеры (профиль и подтверждение почты) в мини-Express,
 * с реальным authenticateUser; на границах моками закрыты Directus и почта.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => ({ ok: true })),
  patch: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../services/email', () => ({ sendEmail: H.sendEmail }));

vi.mock('../directus', () => ({
  directusApi: { get: vi.fn(), post: vi.fn(), patch: H.patch, delete: vi.fn() },
  directusApiManager: {
    post: H.post,
    get: vi.fn(),
    request: vi.fn(),
    cacheAuthToken: vi.fn(),
    instance: { interceptors: { response: { use: vi.fn() }, request: { use: vi.fn() } } },
  },
  default: { get: vi.fn(), post: vi.fn(), patch: H.patch, delete: vi.fn() },
}));

// Сессию валидируем без сети: сам механизм сессий закрыт своими тестами.
vi.mock('../services/directus-session-validator', () => ({
  validateDirectusSession: vi.fn(async () => 'valid'),
}));

vi.mock('../utils/environment-detector', () => ({
  detectEnvironment: () => ({ directusUrl: 'http://directus.test' }),
}));

import { registerUserRoutes } from '../routes/user';
import { registerEmailChangeRoutes, EMAIL_CHANGE_TOKEN_TTL_SEC } from '../api/email-change';
import { __clearResetTokenStore } from '../utils/password-reset-tokens';

const USER_ID = 'user-42';
const OLD_EMAIL = 'owner@example.com';
const NEW_EMAIL = 'attacker@evil.example';
const ADMIN_TOKEN = 'test-admin-token';

const makeApp = () => {
  const app = express();
  app.use(express.json());
  registerUserRoutes(app);
  registerEmailChangeRoutes(app);
  return app;
};

const createMockToken = (payload: object) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  return `${header}.${body}.signature`;
};

const authToken = () => createMockToken({ id: USER_ID, email: OLD_EMAIL });

/**
 * Directus через fetch — с состоянием.
 *
 * Мок ДОЛЖЕН быть stateful: одноразовость ссылки подтверждения держится не на
 * серверной памяти, а на том, что после применения адрес аккаунта в Directus
 * стал другим. Мок, который вечно отдаёт старый адрес, эту механику просто не
 * проверял бы.
 */
function stubDirectusFetch(options: { patchOk?: boolean; email?: string } = {}) {
  const patchOk = options.patchOk !== false;
  const state = { email: options.email ?? OLD_EMAIL };
  const patches: Array<{ url: string; body: any }> = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: any) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(init.body);
        patches.push({ url: String(url), body });
        if (patchOk && typeof body.email === 'string') {
          state.email = body.email;
        }
        return patchOk
          ? { ok: true, status: 200, json: async () => ({ data: {} }), text: async () => '' }
          : { ok: false, status: 500, json: async () => ({}), text: async () => 'directus error' };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: USER_ID,
            email: state.email,
            first_name: 'Дмитрий',
            is_smm_admin: false,
          },
        }),
        text: async () => '',
        clone() {
          return this;
        },
      };
    }),
  );

  return { patches, state };
}

/** Ответ Directus на PATCH профиля через axios-клиент. */
function stubProfilePatch() {
  H.patch.mockResolvedValue({
    data: { data: { id: USER_ID, email: OLD_EMAIL, first_name: 'Дмитрий', last_name: '' } },
  });
}

/** Directus /auth/login: принимает только правильный пароль. */
function stubPasswordCheck(correctPassword: string | null) {
  H.post.mockImplementation(async (url: string, body: any) => {
    if (url !== '/auth/login') throw new Error(`unexpected ${url}`);
    if (correctPassword !== null && body?.password === correctPassword) {
      return { data: { data: { access_token: 'x' } } };
    }
    const err: any = new Error('Invalid credentials');
    err.response = { status: 401 };
    throw err;
  });
}

/** Достаёт параметры ссылки подтверждения из письма на новый адрес. */
function confirmLinkFromMail(to = NEW_EMAIL) {
  const call = H.sendEmail.mock.calls.find((c: any) => c[0]?.to === to);
  if (!call) throw new Error(`Письмо на ${to} не отправлено`);
  const html = (call[0] as any).html as string;
  const m = html.match(/userId=([^&"]+)&ts=(\d+)&email=([^&"]+)&token=([a-f0-9]+)/);
  if (!m) throw new Error('В письме нет ссылки подтверждения');
  return {
    userId: decodeURIComponent(m[1]),
    ts: Number(m[2]),
    email: decodeURIComponent(m[3]),
    token: m[4],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __clearResetTokenStore();
  process.env.DIRECTUS_URL = 'http://directus.test';
  process.env.APP_SIGNING_SECRET = ADMIN_TOKEN;
  process.env.DIRECTUS_STATIC_TOKEN = 'test-static-token';
  // AI-89: getPublicOrigin() теперь бросает в проде без APP_PUBLIC_URL
  // (раньше был silent fallback на smm.omemo.tech).
  process.env.APP_PUBLIC_URL = 'http://app.test';
  process.env.DIRECTUS_STATIC_TOKEN = 'test-static-token';
  stubProfilePatch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PUT /api/user/profile — смена пароля требует текущий пароль', () => {
  it('правка одного лишь имени работает без текущего пароля (обратная совместимость)', async () => {
    stubDirectusFetch();
    stubPasswordCheck('correct-horse');

    const res = await request(makeApp())
      .put('/api/user/profile')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ first_name: 'Новое', last_name: 'Имя', email: OLD_EMAIL });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Пароль не спрашивали — /auth/login не дёргался вообще.
    expect(H.post).not.toHaveBeenCalled();
    expect(H.patch).toHaveBeenCalledTimes(1);
  });

  it('без current_password пароль не меняется (400, Directus не трогаем)', async () => {
    stubDirectusFetch();
    stubPasswordCheck('correct-horse');

    const res = await request(makeApp())
      .put('/api/user/profile')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ first_name: 'Дмитрий', email: OLD_EMAIL, new_password: 'FAKE-PWD-FOR-TEST-A' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CURRENT_PASSWORD_REQUIRED');
    expect(H.patch).not.toHaveBeenCalled();
  });

  it('с неверным current_password пароль не меняется (403, без forceLogout-кода)', async () => {
    stubDirectusFetch();
    stubPasswordCheck('correct-horse');

    const res = await request(makeApp())
      .put('/api/user/profile')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({
        first_name: 'Дмитрий',
        email: OLD_EMAIL,
        new_password: 'FAKE-PWD-FOR-TEST-A',
        current_password: 'guess',
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CURRENT_PASSWORD_INVALID');
    // 401 или code AUTH_SESSION_INVALID выкинули бы пользователя из приложения.
    expect(res.status).not.toBe(401);
    expect(res.body.code).not.toBe('AUTH_SESSION_INVALID');
    expect(H.patch).not.toHaveBeenCalled();
  });

  it('с верным current_password пароль меняется', async () => {
    stubDirectusFetch();
    stubPasswordCheck('correct-horse');

    const res = await request(makeApp())
      .put('/api/user/profile')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({
        first_name: 'Дмитрий',
        email: OLD_EMAIL,
        new_password: 'brand-new-pass',
        current_password: 'correct-horse',
      });

    expect(res.status).toBe(200);
    expect(H.patch).toHaveBeenCalledTimes(1);
    expect(H.patch.mock.calls[0][1]).toMatchObject({ password: 'brand-new-pass' });
  });

  it('текущий пароль проверяется по адресу из Directus, а не из тела запроса', async () => {
    // Угонщик подставляет свой адрес в тело, рассчитывая, что проверка пароля
    // пойдёт по нему. Проверка обязана идти по текущему адресу аккаунта.
    stubDirectusFetch();
    stubPasswordCheck('correct-horse');

    await request(makeApp())
      .put('/api/user/profile')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({
        first_name: 'Дмитрий',
        email: NEW_EMAIL,
        new_password: 'x-new-pass',
        current_password: 'correct-horse',
      });

    expect(H.post).toHaveBeenCalledWith('/auth/login', expect.objectContaining({ email: OLD_EMAIL }));
  });

  it('недоступный Directus при проверке пароля даёт 500, а не молчаливый пропуск', async () => {
    stubDirectusFetch();
    H.post.mockImplementation(async () => {
      const err: any = new Error('ECONNREFUSED');
      err.response = { status: 503 };
      throw err;
    });

    const res = await request(makeApp())
      .put('/api/user/profile')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({
        first_name: 'Дмитрий',
        email: OLD_EMAIL,
        new_password: 'FAKE-PWD-FOR-TEST-A',
        current_password: 'whatever',
      });

    expect(res.status).toBe(500);
    expect(H.patch).not.toHaveBeenCalled();
  });
});

describe('PUT /api/user/profile — смена почты не применяется мгновенно', () => {
  it('без current_password почта не меняется', async () => {
    const { patches } = stubDirectusFetch();
    stubPasswordCheck('correct-horse');

    const res = await request(makeApp())
      .put('/api/user/profile')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ first_name: 'Дмитрий', email: NEW_EMAIL });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CURRENT_PASSWORD_REQUIRED');
    expect(H.patch).not.toHaveBeenCalled();
    expect(patches).toHaveLength(0);
    expect(H.sendEmail).not.toHaveBeenCalled();
  });

  it('с верным паролем адрес НЕ уходит в Directus — только письма', async () => {
    const { patches } = stubDirectusFetch();
    stubPasswordCheck('correct-horse');

    const res = await request(makeApp())
      .put('/api/user/profile')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ first_name: 'Дмитрий', email: NEW_EMAIL, current_password: 'correct-horse' });

    expect(res.status).toBe(200);
    expect(res.body.email_change_pending).toBe(true);
    expect(res.body.pending_email).toBe(NEW_EMAIL);
    // Профиль отдаёт СТАРЫЙ адрес: он ещё действует.
    expect(res.body.data.email).toBe(OLD_EMAIL);

    // Ни в PATCH профиля, ни в прямом PATCH к Directus нет поля email.
    expect(H.patch.mock.calls[0][1]).not.toHaveProperty('email');
    expect(patches.every((p) => !('email' in p.body))).toBe(true);
  });

  it('предупреждение уходит на СТАРЫЙ адрес, ссылка — на новый', async () => {
    stubDirectusFetch();
    stubPasswordCheck('correct-horse');

    await request(makeApp())
      .put('/api/user/profile')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ first_name: 'Дмитрий', email: NEW_EMAIL, current_password: 'correct-horse' });

    const recipients = H.sendEmail.mock.calls.map((c: any) => c[0].to);
    expect(recipients).toContain(OLD_EMAIL);
    expect(recipients).toContain(NEW_EMAIL);

    // На старый адрес ссылку подтверждения не шлём — только уведомление.
    const oldMail = H.sendEmail.mock.calls.find((c: any) => c[0].to === OLD_EMAIL)![0] as any;
    expect(oldMail.html).not.toMatch(/confirm-email\?userId=/);
    expect(oldMail.html).toContain(NEW_EMAIL);
  });
});

describe('POST /api/auth/email-change/confirm', () => {
  async function requestChange(app: express.Express) {
    await request(app)
      .put('/api/user/profile')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ first_name: 'Дмитрий', email: NEW_EMAIL, current_password: 'correct-horse' });
    return confirmLinkFromMail();
  }

  it('подтверждение применяет новый адрес в Directus', async () => {
    const { patches } = stubDirectusFetch();
    stubPasswordCheck('correct-horse');
    const app = makeApp();
    const link = await requestChange(app);

    const res = await request(app).post('/api/auth/email-change/confirm').send(link);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(NEW_EMAIL);
    const emailPatch = patches.find((p) => 'email' in p.body);
    expect(emailPatch).toBeTruthy();
    expect(emailPatch!.body.email).toBe(NEW_EMAIL);
  });

  it('повторный переход по той же ссылке отклоняется и не пишет в Directus', async () => {
    const { patches } = stubDirectusFetch();
    stubPasswordCheck('correct-horse');
    const app = makeApp();
    const link = await requestChange(app);

    await request(app).post('/api/auth/email-change/confirm').send(link);
    const afterFirst = patches.length;

    const second = await request(app).post('/api/auth/email-change/confirm').send(link);
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/использована|недействительн/i);
    expect(patches.length).toBe(afterFirst);
  });

  it('подделанный токен отклоняется', async () => {
    const { patches } = stubDirectusFetch();
    stubPasswordCheck('correct-horse');
    const app = makeApp();
    const link = await requestChange(app);

    const res = await request(app)
      .post('/api/auth/email-change/confirm')
      .send({ ...link, token: 'f'.repeat(40) });

    expect(res.status).toBe(400);
    expect(patches.some((p) => 'email' in p.body)).toBe(false);
  });

  it('токен сброса пароля не работает как токен смены почты', async () => {
    // Оба токена подписаны одним ключом. Без разделения доменов подписи
    // валидная ссылка сброса стала бы валидной ссылкой смены почты.
    const { patches } = stubDirectusFetch();
    stubPasswordCheck('correct-horse');
    const app = makeApp();
    const link = await requestChange(app);

    const crypto = await import('crypto');
    const resetStyleToken = crypto
      .createHmac('sha256', ADMIN_TOKEN)
      .update(`${USER_ID}:${link.ts}`)
      .digest('hex')
      .slice(0, 40);

    const res = await request(app)
      .post('/api/auth/email-change/confirm')
      .send({ ...link, token: resetStyleToken });

    expect(res.status).toBe(400);
    expect(patches.some((p) => 'email' in p.body)).toBe(false);
  });

  it('подменённый в ссылке адрес назначения отклоняется', async () => {
    // Токен подписан над конкретным новым адресом: переписать email в URL,
    // оставив чужую подпись, не выйдет.
    const { patches } = stubDirectusFetch();
    stubPasswordCheck('correct-horse');
    const app = makeApp();
    const link = await requestChange(app);

    const res = await request(app)
      .post('/api/auth/email-change/confirm')
      .send({ ...link, email: 'someone-else@evil.example' });

    expect(res.status).toBe(400);
    expect(patches.some((p) => 'email' in p.body)).toBe(false);
  });

  it('просроченная ссылка отклоняется (валидная подпись над старым ts)', async () => {
    // Тут проверяется именно TTL, а не подпись: токен подписан корректно, но
    // над временем часовой давности. Без TTL такая ссылка сработала бы, пока
    // адрес аккаунта не сменили, — а leaked-but-unused ссылка должна
    // протухать по времени.
    const { patches } = stubDirectusFetch();
    stubPasswordCheck('correct-horse');
    const app = makeApp();

    const crypto = await import('crypto');
    const staleTs = Math.floor(Date.now() / 1000) - (EMAIL_CHANGE_TOKEN_TTL_SEC + 60);
    const staleToken = crypto
      .createHmac('sha256', ADMIN_TOKEN)
      .update(`email-change:v1:${USER_ID}:${staleTs}:${OLD_EMAIL.toLowerCase()}:${NEW_EMAIL.toLowerCase()}`)
      .digest('hex')
      .slice(0, 40);

    const res = await request(app)
      .post('/api/auth/email-change/confirm')
      .send({ userId: USER_ID, ts: staleTs, email: NEW_EMAIL, token: staleToken });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/истёк|истек/i);
    expect(patches.some((p) => 'email' in p.body)).toBe(false);
  });

  it('ссылка переживает рестарт процесса', async () => {
    // Ссылки сброса живут в Map в памяти, и на проде это уже выстрелило:
    // ссылку отвергло через 19 минут при TTL 60, потому что контейнер
    // пересобрали. Деплои идут параллельно из нескольких сессий, так что
    // рестарт между запросом смены и переходом по ссылке — норма, а не
    // редкий случай. Подтверждение почты обязано это переживать.
    const { patches } = stubDirectusFetch();
    stubPasswordCheck('correct-horse');
    const link = await requestChange(makeApp());

    // Имитация рестарта: сбрасываем модули и поднимаем роутер заново, так что
    // любое состояние уровня модуля гарантированно потеряно.
    vi.resetModules();
    const fresh = await import('../api/email-change');
    const restartedApp = express();
    restartedApp.use(express.json());
    fresh.registerEmailChangeRoutes(restartedApp);

    const res = await request(restartedApp).post('/api/auth/email-change/confirm').send(link);

    expect(res.status).toBe(200);
    expect(patches.some((p) => p.body.email === NEW_EMAIL)).toBe(true);
  });

  it('после подтверждения уведомление уходит на старый адрес', async () => {
    stubDirectusFetch();
    stubPasswordCheck('correct-horse');
    const app = makeApp();
    const link = await requestChange(app);
    H.sendEmail.mockClear();

    await request(app).post('/api/auth/email-change/confirm').send(link);

    expect(H.sendEmail).toHaveBeenCalledTimes(1);
    const mail = H.sendEmail.mock.calls[0][0] as any;
    expect(mail.to).toBe(OLD_EMAIL);
    expect(mail.subject).toMatch(/изменён/i);
  });

  it('без авторизации профиль не редактируется', async () => {
    stubDirectusFetch();
    const res = await request(makeApp())
      .put('/api/user/profile')
      .send({ first_name: 'Дмитрий', email: NEW_EMAIL, current_password: 'correct-horse' });
    expect(res.status).toBe(401);
  });
});

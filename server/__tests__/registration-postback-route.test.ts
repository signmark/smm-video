/**
 * Registration postback → партнёрский API Omemo/niap.
 *
 * Что закрываем. Сам сервис `server/services/partner-postback.ts` уже покрыт
 * юнит-тестами (`partner-postback.test.ts`, P01–P12): там проверено, что
 * функция умеет сформировать payload и не падает на сетевых ошибках. Но не
 * было ни одного теста на то, что при регистрации пользователя постбек
 * ВООБЩЕ уходит — весь путь `server/api/auth-routes.ts` (ветка `partnerCode`)
 * оставался непокрытым. Ломается он молча: отправка висит на
 * `.catch(() => {})`, ответ регистрации от неё не зависит, в ниап просто
 * перестают приходить регистрации.
 *
 * Поэтому тут смонтирован НАСТОЯЩИЙ роут и НАСТОЯЩИЙ сервис постбека —
 * замокан только транспорт (`axios` в сторону Directus, глобальный `fetch`
 * в сторону ниап). Проверяется исходящий HTTP-запрос целиком: URL, заголовки
 * и тело, — то есть ровно то, что увидит принимающая сторона.
 *
 * Запуск:
 *   npx vitest run server/__tests__/registration-postback-route.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  axiosPost: vi.fn(),
  axiosPatch: vi.fn(),
}));

vi.mock('axios', () => {
  const interceptors = { request: { use: vi.fn() }, response: { use: vi.fn() } };
  const instance: any = {
    get: H.axiosGet,
    post: H.axiosPost,
    patch: H.axiosPatch,
    delete: vi.fn(),
    put: vi.fn(),
    interceptors,
  };
  const create = () => instance;
  return { default: { ...instance, create }, create, interceptors };
});

vi.mock('../directus', () => ({
  directusApi: { get: H.axiosGet, post: H.axiosPost, patch: H.axiosPatch, delete: vi.fn() },
  directusApiManager: {
    request: vi.fn(),
    cacheAuthToken: vi.fn(),
    get: H.axiosGet,
    post: H.axiosPost,
    instance: { interceptors: { response: { use: vi.fn() } } },
  },
  default: { get: H.axiosGet, post: H.axiosPost, patch: H.axiosPatch, delete: vi.fn() },
}));

vi.mock('../services/directus-auth-manager', () => ({
  directusAuthManager: { getAdminAuthToken: vi.fn(async () => 'admin-token') },
}));

vi.mock('../routes-global-api-keys', () => ({ isUserAdmin: vi.fn(async () => false) }));
vi.mock('../services/directus-session-validator', () => ({ validateDirectusSession: vi.fn(async () => 'valid') }));
vi.mock('../services/directus-refresh-service', () => ({ refreshDirectusSession: vi.fn() }));
vi.mock('../services/plan-expiry', () => ({ downgradeExpiredPlan: vi.fn(async () => undefined) }));

// ---------------------------------------------------------------------------
// Окружение. partner-postback читает env на этапе загрузки модуля, поэтому
// переменные выставляются ДО импорта роутов — импорт динамический намеренно,
// статический был бы поднят hoisting'ом выше этих присваиваний.
// ---------------------------------------------------------------------------

const POSTBACK_URL = 'https://niap.test/api/v1/postback';
const POSTBACK_SECRET = 'niap-shared-secret';
const NEW_USER_ID = 'new-user-42';

process.env.OMEMO_POSTBACK_URL = POSTBACK_URL;
process.env.OMEMO_POSTBACK_SECRET = POSTBACK_SECRET;
process.env.DIRECTUS_STATIC_TOKEN = 'static-admin-token';
// DIRECTUS_URL намеренно не трогаем: его задаёт setup.ts в своём beforeAll,
// то есть уже после загрузки этого модуля. Читаем в момент проверки.

const { registerAuthRoutes } = await import('../api/auth-routes');

const app = express();
app.use(express.json());
registerAuthRoutes(app);

const FORM = {
  email: 'user@example.com',
  password: 'sup3r-secret',
  firstName: 'Иван',
  lastName: 'Петров',
};

let fetchMock: ReturnType<typeof vi.fn>;

function registerWith(extra: Record<string, unknown> = {}) {
  return request(app).post('/api/auth/register').send({ ...FORM, ...extra });
}

/** Только запросы в ниап: остальной трафик роута идёт через axios, но пусть фильтр будет явным. */
function postbackCalls(): any[][] {
  return fetchMock.mock.calls.filter((call) => String(call[0]) === POSTBACK_URL);
}

function lastPostbackBody(): Record<string, any> {
  const call = postbackCalls().at(-1);
  if (!call) throw new Error('постбек не отправлялся');
  return JSON.parse(call[1].body);
}

/** Отправка не ожидается роутом (fire-and-forget) — даём микротаскам догореть. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.clearAllMocks();

  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'OK' });
  vi.stubGlobal('fetch', fetchMock);

  H.axiosPost.mockImplementation(async (url: string) => {
    if (url.endsWith('/users')) return { data: { data: { id: NEW_USER_ID } } };
    if (url.endsWith('/auth/login')) {
      return { data: { data: { access_token: 'access-token', refresh_token: 'refresh-token' } } };
    }
    return { data: {} };
  });
  H.axiosPatch.mockResolvedValue({ data: { data: {} } });
  // Чтение юзера из Directus перед постбеком: по умолчанию email как в форме, телеграма нет.
  H.axiosGet.mockResolvedValue({ data: { data: { email: FORM.email } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// R01–R02  постбек уходит / не уходит
// ---------------------------------------------------------------------------

describe('POST /api/auth/register → registration postback', () => {
  it('R01 с partnerCode шлёт ровно один POST в ниап с полным payload и обоими заголовками', async () => {
    const response = await registerWith({ partnerCode: '  partner123  ' });
    await flush();

    expect(response.status).toBe(201);
    expect(postbackCalls()).toHaveLength(1);

    const [url, init] = postbackCalls()[0];
    expect(url).toBe(POSTBACK_URL);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['Authorization']).toBe(`Bearer ${POSTBACK_SECRET}`);
    expect(init.headers['X-Omemo-Token']).toBe(POSTBACK_SECRET);

    expect(JSON.parse(init.body)).toEqual({
      event_type: 'registration',
      partner_code: 'PARTNER123',
      transaction_id: `smmhub-registration-${NEW_USER_ID}`,
      product_id: 5,
      buyer_email: FORM.email,
      source_app: 'smmhub',
      schema_version: '1.0',
    });
  });

  it('R02 без partnerCode постбек не отправляется вообще', async () => {
    const response = await registerWith();
    await flush();

    expect(response.status).toBe(201);
    expect(postbackCalls()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('R03 пустой partnerCode приравнивается к отсутствию', async () => {
    const response = await registerWith({ partnerCode: '   ' });
    await flush();

    expect(response.status).toBe(201);
    expect(postbackCalls()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// R04–R06  постбек не влияет на саму регистрацию
// ---------------------------------------------------------------------------

describe('отказ постбека не ломает регистрацию', () => {
  // Гарантию «отказ ниап не виден пользователю» держат ДВА независимых слоя:
  // try/catch внутри самого `send()` и `.catch(() => {})` в роуте. Проверено
  // мутациями: сломать надо оба сразу, поодиночке каждый избыточен. Тест
  // стережёт саму гарантию, а не конкретный слой — если однажды уберут оба,
  // регистрация начнёт падать из-за недоступности партнёрского API, и это
  // покраснеет здесь.
  it('R04 сетевая ошибка при отправке — регистрация всё равно 201 и с токенами', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED niap.test'));

    const response = await registerWith({ partnerCode: 'PARTNER123' });
    await flush();

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      userId: NEW_USER_ID,
      token: 'access-token',
      refresh_token: 'refresh-token',
    });
    expect(postbackCalls()).toHaveLength(1);
  });

  it('R05 ниап ответил HTTP 500 — регистрация всё равно 201', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'internal error' });

    const response = await registerWith({ partnerCode: 'PARTNER123' });
    await flush();

    expect(response.status).toBe(201);
    expect(response.body.userId).toBe(NEW_USER_ID);
  });

  it('R06 сорвавшийся auto-login не отменяет уже отправленный постбек', async () => {
    H.axiosPost.mockImplementation(async (url: string) => {
      if (url.endsWith('/users')) return { data: { data: { id: NEW_USER_ID } } };
      if (url.endsWith('/auth/login')) throw new Error('login failed');
      return { data: {} };
    });

    const response = await registerWith({ partnerCode: 'PARTNER123' });
    await flush();

    expect(response.status).toBe(201);
    expect(response.body.token).toBeNull();
    expect(postbackCalls()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// R07–R09  данные покупателя и партнёрский код
// ---------------------------------------------------------------------------

describe('данные покупателя в постбеке', () => {
  it('R07 email и telegram_chat_id берутся из свежего чтения Directus', async () => {
    H.axiosGet.mockResolvedValue({
      data: { data: { email: 'changed@example.com', telegram_chat_id: 123456789 } },
    });

    await registerWith({ partnerCode: 'PARTNER123' });
    await flush();

    const body = lastPostbackBody();
    expect(body.buyer_email).toBe('changed@example.com');
    expect(body.buyer_telegram_id).toBe('123456789');
  });

  it('R08 чтение юзера из Directus упало — постбек уходит с email из формы', async () => {
    H.axiosGet.mockRejectedValue(new Error('Directus 503'));

    await registerWith({ partnerCode: 'PARTNER123' });
    await flush();

    const body = lastPostbackBody();
    expect(body.buyer_email).toBe(FORM.email);
    expect(body).not.toHaveProperty('buyer_telegram_id');
  });

  it('R09 партнёрский код сохраняется в Directus нормализованным', async () => {
    await registerWith({ partnerCode: '  partner123  ' });
    await flush();

    const partnerPatch = H.axiosPatch.mock.calls.find(
      ([, payload]: any[]) => payload && 'omemo_partner_code' in payload,
    );
    expect(partnerPatch).toBeDefined();
    expect(partnerPatch![0]).toBe(`${process.env.DIRECTUS_URL}/users/${NEW_USER_ID}`);
    expect(partnerPatch![1].omemo_partner_code).toBe('PARTNER123');
  });

  it('R10 сохранение кода в Directus упало — постбек всё равно уходит', async () => {
    H.axiosPatch.mockImplementation(async (_url: string, payload: any) => {
      if (payload && 'omemo_partner_code' in payload) throw new Error('Directus PATCH 403');
      return { data: { data: {} } };
    });

    const response = await registerWith({ partnerCode: 'PARTNER123' });
    await flush();

    expect(response.status).toBe(201);
    expect(postbackCalls()).toHaveLength(1);
    expect(lastPostbackBody().partner_code).toBe('PARTNER123');
  });
});

// ---------------------------------------------------------------------------
// R11  несостоявшаяся регистрация не порождает постбек
// ---------------------------------------------------------------------------

describe('несостоявшаяся регистрация', () => {
  it('R11 создание юзера в Directus упало — постбек не уходит', async () => {
    H.axiosPost.mockImplementation(async (url: string) => {
      if (url.endsWith('/users')) {
        throw Object.assign(new Error('duplicate'), {
          response: { data: { errors: [{ message: 'Value has to be unique' }] } },
        });
      }
      return { data: {} };
    });

    const response = await registerWith({ partnerCode: 'PARTNER123' });
    await flush();

    expect(response.status).toBe(400);
    expect(postbackCalls()).toHaveLength(0);
  });

  it('R12 невалидная форма (нет пароля) — ни Directus, ни постбек не трогаются', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: FORM.email, firstName: 'Иван', lastName: 'Петров', partnerCode: 'PARTNER123' });
    await flush();

    expect(response.status).toBe(400);
    expect(H.axiosPost).not.toHaveBeenCalled();
    expect(postbackCalls()).toHaveLength(0);
  });
});

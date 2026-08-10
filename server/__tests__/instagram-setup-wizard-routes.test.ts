/**
 * Мастер настройки Instagram: персистентность и граница арендатора (AI-88).
 *
 * ДЕФЕКТ. `server/routes/instagram-setup-wizard.ts` вызывал у `directusApiManager`
 * методы, которых у этого класса нет вообще: `createItem`, `getItems`, `updateItem`,
 * `deleteItems`. У него есть только `request`/`get`/`post`. Каждый такой вызов —
 * `TypeError: ... is not a function`, то есть весь слой сохранения был нерабочим:
 * нельзя ни прочитать учётные данные, ни отключить аккаунт, ни обновить токен.
 * Роутер при этом ЖИВОЙ: `app.use('/api/instagram-setup', ...)` в `server/index.ts`.
 * Сборка молчала, потому что esbuild стирает типы, а тестов на роут не было.
 *
 * ГРАНИЦА АРЕНДАТОРА. Обработчики брали `userId` из URL и не сверяли его с тем, кто
 * пришёл — `req.user` в файле не упоминался. Аутентификация есть (глобальный
 * `createApiAuthGate` на `/api`), авторизации не было. Пока вызовы падали с
 * `TypeError`, это не эксплуатировалось: дефект случайно работал заглушкой.
 * Починить персистентность и не завести границу означало бы превратить мёртвый
 * эндпоинт в рабочий IDOR — любой залогиненный сносил бы чужие учётные данные.
 *
 * Mutation-proof: убрать сверку `req.user.id` с `:userId` в любом хендлере →
 * краснеет тест изоляции, потому что проверяется не только код ответа, но и то,
 * что привилегированная операция НЕ выполнена (мок Directus не вызван).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => ({
  crudList: vi.fn(async () => [] as any[]),
  crudCreate: vi.fn(async () => ({ id: 'new-id' })),
  crudUpdate: vi.fn(async () => ({ id: 'cred-1' })),
  crudDelete: vi.fn(async () => undefined),
  axiosGet: vi.fn(async () => ({ data: { access_token: 'refreshed-token', expires_in: 5184000 } })),
}));

vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    list: H.crudList,
    create: H.crudCreate,
    update: H.crudUpdate,
    delete: H.crudDelete,
  },
}));

vi.mock('axios', () => {
  const interceptors = { request: { use: vi.fn() }, response: { use: vi.fn() } };
  const inst: any = { get: H.axiosGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn(), interceptors };
  return { default: { ...inst, create: () => inst }, create: () => inst, interceptors };
});

vi.mock('../services/global-api-keys', () => ({
  GlobalApiKeysService: class {
    async getApiKey() { return 'key'; }
    async saveApiKey() { return true; }
  },
}));

const OWNER = 'user-owner';
const OTHER = 'user-other';

async function makeApp(actingUserId: string) {
  vi.resetModules();
  const router = (await import('../routes/instagram-setup-wizard')).default;
  const app = express();
  app.use(express.json());
  // Глобальный гейт уже аутентифицировал запрос; сюда доходит известный пользователь.
  app.use((req: any, _res, next) => { req.user = { id: actingUserId }; next(); });
  app.use('/api/instagram-setup', router);
  return app;
}

beforeEach(() => {
  H.crudList.mockReset().mockResolvedValue([]);
  H.crudCreate.mockReset().mockResolvedValue({ id: 'new-id' });
  H.crudUpdate.mockReset().mockResolvedValue({ id: 'cred-1' });
  H.crudDelete.mockReset().mockResolvedValue(undefined);
  H.axiosGet.mockReset().mockResolvedValue({ data: { access_token: 'refreshed-token', expires_in: 5184000 } });
});

describe('AI-88: чтение статуса Instagram', () => {
  it('не отдаёт статус чужого пользователя', async () => {
    const app = await makeApp(OWNER);
    const res = await request(app).get(`/api/instagram-setup/status/${OTHER}`);
    expect(res.status).toBe(403);
  });

  it('отдаёт собственный статус', async () => {
    const app = await makeApp(OWNER);
    const res = await request(app).get(`/api/instagram-setup/status/${OWNER}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('AI-88: отключение аккаунта', () => {
  it('удаляет запись владельца', async () => {
    H.crudList.mockResolvedValue([{ id: 'cred-1', user_id: OWNER }]);
    const app = await makeApp(OWNER);
    const res = await request(app).delete(`/api/instagram-setup/disconnect/${OWNER}`);
    expect(res.status).toBe(200);
    expect(H.crudDelete).toHaveBeenCalledWith('instagram_credentials', 'cred-1', expect.anything());
  });

  it('НЕ удаляет чужую запись и не выполняет привилегированную операцию', async () => {
    H.crudList.mockResolvedValue([{ id: 'cred-other', user_id: OTHER }]);
    const app = await makeApp(OWNER);
    const res = await request(app).delete(`/api/instagram-setup/disconnect/${OTHER}`);
    expect(res.status).toBe(403);
    expect(H.crudDelete).not.toHaveBeenCalled();
  });
});

describe('AI-88: обновление токена', () => {
  it('обновляет токен владельца в хранилище', async () => {
    H.crudList.mockResolvedValue([{
      id: 'cred-1', user_id: OWNER, app_id: 'a', app_secret: 's', user_access_token: 'old',
    }]);
    const app = await makeApp(OWNER);
    const res = await request(app).post(`/api/instagram-setup/refresh-token/${OWNER}`);
    expect(res.status).toBe(200);
    expect(H.crudUpdate).toHaveBeenCalled();
    const [collection, id, patch] = H.crudUpdate.mock.calls[0] as any[];
    expect(collection).toBe('instagram_credentials');
    expect(id).toBe('cred-1');
    expect(patch.user_access_token).toBe('refreshed-token');
  });

  it('НЕ обновляет чужой токен', async () => {
    H.crudList.mockResolvedValue([{ id: 'cred-other', user_id: OTHER, app_id: 'a', app_secret: 's', user_access_token: 'old' }]);
    const app = await makeApp(OWNER);
    const res = await request(app).post(`/api/instagram-setup/refresh-token/${OTHER}`);
    expect(res.status).toBe(403);
    expect(H.crudUpdate).not.toHaveBeenCalled();
    expect(H.axiosGet).not.toHaveBeenCalled();
  });
});

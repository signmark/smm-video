/**
 * Граница арендатора в storage и в /api/publish/{status,cancel}.
 *
 * Находка ревью Codex 29.07.2026 (P1 «cross-tenant отмена публикации через
 * storage fallback»):
 *
 *  - `getCampaignContentById(id, token)` после отказа пользовательского токена
 *    не заканчивал чтение, а перебирал `tokenCache` ВСЕХ пользователей и затем
 *    пробовал анонимный запрос. Поскольку `getAuthToken(любойUserId)` отдаёт
 *    `DIRECTUS_SERVICE_TOKEN`, это означало «403 пользователя → дочитать
 *    служебным токеном»;
 *  - `updateCampaignContent(id, updates)` без токена сам находил владельца и
 *    брал его (= служебный) токен, поэтому `/api/publish/cancel/:id` дописывал
 *    чужую запись после того, как прямой PATCH пользователя получил 403;
 *  - тот же handler клал токен АТАКУЮЩЕГО в общий кеш под `userId` ВЛАДЕЛЬЦА.
 *
 * Инвариант: отказ пользовательского токена окончателен для пользовательского
 * маршрута. Служебный доступ существует только под явным именем
 * (`*Privileged`) и только после подтверждённого ownership.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  managerRequest: vi.fn(),
  cacheAuthToken: vi.fn(),
  assertOwnership: vi.fn(),
  resolveToken: vi.fn(async () => 'SERVICE-TOKEN'),
}));

vi.mock('../lib/directus', () => ({
  directusApi: { get: H.get, patch: H.patch, post: H.post, delete: H.del },
  DIRECTUS_URL: 'http://directus:8055',
}));

vi.mock('../directus', () => ({
  directusApiManager: {
    request: H.managerRequest,
    cacheAuthToken: H.cacheAuthToken,
    instance: { interceptors: { response: { use: vi.fn() } } },
  },
}));

vi.mock('../services/publishing-token', () => ({
  resolvePublishingToken: H.resolveToken,
  getServiceTokenFromEnv: () => 'SERVICE-TOKEN',
}));

vi.mock('../services/content-access', () => ({
  assertContentBelongsToRequester: H.assertOwnership,
}));

vi.mock('../middleware/user-auth', () => ({
  authenticateUser: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-attacker', token: 'ATTACKER-TOKEN', is_smm_admin: false };
    next();
  },
  requireSmmAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../utils/logger', () => {
  const l: any = vi.fn();
  l.info = vi.fn(); l.warn = vi.fn(); l.error = vi.fn(); l.debug = vi.fn();
  return { log: l, default: l, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
});

vi.mock('../utils/content-cache', () => ({
  invalidateContentCache: vi.fn(),
  getCachedContent: vi.fn(),
  setCachedContent: vi.fn(),
}));

const FOREIGN = 'content-of-another-tenant';

const FOREIGN_ITEM = () => ({
  id: FOREIGN,
  user_id: 'user-victim',
  campaign_id: 'campaign-victim',
  status: 'scheduled',
  created_at: new Date().toISOString(),
  social_platforms: { telegram: { status: 'scheduled' } },
});

/**
 * Directus отвечает 403 на пользовательский токен и 200 на служебный —
 * ровно то, что видит атакующий с чужим UUID. Коллекционный GET отдаёт массив,
 * как настоящий Directus: именно по `.length` старая лесенка решала, что
 * владелец найден, и переходила к чтению полной записи.
 */
const forbiddenForUserToken = () => {
  H.get.mockImplementation(async (url: string, config: any) => {
    const auth = config?.headers?.Authorization || '';
    if (auth !== 'Bearer SERVICE-TOKEN') {
      const err: any = new Error('Request failed with status code 403');
      err.response = { status: 403, data: {} };
      throw err;
    }
    const isCollection = url === '/items/campaign_content';
    return { data: { data: isCollection ? [FOREIGN_ITEM()] : FOREIGN_ITEM() } };
  });
};

/**
 * Прогревает приватный `tokenCache` в storage: именно его перебирала третья
 * попытка старой лесенки. С холодным кешем дыра не воспроизводится, поэтому
 * тест без прогрева ничего бы не стерёг.
 */
const warmTokenCache = async (userId: string) => {
  const { storage } = await import('../storage');
  process.env.DIRECTUS_SERVICE_TOKEN = 'SERVICE-TOKEN';
  const saved = H.get.getMockImplementation();
  H.get.mockResolvedValue({ data: { data: [] } });
  await storage.getContentSources(userId);
  if (saved) H.get.mockImplementation(saved);
  H.get.mockClear();
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DIRECTUS_SERVICE_TOKEN = 'SERVICE-TOKEN';
  H.resolveToken.mockResolvedValue('SERVICE-TOKEN');
  H.patch.mockResolvedValue({ status: 200, data: { data: { id: FOREIGN, created_at: new Date().toISOString() } } });
  H.managerRequest.mockImplementation(async (cfg: any) => {
    const auth = cfg?.headers?.Authorization || '';
    if (auth === 'Bearer SERVICE-TOKEN') return { data: { data: { id: FOREIGN } } };
    const err: any = new Error('Request failed with status code 403');
    err.response = { status: 403, data: {} };
    throw err;
  });
  H.assertOwnership.mockImplementation(async (_id: string, _req: any, res: any) => {
    res.status(404).json({ success: false, error: 'Контент не найден' });
    return false;
  });
});

describe('storage: пользовательское чтение не эскалирует', () => {
  it('403 пользовательского токена окончателен — служебный токен не пробуется', async () => {
    const { storage } = await import('../storage');
    await warmTokenCache('user-victim');
    forbiddenForUserToken();

    const result = await storage.getCampaignContentById(FOREIGN, 'ATTACKER-TOKEN');

    expect(result).toBeUndefined();
    // Ровно одна попытка — тем токеном, который передали.
    expect(H.get).toHaveBeenCalledTimes(1);
    const usedAuth = H.get.mock.calls.map((c: any[]) => c[1]?.headers?.Authorization);
    expect(usedAuth).toEqual(['Bearer ATTACKER-TOKEN']);
    // Ни служебного токена, ни анонимного запроса.
    expect(usedAuth).not.toContain('Bearer SERVICE-TOKEN');
    expect(usedAuth).not.toContain(undefined);
  });

  it('чтение без токена не превращается в служебное', async () => {
    const { storage } = await import('../storage');
    forbiddenForUserToken();

    const result = await storage.getCampaignContentById(FOREIGN);

    expect(result).toBeUndefined();
    expect(H.get).not.toHaveBeenCalled();
  });

  it('служебное чтение доступно только под явным именем', async () => {
    const { storage } = await import('../storage');
    forbiddenForUserToken();

    const result = await storage.getCampaignContentByIdPrivileged(FOREIGN);

    expect(result?.id).toBe(FOREIGN);
    expect(H.get.mock.calls[0][1]?.headers?.Authorization).toBe('Bearer SERVICE-TOKEN');
  });

  it('своё содержимое читается как раньше', async () => {
    const { storage } = await import('../storage');
    H.get.mockResolvedValue({
      data: { data: { id: 'own-1', user_id: 'user-attacker', campaign_id: 'c-own', status: 'scheduled', created_at: new Date().toISOString() } },
    });

    const result = await storage.getCampaignContentById('own-1', 'ATTACKER-TOKEN');
    expect(result?.id).toBe('own-1');
  });
});

describe('storage: пользовательская запись требует токен', () => {
  it('updateCampaignContent без токена бросает, а не берёт служебный', async () => {
    const { storage } = await import('../storage');
    forbiddenForUserToken();

    await expect(
      storage.updateCampaignContent(FOREIGN, { status: 'draft' } as any),
    ).rejects.toThrow(/requires an auth token/);

    expect(H.patch).not.toHaveBeenCalled();
  });

  it('служебная запись существует под явным именем', async () => {
    const { storage } = await import('../storage');
    await storage.updateCampaignContentPrivileged(FOREIGN, { status: 'draft' } as any);

    expect(H.patch).toHaveBeenCalledTimes(1);
    expect(H.patch.mock.calls[0][2]?.headers?.Authorization).toBe('Bearer SERVICE-TOKEN');
  });
});

describe('/api/publish/{status,cancel} — чужая запись', () => {
  const makeApp = async () => {
    const { registerPublishingRoutes } = await import('../api/publishing-routes');
    const app = express();
    app.use(express.json());
    registerPublishingRoutes(app as any);
    return app;
  };

  it('cancel чужого contentId → 404, чужая запись не тронута (кеш токенов прогрет)', async () => {
    await warmTokenCache('user-victim');
    forbiddenForUserToken();
    const app = await makeApp();

    const res = await request(app).post(`/api/publish/cancel/${FOREIGN}`).send({});

    expect(res.status).toBe(404);
    // Ни прямой PATCH, ни служебный PATCH через storage.
    expect(H.patch).not.toHaveBeenCalled();
    const patchCalls = H.managerRequest.mock.calls.filter((c: any[]) => c[0]?.method === 'patch');
    expect(patchCalls).toHaveLength(0);
    // Токен атакующего не осел в кеше под чужим userId.
    expect(H.cacheAuthToken).not.toHaveBeenCalled();
  });

  it('status чужого contentId → 404, статус и платформы не раскрыты', async () => {
    forbiddenForUserToken();
    const app = await makeApp();

    const res = await request(app).get(`/api/publish/status/${FOREIGN}`);

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('scheduled');
    expect(JSON.stringify(res.body)).not.toContain('telegram');
    expect(H.get).not.toHaveBeenCalled();
  });

  it('свой content по-прежнему отменяется', async () => {
    H.assertOwnership.mockResolvedValue(true);
    H.get.mockResolvedValue({
      data: { data: { id: 'own-1', user_id: 'user-attacker', campaign_id: 'c-own', status: 'scheduled', created_at: new Date().toISOString(), social_platforms: { telegram: { status: 'scheduled' } } } },
    });
    H.managerRequest.mockResolvedValue({ data: { data: { id: 'own-1' } } });
    const app = await makeApp();

    const res = await request(app).post('/api/publish/cancel/own-1').send({});

    expect(res.status).toBe(200);
    // Запись менялась ТОЛЬКО токеном пользователя.
    const authsUsed = [
      ...H.managerRequest.mock.calls.map((c: any[]) => c[0]?.headers?.Authorization),
      ...H.patch.mock.calls.map((c: any[]) => c[2]?.headers?.Authorization),
    ].filter(Boolean);
    expect(authsUsed.length).toBeGreaterThan(0);
    expect(authsUsed.every((a: string) => a === 'Bearer ATTACKER-TOKEN')).toBe(true);
  });
});

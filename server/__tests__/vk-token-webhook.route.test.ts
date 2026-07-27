/**
 * Route-level защита публичного VK token-webhook.
 *
 * POST /api/vk/token-webhook/:campaignId/submit/:secret публичный (needanapp без
 * Bearer), но обязан предъявить постоянный per-campaign секрет в сегменте пути.
 * Секрет сверяется с хранимым в кампании ДО любого admin PATCH. Status-endpoint
 * требует сессию + доступ к кампании. prepare (владелец) генерит/переиспользует
 * стабильный секрет.
 *
 * Гоняются РЕАЛЬНЫЙ vkOAuthRouter, РЕАЛЬНЫЙ secret-хелпер и РЕАЛЬНЫЙ
 * authenticateUser; на границах мокаются axios (directus) и campaign-access.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const STORED_SECRET = 'stored-webhook-secret-abc123';

const H = vi.hoisted(() => {
  class CampaignAccessError extends Error {
    constructor(public readonly status: 404 | 503, public readonly code: string) { super(code); }
  }
  return {
    CampaignAccessError,
    authorizeCampaignAccess: vi.fn(async () => ({ id: 'camp-1' })),
    axiosGet: vi.fn(),
    axiosPatch: vi.fn(async () => ({ data: { data: {} } })),
    axiosPost: vi.fn(async () => ({ data: {} })),
  };
});
vi.mock('../services/campaign-access', () => ({ authorizeCampaignAccess: H.authorizeCampaignAccess, CampaignAccessError: H.CampaignAccessError }));
vi.mock('axios', () => {
  const instance = { get: H.axiosGet, post: H.axiosPost, patch: H.axiosPatch, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
  return { default: { get: H.axiosGet, post: H.axiosPost, patch: H.axiosPatch, create: () => instance }, create: () => instance };
});
vi.mock('../utils/logger', () => {
  const log: any = vi.fn();
  log.debug = vi.fn(); log.info = vi.fn(); log.warn = vi.fn(); log.error = vi.fn();
  return { log, default: log };
});

import vkOAuthRouter from '../routes/vk-oauth';

const app = express();
app.use(express.json());
app.use('/api', vkOAuthRouter);

const CAMPAIGN = 'camp-1';
const createMockToken = (payload: object) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${body}.signature`;
};
const TOKEN = createMockToken({ id: 'user-1', email: 'u@x.io' });

// GET кампании возвращает vk с хранимым секретом (+ поля для status).
const campaignWithSecret = (secret: string | undefined) => ({
  data: { data: { social_media_settings: { vk: {
    ...(secret ? { webhookSecret: secret } : {}),
    token: 't', tokenReceivedAt: new Date().toISOString(), serverRefreshedAt: new Date().toISOString(),
  } } } },
});

beforeEach(() => {
  vi.clearAllMocks();
  H.authorizeCampaignAccess.mockResolvedValue({ id: CAMPAIGN });
  H.axiosGet.mockResolvedValue(campaignWithSecret(STORED_SECRET));
  H.axiosPatch.mockResolvedValue({ data: { data: {} } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ data: { id: 'user-1', is_smm_admin: false } }),
    text: async () => '', clone() { return this; },
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('VK token-webhook POST: постоянный per-campaign секрет', () => {
  it('неверный секрет → 403, PATCH не вызван', async () => {
    const res = await request(app).post(`/api/vk/token-webhook/${CAMPAIGN}/submit/wrong-secret`).send({ access_token: 'tok' });
    expect(res.status).toBe(403);
    expect(H.axiosPatch).not.toHaveBeenCalled();
  });

  it('в кампании нет секрета → 403, PATCH не вызван', async () => {
    H.axiosGet.mockResolvedValue(campaignWithSecret(undefined));
    const res = await request(app).post(`/api/vk/token-webhook/${CAMPAIGN}/submit/${STORED_SECRET}`).send({ access_token: 'tok' });
    expect(res.status).toBe(403);
    expect(H.axiosPatch).not.toHaveBeenCalled();
  });

  it('верный секрет → сохранение (PATCH вызван, 200)', async () => {
    const res = await request(app).post(`/api/vk/token-webhook/${CAMPAIGN}/submit/${STORED_SECRET}`).send({ access_token: 'tok' });
    expect(res.status).toBe(200);
    expect(H.axiosPatch).toHaveBeenCalled();
  });

  it('верный секрет переиспользуется (реконнект): второй POST снова 200', async () => {
    const first = await request(app).post(`/api/vk/token-webhook/${CAMPAIGN}/submit/${STORED_SECRET}`).send({ access_token: 'tok' });
    expect(first.status).toBe(200);
    const second = await request(app).post(`/api/vk/token-webhook/${CAMPAIGN}/submit/${STORED_SECRET}`).send({ access_token: 'tok2' });
    expect(second.status).toBe(200);
  });

  it('верный секрет, но без access_token → 400, PATCH не вызван', async () => {
    const res = await request(app).post(`/api/vk/token-webhook/${CAMPAIGN}/submit/${STORED_SECRET}`).send({});
    expect(res.status).toBe(400);
    expect(H.axiosPatch).not.toHaveBeenCalled();
  });

  it('Directus недоступен при проверке (нет response) → 503, PATCH не вызван', async () => {
    H.axiosGet.mockRejectedValue(new Error('ECONNREFUSED')); // без err.response
    const res = await request(app).post(`/api/vk/token-webhook/${CAMPAIGN}/submit/${STORED_SECRET}`).send({ access_token: 'tok' });
    expect(res.status).toBe(503);
    expect(H.axiosPatch).not.toHaveBeenCalled();
  });

  it('кампания не найдена (404 от Directus) → 403, существование не раскрываем', async () => {
    const err: any = new Error('not found'); err.response = { status: 404 };
    H.axiosGet.mockRejectedValue(err);
    const res = await request(app).post(`/api/vk/token-webhook/${CAMPAIGN}/submit/${STORED_SECRET}`).send({ access_token: 'tok' });
    expect(res.status).toBe(403);
    expect(H.axiosPatch).not.toHaveBeenCalled();
  });
});

describe('VK token-webhook prepare: владелец получает стабильный секрет', () => {
  it('без auth → 401, admin GET не вызван', async () => {
    const res = await request(app).post(`/api/vk/token-webhook/${CAMPAIGN}/prepare`);
    expect(res.status).toBe(401);
    expect(H.axiosGet).not.toHaveBeenCalled();
  });

  it('владелец, секрет уже есть → URL с ним, без нового PATCH', async () => {
    const res = await request(app).post(`/api/vk/token-webhook/${CAMPAIGN}/prepare`).set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.webhookUrl).toContain(`/submit/${STORED_SECRET}`);
    expect(H.axiosPatch).not.toHaveBeenCalled();
  });

  it('владелец, секрета нет → генерируем и сохраняем (PATCH), URL содержит секрет', async () => {
    H.axiosGet.mockResolvedValue(campaignWithSecret(undefined));
    const res = await request(app).post(`/api/vk/token-webhook/${CAMPAIGN}/prepare`).set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(H.axiosPatch).toHaveBeenCalledTimes(1);
    const patchedVk = H.axiosPatch.mock.calls[0][1].social_media_settings.vk;
    expect(patchedVk.webhookSecret).toBeTruthy();
    expect(res.body.webhookUrl).toContain(`/submit/${patchedVk.webhookSecret}`);
  });
});

describe('VK token-webhook status: сессия + доступ к кампании', () => {
  it('без auth → 401, чужой контент не читаем', async () => {
    const res = await request(app).get(`/api/vk/token-webhook/${CAMPAIGN}/status`);
    expect(res.status).toBe(401);
    expect(H.axiosGet).not.toHaveBeenCalled();
  });

  it('чужой пользователь (нет доступа) → 404, admin GET не вызван', async () => {
    H.authorizeCampaignAccess.mockRejectedValue(new H.CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND'));
    const res = await request(app).get(`/api/vk/token-webhook/${CAMPAIGN}/status`).set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(404);
    expect(H.axiosGet).not.toHaveBeenCalled();
  });

  it('Directus недоступен → 503, не 404 и не fail-open', async () => {
    H.authorizeCampaignAccess.mockRejectedValue(new H.CampaignAccessError(503, 'CAMPAIGN_ACCESS_UNAVAILABLE'));
    const res = await request(app).get(`/api/vk/token-webhook/${CAMPAIGN}/status`).set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(503);
  });

  it('владелец → 200', async () => {
    const res = await request(app).get(`/api/vk/token-webhook/${CAMPAIGN}/status`).set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
  });
});

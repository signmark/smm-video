/**
 * Route-level защита публичного VK token-webhook.
 *
 * POST /api/vk/token-webhook/:campaignId публичный (needanapp без Bearer), но
 * обязан предъявить одноразовый state, привязанный к кампании. Без него — никаких
 * admin GET/PATCH. Status-endpoint теперь требует сессию + доступ к кампании.
 *
 * Гоняются РЕАЛЬНЫЙ vkOAuthRouter, РЕАЛЬНОЕ state-хранилище и РЕАЛЬНЫЙ
 * authenticateUser; на границах мокаются axios (directus) и campaign-access.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => {
  class CampaignAccessError extends Error {
    constructor(public readonly status: 404 | 503, public readonly code: string) { super(code); }
  }
  return {
    CampaignAccessError,
    authorizeCampaignAccess: vi.fn(async () => ({ id: 'camp-1' })),
    axiosGet: vi.fn(async () => ({ data: { data: { social_media_settings: { vk: { token: 't', tokenReceivedAt: new Date().toISOString(), serverRefreshedAt: new Date().toISOString() } } } } })),
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
import { createVkWebhookState, __resetVkWebhookStateStore } from '../services/vk-webhook-state';

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

beforeEach(() => {
  vi.clearAllMocks();
  __resetVkWebhookStateStore();
  H.authorizeCampaignAccess.mockResolvedValue({ id: CAMPAIGN });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ data: { id: 'user-1', is_smm_admin: false } }),
    text: async () => '', clone() { return this; },
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('VK token-webhook POST: одноразовый state', () => {
  it('без state → 401, PATCH не вызван', async () => {
    const res = await request(app).post(`/api/vk/token-webhook/${CAMPAIGN}`).send({ access_token: 'tok' });
    expect(res.status).toBe(401);
    expect(H.axiosPatch).not.toHaveBeenCalled();
  });

  it('поддельный state → 401, PATCH не вызван', async () => {
    const res = await request(app).post(`/api/vk/token-webhook/${CAMPAIGN}?state=forged`).send({ access_token: 'tok' });
    expect(res.status).toBe(401);
    expect(H.axiosPatch).not.toHaveBeenCalled();
  });

  it('валидный state + совпадающий campaignId → сохранение (PATCH вызван)', async () => {
    const state = createVkWebhookState(CAMPAIGN, 'user-1');
    const res = await request(app).post(`/api/vk/token-webhook/${CAMPAIGN}?state=${state}`).send({ access_token: 'tok' });
    expect(res.status).toBe(200);
    expect(H.axiosPatch).toHaveBeenCalled();
  });

  it('state другой кампании → 403, PATCH не вызван', async () => {
    const state = createVkWebhookState('other-campaign', 'user-1');
    const res = await request(app).post(`/api/vk/token-webhook/${CAMPAIGN}?state=${state}`).send({ access_token: 'tok' });
    expect(res.status).toBe(403);
    expect(H.axiosPatch).not.toHaveBeenCalled();
  });

  it('replay использованного state → 403', async () => {
    const state = createVkWebhookState(CAMPAIGN, 'user-1');
    const first = await request(app).post(`/api/vk/token-webhook/${CAMPAIGN}?state=${state}`).send({ access_token: 'tok' });
    expect(first.status).toBe(200);
    const replay = await request(app).post(`/api/vk/token-webhook/${CAMPAIGN}?state=${state}`).send({ access_token: 'tok' });
    expect(replay.status).toBe(403);
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

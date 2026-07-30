/**
 * VK ID OAuth2: state одноразовый, ограничен по времени и привязан к владельцу.
 *
 * Находка ревью 2026-07-29 (P1): /api/vk/oauth2/start принимал произвольный
 * campaign_id без проверки владельца, а публичный callback патчил кампанию
 * служебным токеном. Авторизованный пользователь начинал OAuth для ЧУЖОЙ
 * кампании, проходил его со своим VK и перезаписывал VK-настройки жертвы.
 *
 * Гоняются РЕАЛЬНЫЙ vkOAuthRouter и РЕАЛЬНЫЙ authenticateUser; на границах
 * мокаются axios (Directus + id.vk.com) и campaign-access.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => {
  class CampaignAccessError extends Error {
    constructor(public readonly status: 404 | 503, public readonly code: string) { super(code); }
  }
  return {
    CampaignAccessError,
    authorizeCampaignAccess: vi.fn(async () => ({ id: 'camp-own' })),
    axiosGet: vi.fn(),
    axiosPatch: vi.fn(async () => ({ data: { data: {} } })),
    axiosPost: vi.fn(async () => ({ data: {} })),
  };
});
vi.mock('../services/admin-token-manager', () => ({
  adminTokenManager: { getAdminToken: vi.fn(async () => 'test-service-token'), clearToken: vi.fn() },
}));
vi.mock('../services/campaign-access', () => ({
  authorizeCampaignAccess: H.authorizeCampaignAccess,
  CampaignAccessError: H.CampaignAccessError,
}));
vi.mock('axios', () => {
  const instance = {
    get: H.axiosGet, post: H.axiosPost, patch: H.axiosPatch,
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  };
  return {
    default: { get: H.axiosGet, post: H.axiosPost, patch: H.axiosPatch, create: () => instance },
    create: () => instance,
  };
});
vi.mock('../utils/logger', () => {
  const log: any = vi.fn();
  log.debug = vi.fn(); log.info = vi.fn(); log.warn = vi.fn(); log.error = vi.fn();
  return { log, default: log };
});

const OLD_ENV = { ...process.env };
process.env.APP_PUBLIC_URL = 'https://smm.example.test';
process.env.DIRECTUS_URL = 'https://directus.test';
process.env.DIRECTUS_STATIC_TOKEN = 'admin-token-test';

import vkOAuthRouter from '../routes/vk-oauth';

const app = express();
app.use(express.json());
app.use('/api', vkOAuthRouter);

const OWN = 'camp-own';
const FOREIGN = 'camp-foreign';

const createMockToken = (payload: object) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${body}.signature`;
};
const TOKEN = createMockToken({ id: 'user-1', email: 'u@x.io' });

/** Кампания в Directus: владелец и настройки. */
const campaignOwnedBy = (userId: string) => ({
  data: { data: { id: OWN, user_id: userId, social_media_settings: {} } },
});

/** Успешный обмен кода в VK ID. */
const vkTokens = () => ({
  data: { access_token: 'vk-access', refresh_token: 'vk-refresh', expires_in: 3600, device_id: 'dev-1' },
});

const startOAuth = (campaignId: string, host?: string) => {
  let r = request(app).get(`/api/vk/oauth2/start?campaign_id=${campaignId}`).set('Authorization', `Bearer ${TOKEN}`);
  if (host) r = r.set('Host', host);
  return r;
};

/** state из Location редиректа на id.vk.com. */
function stateOf(startRes: request.Response): string {
  const url = new URL(startRes.headers.location);
  return url.searchParams.get('state') || '';
}

const callback = (state: string) =>
  request(app).get(`/api/vk/oauth2/callback?code=vk-code&state=${state}&device_id=dev-1`);

beforeEach(() => {
  vi.clearAllMocks();
  // Доступ есть только к OWN и только у user-1.
  H.authorizeCampaignAccess.mockImplementation(async (campaignId: any, userId: any) => {
    if (String(campaignId) === OWN && String(userId) === 'user-1') return { id: OWN };
    throw new H.CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');
  });
  H.axiosGet.mockResolvedValue(campaignOwnedBy('user-1'));
  H.axiosPost.mockResolvedValue(vkTokens());
  H.axiosPatch.mockResolvedValue({ data: { data: {} } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ data: { id: 'user-1', is_smm_admin: false } }),
    text: async () => '', clone() { return this; },
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(() => { process.env = OLD_ENV; });

describe('GET /api/vk/oauth2/start — владение кампанией до редиректа', () => {
  it('чужая кампания → 404, редиректа в VK нет', async () => {
    const res = await startOAuth(FOREIGN);
    expect(res.status).toBe(404);
    expect(res.headers.location).toBeUndefined();
  });

  it('без сессии → 401', async () => {
    const res = await request(app).get(`/api/vk/oauth2/start?campaign_id=${OWN}`);
    expect(res.status).toBe(401);
  });

  it('Host: attacker.example не меняет redirect_uri', async () => {
    const res = await startOAuth(OWN, 'attacker.example');
    expect(res.status).toBe(302);
    const url = new URL(res.headers.location);
    expect(url.searchParams.get('redirect_uri')).toBe('https://smm.example.test/api/vk/oauth2/callback');
  });

  it('своя кампания → 302 на id.vk.com с PKCE и state', async () => {
    const res = await startOAuth(OWN);
    expect(res.status).toBe(302);
    const url = new URL(res.headers.location);
    expect(url.hostname).toBe('id.vk.com');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
  });
});

describe('GET /api/vk/oauth2/callback — одноразовый state и повторная проверка владельца', () => {
  it('полный happy-path: своя кампания, токены сохраняются', async () => {
    const state = stateOf(await startOAuth(OWN));
    const res = await callback(state);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('vk_oauth2=success');
    expect(H.axiosPatch).toHaveBeenCalledTimes(1);
    const [patchUrl, patchBody] = H.axiosPatch.mock.calls[0];
    expect(String(patchUrl)).toContain(`/items/user_campaigns/${OWN}`);
    expect(patchBody.social_media_settings.vk.accessToken).toBe('vk-access');
  });

  it('владелец кампании сменился после старта → PATCH не выполняется', async () => {
    const state = stateOf(await startOAuth(OWN));
    // Между start и callback кампания перешла другому владельцу.
    H.axiosGet.mockResolvedValue(campaignOwnedBy('user-2'));

    const res = await callback(state);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('vk_error=campaign_access_denied');
    expect(H.axiosPatch).not.toHaveBeenCalled();
  });

  it('подменённый (неизвестный) state → invalid_state, обмен кода не выполняется', async () => {
    const res = await callback('forged-state-value');

    expect(res.headers.location).toContain('vk_error=invalid_state');
    expect(H.axiosPost).not.toHaveBeenCalled();
    expect(H.axiosPatch).not.toHaveBeenCalled();
  });

  it('повторный callback с тем же state → invalid_state, второго PATCH нет', async () => {
    const state = stateOf(await startOAuth(OWN));

    const first = await callback(state);
    expect(first.headers.location).toContain('vk_oauth2=success');

    const replay = await callback(state);
    expect(replay.headers.location).toContain('vk_error=invalid_state');
    expect(H.axiosPatch).toHaveBeenCalledTimes(1);
  });

  it('просроченный state (11 минут) → invalid_state, PATCH не выполняется', async () => {
    const state = stateOf(await startOAuth(OWN));

    const realNow = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(realNow + 11 * 60 * 1000);
    const res = await callback(state);
    nowSpy.mockRestore();

    expect(res.headers.location).toContain('vk_error=invalid_state');
    expect(H.axiosPatch).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { registerRoutes } from '../routes';
import { directusApi } from '../directus';
import {
  validateTelegramConnection,
  validateTelegramToken,
  validateVkToken,
} from '../services/social-api-validator';

/**
 * SM-46: исполнимый route-level тест реального POST /api/campaigns/:id/social/check.
 * При 0 настроенных площадок ответ должен быть нейтральным
 * { success:false, message:'Нет настроенных площадок для проверки', results:{} }
 * и НИ одного network probe. all-healthy/failure сценарии не изменяются.
 */

vi.mock('../directus', () => ({
  directusApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  directusApiManager: {
    request: vi.fn(),
    cacheAuthToken: vi.fn(),
    instance: { interceptors: { response: { use: vi.fn() } } },
  },
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../services/social-api-validator', () => ({
  validateTelegramConnection: vi.fn(),
  validateTelegramToken: vi.fn(),
  validateVkToken: vi.fn(),
  validateInstagramToken: vi.fn(),
  validateFacebookToken: vi.fn(),
  validateYoutubeApiKey: vi.fn(),
}));

const OWNER_ID = 'owner-11111111-1111-1111-1111-111111111111';
const CAMPAIGN_ID = 'campaign-33333333-3333-3333-3333-333333333333';

process.env.DIRECTUS_URL = 'https://directus.test';
process.env.DIRECTUS_STATIC_TOKEN = 'static-admin-token-for-tests';

const app = express();
app.use(express.json());
// @ts-ignore — registerRoutes типизирован под полное приложение
registerRoutes(app);

const createMockToken = (payload: object) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${body}.signature`;
};

/** Аутентификация (authenticateUser) через стаб fetch. */
const stubAuthFetch = () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { id: OWNER_ID, is_smm_admin: false } }),
    text: async () => '',
    clone() { return this; },
  }));
};

/** Кампания с заданными social_media_settings (для получения настроек площадок). */
const stubCampaign = (sms: Record<string, any>) => {
  (directusApi.get as any).mockResolvedValue({
    data: { data: { id: CAMPAIGN_ID, user_id: OWNER_ID, social_media_settings: sms } },
  });
};

const auth = { Authorization: `Bearer ${createMockToken({ id: OWNER_ID, email: 'owner@example.com' })}` };

beforeEach(() => {
  vi.clearAllMocks();
  stubAuthFetch();
  stubCampaign({});
  (validateTelegramToken as any).mockResolvedValue({ isValid: true, message: '' });
  (validateTelegramConnection as any).mockResolvedValue({ isValid: true, message: '' });
  (validateVkToken as any).mockResolvedValue({ isValid: true, message: '' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SM-46: real route POST /api/campaigns/:id/social/check', () => {
  it('0 настроенных площадок => { success:false, message:"Нет настроенных площадок для проверки", results:{} } и ноль probes', async () => {
    const res = await request(app)
      .post(`/api/campaigns/${CAMPAIGN_ID}/social/check`)
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Нет настроенных площадок для проверки');
    expect(res.body.results).toEqual({});
    // Ни одного network probe.
    expect(validateTelegramToken).not.toHaveBeenCalled();
    expect(validateVkToken).not.toHaveBeenCalled();
  });

  it('≥1 площадка / все healthy => прежний success (каждая площадка проверена)', async () => {
    stubCampaign({ telegram: { token: 'tg', chatId: '@chan' }, vk: { token: 'vk' } });

    const res = await request(app)
      .post(`/api/campaigns/${CAMPAIGN_ID}/social/check`)
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.results.telegram.ok).toBe(true);
    expect(res.body.results.vk.ok).toBe(true);
    // telegram с chatId идёт через validateTelegramConnection, vk через validateVkToken.
    expect(validateTelegramConnection).toHaveBeenCalledTimes(1);
    expect(validateTelegramToken).not.toHaveBeenCalled();
    expect(validateVkToken).toHaveBeenCalledTimes(1);
  });

  it('одна failure => прежний failure (reason сохраняется)', async () => {
    stubCampaign({ telegram: { token: 'tg', chatId: '@chan' }, vk: { token: 'vk' } });
    (validateTelegramToken as any).mockResolvedValue({ isValid: true, message: '' });
    (validateVkToken as any).mockResolvedValue({ isValid: false, message: 'Бот выгнан из канала' });

    const res = await request(app)
      .post(`/api/campaigns/${CAMPAIGN_ID}/social/check`)
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true); // частичный успех — как было до SM-46
    expect(res.body.results.telegram.ok).toBe(true);
    expect(res.body.results.vk.ok).toBe(false);
    expect(res.body.results.vk.reason).toBe('Бот выгнан из канала');
  });
});

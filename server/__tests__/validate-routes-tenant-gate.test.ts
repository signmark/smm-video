import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { registerRoutes } from '../routes';
import { validateVkToken } from '../services/social-api-validator';
import { markVkAuthExpired } from '../services/vk-token-refresh';
import { directusApi } from '../directus';

// Регрессия на консолидацию /api/validate/*.
//
// До неё те же пути регистрировались дважды: в registerValidationRoutes (без
// authenticateUser) и в registerSocialRoutes (с ним). Express завершает запрос
// в первом совпавшем handler, поэтому побеждал незащищённый, а authenticated
// вместе с markVkAuthExpired был недостижим. Тест держит оба инварианта:
// единственный handler аутентифицирован и привязан к tenant'у, а его побочный
// эффект действительно исполняется.
//
// См. docs/prompts/claude-codex-daytime-review-followup-2026-07-26.md.

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
  validateTelegramToken: vi.fn(),
  validateVkToken: vi.fn(),
  validateInstagramToken: vi.fn(),
  validateFacebookToken: vi.fn(),
  validateYoutubeApiKey: vi.fn(),
}));

vi.mock('../services/vk-token-refresh', () => ({
  markVkAuthExpired: vi.fn(),
}));

const OWNER_ID = 'owner-11111111-1111-1111-1111-111111111111';
const INTRUDER_ID = 'intruder-22222222-2222-2222-2222-222222222222';
const CAMPAIGN_ID = 'campaign-33333333-3333-3333-3333-333333333333';
const CAMPAIGN_VK_TOKEN = 'vk1.campaign-secret-token';

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

/** Стаб обоих апстрим-вызовов authenticateUser: валидация сессии + is_smm_admin. */
const stubAuthFetch = () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { id: 'stub', is_smm_admin: false } }),
    text: async () => '',
    clone() { return this; },
  }));
};

/** Кампания принадлежит OWNER_ID и хранит VK-токен в social_media_settings. */
const stubCampaignOwnedByOwner = () => {
  (directusApi.get as any).mockResolvedValue({
    data: {
      data: {
        id: CAMPAIGN_ID,
        user_id: OWNER_ID,
        user_created: OWNER_ID,
        social_media_settings: { vk: { token: CAMPAIGN_VK_TOKEN, groupId: '777' } },
      },
    },
  });
};

describe('Консолидация /api/validate/*: аутентификация и tenant binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubCampaignOwnedByOwner();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('POST /api/validate/vk', () => {
    it('401 для анонимного запроса', async () => {
      const response = await request(app)
        .post('/api/validate/vk')
        .send({ campaignId: CAMPAIGN_ID });

      expect(response.status).toBe(401);
      expect(validateVkToken).not.toHaveBeenCalled();
    });

    it('владелец получает 200, токен берётся из кампании и не возвращается наружу', async () => {
      stubAuthFetch();
      (validateVkToken as any).mockResolvedValue({
        isValid: true,
        message: 'Токен валиден',
        details: { response: [{ id: 1, name: 'Группа владельца' }] },
      });

      const response = await request(app)
        .post('/api/validate/vk')
        .set('Authorization', `Bearer ${createMockToken({ id: OWNER_ID, email: 'owner@example.com' })}`)
        .send({ campaignId: CAMPAIGN_ID });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(validateVkToken).toHaveBeenCalledWith(CAMPAIGN_VK_TOKEN, '777');
      expect(JSON.stringify(response.body)).not.toContain(CAMPAIGN_VK_TOKEN);
    });

    it('чужой tenant получает 404 и не видит ни токена, ни VK-деталей кампании', async () => {
      stubAuthFetch();

      const response = await request(app)
        .post('/api/validate/vk')
        .set('Authorization', `Bearer ${createMockToken({ id: INTRUDER_ID, email: 'intruder@example.com' })}`)
        .send({ campaignId: CAMPAIGN_ID });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('CAMPAIGN_NOT_FOUND');
      expect(validateVkToken).not.toHaveBeenCalled();
      expect(JSON.stringify(response.body)).not.toContain(CAMPAIGN_VK_TOKEN);
    });

    it('чужая кампания не помечается authExpired', async () => {
      stubAuthFetch();
      (validateVkToken as any).mockResolvedValue({ isValid: false, message: 'Токен истёк' });

      await request(app)
        .post('/api/validate/vk')
        .set('Authorization', `Bearer ${createMockToken({ id: INTRUDER_ID, email: 'intruder@example.com' })}`)
        .send({ campaignId: CAMPAIGN_ID });

      expect(markVkAuthExpired).not.toHaveBeenCalled();
    });
  });

  // CL-01 (docs/prompts/codex-verdict-validate-consolidation-2026-07-26.md):
  // authExpired выключает кампанию из refresh cron и шлёт владельцу письмо,
  // поэтому флаг ставится только когда проверялся СОХРАНЁННЫЙ токен кампании
  // И VK структурно подтвердил постоянную auth-ошибку. Границы ниже описывают
  // все четыре ситуации, в которых validateVkToken отдаёт isValid: false.
  describe('POST /api/validate/vk — границы authExpired', () => {
    const ownerRequest = (body: object) => request(app)
      .post('/api/validate/vk')
      .set('Authorization', `Bearer ${createMockToken({ id: OWNER_ID, email: 'owner@example.com' })}`)
      .send(body);

    it('сохранённый токен + постоянная auth-ошибка VK (error_code 5) → помечает', async () => {
      stubAuthFetch();
      (validateVkToken as any).mockResolvedValue({
        isValid: false,
        message: 'User authorization failed: no access_token passed.',
        details: { error: { error_code: 5, error_msg: 'User authorization failed' } },
      });

      const response = await ownerRequest({ campaignId: CAMPAIGN_ID });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(validateVkToken).toHaveBeenCalledWith(CAMPAIGN_VK_TOKEN, '777');
      expect(markVkAuthExpired).toHaveBeenCalledWith(CAMPAIGN_ID);
    });

    it('произвольный токен из body + та же ошибка → НЕ помечает', async () => {
      stubAuthFetch();
      (validateVkToken as any).mockResolvedValue({
        isValid: false,
        message: 'User authorization failed: no access_token passed.',
        details: { error: { error_code: 5, error_msg: 'User authorization failed' } },
      });

      const response = await ownerRequest({ campaignId: CAMPAIGN_ID, token: 'vk1.опечатка-пользователя' });

      expect(response.status).toBe(200);
      expect(validateVkToken).toHaveBeenCalledWith('vk1.опечатка-пользователя', undefined);
      // Сохранённый токен кампании не проверялся — про него ничего не известно.
      expect(markVkAuthExpired).not.toHaveBeenCalled();
    });

    it('сохранённый токен + сетевая ошибка (details пустой) → НЕ помечает', async () => {
      stubAuthFetch();
      (validateVkToken as any).mockResolvedValue({
        isValid: false,
        message: 'timeout of 10000ms exceeded',
        details: undefined,
      });

      const response = await ownerRequest({ campaignId: CAMPAIGN_ID });

      expect(response.status).toBe(200);
      expect(markVkAuthExpired).not.toHaveBeenCalled();
    });

    it('сохранённый токен + провал проверки группы → НЕ помечает', async () => {
      stubAuthFetch();
      (validateVkToken as any).mockResolvedValue({
        isValid: false,
        message: 'Токен валиден, но ошибка при проверке группы: Request failed',
        details: {
          user: { id: 42, first_name: 'Имя', last_name: 'Фамилия' },
          groupError: { error: { error_code: 100, error_msg: 'One of the parameters is invalid' } },
        },
      });

      const response = await ownerRequest({ campaignId: CAMPAIGN_ID });

      expect(response.status).toBe(200);
      // users.get прошёл — токен как раз рабочий, мертва проверка группы.
      expect(markVkAuthExpired).not.toHaveBeenCalled();
    });

    it('сохранённый токен + временная ошибка VK (error_code 6) → НЕ помечает', async () => {
      stubAuthFetch();
      (validateVkToken as any).mockResolvedValue({
        isValid: false,
        message: 'Too many requests per second',
        details: { error: { error_code: 6, error_msg: 'Too many requests per second' } },
      });

      const response = await ownerRequest({ campaignId: CAMPAIGN_ID });

      expect(response.status).toBe(200);
      expect(markVkAuthExpired).not.toHaveBeenCalled();
    });

    // Матрица allowlist {5, 27, 28} против сознательно исключённого 15.
    // Раньше 5 и 6 были закреплены тестами, а 15/27/28 держались только чтением
    // кода — эти три кейса закрывают границу целиком (rev2, неблокирующее 3).
    it('сохранённый токен + Access denied (error_code 15) → НЕ помечает', async () => {
      stubAuthFetch();
      (validateVkToken as any).mockResolvedValue({
        isValid: false,
        message: 'Access denied',
        details: { error: { error_code: 15, error_msg: 'Access denied' } },
      });

      const response = await ownerRequest({ campaignId: CAMPAIGN_ID });

      expect(response.status).toBe(200);
      // 15 доказывает отказ по конкретному объекту, а не смерть credential.
      expect(markVkAuthExpired).not.toHaveBeenCalled();
    });

    it('сохранённый токен + Group authorization failed (error_code 27) → помечает', async () => {
      stubAuthFetch();
      (validateVkToken as any).mockResolvedValue({
        isValid: false,
        message: 'Group authorization failed',
        details: { error: { error_code: 27, error_msg: 'Group authorization failed' } },
      });

      const response = await ownerRequest({ campaignId: CAMPAIGN_ID });

      expect(response.status).toBe(200);
      expect(markVkAuthExpired).toHaveBeenCalledWith(CAMPAIGN_ID);
    });

    it('сохранённый токен + Application authorization failed (error_code 28) → помечает', async () => {
      stubAuthFetch();
      (validateVkToken as any).mockResolvedValue({
        isValid: false,
        message: 'Application authorization failed',
        details: { error: { error_code: 28, error_msg: 'Application authorization failed' } },
      });

      const response = await ownerRequest({ campaignId: CAMPAIGN_ID });

      expect(response.status).toBe(200);
      expect(markVkAuthExpired).toHaveBeenCalledWith(CAMPAIGN_ID);
    });
  });

  describe('POST /api/validate/threads', () => {
    it('401 для анонимного запроса', async () => {
      const response = await request(app)
        .post('/api/validate/threads')
        .send({ campaignId: CAMPAIGN_ID });

      expect(response.status).toBe(401);
    });

    it('чужой tenant получает 404 вместо чужого accessToken', async () => {
      stubAuthFetch();

      const response = await request(app)
        .post('/api/validate/threads')
        .set('Authorization', `Bearer ${createMockToken({ id: INTRUDER_ID, email: 'intruder@example.com' })}`)
        .send({ campaignId: CAMPAIGN_ID });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('CAMPAIGN_NOT_FOUND');
    });
  });

  describe('остальные платформы требуют аутентификации', () => {
    it.each([
      ['telegram', { token: 'x' }],
      ['instagram', { token: 'x' }],
      ['facebook', { token: 'x' }],
      ['youtube', { apiKey: 'x' }],
    ])('POST /api/validate/%s → 401 без токена', async (platform, body) => {
      const response = await request(app).post(`/api/validate/${platform}`).send(body);
      expect(response.status).toBe(401);
    });
  });
});

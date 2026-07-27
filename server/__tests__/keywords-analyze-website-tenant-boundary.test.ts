/**
 * POST /api/keywords/analyze-website — запись в чужую кампанию.
 *
 * Эндпоинт не только возвращает подобранные слова: при переданном campaignId
 * aiService.analyzeWebsiteKeywords СОХРАНЯЕТ их в campaign_keywords, причём
 * админским токеном. Права Directus в этом пути не участвуют, поэтому без
 * проверки доступа слова писались в любую чужую кампанию по её id.
 *
 * Mutation-proof: убрать authorizeCampaignAccess из хендлера → тест краснеет,
 * потому что проверяется и код ответа, и то, что подбор/сохранение не запущены.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => {
  class CampaignAccessError extends Error {
    constructor(public readonly status: 404 | 503, public readonly code: string) {
      super(code);
    }
  }
  return {
    CampaignAccessError,
    authorizeCampaignAccess: vi.fn(async () => { throw new CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND'); }),
    analyzeWebsiteKeywords: vi.fn(async () => [{ keyword: 'кофе' }]),
    directusGet: vi.fn(async () => ({ data: { data: {} } })),
  };
});

vi.mock('../services/campaign-access', () => ({
  authorizeCampaignAccess: H.authorizeCampaignAccess,
  listAccessibleCampaignIds: vi.fn(async () => []),
  CampaignAccessError: H.CampaignAccessError,
}));

vi.mock('../directus', () => ({
  directusApi: { get: H.directusGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  directusApiManager: { request: vi.fn(), cacheAuthToken: vi.fn(), instance: { interceptors: { response: { use: vi.fn() } } } },
  default: { get: H.directusGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('axios', () => {
  const interceptors = { request: { use: vi.fn() }, response: { use: vi.fn() } };
  const instance: any = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn(), interceptors };
  const create = () => instance;
  return { default: { get: vi.fn(), post: vi.fn(), create, interceptors }, create, interceptors };
});

vi.mock('../services/ai-service', () => ({ aiService: { analyzeWebsiteKeywords: H.analyzeWebsiteKeywords, generateContent: vi.fn(), validateApiKeys: vi.fn() } }));

// Тяжёлые зависимости ai.ts, не нужные на этом пути.
vi.mock('../storage', () => ({ storage: {} }));
vi.mock('../services/deepseek', () => ({ deepseekService: {} }));
vi.mock('../services/gemini-direct', () => ({ geminiDirect: {} }));
vi.mock('../services/gemini-image', () => ({ GeminiImageService: class {} }));
vi.mock('../services/global-api-keys', () => ({ globalApiKeysService: { getGlobalApiKey: vi.fn() } }));
vi.mock('../services/api-keys', () => ({ apiKeyService: {}, ApiServiceName: { QWEN: 'qwen' } }));
vi.mock('../services/fal-ai-universal', () => ({ falAiUniversalService: {}, FalAiModelName: {} }));
vi.mock('../services/openai-image', () => ({ generateWithGptImage: vi.fn() }));
vi.mock('../services/qwen', () => ({ QwenService: class {} }));
vi.mock('../services/ai-assistant', () => ({ aiAssistantService: { processCommand: vi.fn() } }));
vi.mock('../services/image-gen-tracker', () => ({ getUsage: vi.fn(), incrementUsage: vi.fn(), canGenerate: vi.fn() }));
vi.mock('../services/plan-limits', () => ({ getEffectivePlan: vi.fn(() => 'free'), getPlanLimits: vi.fn(() => ({})) }));
vi.mock('../utils/logger', () => {
  const logFn: any = vi.fn();
  logFn.info = vi.fn(); logFn.warn = vi.fn(); logFn.error = vi.fn(); logFn.debug = vi.fn();
  return { log: logFn, default: logFn, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
});

import { registerAiRoutes } from '../routes/ai';

const app = express();
app.use(express.json());
registerAiRoutes(app);

const createMockToken = (payload: object) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${body}.signature`;
};
const STRANGER = createMockToken({ id: 'user-stranger', email: 's@x.io' });
const authed = (r: request.Test) => r.set('Authorization', `Bearer ${STRANGER}`);
const FOREIGN = 'campaign-of-another-tenant';

beforeEach(() => {
  // reset, а не clear: чистит и очередь mockResolvedValueOnce, иначе
  // непотреблённое значение утекает в соседний тест.
  vi.resetAllMocks();
  H.authorizeCampaignAccess.mockImplementation(async () => {
    throw new H.CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');
  });
  H.analyzeWebsiteKeywords.mockImplementation(async () => [{ keyword: 'кофе' }]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { id: 'user-stranger', is_smm_admin: false } }),
    text: async () => '',
    clone() { return this; },
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/keywords/analyze-website', () => {
  it('чужой campaignId → 404, подбор и сохранение не запускаются', async () => {
    const res = await authed(request(app).post('/api/keywords/analyze-website'))
      .send({ url: 'https://x.io', campaignId: FOREIGN });

    expect(res.status).toBe(404);
    expect(H.authorizeCampaignAccess).toHaveBeenCalledWith(FOREIGN, 'user-stranger', expect.any(String), false);
    expect(H.analyzeWebsiteKeywords).not.toHaveBeenCalled();
  });

  it('своя кампания — подбор выполняется', async () => {
    H.authorizeCampaignAccess.mockResolvedValueOnce({ id: 'own-1' } as any);

    const res = await authed(request(app).post('/api/keywords/analyze-website'))
      .send({ url: 'https://x.io', campaignId: 'own-1' });

    expect(res.status).toBe(200);
    expect(H.analyzeWebsiteKeywords).toHaveBeenCalledWith('https://x.io', 'own-1', expect.any(String));
  });

  it('без campaignId ничего не сохраняется — проверка доступа не нужна', async () => {
    const res = await authed(request(app).post('/api/keywords/analyze-website'))
      .send({ url: 'https://x.io' });

    expect(res.status).toBe(200);
    expect(H.authorizeCampaignAccess).not.toHaveBeenCalled();
    expect(H.analyzeWebsiteKeywords).toHaveBeenCalled();
  });
});

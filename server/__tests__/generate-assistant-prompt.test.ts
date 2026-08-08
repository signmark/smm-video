/**
 * SM-18 (review @Codex_HM): `/generate-assistant-prompt` должен ДЕТЕРМИНИРОВАННО
 * возвращать переменную `[socialNetworks]`, даже если mock-модель проигнорировала
 * инструкцию и написала literal «Facebook». Без этого в поле пользователя и в базу
 * уезжает готовое название сети, и исходный регресс возвращается.
 *
 * Гоняется РЕАЛЬНЫЙ registerCampaignRoutes в мини-Express; на границах моками
 * закрыты authenticateUser, Directus и модель.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => {
  return {
    getById: vi.fn(),
    generateContent: vi.fn(),
  };
});

vi.mock('../middleware/user-auth', () => ({
  authenticateUser: (req: any, _res: any, next: () => void) => {
    req.user = { id: 'user-1', token: 'token-1' };
    next();
  },
}));

vi.mock('../services/directus-crud', () => ({
  directusCrud: { getById: H.getById, list: vi.fn(async () => []), update: vi.fn() },
}));

vi.mock('../services/ai-service', () => ({
  aiService: { generateContent: H.generateContent },
}));

// Тяжёлые зависимости campaigns.ts, не нужные на этом пути.
vi.mock('../directus', () => ({
  directusApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  directusApiManager: { request: vi.fn(), cacheAuthToken: vi.fn(), instance: { interceptors: { response: { use: vi.fn() } } } },
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('axios', () => {
  const interceptors = { request: { use: vi.fn() }, response: { use: vi.fn() } };
  const instance: any = {
    get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn(), interceptors,
  };
  return { default: { get: vi.fn(), post: vi.fn(), create: () => instance, interceptors }, create: () => instance, interceptors };
});
vi.mock('../routes-global-api-keys', () => ({ isUserAdmin: vi.fn(async () => false) }));
vi.mock('../services/web-crawler-agent', () => ({ webCrawlerAgent: {} }));
vi.mock('../utils/ai-helpers', () => ({ extractFullSiteContent: vi.fn() }));
vi.mock('../services/admin-token-manager', () => ({ adminTokenManager: { getToken: vi.fn(async () => 'admin-token') } }));
vi.mock('../services/plan-limits', () => ({ getPlanLimits: vi.fn(() => ({})), getEffectivePlan: vi.fn(() => 'free') }));
vi.mock('../utils/logger', () => {
  const logFn: any = vi.fn();
  logFn.info = vi.fn(); logFn.warn = vi.fn(); logFn.error = vi.fn(); logFn.debug = vi.fn();
  return { log: logFn, default: logFn };
});

import { registerCampaignRoutes } from '../routes/campaigns';

const app = express();
app.use(express.json());
registerCampaignRoutes(app);

const PAYLOAD = {
  role: 'SMM-менеджер',
  experience: '3-5 лет',
  knowledge: ['маркетинг'],
  skills: ['копирайтинг'],
  tone: 'живой',
  postLength: 'средняя',
  contentMix: { educational: 33, entertaining: 33, selling: 34 },
};

const CONNECTED_CAMPAIGN = {
  id: 'camp-1',
  target_audience: 'широкая аудитория',
  business_description: 'IT-продукт',
  social_media_settings: {
    telegram: { enabled: true, chatId: 'x', token: 'secret' },
    vk: { enabled: false, groupId: 'g' },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  H.getById.mockResolvedValue(CONNECTED_CAMPAIGN);
});

describe('POST /api/campaigns/:campaignId/generate-assistant-prompt (SM-18)', () => {
  it('возвращает переменную [socialNetworks], даже если модель вернула literal Facebook', async () => {
    // Mock-модель НАРУШАЕТ инструкцию: пишет «Facebook» напрямую.
    H.generateContent.mockResolvedValue({
      content:
        'Ты — SMM-менеджер с опытом 3-5 лет. Твоя целевая аудитория — пользователи Facebook. ' +
        'Пиши под формат Facebook и Instagram.',
    });

    const res = await request(app)
      .post('/api/campaigns/camp-1/generate-assistant-prompt')
      .send(PAYLOAD);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const prompt = String(res.body.prompt || '');
    // В поле/базе должна лежать переменная, а не готовое имя сети.
    expect(prompt).toContain('[socialNetworks]');
    expect(prompt).not.toContain('Facebook');
  });

  it('сохраняет отрицание «не использовать Facebook» без инверсии', async () => {
    H.generateContent.mockResolvedValue({
      content:
        'Ты — SMM-менеджер. Не используй Facebook; пиши только для Telegram. ' +
        'Целевая аудитория — пользователи [socialNetworks].',
    });

    const res = await request(app)
      .post('/api/campaigns/camp-1/generate-assistant-prompt')
      .send(PAYLOAD);

    expect(res.status).toBe(200);
    const prompt = String(res.body.prompt || '');
    // Отрицающая пользовательская фраза не инвертируется и не затирается.
    expect(prompt).toContain('Не используй Facebook');
    // Плейсхолдер из положительного упоминания сохраняется.
    expect(prompt).toContain('[socialNetworks]');
  });
});

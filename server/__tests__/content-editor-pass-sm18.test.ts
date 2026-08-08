/**
 * SM-18 (review @Codex_HM): editor-pass (`POST /api/content/:id/editor-pass` —
 * routes/content.ts) — один из модельных ingress, где литеральные названия в
 * legacy globalPrompt раньше не трогались (там стоял инлайн `.replace` только
 * для [socialNetworks]). Теперь — единый канонический helper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => {
  return {
    directusGet: vi.fn(),
    getById: vi.fn(),
    generateContent: vi.fn(),
    patch: vi.fn(),
  };
});

vi.mock('../directus', () => ({
  directusApi: { get: H.directusGet, post: vi.fn(), patch: H.patch, delete: vi.fn() },
}));

vi.mock('../services/social-publishing', () => ({
  socialPublishingService: { publishContent: vi.fn() },
}));

vi.mock('../services/publish-scheduler', () => ({
  getPublishScheduler: vi.fn().mockReturnValue({ schedulePublication: vi.fn() }),
}));

vi.mock('../services/directus-crud', () => ({
  directusCrud: { list: vi.fn(), create: vi.fn(), update: vi.fn(), getById: H.getById },
}));

vi.mock('../storage', () => ({ storage: {} }));

vi.mock('../services/ai-service', () => ({
  aiService: { generateContent: H.generateContent },
}));

vi.mock('../middleware/user-auth', () => ({
  authenticateUser: (req: any, _res: any, next: () => void) => {
    req.user = { id: 'user-1', token: 'token-1' };
    next();
  },
  requireSmmAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock('../utils/logger', () => {
  const logFn: any = vi.fn();
  logFn.info = vi.fn(); logFn.warn = vi.fn(); logFn.error = vi.fn(); logFn.debug = vi.fn();
  return { log: logFn, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
});

import { registerContentRoutes } from '../routes/content';

const app = express();
app.use(express.json());
registerContentRoutes(app);

beforeEach(() => {
  vi.clearAllMocks();
});

const legacyPrompt =
  'Ты — SMM-менеджер. Твоя целевая аудитория — пользователи Facebook. Это предприниматели и маркетологи.';

describe('editor-pass тракт (SM-18, routes/content.ts)', () => {
  it('legacy literal Facebook не уходит в модель — раскрывается в подключённую платформу', async () => {
    H.directusGet.mockResolvedValue({
      data: { data: { id: 'item-1', campaign_id: 'camp-1', content: '<p>Исходный текст поста</p>' } },
    });
    H.getById.mockResolvedValue({
      autonomous_settings: JSON.stringify({ globalPrompt: legacyPrompt }),
      social_media_settings: { telegram: { enabled: true, token: 't' } },
    });

    let capturedPrompt: string | undefined;
    H.generateContent.mockImplementation(async (opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return { content: 'Улучшенный текст поста' };
    });

    const res = await request(app).post('/api/content/item-1/editor-pass').send({});

    expect(res.status).toBe(200);
    expect(capturedPrompt).toBeDefined();
    expect(capturedPrompt).not.toContain('Facebook');
    expect(capturedPrompt).toContain('Telegram');
  });

  it('не инвертирует отрицание «не использовать Facebook»', async () => {
    H.directusGet.mockResolvedValue({
      data: { data: { id: 'item-1', campaign_id: 'camp-1', content: '<p>Текст</p>' } },
    });
    H.getById.mockResolvedValue({
      autonomous_settings: JSON.stringify({ globalPrompt: 'Не использовать Facebook; пиши для Telegram' }),
      social_media_settings: { telegram: { enabled: true, token: 't' } },
    });

    let capturedPrompt: string | undefined;
    H.generateContent.mockImplementation(async (opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return { content: 'Улучшенный текст поста' };
    });

    const res = await request(app).post('/api/content/item-1/editor-pass').send({});

    expect(res.status).toBe(200);
    expect(capturedPrompt).toContain('Не использовать Facebook');
  });
});

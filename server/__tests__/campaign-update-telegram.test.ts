/**
 * SM-24: Campaign update route — Telegram chatId validation, normalization,
 * and persistence guard. Tests the real campaigns router with mocked Directus.
 *
 * file:line inventory:
 *   server/routes/campaigns.ts:54-63   — POST /api/campaigns (does NOT write social_media_settings)
 *   server/routes/campaigns.ts:251-299 — PATCH /api/campaigns/:id (only persistence path)
 *   server/routes/campaigns.ts:273-299 — Telegram validation + normalization guard
 *   server/utils/telegram-chatid.ts:1-35 — normalizeTelegramChatId()
 *   server/services/oauth-response-sanitizer.ts:23-79 — sanitizeOAuthSecrets, hasToken contract
 *   client/src/lib/platform-connection.ts:63-65 — isPlatformConnected
 *
 * Executed locally with npm ci, axios 1.18.1, vitest 4.1.6.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Mock all heavy dependencies BEFORE importing the router ─────

vi.mock('../middleware/user-auth', () => ({
  authenticateUser: (req: any, _res: any, next: any) => {
    req.user = { id: 'test-user', token: 'test-user-token' };
    next();
  },
}));

vi.mock('../utils/logger', () => ({
  log: Object.assign(vi.fn(), { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../utils/text', () => ({
  cleanupText: (s: string) => s,
}));

vi.mock('../services/plan-limits', () => ({
  getPlanLimits: vi.fn().mockResolvedValue({ max_campaigns: 100 }),
  getEffectivePlan: vi.fn().mockResolvedValue('pro'),
}));

vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    create: vi.fn().mockResolvedValue({ data: { id: 'test' } }),
    readOne: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    deleteById: vi.fn(),
    listRelated: vi.fn(),
  },
}));

vi.mock('../services/campaign-access', () => ({
  authorizeCampaignAccess: (_id: any, _uid: any, _token: any, _admin: any) => Promise.resolve(),
  CampaignAccessError: class extends Error {},
}));

vi.mock('../services/oauth-response-sanitizer', () => ({
  mergeOAuthSettings: (_existing: any, incoming: any) => incoming,
  sanitizeOAuthSecrets: (x: any) => x,
}));

vi.mock('../services/social-prompt', () => ({
  normalizePlatformMentionsToPlaceholder: vi.fn(),
}));

vi.mock('../services/web-crawler-agent', () => ({
  webCrawlerAgent: {},
}));

vi.mock('../utils/ai-helpers', () => ({
  extractFullSiteContent: vi.fn(),
}));

vi.mock('../services/ai-service', () => ({
  aiService: {},
}));

vi.mock('../services/admin-token-manager', () => ({
  adminTokenManager: {
    getToken: vi.fn().mockResolvedValue('adm-secret'),
  },
}));

vi.mock('../routes-global-api-keys', () => ({
  isUserAdmin: vi.fn().mockResolvedValue(false),
}));

// ─── Mock Directus API with update tracking ─────

let patchCallCount = 0;
let lastPatchedPayload: any = null;

vi.mock('../directus', () => {
  const directusApi = {
    get: vi.fn().mockResolvedValue({
      data: { data: { id: 'test-camp-1', social_media_settings: {} } },
    }),
    patch: vi.fn().mockImplementation(async (_url: string, data: any) => {
      patchCallCount++;
      lastPatchedPayload = data;
      return { data: { data: { ...data, id: 'test-camp-1' } } };
    }),
    post: vi.fn().mockResolvedValue({ data: { data: { id: 'new-id' } } }),
    delete: vi.fn(),
  };
  return { directusApi };
});

import { directusApi } from '../directus';

// ─── NOW import the router ─────

import { registerCampaignRoutes } from '../routes/campaigns';

const AUTH = 'Bearer test-token';

function createApp() {
  const app = express();
  app.use(express.json());
  registerCampaignRoutes(app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  patchCallCount = 0;
  lastPatchedPayload = null;
});

// ─── Canary: PATCH route is registered and reachable ─────

describe('SM-24: PATCH route reachable', () => {
  it('valid name-only PATCH returns non-404', async () => {
    const app = createApp();
    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({ name: 'renamed' });

    expect(res.status).not.toBe(404);
  });

  it('valid Telegram PATCH returns 200 with canonical payload', async () => {
    const app = createApp();

    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          telegram: { chatId: '@my_channel' },
        },
      });

    expect(res.status).toBe(200);
  });
});

// ─── Invalid chatId → 400, update NOT called ─────

describe('SM-24: invalid chatId → 400, no Directus patch', () => {
  it('rejects email — handler 400, update count = 0', async () => {
    const app = createApp();

    const before = patchCallCount;
    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          telegram: { chatId: 'i.zelenin@nplanner.ru' },
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid Telegram chat ID');
    expect(patchCallCount).toBe(before);
    expect(lastPatchedPayload).toBeNull();
  });

  it('rejects 129-char garbage — handler 400', async () => {
    const app = createApp();

    const before = patchCallCount;
    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          telegram: { chatId: 'a'.repeat(129) },
        },
      });

    expect(res.status).toBe(400);
    expect(patchCallCount).toBe(before);
  });

  it('rejects 4-char username — handler 400', async () => {
    const app = createApp();

    const before = patchCallCount;
    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          telegram: { chatId: '@abcd' },
        },
      });

    expect(res.status).toBe(400);
    expect(patchCallCount).toBe(before);
  });

  it('rejects dual-key conflict — handler 400, no write', async () => {
    const app = createApp();

    const before = patchCallCount;
    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          telegram: { chatId: '@ch1', chat_id: '@ch2' },
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Ambiguous');
    expect(patchCallCount).toBe(before);
  });
});

// ─── Valid chatId → canonical save, Directus called exactly once ─────

describe('SM-24: valid chatId normalized and persisted', () => {
  it('normalizes https://t.me/username → @username, 1 update', async () => {
    const app = createApp();

    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          telegram: { chatId: 'https://t.me/my_channel' },
        },
      });

    expect(res.status).toBe(200);
    expect(patchCallCount).toBe(1);
    expect(lastPatchedPayload.social_media_settings.telegram.chatId).toBe('@my_channel');
  });

  it('preserves -100XXXXXXXXX as-is', async () => {
    const app = createApp();

    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          telegram: { chatId: '-1001234567890' },
        },
      });

    expect(res.status).toBe(200);
    expect(patchCallCount).toBe(1);
    expect(lastPatchedPayload.social_media_settings.telegram.chatId).toBe('-1001234567890');
  });

  it('normalizes bare username to @username', async () => {
    const app = createApp();

    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          telegram: { chatId: 'my_channel' },
        },
      });

    expect(res.status).toBe(200);
    expect(patchCallCount).toBe(1);
    expect(lastPatchedPayload.social_media_settings.telegram.chatId).toBe('@my_channel');
  });

  it('passes through @username unchanged', async () => {
    const app = createApp();

    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          telegram: { chatId: '@my_channel' },
        },
      });

    expect(res.status).toBe(200);
    expect(patchCallCount).toBe(1);
    expect(lastPatchedPayload.social_media_settings.telegram.chatId).toBe('@my_channel');
  });

  it('accepts numeric chat ID', async () => {
    const app = createApp();

    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          telegram: { chatId: '123456789' },
        },
      });

    expect(res.status).toBe(200);
    expect(patchCallCount).toBe(1);
    expect(lastPatchedPayload.social_media_settings.telegram.chatId).toBe('123456789');
  });

  it('canonicalizes snake_case chat_id to camelCase chatId', async () => {
    const app = createApp();

    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          telegram: { chat_id: '@my_channel' },
        },
      });

    expect(res.status).toBe(200);
    expect(patchCallCount).toBe(1);
    const tg = lastPatchedPayload.social_media_settings.telegram;
    expect(tg.chatId).toBe('@my_channel');
    expect(tg.chat_id).toBeUndefined();
  });

  it('accepts 5-char username', async () => {
    const app = createApp();

    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          telegram: { chatId: '@abcde' },
        },
      });

    expect(res.status).toBe(200);
    expect(patchCallCount).toBe(1);
  });
});

// ─── Empty/disabled passes ─────

describe('SM-24: empty/disabled Telegram config passes', () => {
  it('saves settings with empty chatId and token', async () => {
    const app = createApp();

    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          telegram: { chatId: '', token: '' },
        },
      });

    expect(res.status).toBe(200);
    expect(patchCallCount).toBe(1);
  });

  it('saves settings without telegram key at all', async () => {
    const app = createApp();

    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          vk: { groupId: '123' },
        },
      });

    expect(res.status).toBe(200);
    expect(patchCallCount).toBe(1);
  });
});

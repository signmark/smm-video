/**
 * SM-24: Campaign update route — Telegram chatId validation and normalization.
 *
 * Tests for server/routes/campaigns.ts PATCH endpoint:
 * - Invalid chatId (email, garbage) → 400, update NOT called
 * - Valid formats normalized and persisted canonically
 * - Empty/disabled Telegram config passes through
 * - snake_case chat_id normalized to camelCase chatId
 *
 * NOT RUN: no node_modules. @Clause_Dev_Hermi executes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock auth
vi.mock('../middleware/user-auth', () => ({
  authenticateUser: (req: any, _res: any, next: any) => {
    req.user = { id: 'test-user', token: 'test-token' };
    next();
  },
}));

// Mock Directus API — track PATCH calls
let lastPatchedData: any = null;
vi.mock('../directus', () => ({
  directusApi: {
    get: vi.fn().mockResolvedValue({ data: { data: { social_media_settings: {} } } }),
    patch: vi.fn().mockImplementation(async (_url: string, data: any) => {
      lastPatchedData = data;
      return { data: { data: data } };
    }),
    post: vi.fn(),
    delete: vi.fn(),
  },
  directusApiManager: { request: vi.fn() },
}));

import { directusApi } from '../directus';

// Register routes
const app = express();
app.use(express.json());
// We need the campaigns routes — import the actual register function
const campaignsModule = await import('../routes/campaigns');
if (typeof (campaignsModule as any).default === 'function') {
  // default export is register function
  (campaignsModule as any).default(app);
} else {
  // named export
  const registerFn = Object.values(campaignsModule).find(
    (v: any) => typeof v === 'function' && v.name?.includes('register')
  ) as any;
  if (registerFn) registerFn(app);
}

const AUTH = 'Bearer test-user-token';

beforeEach(() => {
  vi.clearAllMocks();
  lastPatchedData = null;
  (directusApi.get as any).mockResolvedValue({
    data: { data: { social_media_settings: {} } },
  });
});

describe('SM-24: campaign update — Telegram chatId validation', () => {
  it('rejects email as chatId with 400, does not call patch', async () => {
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
    expect(lastPatchedData).toBeNull();
  });

  it('rejects 129-char description as chatId with 400', async () => {
    const longText = 'a'.repeat(129);
    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          telegram: { chatId: longText },
        },
      });
    expect(res.status).toBe(400);
    expect(lastPatchedData).toBeNull();
  });

  it('accepts and normalizes https://t.me/username to @username', async () => {
    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          telegram: { chatId: 'https://t.me/my_channel' },
        },
      });
    expect(res.status).toBe(200);
    expect(lastPatchedData.social_media_settings.telegram.chatId).toBe('@my_channel');
  });

  it('accepts -100XXXXXXXXX supergroup ID as-is', async () => {
    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          telegram: { chatId: '-1001234567890' },
        },
      });
    expect(res.status).toBe(200);
    expect(lastPatchedData.social_media_settings.telegram.chatId).toBe('-1001234567890');
  });

  it('accepts bare username and adds @', async () => {
    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          telegram: { chatId: 'my_channel' },
        },
      });
    expect(res.status).toBe(200);
    expect(lastPatchedData.social_media_settings.telegram.chatId).toBe('@my_channel');
  });

  it('saves empty/disabled Telegram config without error', async () => {
    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          telegram: { chatId: '', token: '' },
        },
      });
    expect(res.status).toBe(200);
    expect(lastPatchedData).not.toBeNull();
  });

  it('normalizes snake_case chat_id to camelCase chatId', async () => {
    const res = await request(app)
      .patch('/api/campaigns/test-camp-1')
      .set('Authorization', AUTH)
      .send({
        social_media_settings: {
          telegram: { chat_id: '@my_channel' },
        },
      });
    expect(res.status).toBe(200);
    const tg = lastPatchedData.social_media_settings.telegram;
    expect(tg.chatId).toBe('@my_channel');
    expect(tg.chat_id).toBeUndefined();
  });
});

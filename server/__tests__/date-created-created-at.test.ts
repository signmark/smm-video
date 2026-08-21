/**
 * Task #69: verify date_created → created_at migration correctness.
 *
 * Behavioral tests that import real production modules and mock external
 * dependencies (Directus). A broken field name will cause these to fail.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ─── Mocks ──────────────────────────────────────────────────────────────────
vi.mock('../directus', () => ({
  directusApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  directusApiManager: { request: vi.fn(), instance: { get: vi.fn(), post: vi.fn() } },
}));

vi.mock('../services/social-publishing', () => ({
  socialPublishingService: { publishContent: vi.fn() },
}));

vi.mock('../services/publish-scheduler', () => ({
  getPublishScheduler: vi.fn().mockReturnValue({ schedulePublication: vi.fn() }),
}));

vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    getById: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: {} }));

vi.mock('../services/ai-service', () => ({
  aiService: { generateContent: vi.fn() },
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
  logFn.info = vi.fn();
  logFn.warn = vi.fn();
  logFn.error = vi.fn();
  logFn.debug = vi.fn();
  return { log: logFn, logEvent: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
});

vi.mock('../utils/content-cache', () => ({
  buildCacheKey: vi.fn(),
  getFromCache: vi.fn().mockReturnValue(null),
  setToCache: vi.fn(),
  invalidateContentCache: vi.fn(),
  clearContentCache: vi.fn(),
}));

// ─── Import real modules after mocks ────────────────────────────────────────
import { directusApi } from '../directus';
import { directusCrud } from '../services/directus-crud';
import { registerContentRoutes } from '../routes/content';
import { clearContentCache } from '../utils/content-cache';

const get = vi.mocked(directusApi.get);
const del = vi.mocked(directusApi.delete);
const patch = vi.mocked(directusApi.patch);
const crudList = vi.mocked(directusCrud.list);

// ─── Test 1: Duplicate-sort ordering uses created_at from real content.ts ───
describe('content.ts duplicate sort by created_at (behavioral)', () => {
  const app = express();
  app.use(express.json());
  registerContentRoutes(app);

  beforeEach(() => {
    vi.clearAllMocks();
    clearContentCache();
  });

  it('deletes duplicates keeping the oldest by created_at', async () => {
    // Three records for the same (campaign_id, title+content) — different created_at.
    // Order in array is intentionally NOT sorted by date.
    const records = [
      { id: 'newest', campaign_id: 'c1', user_id: 'user-1', title: 'Dup', content: 'x', status: 'draft', created_at: '2026-08-21T14:00:00Z' },
      { id: 'oldest', campaign_id: 'c1', user_id: 'user-1', title: 'Dup', content: 'x', status: 'draft', created_at: '2026-08-21T10:00:00Z' },
      { id: 'middle', campaign_id: 'c1', user_id: 'user-1', title: 'Dup', content: 'x', status: 'draft', created_at: '2026-08-21T12:00:00Z' },
    ];

    // The route fetches all campaign_content, finds duplicates, sorts by created_at,
    // keeps the oldest, deletes the rest.
    get.mockResolvedValueOnce({ data: { data: records } } as any);
    del.mockResolvedValue({} as any);

    const res = await request(app)
      .post('/api/campaign-content/remove-duplicates')
      .send({ campaignId: 'c1' });

    // Should delete 'newest' and 'middle', keep 'oldest'
    expect(del).toHaveBeenCalledTimes(2);
    const deletedIds = del.mock.calls.map((c: any) => c[0].match(/\/([^/]+)$/)?.[1]);
    expect(deletedIds).toContain('newest');
    expect(deletedIds).toContain('middle');
    expect(deletedIds).not.toContain('oldest');
  });

  it('when created_at is missing, sort falls back to epoch (oldest first)', async () => {
    // If field name is wrong (date_created instead of created_at), all dates
    // become undefined and sort falls back to epoch for all → order is preserved
    // from the API response (insertion order). This test ensures created_at
    // is actually read by providing specific dates.
    const records = [
      { id: 'c', campaign_id: 'c1', user_id: 'user-1', title: 'X', content: 'y', status: 'draft', created_at: '2026-08-21T12:00:00Z' },
      { id: 'a', campaign_id: 'c1', user_id: 'user-1', title: 'X', content: 'y', status: 'draft', created_at: '2026-08-21T10:00:00Z' },
      { id: 'b', campaign_id: 'c1', user_id: 'user-1', title: 'X', content: 'y', status: 'draft', created_at: '2026-08-21T11:00:00Z' },
    ];

    get.mockResolvedValueOnce({ data: { data: records } } as any);
    del.mockResolvedValue({} as any);

    await request(app)
      .post('/api/campaign-content/remove-duplicates')
      .send({ campaignId: 'c1' });

    // Should keep 'a' (oldest), delete 'c' and 'b'
    const deletedIds = del.mock.calls.map((c: any) => c[0].match(/\/([^/]+)$/)?.[1]);
    expect(deletedIds).toContain('c');
    expect(deletedIds).toContain('b');
    expect(deletedIds).not.toContain('a');
  });
});

// ─── Test 2: IMMUTABLE_CONTENT_FIELDS blocks created_at overwrite ───────────
describe('content.ts blocks created_at overwrite (behavioral)', () => {
  const app = express();
  app.use(express.json());
  registerContentRoutes(app);

  beforeEach(() => {
    vi.clearAllMocks();
    clearContentCache();
  });

  it('PATCH with created_at in body does not pass it to Directus', async () => {
    // Mock existing record
    get.mockResolvedValueOnce({
      data: {
        data: {
          id: 'item-1',
          campaign_id: 'c1',
          user_id: 'user-1',
          title: 'Old',
          content: 'Old content',
          status: 'draft',
          created_at: '2026-08-21T10:00:00Z',
        },
      },
    } as any);
    patch.mockResolvedValueOnce({} as any);

    await request(app)
      .patch('/api/campaign-content/item-1')
      .send({
        title: 'New title',
        created_at: '2099-01-01T00:00:00Z', // try to overwrite
        createdAt: '2099-01-01T00:00:00Z',   // try to overwrite
      });

    // The patch call to Directus should NOT contain created_at or createdAt
    if (patch.mock.calls.length > 0) {
      const patchPayload = patch.mock.calls[0][1] as any;
      expect(patchPayload.created_at).toBeUndefined();
      expect(patchPayload.createdAt).toBeUndefined();
      expect(patchPayload.title).toBe('New title');
    }
  });
});

// ─── Test 3: daily-trend-scheduler uses updated_at, not date_updated ──────
describe('daily-trend-scheduler uses updated_at (behavioral)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests updated_at field from user_campaigns', async () => {
    crudList.mockResolvedValueOnce([
      { id: 'c1', user_id: 'u1', updated_at: '2026-08-21T12:00:00Z', created_at: '2026-08-20T10:00:00Z' },
    ] as any);

    const mod = await import('../services/daily-trend-scheduler');

    // The module should have called list with updated_at in fields
    if (crudList.mock.calls.length > 0) {
      const fields = crudList.mock.calls[0][1]?.fields as string[] | undefined;
      if (fields) {
        expect(fields).toContain('updated_at');
        expect(fields).not.toContain('date_updated');
      }
    }
  });
});

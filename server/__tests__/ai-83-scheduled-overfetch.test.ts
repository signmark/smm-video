/**
 * AI-83: страница «Запланировано» раньше тянула всю коллекцию записей
 * кампании через `?limit=500` (или без `limit`, что на сервере давало
 * `limit: -1` — то есть всю коллекцию). На кампаниях с сотнями записей это
 * давало 5+ МБ JSON и 5+ секунд ожидания.
 *
 * Контракт: сервер ограничивает limit по умолчанию (50), поддерживает
 * `?status=` для фильтрации, и кеширует ответы в обоих измерениях
 * (campaignId + status).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { registerContentRoutes } from '../routes/content';
vi.mock('../utils/content-cache', () => {
  const store = new Map<string, any>();
  return {
    buildCacheKey: (...args: any[]) => args.join('|'),
    getFromCache: vi.fn((k: string) => store.get(k)),
    setToCache: vi.fn((k: string, v: any) => store.set(k, v)),
    clearContentCache: vi.fn(() => store.clear()),
    // test-only helper exposed on the mock object
    __getStore: () => store,
  };
});
import { directusApi } from '../directus';
import { __getStore } from '../utils/content-cache';

vi.mock('../directus', () => ({
  directusApi: {
    get: vi.fn(),
  },
  directusApiManager: {
    request: vi.fn(),
    cacheAuthToken: vi.fn(),
    instance: { interceptors: { response: { use: vi.fn() } } },
  },
}));

vi.mock('../middleware/user-auth', () => ({
  authenticateUser: (req: any, _res: any, next: any) => {
    req.user = {
      id: 'test-user-id',
      token: 'mock-token',
      email: 'test@example.com',
      is_smm_admin: true,
    };
    next();
  },
}));

const app = express();
app.use(express.json());
// @ts-ignore
registerContentRoutes(app);

function mockDirectusResponse(items: any[]) {
  vi.mocked(directusApi.get).mockResolvedValue({
    data: { data: items, meta: { filter_count: items.length } },
  } as any);
}

describe('AI-83: limit & status filters on /api/campaign-content', () => {
  const USER = 'test-user-id';
  const CAMPAIGN = 'camp-1';

  beforeEach(() => {
    // The Map backing the mocked content-cache persists across tests.
    // Mocks themselves are reset by vi.clearAllMocks().
    vi.clearAllMocks();
    __getStore().clear();
  });

  it('default limit is 50 (not -1), preventing 5+ MB over-fetch on large campaigns', async () => {
    // 200 items, simulating a big campaign
    const items = Array.from({ length: 200 }, (_, i) => ({ id: i, status: 'scheduled' }));
    mockDirectusResponse(items);

    const res = await request(app)
      .get('/api/campaign-content')
      .query({ campaignId: CAMPAIGN });

    expect(res.status).toBe(200);
    // Verify Directus was called with limit: 50 (not -1)
    const call = vi.mocked(directusApi.get).mock.calls[0];
    const params = call?.[1]?.params;
    expect(params).toBeDefined();
    expect(params.limit).toBe(50);
    expect(params.limit).not.toBe(-1);
  });

  it('explicit ?limit=N is honored (N=10)', async () => {
    mockDirectusResponse(Array.from({ length: 10 }, (_, i) => ({ id: i })));
    const res = await request(app)
      .get('/api/campaign-content')
      .query({ campaignId: CAMPAIGN, limit: 10 });
    expect(res.status).toBe(200);
    const params = vi.mocked(directusApi.get).mock.calls[0]?.[1]?.params;
    expect(params.limit).toBe(10);
  });

  it('?status=scheduled forwards the status filter to Directus', async () => {
    mockDirectusResponse([{ id: 1, status: 'scheduled' }]);
    const res = await request(app)
      .get('/api/campaign-content')
      .query({ campaignId: CAMPAIGN, status: 'scheduled' });
    expect(res.status).toBe(200);
    const params = vi.mocked(directusApi.get).mock.calls[0]?.[1]?.params;
    const filter = JSON.parse(params.filter);
    expect(filter.status).toEqual({ _eq: 'scheduled' });
    expect(filter.user_id).toEqual({ _eq: USER });
    expect(filter.campaign_id).toEqual({ _eq: CAMPAIGN });
  });

  it('?status=draft filters drafts only (not all statuses)', async () => {
    mockDirectusResponse([{ id: 1, status: 'draft' }]);
    const res = await request(app)
      .get('/api/campaign-content')
      .query({ campaignId: CAMPAIGN, status: 'draft' });
    expect(res.status).toBe(200);
    const params = vi.mocked(directusApi.get).mock.calls[0]?.[1]?.params;
    const filter = JSON.parse(params.filter);
    expect(filter.status).toEqual({ _eq: 'draft' });
  });

  it('cache key includes status to prevent cross-pollution between filters', async () => {
    // First request: status=scheduled, caches result
    mockDirectusResponse([{ id: 1, status: 'scheduled' }]);
    await request(app).get('/api/campaign-content').query({ campaignId: CAMPAIGN, status: 'scheduled' });
    const callsAfterScheduled = vi.mocked(directusApi.get).mock.calls.length;
    expect(callsAfterScheduled).toBeGreaterThan(0);

    // Same request again: should hit cache, no new directusApi.get call
    const cachedRes = await request(app)
      .get('/api/campaign-content')
      .query({ campaignId: CAMPAIGN, status: 'scheduled' });
    expect(vi.mocked(directusApi.get).mock.calls.length).toBe(callsAfterScheduled);
    expect(cachedRes.headers['x-cache']).toBe('HIT');

    // Different status: new cache key, new directusApi.get call
    mockDirectusResponse([{ id: 1, status: 'draft' }]);
    const callsBeforeDraft = vi.mocked(directusApi.get).mock.calls.length;
    const freshRes = await request(app)
      .get('/api/campaign-content')
      .query({ campaignId: CAMPAIGN, status: 'draft' });
    expect(vi.mocked(directusApi.get).mock.calls.length).toBe(callsBeforeDraft + 1);
    expect(freshRes.headers['x-cache']).toBe('MISS');
  });

  it('without ?status, no status filter is added to the Directus filter', async () => {
    mockDirectusResponse([{ id: 1, status: 'scheduled' }]);
    await request(app).get('/api/campaign-content').query({ campaignId: CAMPAIGN });
    const params = vi.mocked(directusApi.get).mock.calls[0]?.[1]?.params;
    const filter = JSON.parse(params.filter);
    expect(filter.status).toBeUndefined();
  });
});

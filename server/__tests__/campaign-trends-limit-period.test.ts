/**
 * GET /api/campaign-trends: limit и period больше не игнорируются.
 * Раньше эндпоинт всегда ходил в Directus с limit: -1 и отдавал весь датасет
 * кампании (на проде ~4 МБ на каждое открытие дашборда).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    create: vi.fn().mockReturnValue({
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
      get: vi.fn(),
      post: vi.fn(),
    })
  }
}));

vi.mock('../directus', () => ({
  directusApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn() }
}));

vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    getAdminTokenPublic: vi.fn().mockResolvedValue('admin-token'),
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  }
}));

vi.mock('../services/directus-auth-manager', () => ({
  directusAuthManager: { getAdminToken: vi.fn() }
}));

vi.mock('../services/gemini-direct', () => ({
  geminiDirect: { generateContent: vi.fn() }
}));

vi.mock('../services/analytics-service', () => ({
  AnalyticsService: { refreshCampaignAnalytics: vi.fn(), getCampaignAnalytics: vi.fn() }
}));

vi.mock('../services/campaign-access', () => ({
  authorizeCampaignAccess: vi.fn().mockResolvedValue(undefined),
  CampaignAccessError: class CampaignAccessError extends Error {}
}));

vi.mock('../services/oauth-response-sanitizer', () => ({
  sanitizeOAuthSecrets: (v: any) => v
}));

vi.mock('../routes-global-api-keys', () => ({
  isUserAdmin: vi.fn().mockResolvedValue(false)
}));

vi.mock('../middleware/user-auth', () => ({
  authenticateUser: (req: any, _res: any, next: () => void) => {
    req.user = { id: 'user-1', token: 'token-1' };
    next();
  },
  requireSmmAdmin: (_req: any, _res: any, next: () => void) => next()
}));

vi.mock('../utils/logger', () => {
  const logFn: any = vi.fn();
  logFn.info = vi.fn();
  logFn.warn = vi.fn();
  logFn.error = vi.fn();
  logFn.debug = vi.fn();
  return { log: logFn, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
});

import axios from 'axios';
import { registerAnalyticsRoutes } from '../routes/analytics';

const app = express();
app.use(express.json());
registerAnalyticsRoutes(app);

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/** Тренд с датой поста в raw_source_data (unix-секунды, как отдаёт TG/VK). */
const trend = (id: string, postDaysAgo: number, createdDaysAgo = postDaysAgo) => ({
  id,
  title: `trend-${id}`,
  created_at: daysAgo(createdDaysAgo).toISOString(),
  raw_source_data: { date: Math.floor(daysAgo(postDaysAgo).getTime() / 1000) }
});

const lastGetParams = () => vi.mocked(axios.get).mock.calls[0][1]?.params as Record<string, any>;

describe('GET /api/campaign-trends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('по умолчанию просит у Directus ограниченную выборку, а не limit: -1', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { data: [] } } as any);

    const res = await request(app).get('/api/campaign-trends?campaignId=c1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
    expect(lastGetParams().limit).toBe(500);
  });

  it('уважает числовой limit и режет выдачу', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { data: [trend('1', 1), trend('2', 2), trend('3', 3)] }
    } as any);

    const res = await request(app).get('/api/campaign-trends?campaignId=c1&limit=2');

    expect(lastGetParams().limit).toBe(2);
    expect(res.body.data).toHaveLength(2);
  });

  it('limit=all — явный опт-ин на весь датасет (страница трендов)', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { data: [trend('1', 400)] } } as any);

    const res = await request(app).get('/api/campaign-trends?campaignId=c1&limit=all');

    expect(lastGetParams().limit).toBe(-1);
    expect(lastGetParams()['filter[created_at][_gte]']).toBeUndefined();
    expect(res.body.data).toHaveLength(1);
  });

  it('period=7days фильтрует по дате поста, а не по created_at', async () => {
    // Свежая вставка старого поста: created_at сегодня, но пост месячной давности —
    // именно из-за этого фильтр по created_at давал неверные окна.
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { data: [trend('fresh', 2), trend('old-post', 30, 0)] }
    } as any);

    const res = await request(app).get('/api/campaign-trends?campaignId=c1&period=7days');

    expect(lastGetParams()['filter[created_at][_gte]']).toBeDefined();
    expect(res.body.data.map((t: any) => t.id)).toEqual(['fresh']);
  });

  it('тренды без даты не пропадают при фильтре по периоду', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { data: [{ id: 'no-date', title: 'no-date', raw_source_data: {} }] }
    } as any);

    const res = await request(app).get('/api/campaign-trends?campaignId=c1&period=7days');

    expect(res.body.data.map((t: any) => t.id)).toEqual(['no-date']);
  });

  it('period=all не фильтрует ничего', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { data: [trend('1', 1), trend('2', 200)] }
    } as any);

    const res = await request(app).get('/api/campaign-trends?campaignId=c1&period=all');

    expect(lastGetParams()['filter[created_at][_gte]']).toBeUndefined();
    expect(res.body.data).toHaveLength(2);
  });

  it('без campaignId — 400', async () => {
    const res = await request(app).get('/api/campaign-trends');
    expect(res.status).toBe(400);
    expect(axios.get).not.toHaveBeenCalled();
  });
});

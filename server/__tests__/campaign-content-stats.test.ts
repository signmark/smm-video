/**
 * GET /api/campaign-content/stats — агрегаты вместо выгрузки всей таблицы.
 *
 * Дашборд и сайдбар считали плитки и гистограмму из `?summary=1` без campaignId
 * и без limit: на проде это 1422 объекта и 354 КБ на каждое открытие. Здесь
 * проверяем, что счётчики считает Directus, а сырыми едут только даты за окно.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../directus', () => ({
  directusApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../services/social-publishing', () => ({
  socialPublishingService: { publishContent: vi.fn() },
}));

vi.mock('../services/publish-scheduler', () => ({
  getPublishScheduler: vi.fn().mockReturnValue({ schedulePublication: vi.fn() }),
}));

vi.mock('../services/directus-crud', () => ({
  directusCrud: { list: vi.fn(), create: vi.fn(), update: vi.fn(), getAdminTokenPublic: vi.fn() },
}));

vi.mock('../storage', () => ({ storage: {} }));

vi.mock('../services/ai-service', () => ({ aiService: { generateContent: vi.fn() } }));

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
  return { log: logFn, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
});

import { directusApi } from '../directus';
import { registerContentRoutes } from '../routes/content';
import { clearContentCache } from '../utils/content-cache';

const app = express();
app.use(express.json());
registerContentRoutes(app);

const get = vi.mocked(directusApi.get);

/** Вызов, у которого в params есть aggregate — тот самый агрегат по статусам. */
const aggregateCall = () =>
  get.mock.calls.find(call => (call[1] as any)?.params?.aggregate);
/** Вызов окна графика — у него есть fields с датами. */
const windowCall = () =>
  get.mock.calls.find(call => {
    const fields = (call[1] as any)?.params?.fields;
    return Array.isArray(fields) && fields.includes('published_at');
  });
/** Вызов за карточкой «Недавний контент» — единственный, где просят title. */
const latestCall = () =>
  get.mock.calls.find(call => {
    const fields = (call[1] as any)?.params?.fields;
    return Array.isArray(fields) && fields.includes('title');
  });

const aggregateResponse = (rows: any[]) => ({ data: { data: rows } });

function mockDirectus(statusRows: any[], windowRows: any[] = [], latestRows: any[] = []) {
  get.mockImplementation((_url: any, config: any) => {
    const params = config?.params;
    if (params?.aggregate) return Promise.resolve(aggregateResponse(statusRows) as any);
    if (Array.isArray(params?.fields) && params.fields.includes('title')) {
      return Promise.resolve({ data: { data: latestRows } } as any);
    }
    return Promise.resolve({ data: { data: windowRows } } as any);
  });
}

describe('GET /api/campaign-content/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearContentCache();
  });

  it('считает статусы агрегатом Directus, а не выгрузкой строк', async () => {
    mockDirectus([
      { status: 'draft', count: { id: '900' } },
      { status: 'published', count: { id: '400' } },
      { status: 'partial', count: { id: '20' } },
      { status: 'scheduled', count: { id: '12' } },
      { status: 'failed', count: { id: '3' } },
    ]);

    const res = await request(app).get('/api/campaign-content/stats');

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1335);
    expect(res.body.data.published).toBe(420); // published + partial
    expect(res.body.data.scheduled).toBe(12);
    expect(res.body.data.failed).toBe(3);
    expect(res.body.data.draft).toBe(900);

    const params = (aggregateCall()?.[1] as any).params;
    expect(params.aggregate).toBe(JSON.stringify({ count: ['id'] }));
    expect(params.groupBy).toEqual(['status']);
  });

  it('окно графика просит только даты и ограничено по числу строк', async () => {
    mockDirectus([{ status: 'published', count: { id: '5' } }]);

    await request(app).get('/api/campaign-content/stats?days=7');

    const params = (windowCall()?.[1] as any).params;
    expect(params.fields).toEqual(['id', 'status', 'published_at', 'scheduled_at']);
    // Ключевое: никакого limit: -1 — прежний путь тянул всю таблицу.
    expect(params.limit).toBeGreaterThan(0);
    expect(params.limit).not.toBe(-1);

    const filter = JSON.parse(params.filter);
    expect(filter.user_id).toEqual({ _eq: 'user-1' });
    expect(filter._or).toHaveLength(2);
    expect(filter._or[0].published_at._gte).toBeDefined();
  });

  it('отдаёт строки окна в camelCase для клиента', async () => {
    mockDirectus(
      [{ status: 'published', count: { id: '1' } }],
      [{ id: 'c1', status: 'published', published_at: '2026-07-26T10:00:00Z', scheduled_at: null }],
    );

    const res = await request(app).get('/api/campaign-content/stats');

    expect(res.body.data.recent).toEqual([
      { id: 'c1', status: 'published', publishedAt: '2026-07-26T10:00:00Z', scheduledAt: null },
    ]);
  });

  it('отдаёт последние записи для карточки «Недавний контент» — без тел постов', async () => {
    mockDirectus(
      [{ status: 'draft', count: { id: '1' } }],
      [],
      [{ id: 'n1', title: 'Пост', status: 'draft', created_at: '2026-07-26T09:00:00Z' }],
    );

    const res = await request(app).get('/api/campaign-content/stats');

    expect(res.body.data.latest).toEqual([
      { id: 'n1', title: 'Пост', status: 'draft', createdAt: '2026-07-26T09:00:00Z' },
    ]);

    const params = (latestCall()?.[1] as any).params;
    // Ни content, ни image_url, ни social_platforms — карточке нужны заголовок и дата.
    expect(params.fields).toEqual(['id', 'title', 'status', 'created_at']);
    expect(params.limit).toBeLessThanOrEqual(5);
  });

  it('фильтрует по кампании, когда передан campaignId', async () => {
    mockDirectus([{ status: 'draft', count: { id: '2' } }]);

    await request(app).get('/api/campaign-content/stats?campaignId=camp-1');

    const filter = JSON.parse((aggregateCall()?.[1] as any).params.filter);
    expect(filter.campaign_id).toEqual({ _eq: 'camp-1' });
  });

  it('окно ограничено сверху — days нельзя раздуть до года', async () => {
    mockDirectus([{ status: 'draft', count: { id: '1' } }]);

    const res = await request(app).get('/api/campaign-content/stats?days=3650');

    expect(res.body.data.windowDays).toBe(92);
  });

  it('второй запрос обслуживается из кеша, Directus не дёргается повторно', async () => {
    mockDirectus([{ status: 'draft', count: { id: '1' } }]);

    await request(app).get('/api/campaign-content/stats');
    const callsAfterFirst = get.mock.calls.length;
    const res = await request(app).get('/api/campaign-content/stats');

    expect(res.headers['x-cache']).toBe('HIT');
    expect(get.mock.calls.length).toBe(callsAfterFirst);
  });

  it('если агрегат недоступен — считает по id+status, а не по полным телам', async () => {
    get.mockImplementation((_url: any, config: any) => {
      if (config?.params?.aggregate) {
        return Promise.reject(Object.assign(new Error('FORBIDDEN'), { response: { status: 403 } }));
      }
      const fields = config?.params?.fields;
      if (Array.isArray(fields) && fields.includes('published_at')) {
        return Promise.resolve({ data: { data: [] } } as any);
      }
      return Promise.resolve({
        data: { data: [{ id: 'a', status: 'failed' }, { id: 'b', status: 'failed' }, { id: 'c', status: 'draft' }] },
      } as any);
    });

    const res = await request(app).get('/api/campaign-content/stats');

    expect(res.status).toBe(200);
    expect(res.body.data.failed).toBe(2);
    expect(res.body.data.total).toBe(3);

    const fallbackCall = get.mock.calls.find(call => {
      const fields = (call[1] as any)?.params?.fields;
      return Array.isArray(fields) && fields.length === 2 && fields.includes('status');
    });
    expect((fallbackCall?.[1] as any).params.fields).toEqual(['id', 'status']);
  });

  it('нормализует naive-UTC от Directus к ISO с Z (SM-14)', async () => {
    // Directus иногда отдаёт timestamp'ы без явного TZ-маркера (naive-UTC).
    // Без нормализации клиент читает строку как локальное время и карточка
    // «Недавний контент» дрейфует на TZ браузера (SM-14).
    mockDirectus(
      [{ status: 'draft', count: { id: '1' } }],
      [{ id: 'c1', status: 'published', published_at: '2026-07-26T10:00:00', scheduled_at: null }],
      [{ id: 'n1', title: 'Пост', status: 'draft', created_at: '2026-07-26T09:00:00' }],
    );

    const res = await request(app).get('/api/campaign-content/stats');

    expect(res.status).toBe(200);
    expect(res.body.data.latest[0].createdAt).toBe('2026-07-26T09:00:00Z');
    expect(res.body.data.recent[0].publishedAt).toBe('2026-07-26T10:00:00Z');
    expect(res.body.data.recent[0].scheduledAt).toBeNull();
  });

  it('не ломает строки с уже явным TZ-маркером (Z или ±HH:MM)', async () => {
    mockDirectus(
      [{ status: 'draft', count: { id: '1' } }],
      [
        { id: 'cZ', status: 'published', published_at: '2026-07-26T10:00:00Z', scheduled_at: null },
        { id: 'cP', status: 'scheduled', published_at: null, scheduled_at: '2026-07-27T11:00:00+05:00' },
      ],
      [
        { id: 'nZ', title: 'Z', status: 'draft', created_at: '2026-07-26T09:00:00Z' },
        { id: 'nP', title: 'P', status: 'draft', created_at: '2026-07-26T09:00:00+05:00' },
      ],
    );

    const res = await request(app).get('/api/campaign-content/stats');

    expect(res.body.data.latest.map((r: any) => r.createdAt)).toEqual([
      '2026-07-26T09:00:00Z',
      '2026-07-26T09:00:00+05:00',
    ]);
    expect(res.body.data.recent[0].publishedAt).toBe('2026-07-26T10:00:00Z');
    expect(res.body.data.recent[1].scheduledAt).toBe('2026-07-27T11:00:00+05:00');
  });

  it('"stats" не уезжает в обработчик /:id', async () => {
    mockDirectus([{ status: 'draft', count: { id: '1' } }]);

    const res = await request(app).get('/api/campaign-content/stats');

    // Обработчик /:id ходит в /items/campaign_content/<id> — такого вызова быть не должно.
    expect(get.mock.calls.some(call => String(call[0]).includes('/items/campaign_content/'))).toBe(false);
    expect(res.body.data).toBeDefined();
  });
});

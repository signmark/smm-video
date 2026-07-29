/**
 * Экспорт отчёта: содержимое за период и граница арендатора.
 *
 * Два независимых повода:
 *
 *  1. **SM-6 / SM-7** — при периоде «30 дней» страница аналитики показывала посты,
 *     а PDF/Excel выгружались пустыми. Причина: строки отчёта собирались из
 *     top-level колонок `published_at`/`reach`/`likes`, которые у живых записей
 *     пустые, тогда как настоящие дата и метрики лежат в JSON `social_platforms`.
 *     Фикс был, но тестов на генератор отчётов не существовало вовсе — здесь
 *     закрывается именно та функция, что наполняет таблицу постов.
 *
 *  2. **Граница арендатора** — `POST /api/reports/:campaignId/export` не проверял
 *     владение кампанией. Собственный токен пользователя границей не является:
 *     роль в Directus читает кампании целиком, поэтому по чужому id выгружался
 *     чужой отчёт с постами, охватами и комментариями.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ─── 1. Наполнение отчёта за период ───────────────────────────────────────────

import { flattenPublishedPlatformRows } from '../services/analytics-aggregation';

/** Окно «30 дней», как его задаёт быстрый фильтр на странице аналитики. */
const TO = new Date('2026-07-29T12:00:00.000Z');
const FROM = new Date('2026-06-29T12:00:00.000Z');

/** Запись ровно в той форме, в какой её отдаёт Directus живому приложению. */
const postPublishedAt = (isoInsidePlatform: string | null, overrides: Record<string, any> = {}) => ({
  id: 'content-1',
  title: 'Пост про запуск',
  content: 'Текст поста',
  // Пустые top-level колонки — это норма для реальных записей, а не крайний случай.
  published_at: null,
  reach: null,
  likes: null,
  social_platforms: {
    telegram: {
      status: 'published',
      postUrl: 'https://t.me/c/1/2',
      publishedAt: isoInsidePlatform,
      analytics: { views: 1500, likes: 42, comments: 7, shares: 3 },
    },
  },
  ...overrides,
});

describe('строки отчёта за период (SM-6, SM-7)', () => {
  it('пост с датой только внутри social_platforms попадает в отчёт', () => {
    // Ровно случай из тикета: на странице пост виден, в выгрузке его не было.
    const rows = flattenPublishedPlatformRows([postPublishedAt('2026-07-10T09:00:00.000Z')], FROM, TO);

    expect(rows).toHaveLength(1);
    expect(rows[0].platform).toBe('telegram');
    expect(rows[0].title).toBe('Пост про запуск');
  });

  it('метрики берутся из social_platforms, а не из пустых колонок', () => {
    const rows = flattenPublishedPlatformRows([postPublishedAt('2026-07-10T09:00:00.000Z')], FROM, TO);

    // Раньше здесь были нули — отчёт «скачивается, но данных нет».
    expect(rows[0].reach).toBe(1500);
    expect(rows[0].likes).toBe(42);
    expect(rows[0].comments).toBe(7);
    expect(rows[0].shares).toBe(3);
  });

  it('за 30 дней собираются все посты периода, а не только последние', () => {
    const posts = [
      postPublishedAt('2026-07-28T10:00:00.000Z', { id: 'c-1' }),
      postPublishedAt('2026-07-15T10:00:00.000Z', { id: 'c-2' }),
      postPublishedAt('2026-07-01T10:00:00.000Z', { id: 'c-3' }),
    ];

    const rows = flattenPublishedPlatformRows(posts, FROM, TO);

    expect(rows).toHaveLength(3);
  });

  it('посты вне периода в отчёт не попадают', () => {
    const posts = [
      postPublishedAt('2026-05-01T10:00:00.000Z', { id: 'старый' }),
      postPublishedAt('2026-07-10T10:00:00.000Z', { id: 'свежий' }),
    ];

    const rows = flattenPublishedPlatformRows(posts, FROM, TO);

    expect(rows).toHaveLength(1);
    expect(rows[0].published_at).toContain('2026-07-10');
  });

  it('social_platforms строкой JSON разбирается так же', () => {
    // Directus в части ответов отдаёт JSON-поле строкой.
    const post = postPublishedAt('2026-07-10T09:00:00.000Z');
    const asString = { ...post, social_platforms: JSON.stringify(post.social_platforms) };

    expect(flattenPublishedPlatformRows([asString], FROM, TO)).toHaveLength(1);
  });

  it('неопубликованные платформы в отчёт не идут', () => {
    const post = postPublishedAt('2026-07-10T09:00:00.000Z');
    (post.social_platforms as any).telegram.status = 'pending';

    expect(flattenPublishedPlatformRows([post], FROM, TO)).toHaveLength(0);
  });

  it('каждая платформа поста — отдельная строка отчёта', () => {
    const post = postPublishedAt('2026-07-10T09:00:00.000Z');
    (post.social_platforms as any).vk = {
      status: 'published',
      publishedAt: '2026-07-11T09:00:00.000Z',
      analytics: { views: 300, likes: 5 },
    };

    const rows = flattenPublishedPlatformRows([post], FROM, TO);

    expect(rows.map(r => r.platform).sort()).toEqual(['telegram', 'vk']);
  });

  it('публикация без единой отметки времени в период не зачисляется', () => {
    // Догадка здесь означала бы посты «из ниоткуда» в отчёте за произвольный месяц.
    expect(flattenPublishedPlatformRows([postPublishedAt(null)], FROM, TO)).toHaveLength(0);
  });
});

// ─── 2. Граница арендатора на ручке экспорта ──────────────────────────────────

const H = vi.hoisted(() => {
  class CampaignAccessError extends Error {
    constructor(public readonly status: 404 | 503, public readonly code: string) {
      super(code);
    }
  }
  return {
    CampaignAccessError,
    authorizeCampaignAccess: vi.fn(async () => { throw new CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND'); }),
    listAccessibleCampaignIds: vi.fn(async () => [] as string[]),
    generateCampaignReport: vi.fn(async () => Buffer.from('report-bytes')),
  };
});

vi.mock('../services/campaign-access', () => ({
  authorizeCampaignAccess: H.authorizeCampaignAccess,
  listAccessibleCampaignIds: H.listAccessibleCampaignIds,
  CampaignAccessError: H.CampaignAccessError,
}));

vi.mock('../services/report-generator', () => ({
  generateCampaignReport: H.generateCampaignReport,
}));

vi.mock('../utils/logger', () => {
  const logFn: any = vi.fn();
  logFn.info = vi.fn(); logFn.warn = vi.fn(); logFn.error = vi.fn(); logFn.debug = vi.fn();
  return { log: logFn, default: logFn, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
});

import reportsRouter from '../routes/reports';

const app = express();
app.use(express.json());
app.use('/api/reports', reportsRouter);

const createMockToken = (payload: object) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${body}.signature`;
};
const STRANGER = createMockToken({ id: 'user-stranger', email: 's@x.io' });

const exportQuery = '?format=excel&from=2026-06-29&to=2026-07-29';

beforeEach(() => {
  vi.clearAllMocks();
  H.authorizeCampaignAccess.mockImplementation(async () => {
    throw new H.CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND');
  });
  H.generateCampaignReport.mockImplementation(async () => Buffer.from('report-bytes'));

  // Валидная сессия для настоящего authenticateUser.
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

describe('POST /api/reports/:campaignId/export — граница арендатора', () => {
  it('чужая кампания → 404, отчёт не генерируется', async () => {
    const res = await request(app)
      .post(`/api/reports/campaign-of-another-tenant/export${exportQuery}`)
      .set('Authorization', `Bearer ${STRANGER}`);

    expect(res.status).toBe(404);
    // Главное: до генератора дело не дошло, чужие данные не читались.
    expect(H.generateCampaignReport).not.toHaveBeenCalled();
  });

  it('без сессии → 401, отчёт не генерируется', async () => {
    const res = await request(app).post(`/api/reports/campaign-mine/export${exportQuery}`);

    expect(res.status).toBe(401);
    expect(H.generateCampaignReport).not.toHaveBeenCalled();
  });

  it('своя кампания → отчёт отдаётся', async () => {
    H.authorizeCampaignAccess.mockImplementation(async () => ({ id: 'campaign-mine' }));

    const res = await request(app)
      .post(`/api/reports/campaign-mine/export${exportQuery}`)
      .set('Authorization', `Bearer ${STRANGER}`);

    expect(res.status).toBe(200);
    expect(H.generateCampaignReport).toHaveBeenCalled();
    expect(res.headers['content-disposition']).toContain('attachment');
  });

  it('сбой Directus на проверке доступа → 503, а не молчаливая выдача', async () => {
    H.authorizeCampaignAccess.mockImplementation(async () => {
      throw new H.CampaignAccessError(503, 'CAMPAIGN_ACCESS_UNAVAILABLE');
    });

    const res = await request(app)
      .post(`/api/reports/campaign-mine/export${exportQuery}`)
      .set('Authorization', `Bearer ${STRANGER}`);

    expect(res.status).toBe(503);
    expect(H.generateCampaignReport).not.toHaveBeenCalled();
  });
});

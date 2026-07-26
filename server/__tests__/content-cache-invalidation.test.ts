import { describe, expect, it, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  buildCacheKey,
  getFromCache,
  setToCache,
  invalidateContentCache,
  clearContentCache,
} from '../utils/content-cache';
import { invalidateContentCacheOnMutation } from '../middleware/content-cache-invalidation';

const USER = 'user-1';
const CAMPAIGN = 'camp-1';

function seed(userId = USER, campaignId = CAMPAIGN) {
  const key = buildCacheKey(userId, campaignId, 1, 500);
  setToCache(key, { data: ['stale'] });
  return key;
}

/** Прод-порядок: авторизация проставляет req.user до того, как отработает res 'finish'. */
// userId: null — сымитировать неавторизованный запрос. Именно null, а не undefined:
// явный undefined в JS включает значение параметра по умолчанию.
function buildApp(handler: express.RequestHandler, userId: string | null = USER) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (userId) (req as any).user = { id: userId };
    next();
  });
  app.use('/api', invalidateContentCacheOnMutation);
  app.all('/api/*', handler);
  return app;
}

describe('invalidateContentCache', () => {
  beforeEach(() => clearContentCache());

  it('сбрасывает кеш конкретной кампании', () => {
    const key = seed();
    invalidateContentCache(USER, CAMPAIGN);
    expect(getFromCache(key)).toBeNull();
  });

  it('без campaignId сбрасывает весь кеш пользователя', () => {
    const a = seed(USER, 'camp-a');
    const b = seed(USER, 'camp-b');
    invalidateContentCache(USER);
    expect(getFromCache(a)).toBeNull();
    expect(getFromCache(b)).toBeNull();
  });

  it('принимает campaign_id связью-объектом, а не только строкой', () => {
    const key = seed();
    // Раньше ключ собирался как ":[object Object]:" и не совпадал ни с чем —
    // инвалидация молча не срабатывала.
    invalidateContentCache(USER, { id: CAMPAIGN } as any);
    expect(getFromCache(key)).toBeNull();
  });

  it('не трогает кеш другого пользователя', () => {
    const mine = seed(USER);
    const theirs = seed('user-2');
    invalidateContentCache(USER);
    expect(getFromCache(mine)).toBeNull();
    expect(getFromCache(theirs)).not.toBeNull();
  });

  it('не задевает пользователя, чей id начинается так же', () => {
    const mine = seed('user-1');
    const neighbour = seed('user-10');
    invalidateContentCache('user-1');
    expect(getFromCache(mine)).toBeNull();
    expect(getFromCache(neighbour)).not.toBeNull();
  });
});

describe('buildCacheKey — вариант выдачи', () => {
  beforeEach(() => clearContentCache());

  it('сводка и полная выдача не делят одну запись кеша', () => {
    // Тела ответов разные: перепутав их, отдадим дашборду полный список или,
    // хуже, странице контента — сводку без текстов.
    const full = buildCacheKey(USER, CAMPAIGN, 1, 500, 'full');
    const summary = buildCacheKey(USER, CAMPAIGN, 1, 500, 'summary');
    expect(full).not.toBe(summary);

    setToCache(full, { data: ['полная'] });
    setToCache(summary, { data: ['сводка'] });
    expect(getFromCache(full)).toEqual({ data: ['полная'] });
    expect(getFromCache(summary)).toEqual({ data: ['сводка'] });
  });

  it('по умолчанию вариант — полная выдача', () => {
    expect(buildCacheKey(USER, CAMPAIGN, 1, 500)).toBe(buildCacheKey(USER, CAMPAIGN, 1, 500, 'full'));
  });

  it('инвалидация чистит оба варианта — вариант в конце ключа', () => {
    const full = buildCacheKey(USER, CAMPAIGN, 1, 500, 'full');
    const summary = buildCacheKey(USER, CAMPAIGN, 1, 500, 'summary');
    setToCache(full, { data: [1] });
    setToCache(summary, { data: [2] });
    invalidateContentCache(USER, CAMPAIGN);
    expect(getFromCache(full)).toBeNull();
    expect(getFromCache(summary)).toBeNull();
  });

  it('сводка без кампании тоже вычищается при сбросе всего пользователя', () => {
    // Дашборд ходит без campaignId — его ключ не должен пережить инвалидацию.
    const dashboard = buildCacheKey(USER, '', 1, -1, 'summary');
    setToCache(dashboard, { data: [1] });
    invalidateContentCache(USER);
    expect(getFromCache(dashboard)).toBeNull();
  });
});

describe('invalidateContentCacheOnMutation (middleware)', () => {
  beforeEach(() => clearContentCache());

  it('сбрасывает кеш после успешного POST', async () => {
    const key = seed();
    const app = buildApp((_req, res) => { res.json({ success: true }); });
    await request(app).post('/api/retry-platform').send({ campaignId: CAMPAIGN });
    expect(getFromCache(key)).toBeNull();
  });

  it('сбрасывает кеш после PATCH и DELETE', async () => {
    for (const method of ['patch', 'delete'] as const) {
      clearContentCache();
      const key = seed();
      const app = buildApp((_req, res) => { res.json({ ok: true }); });
      await (request(app) as any)[method]('/api/content/x').send({ campaignId: CAMPAIGN });
      expect(getFromCache(key)).toBeNull();
    }
  });

  it('не сбрасывает кеш на GET — иначе кеш теряет смысл', async () => {
    const key = seed();
    const app = buildApp((_req, res) => { res.json({ data: [] }); });
    await request(app).get('/api/campaign-content?campaignId=' + CAMPAIGN);
    expect(getFromCache(key)).not.toBeNull();
  });

  it('не сбрасывает кеш, если запрос провалился', async () => {
    const key = seed();
    const app = buildApp((_req, res) => { res.status(400).json({ error: 'nope' }); });
    await request(app).post('/api/retry-platform').send({ campaignId: CAMPAIGN });
    expect(getFromCache(key)).not.toBeNull();
  });

  it('без campaignId в запросе чистит весь кеш пользователя', async () => {
    const a = seed(USER, 'camp-a');
    const b = seed(USER, 'camp-b');
    const app = buildApp((_req, res) => { res.json({ ok: true }); });
    await request(app).post('/api/unpublish-content').send({ contentId: 'c-1' });
    expect(getFromCache(a)).toBeNull();
    expect(getFromCache(b)).toBeNull();
  });

  it('берёт campaignId из query и из params пути', async () => {
    const key = seed();
    const app = buildApp((_req, res) => { res.json({ ok: true }); });
    await request(app).post(`/api/x?campaignId=${CAMPAIGN}`).send({});
    expect(getFromCache(key)).toBeNull();
  });

  it('ничего не делает без авторизованного пользователя', async () => {
    const key = seed();
    const app = buildApp((_req, res) => { res.json({ ok: true }); }, null);
    await request(app).post('/api/x').send({ campaignId: CAMPAIGN });
    expect(getFromCache(key)).not.toBeNull();
  });
});

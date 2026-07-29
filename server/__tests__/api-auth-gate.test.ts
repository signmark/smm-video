/**
 * Явный гейт авторизации на `/api`.
 *
 * До него весь `/api` закрывался побочным эффектом: `facebookGroupsRouter`
 * смонтирован в `server/index.ts` раньше остальных, а внутри у него
 * верхнеуровневый `router.use(authenticateUser)`. Перестановка одного импорта
 * молча открывала наружу десятки ручек (находка ревью 2026-07-28).
 *
 * Этот файл — единственное место, где список публичных путей зафиксирован
 * тестом. Любое расширение списка обязано появиться здесь же вместе с причиной,
 * иначе «временно открыли и забыли» пройдёт незамеченным.
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

import { createApiAuthGate, isPublicApiPath, PUBLIC_API_PATHS } from '../middleware/api-auth-gate';

/** Заглушка настоящей проверки сессии: важно лишь, звали её или нет. */
const makeApp = () => {
  const authenticate = vi.fn((req: any, res: any, next: any) => {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ error: 'Unauthorized' });
    next();
  });

  const app = express();
  app.use('/api', createApiAuthGate(authenticate as any));
  app.all('/api/*', (_req, res) => res.json({ reached: true }));

  return { app, authenticate };
};

describe('isPublicApiPath', () => {
  it('публичны ровно перечисленные пути', () => {
    expect(isPublicApiPath('/api/yookassa/webhook')).toBe(true);
    expect(isPublicApiPath('/api/instagram-video-proxy/abc123')).toBe(true);
    expect(isPublicApiPath('/api/video-proxy/aHR0cA')).toBe(true);
    expect(isPublicApiPath('/api/video-stream-proxy')).toBe(true);
    expect(isPublicApiPath('/api/media-proxy/aHR0cA')).toBe(true);
    expect(isPublicApiPath('/api/subscriptions/approve')).toBe(true);
    expect(isPublicApiPath('/api/subscriptions/reject')).toBe(true);
    expect(isPublicApiPath('/api/threads/deauth')).toBe(true);
    expect(isPublicApiPath('/api/threads/data-deletion')).toBe(true);
  });

  it('query-строка на решение не влияет', () => {
    expect(isPublicApiPath('/api/subscriptions/approve?userId=1&token=abc')).toBe(true);
    expect(isPublicApiPath('/api/campaigns?userId=1')).toBe(false);
  });

  it('данные приложения публичными не считаются', () => {
    for (const path of [
      '/api/campaigns',
      '/api/campaign-content/123',
      '/api/campaign-trends',
      '/api/keywords',
      '/api/sources',
      '/api/autonomous/all',
      '/api/reports/123/export',
      '/api/proxy/trends',
      '/api/user/profile',
      '/api/admin/promo-codes',
    ]) {
      expect(isPublicApiPath(path), `${path} не должен быть публичным`).toBe(false);
    }
  });

  it('похожие, но чужие пути не проходят по префиксу', () => {
    // Регулярки не должны открывать соседей: ни приписанным хвостом, ни префиксом.
    expect(isPublicApiPath('/api/yookassa/webhook-secret-dump')).toBe(false);
    expect(isPublicApiPath('/api/subscriptions/approve-all')).toBe(false);
    expect(isPublicApiPath('/api/threads/deauthorize-everything')).toBe(false);
    expect(isPublicApiPath('/api/subscriptions')).toBe(false);
    expect(isPublicApiPath('/api/threads/settings')).toBe(false);
  });

  it('каждое исключение снабжено причиной', () => {
    // Список читают люди: запись без объяснения «почему публично» — это заявка
    // на то, что через полгода никто не рискнёт её убрать.
    for (const entry of PUBLIC_API_PATHS) {
      expect(entry.why.length, `правило ${entry.pattern} без причины`).toBeGreaterThan(5);
    }
  });
});

describe('гейт на реальном Express', () => {
  it('запрос без токена к данным приложения → 401, до обработчика не доходит', async () => {
    const { app, authenticate } = makeApp();

    const res = await request(app).get('/api/campaigns');

    expect(res.status).toBe(401);
    expect(authenticate).toHaveBeenCalled();
    expect(res.body.reached).toBeUndefined();
  });

  it('с токеном запрос проходит', async () => {
    const { app } = makeApp();

    const res = await request(app).get('/api/campaigns').set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
    expect(res.body.reached).toBe(true);
  });

  it('публичный путь проходит без токена и проверку сессии не дёргает', async () => {
    const { app, authenticate } = makeApp();

    const res = await request(app).post('/api/yookassa/webhook').send({});

    expect(res.status).toBe(200);
    expect(res.body.reached).toBe(true);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('медиа-прокси открыт: его тянут серверы соцсетей', async () => {
    const { app } = makeApp();

    const res = await request(app).get('/api/instagram-video-proxy/video-42');

    expect(res.status).toBe(200);
  });

  it('preflight OPTIONS не требует токена', async () => {
    const { app, authenticate } = makeApp();

    const res = await request(app).options('/api/campaigns');

    expect(res.status).toBe(200);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('наследство n8n закрыто: вебхук тем трендов требует сессию', async () => {
    // Ручка писала темы в ЛЮБУЮ кампанию служебным токеном без проверок.
    // В список исключений внесена сознательно НЕ была.
    const { app } = makeApp();

    const res = await request(app).post('/api/webhook/trend-topics').send({ campaignId: 'x', trendTopics: [] });

    expect(res.status).toBe(401);
  });
});

/**
 * Временное видео для Meta.
 *
 * Instagram и Threads скачивают файл по этой ссылке сами, без Bearer. Гейт
 * закрыл её вместе со всем остальным — публикация видео в обе платформы
 * ломалась на проде (найдено ревью Codex, подтверждено запросом к живому
 * прод-серверу: GET и HEAD отдавали 401).
 *
 * Исключение намеренно узкое: только чтение и только по идентификатору формы
 * UUID, который выдаёт randomUUID() с TTL 10 минут.
 */
describe('GET/HEAD /api/video-temp/:id — Meta скачивает видео', () => {
  const UUID = '3f1a2b4c-5d6e-4f70-8912-abcdef012345';

  it('GET по UUID проходит без токена', async () => {
    const { app, authenticate } = makeApp();

    const res = await request(app).get(`/api/video-temp/${UUID}`);

    expect(res.status).toBe(200);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('HEAD тоже проходит: Threads сначала проверяет размер', async () => {
    const { app } = makeApp();

    const res = await request(app).head(`/api/video-temp/${UUID}`);

    expect(res.status).toBe(200);
  });

  it('POST по тому же пути закрыт — правило только на чтение', async () => {
    const { app } = makeApp();

    const res = await request(app).post(`/api/video-temp/${UUID}`).send({});

    expect(res.status).toBe(401);
  });

  it('идентификатор не формы UUID закрыт', async () => {
    // Иначе правило открыло бы произвольный путь под этим префиксом.
    const { app } = makeApp();

    for (const bad of ['none', '../campaigns', 'abc', `${UUID}extra`, `${UUID}/../campaigns`]) {
      const res = await request(app).get(`/api/video-temp/${bad}`);
      expect(res.status, `${bad} не должен быть публичным`).toBe(401);
    }
  });

  it('сам /api/video-temp без идентификатора закрыт', async () => {
    const { app } = makeApp();

    const res = await request(app).get('/api/video-temp');

    expect(res.status).toBe(401);
  });
});

/**
 * Табличная проверка исключения `/api/video-temp/:uuid` на обход.
 *
 * Требование handoff 29.07.2026: правило открывает наружу путь без сессии,
 * поэтому его границы проверяются перебором, а не «на глаз». Публичными обязаны
 * остаться РОВНО точный UUID и РОВНО `GET`/`HEAD`.
 *
 * Кодировать `..`/`/` смысла нет — гейт смотрит на `originalUrl`, где
 * `%2e%2e` и `%2f` остаются процентными последовательностями и в регулярку
 * не попадают. Проверяем это явно, чтобы будущая «нормализация пути» перед
 * гейтом не открыла обход молча.
 */
describe('/api/video-temp/:uuid — перебор обходов', () => {
  const UUID_OK = '3f1a5c2e-9b4d-4a7f-8c21-0d5e6f7a8b90';

  const BYPASS_ATTEMPTS = [
    ['кодированный обход вверх', `/api/video-temp/${UUID_OK}/%2e%2e/campaigns`],
    ['кодированный слэш в хвосте', `/api/video-temp/${UUID_OK}%2f..%2fcampaigns`],
    ['кодированный слэш вместо разделителя', `/api/video-temp%2f${UUID_OK}`],
    ['двойной слэш', `/api//video-temp/${UUID_OK}`],
    ['двойной слэш внутри', `/api/video-temp//${UUID_OK}`],
    ['хвостовой слэш', `/api/video-temp/${UUID_OK}/`],
    ['UUID с хвостом', `/api/video-temp/${UUID_OK}.mp4`],
    ['UUID с суффиксом-путём', `/api/video-temp/${UUID_OK}/raw`],
    ['префикс перед UUID', `/api/video-temp/x${UUID_OK}`],
    ['UUID без дефисов', `/api/video-temp/${UUID_OK.replace(/-/g, '')}`],
    ['фрагмент UUID', `/api/video-temp/${UUID_OK.slice(0, 20)}`],
    ['не hex в UUID', '/api/video-temp/3f1a5c2e-9b4d-4a7f-8c21-0d5e6f7a8bZZ'],
  ] as const;

  it.each(BYPASS_ATTEMPTS)('%s остаётся закрытым', (_name, path) => {
    expect(isPublicApiPath(path, 'GET')).toBe(false);
  });

  it('смешанный регистр UUID публичен — hex регистронезависим', () => {
    // Явное решение, а не случайность: флаг `i` в правиле стоит осознанно.
    expect(isPublicApiPath(`/api/video-temp/${UUID_OK.toUpperCase()}`, 'GET')).toBe(true);
  });

  it.each(['GET', 'HEAD', 'get', 'head'])('%s публичен', (method) => {
    expect(isPublicApiPath(`/api/video-temp/${UUID_OK}`, method)).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE'])('%s закрыт', (method) => {
    expect(isPublicApiPath(`/api/video-temp/${UUID_OK}`, method)).toBe(false);
  });

  it('X-HTTP-Method-Override на POST не открывает путь', async () => {
    // Гейт обязан смотреть на настоящий метод запроса. Express сам заголовок
    // не разбирает, но если кто-то поставит method-override middleware ВЫШЕ
    // гейта, POST начнёт выглядеть как GET — тест это заметит.
    const { app } = makeApp();

    for (const override of ['GET', 'HEAD']) {
      const res = await request(app)
        .post(`/api/video-temp/${UUID_OK}`)
        .set('X-HTTP-Method-Override', override)
        .send({});

      expect(res.status, `override ${override} не должен открывать POST`).toBe(401);
    }
  });

  it('хвостовой слэш и двойной слэш закрыты и на живом роутере', async () => {
    const { app } = makeApp();

    for (const path of [`/api/video-temp/${UUID_OK}/`, `/api/video-temp//${UUID_OK}`]) {
      const res = await request(app).get(path);
      expect(res.status, `${path} не должен быть публичным`).toBe(401);
    }
  });
});

/**
 * Граница арендатора в публикующих и конвертирующих ручках.
 *
 * Находки ревью 2026-07-29:
 *  - `/api/publish/content` и `/api/publish-content` принимали ЦЕЛЫЙ объект
 *    `content` из тела и считали его истиной. Можно было прислать
 *    `content.campaignId` своей кампании и `content.id` чужой записи: проверка
 *    шла по одному идентификатору, а служебный PATCH — по другому;
 *  - `/api/real-video-converter/*` вообще не требовал сессии и перезаписывал
 *    `video_url` любой записи, а в `/convert-content` стоял фолбэк «токен
 *    пользователя дал 403 → повторим админским», который обнулял права;
 *  - `/api/publish/auto-update-status` и `/api/publish/update-status` читали и
 *    правили запись служебным токеном без проверки владения.
 *
 * Тесты монтируют НАСТОЯЩИЕ роутеры. Проверяется не только код ответа, но и то,
 * что привилегированная операция не выполнена.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => ({
  assertOwnership: vi.fn(async (_id: string, _req: any, res: any) => {
    res.status(404).json({ success: false, error: 'Контент не найден' });
    return false;
  }),
  getContentById: vi.fn(async () => null as any),
  publish: vi.fn(async () => ({ success: true })),
  directusPatch: vi.fn(async () => ({ data: { data: {} } })),
  directusGet: vi.fn(async () => ({ data: { data: { id: 'c-1', video_url: 'https://cdn.test/v.mp4' } } })),
  convertForInstagram: vi.fn(async () => ({ success: true, convertedUrl: 'https://cdn.test/out.mp4' })),
  updateContentVideoUrl: vi.fn(async () => true),
}));

vi.mock('../services/content-access', () => ({
  assertContentBelongsToRequester: H.assertOwnership,
}));

vi.mock('../services/real-video-converter', () => ({
  realVideoConverter: {
    needsConversion: () => true,
    convertForInstagramStories: H.convertForInstagram,
    convertLocalFile: H.convertForInstagram,
    checkFFmpegAvailable: async () => true,
    updateContentVideoUrl: H.updateContentVideoUrl,
  },
}));

vi.mock('../directus', () => ({
  directusApi: { get: H.directusGet, patch: H.directusPatch, post: vi.fn(), delete: vi.fn() },
  directusApiManager: { request: vi.fn(), instance: { interceptors: { response: { use: vi.fn() } } } },
}));

vi.mock('../middleware/user-auth', () => ({
  authenticateUser: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-stranger', token: 'user-token', is_smm_admin: false };
    next();
  },
  requireSmmAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../utils/logger', () => {
  const l: any = vi.fn();
  l.info = vi.fn(); l.warn = vi.fn(); l.error = vi.fn(); l.debug = vi.fn();
  return { log: l, default: l, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
});

import realVideoConverterRouter from '../routes/real-video-converter';

const FOREIGN = 'content-of-another-tenant';

const makeApp = (router: any, prefix: string) => {
  const app = express();
  app.use(express.json());
  app.use(prefix, router);
  return app;
};

beforeEach(() => {
  vi.clearAllMocks();
  H.assertOwnership.mockImplementation(async (_id: string, _req: any, res: any) => {
    res.status(404).json({ success: false, error: 'Контент не найден' });
    return false;
  });
  H.convertForInstagram.mockImplementation(async () => ({
    success: true, convertedUrl: 'https://cdn.test/out.mp4',
  }));
  H.directusGet.mockImplementation(async () => ({
    data: { data: { id: 'c-1', video_url: 'https://cdn.test/v.mp4' } },
  }));
});

afterEach(() => vi.clearAllMocks());

describe('/api/real-video-converter — конвертация чужого контента', () => {
  const app = () => makeApp(realVideoConverterRouter, '/api/real-video-converter');

  it('convert с чужим contentId → 404, конвертация даже не запускается', async () => {
    const res = await request(app())
      .post('/api/real-video-converter/convert')
      .send({ videoUrl: 'https://cdn.test/in.mp4', forceConvert: true, contentId: FOREIGN });

    expect(res.status).toBe(404);
    // Проверка стоит ДО конвертации: чужой контент не должен отъедать ни
    // процессор, ни место на диске.
    expect(H.convertForInstagram).not.toHaveBeenCalled();
    expect(H.directusPatch).not.toHaveBeenCalled();
  });

  it('convert-content с чужим contentId → 404, запись не читается служебным токеном', async () => {
    const res = await request(app())
      .post('/api/real-video-converter/convert-content')
      .send({ contentId: FOREIGN });

    expect(res.status).toBe(404);
    expect(H.directusGet).not.toHaveBeenCalled();
    expect(H.convertForInstagram).not.toHaveBeenCalled();
  });

  it('со своим contentId конвертация проходит', async () => {
    H.assertOwnership.mockImplementation(async () => true);

    const res = await request(app())
      .post('/api/real-video-converter/convert')
      .send({ videoUrl: 'https://cdn.test/in.mp4', forceConvert: true, contentId: 'c-mine' });

    expect(res.status).toBe(200);
    expect(H.convertForInstagram).toHaveBeenCalled();
  });

  it('contentUpdated=false, если PATCH записи не прошёл', async () => {
    // Раньше отвечали true всегда, когда переданы forceConvert и contentId —
    // клиент считал, что ссылка в записи обновилась.
    H.assertOwnership.mockImplementation(async () => true);
    H.directusPatch.mockImplementation(async () => { throw new Error('directus down'); });

    const res = await request(app())
      .post('/api/real-video-converter/convert')
      .send({ videoUrl: 'https://cdn.test/in.mp4', forceConvert: true, contentId: 'c-mine' });

    expect(res.status).toBe(200);
    expect(res.body.contentUpdated).toBe(false);
  });

  it('недоступная проверка доступа → 503, без обхода служебным токеном', async () => {
    H.assertOwnership.mockImplementation(async (_id: string, _req: any, res: any) => {
      res.status(503).json({ success: false, error: 'Проверка доступа временно недоступна' });
      return false;
    });

    const res = await request(app())
      .post('/api/real-video-converter/convert-content')
      .send({ contentId: 'c-any' });

    expect(res.status).toBe(503);
    expect(H.directusGet).not.toHaveBeenCalled();
  });
});

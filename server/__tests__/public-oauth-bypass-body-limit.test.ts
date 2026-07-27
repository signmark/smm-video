/**
 * Порядок body-parser'ов: публичный callback — 1mb, обычные /api — 50mb.
 *
 * Регрессия: раньше `app.use('/api', express.json({ limit: '1mb' }))` (дважды)
 * перехватывал ВСЕ /api-запросы раньше глобального 50mb-парсера, и обычные API
 * с телом 1–50mb были недостижимы. Тест закрепляет: callback парсится с 1mb
 * (>1mb → 413), а обычный /api доходит до 50mb (1–50mb ок, >50mb → 413).
 *
 * Гоняется РЕАЛЬНЫЙ registerPublicOAuthBypass из production-модуля.
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { registerPublicOAuthBypass } from '../middleware/public-oauth-bypass';

// Настоящий роутер — из его stack хелпер достаёт handler (как в index.ts).
const vkRouter = express.Router();
vkRouter.post('/vk/token-webhook/:campaignId/submit/:secret', (req, res) => {
  res.json({ token: (req.body as any)?.access_token ?? null });
});

const app = express();
// 1) Публичные callback'и — первыми, с точечным 1mb-парсером внутри хелпера.
registerPublicOAuthBypass(
  app,
  [{ router: vkRouter, routerPath: '/vk/token-webhook/:campaignId/submit/:secret', publicPath: '/api/vk/token-webhook/:campaignId/submit/:secret', method: 'post' }],
  { warn: () => {}, info: () => {} },
);
// 2) Глобальный 50mb-парсер и обычный /api-роут — как в index.ts, ПОСЛЕ callback'ов.
app.use('/api', express.json({ limit: '50mb' }));
app.post('/api/normal', (req, res) => {
  res.json({ len: (req.body as any)?.blob?.length ?? 0 });
});
// Дефолтный error-handler Express отдаёт err.status (413 от body-parser).

const bytes = (n: number) => 'a'.repeat(n);
const MB = 1024 * 1024;

describe('body-parser: 1mb для callback, 50mb для обычных /api', () => {
  it('маленький публичный callback получает распарсенное тело', async () => {
    const res = await request(app)
      .post('/api/vk/token-webhook/camp-1/submit/sec-1')
      .send({ access_token: 'short-token' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBe('short-token');
  });

  it('публичный callback с телом >1mb → 413', async () => {
    const res = await request(app)
      .post('/api/vk/token-webhook/camp-1/submit/sec-1')
      .send({ access_token: bytes(2 * MB) });
    expect(res.status).toBe(413);
  });

  it('обычный /api-запрос с телом 1–50mb доходит до роута (200)', async () => {
    const res = await request(app)
      .post('/api/normal')
      .send({ blob: bytes(3 * MB) });
    expect(res.status).toBe(200);
    expect(res.body.len).toBe(3 * MB);
  });

  it('обычный /api-запрос с телом >50mb → 413', async () => {
    const res = await request(app)
      .post('/api/normal')
      .send({ blob: bytes(51 * MB) });
    expect(res.status).toBe(413);
  });
});

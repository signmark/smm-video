import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { healthRouter } from '../routes/health';
import { rootHealthHandler } from '../routes/root-health';

vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    list: vi.fn(),
  },
}));

vi.mock('axios', () => ({
  default: {
    head: vi.fn(),
    get: vi.fn(),
  },
}));

import { directusCrud } from '../services/directus-crud';
import axios from 'axios';

const app = express();
app.use('/api', healthRouter);

describe('Health Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BEGET_S3_BUCKET = process.env.BEGET_S3_BUCKET || 'test-bucket';
  });

  it('должен возвращать 200 и status ok когда все сервисы healthy', async () => {
    vi.mocked(directusCrud.list).mockResolvedValue([]);
    vi.mocked(axios.head).mockResolvedValue({ status: 200 });
    vi.mocked(axios.get).mockResolvedValue({ status: 200 });

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.timestamp).toBeDefined();
    expect(response.body.services.directus).toEqual({ status: 'healthy' });
    expect(response.body.services.s3).toEqual({ status: 'healthy' });
    expect(response.body.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('должен возвращать 503 когда Directus нездоров', async () => {
    vi.mocked(directusCrud.list).mockRejectedValue(new Error('Directus connection failed'));
    vi.mocked(axios.head).mockResolvedValue({ status: 200 });
    vi.mocked(axios.get).mockResolvedValue({ status: 200 });

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('error');
    expect(response.body.services.directus).toEqual({
      status: 'unhealthy',
      error: 'Directus connection failed',
    });
  });

  it('должен помечать S3 как unreachable при ошибке head', async () => {
    vi.mocked(directusCrud.list).mockResolvedValue([]);
    vi.mocked(axios.head).mockRejectedValue(new Error('Network error'));

    const response = await request(app).get('/api/health');

    expect(response.body.services.s3).toEqual({ status: 'unreachable' });
  });

  it('должен помечать S3 как unreachable когда head возвращает null (catch)', async () => {
    vi.mocked(directusCrud.list).mockResolvedValue([]);
    vi.mocked(axios.head).mockImplementation(() => Promise.resolve(null as any));

    const response = await request(app).get('/api/health');

    expect(response.body.services.s3).toEqual({ status: 'unreachable' });
  });

  it('не ходит наружу за n8n и не упоминает его в ответе', async () => {
    // Раньше проверка отвечала полем n8n со статусом «removed» — то есть всё ещё
    // рассказывала про сервис, которого в продукте нет. Теперь его нет и в ответе.
    vi.mocked(directusCrud.list).mockResolvedValue([]);
    vi.mocked(axios.head).mockResolvedValue({ status: 200 });

    const response = await request(app).get('/api/health');

    expect(response.body.services).not.toHaveProperty('n8n');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('должен вызывать directusCrud.list с useAdminToken', async () => {
    vi.mocked(directusCrud.list).mockResolvedValue([]);
    vi.mocked(axios.head).mockResolvedValue({ status: 200 });
    vi.mocked(axios.get).mockResolvedValue({ status: 200 });

    await request(app).get('/api/health');

    expect(directusCrud.list).toHaveBeenCalledWith('user_campaigns', {
      limit: 1,
      useAdminToken: true,
    });
  });
});


/**
 * Корневой `/health` — вход проверки выкатки (AI-50).
 *
 * Deploy-скрипт сверяет три источника SHA: метку образа, метку запущенного
 * контейнера и это поле. Если приложение перестанет его отдавать, проверка
 * выкатки станет молча зелёной на любом образе — поэтому поле закреплено
 * тестом, а не только процедурой.
 */
describe('root /health revision', () => {
  const rootApp = express();
  rootApp.get('/health', rootHealthHandler);

  const original = process.env.APP_COMMIT_SHA;

  // Свой сброс: beforeEach соседнего describe сюда не распространяется, и без
  // этого вызовы из предыдущих тестов файла засчитались бы этому.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.APP_COMMIT_SHA;
    else process.env.APP_COMMIT_SHA = original;
  });

  it('отдаёт SHA сборки из APP_COMMIT_SHA', async () => {
    process.env.APP_COMMIT_SHA = 'a4fb2717cbea0000000000000000000000000000';

    const response = await request(rootApp).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.revision).toBe('a4fb2717cbea0000000000000000000000000000');
  });

  it('без переменной отдаёт unknown, а не пустоту и не падение', async () => {
    delete process.env.APP_COMMIT_SHA;

    const response = await request(rootApp).get('/health');

    // Старые окружения и локальный запуск обязаны работать...
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
    // ...но выдавать себя за выкаченный SHA не должны: deploy сравнивает на
    // равенство, поэтому 'unknown' не пройдёт проверку никогда.
    expect(response.body.revision).toBe('unknown');
  });

  it('пустая переменная не выдаётся за валидный SHA', async () => {
    process.env.APP_COMMIT_SHA = '';

    const response = await request(rootApp).get('/health');

    expect(response.body.revision).toBe('unknown');
  });

  it('не ходит во внешние сервисы: ответ не зависит от Directus и S3', async () => {
    vi.mocked(directusCrud.list).mockRejectedValue(new Error('Directus down'));
    vi.mocked(axios.head).mockRejectedValue(new Error('S3 down'));

    const response = await request(rootApp).get('/health');

    // /api/health в этой же ситуации отдаёт 503 — и это правильно для него.
    // Здесь 200 обязателен: deploy спрашивает «этот ли код запущен», и ответ
    // не должен зависеть от чужих сервисов.
    expect(response.status).toBe(200);
    expect(directusCrud.list).not.toHaveBeenCalled();
    expect(axios.head).not.toHaveBeenCalled();
  });
});

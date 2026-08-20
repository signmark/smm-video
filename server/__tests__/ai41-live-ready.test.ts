/**
 * AI-41: «жив» и «готов» — разные вопросы, и ответы на них не должны совпадать.
 *
 * Проверяем поведение, а не форму: что именно происходит, когда зависимость
 * легла, и что при этом остаётся зелёным.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { classifyStorageOutcome, decideReadiness } from '../routes/readiness';

vi.mock('../services/directus-crud', () => ({
  directusCrud: { list: vi.fn() },
}));
vi.mock('axios', () => ({
  default: {
    head: vi.fn(),
    // SM-45: live-ready теперь импортирует publish-scheduler → directus.ts, и
    // тот зовёт axios.create при загрузке модуля. Без create suite не грузится.
    create: vi.fn().mockReturnValue({
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    }),
  },
}));

import { directusCrud } from '../services/directus-crud';
import axios from 'axios';
import { readyHandler } from '../routes/live-ready';
import { rootHealthHandler } from '../routes/root-health';

const app = express();
app.get('/live', rootHealthHandler);
app.get('/ready', readyHandler);

const OLD_BUCKET = process.env.BEGET_S3_BUCKET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BEGET_S3_BUCKET = 'test-bucket';
});
afterEach(() => {
  if (OLD_BUCKET === undefined) delete process.env.BEGET_S3_BUCKET;
  else process.env.BEGET_S3_BUCKET = OLD_BUCKET;
});

describe('AI-41: приговор о готовности', () => {
  it('обязательная зависимость легла — не готов', () => {
    const v = decideReadiness([
      { name: 'directus', required: true, status: 'down', reason: 'unreachable', duration_ms: 1 },
      { name: 'storage', required: true, status: 'up', duration_ms: 1 },
    ]);
    expect(v.ready).toBe(false);
    expect(v.httpStatus).toBe(503);
  });

  it('необязательная зависимость легла — всё ещё готов', () => {
    const v = decideReadiness([
      { name: 'directus', required: true, status: 'up', duration_ms: 1 },
      { name: 'nice-to-have', required: false, status: 'down', reason: 'timeout', duration_ms: 1 },
    ]);
    expect(v.ready).toBe(true);
    expect(v.httpStatus).toBe(200);
  });

  it('все на месте — готов', () => {
    const v = decideReadiness([{ name: 'directus', required: true, status: 'up', duration_ms: 1 }]);
    expect(v.httpStatus).toBe(200);
  });
});

describe('AI-41: разбор ответа хранилища', () => {
  it('403 означает, что хранилище живо: сервер ответил', () => {
    // Наш бакет отвечает на анонимный HEAD именно 403. Прежний код записывал
    // это в «недоступно», то есть исправное хранилище постоянно числилось сломанным.
    expect(classifyStorageOutcome({ httpStatus: 403 })).toEqual({ status: 'up' });
  });

  it('404 тоже означает, что хранилище живо', () => {
    expect(classifyStorageOutcome({ httpStatus: 404 })).toEqual({ status: 'up' });
  });

  it('истекло ожидание — легло', () => {
    expect(classifyStorageOutcome({ errorCode: 'ECONNABORTED' })).toEqual({
      status: 'down',
      reason: 'timeout',
    });
  });

  it('имя не разрешилось — легло', () => {
    expect(classifyStorageOutcome({ errorCode: 'ENOTFOUND' })).toEqual({
      status: 'down',
      reason: 'unreachable',
    });
  });
});

describe('AI-41: ручки отвечают по-разному на один и тот же сбой', () => {
  it('Directus лёг: /live остаётся 200, /ready краснеет 503', async () => {
    vi.mocked(directusCrud.list).mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:8055'));
    vi.mocked(axios.head).mockResolvedValue({ status: 200 } as any);

    const live = await request(app).get('/live');
    expect(live.status).toBe(200);

    const ready = await request(app).get('/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.status).toBe('not_ready');
    const directus = ready.body.dependencies.find((d: any) => d.name === 'directus');
    expect(directus.status).toBe('down');
  });

  it('всё на месте: /ready отвечает 200 и перечисляет зависимости', async () => {
    vi.mocked(directusCrud.list).mockResolvedValue([] as any);
    vi.mocked(axios.head).mockResolvedValue({ status: 200 } as any);

    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.dependencies.map((d: any) => d.name).sort()).toEqual(['directus', 'storage']);
  });

  it('хранилище ответило 403 — это НЕ повод краснеть', async () => {
    vi.mocked(directusCrud.list).mockResolvedValue([] as any);
    vi.mocked(axios.head).mockRejectedValue({ response: { status: 403 } });

    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    const storage = res.body.dependencies.find((d: any) => d.name === 'storage');
    expect(storage.status).toBe('up');
  });

  it('хранилище не отвечает вовсе — не готов', async () => {
    vi.mocked(directusCrud.list).mockResolvedValue([] as any);
    vi.mocked(axios.head).mockRejectedValue({ code: 'ENOTFOUND' });

    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
  });

  it('в ответе нет ни адресов, ни текстов ошибок: ручка публичная', async () => {
    vi.mocked(directusCrud.list).mockRejectedValue(
      new Error('connect ECONNREFUSED 10.0.0.5:8055 token=secret-value'),
    );
    vi.mocked(axios.head).mockRejectedValue({ code: 'ENOTFOUND' });

    const res = await request(app).get('/ready');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('secret-value');
    expect(body).not.toContain('10.0.0.5');
    expect(body).not.toContain('test-bucket');
    expect(body).not.toContain('storage.beget.cloud');
  });

  it('хранилище не настроено — не готов, и это видно, а не молчит', async () => {
    delete process.env.BEGET_S3_BUCKET;
    vi.mocked(directusCrud.list).mockResolvedValue([] as any);

    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    const storage = res.body.dependencies.find((d: any) => d.name === 'storage');
    expect(storage.status).toBe('down');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import clearCacheRouter from '../routes/clear-cache';

vi.mock('../services/publish-scheduler', () => ({
  publishScheduler: {
    clearTokenCache: vi.fn(),
  },
}));

vi.mock('../services/status-checker', () => ({
  publicationStatusChecker: {
    clearTokenCache: vi.fn(),
  },
}));

vi.mock('../storage', () => ({
  storage: {
    clearTokenCache: vi.fn(),
  },
}));

import { publishScheduler } from '../services/publish-scheduler';
import { publicationStatusChecker } from '../services/status-checker';

const app = express();
app.use('/api', clearCacheRouter);

describe('Clear Cache Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('должен возвращать 200 и success при успешной очистке', async () => {
    const response = await request(app).post('/api/clear-cache');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Кэш токенов успешно очищен');
    expect(response.body.clearedServices).toBeDefined();
    expect(Array.isArray(response.body.clearedServices)).toBe(true);
    expect(response.body.timestamp).toBeDefined();
  });

  it('должен вызывать clearTokenCache у publishScheduler', async () => {
    await request(app).post('/api/clear-cache');

    expect(publishScheduler.clearTokenCache).toHaveBeenCalled();
  });

  it('должен вызывать clearTokenCache у publicationStatusChecker', async () => {
    await request(app).post('/api/clear-cache');

    expect(publicationStatusChecker.clearTokenCache).toHaveBeenCalled();
  });

  it('должен включать очищенные сервисы в ответ', async () => {
    const response = await request(app).post('/api/clear-cache');

    expect(response.body.clearedServices).toContain('publish-scheduler');
    expect(response.body.clearedServices).toContain('status-checker');
  });
});

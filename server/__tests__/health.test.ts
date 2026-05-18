import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { healthRouter } from '../routes/health';

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
    process.env.N8N_URL = process.env.N8N_URL || 'https://n8n.test.example';
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
    expect(response.body.services.n8n).toEqual({ status: 'healthy' });
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

  it('должен помечать n8n как unreachable когда get возвращает null', async () => {
    vi.mocked(directusCrud.list).mockResolvedValue([]);
    vi.mocked(axios.head).mockResolvedValue({ status: 200 });
    vi.mocked(axios.get).mockImplementation(() => Promise.resolve(null as any));

    const response = await request(app).get('/api/health');

    expect(response.body.services.n8n).toEqual({ status: 'unreachable' });
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

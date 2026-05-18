import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { featureFlagsRouter } from '../routes/feature-flags';

const app = express();
app.use('/api', featureFlagsRouter);

describe('Feature Flags Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/feature-flags', () => {
    it('должен возвращать объект с feature flags', async () => {
      const response = await request(app).get('/api/feature-flags');

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(typeof response.body).toBe('object');
      expect(response.body).toHaveProperty('instagramStories');
      expect(response.body).toHaveProperty('videoEditor');
      expect(response.body).toHaveProperty('aiImageGeneration');
      expect(response.body).toHaveProperty('youtubePublishing');
      expect(response.body).toHaveProperty('telegramPublishing');
      expect(typeof response.body.instagramStories).toBe('boolean');
      expect(typeof response.body.videoEditor).toBe('boolean');
    });
  });

  describe('GET /api/feature-flags/descriptions', () => {
    it('должен возвращать flags, descriptions и defaults', async () => {
      const response = await request(app).get('/api/feature-flags/descriptions');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('flags');
      expect(response.body).toHaveProperty('descriptions');
      expect(response.body).toHaveProperty('defaults');
      expect(typeof response.body.flags).toBe('object');
      expect(typeof response.body.descriptions).toBe('object');
      expect(typeof response.body.defaults).toBe('object');
    });
  });

  describe('PATCH /api/feature-flags', () => {
    it('должен возвращать 501 Not Implemented', async () => {
      const response = await request(app).patch('/api/feature-flags');

      expect(response.status).toBe(501);
      expect(response.body.error).toBe('Feature flag updates not implemented yet');
      expect(response.body.message).toContain('environment-based');
    });
  });
});

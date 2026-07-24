import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  registerUploadImageRoute,
  validateImageUpload,
  sniffImageType,
  buildStorageKey,
  UPLOAD_IMAGE_MAX_BYTES,
} from '../api/upload-image-route';

// Security §4 regression: /api/s3/upload-image — лимит размера (413), MIME+magic bytes
// allowlist (415), серверный S3 key, generic ошибки без internal error.message.
// См. docs/followups/2026-07-24-security-backlog.md §4.

vi.mock('../directus', () => ({
  directusApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  directusApiManager: {
    request: vi.fn(),
    cacheAuthToken: vi.fn(),
    instance: { interceptors: { response: { use: vi.fn() } } },
  },
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const uploadFileMock = vi.fn();
const app = express();
registerUploadImageRoute(app, () => ({ uploadFile: uploadFileMock }));

const createMockToken = (payload: object) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${body}.signature`;
};

const stubAuthFetch = () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { id: 'stub', is_smm_admin: false } }),
    text: async () => '',
    clone() { return this; },
  }));
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const validPng = Buffer.concat([PNG_MAGIC, Buffer.alloc(64, 1)]);
const validJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

const freshToken = (tag: string) =>
  createMockToken({ id: `upload-user-${tag}-${Date.now()}`, email: 'u@example.com' });

describe('Security §4: upload endpoint hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubAuthFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('unit: sniffImageType / validateImageUpload', () => {
    it('распознаёт magic bytes JPEG/PNG/GIF/WebP и отвергает прочее', () => {
      expect(sniffImageType(validJpeg)).toBe('image/jpeg');
      expect(sniffImageType(validPng)).toBe('image/png');
      expect(sniffImageType(Buffer.from('GIF89a-data'))).toBe('image/gif');
      const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
      expect(sniffImageType(webp)).toBe('image/webp');
      expect(sniffImageType(Buffer.from('just text'))).toBeNull();
      expect(sniffImageType(Buffer.from('<svg xmlns="..."></svg>'))).toBeNull();
    });

    it('413 при превышении лимита, 415 при чужом MIME и при подмене содержимого', () => {
      const big = { size: UPLOAD_IMAGE_MAX_BYTES + 1, mimetype: 'image/png', buffer: validPng };
      expect(validateImageUpload(big)).toMatchObject({ ok: false, status: 413 });

      const badMime = { size: 100, mimetype: 'application/pdf', buffer: validPng };
      expect(validateImageUpload(badMime)).toMatchObject({ ok: false, status: 415 });

      const spoofed = { size: 100, mimetype: 'image/png', buffer: Buffer.from('MZ executable') };
      expect(validateImageUpload(spoofed)).toMatchObject({ ok: false, status: 415 });

      const good = { size: validPng.length, mimetype: 'image/png', buffer: validPng };
      expect(validateImageUpload(good)).toMatchObject({ ok: true, contentType: 'image/png', ext: 'png' });
    });

    it('buildStorageKey не использует клиентское имя и имеет предсказуемый формат', () => {
      expect(buildStorageKey('png')).toMatch(/^stories\/story-\d+-[0-9a-f]{16}\.png$/);
    });
  });

  describe('POST /api/s3/upload-image', () => {
    it('401 для анонимного запроса', async () => {
      const response = await request(app)
        .post('/api/s3/upload-image')
        .attach('image', validPng, { filename: 'a.png', contentType: 'image/png' });
      expect(response.status).toBe(401);
      expect(uploadFileMock).not.toHaveBeenCalled();
    });

    it('413 для файла больше лимита', async () => {
      const oversized = Buffer.concat([PNG_MAGIC, Buffer.alloc(UPLOAD_IMAGE_MAX_BYTES, 1)]);
      const response = await request(app)
        .post('/api/s3/upload-image')
        .set('Authorization', `Bearer ${freshToken('big')}`)
        .attach('image', oversized, { filename: 'big.png', contentType: 'image/png' });
      expect(response.status).toBe(413);
      expect(uploadFileMock).not.toHaveBeenCalled();
    });

    it('415 для не-изображения', async () => {
      const response = await request(app)
        .post('/api/s3/upload-image')
        .set('Authorization', `Bearer ${freshToken('txt')}`)
        .attach('image', Buffer.from('plain text payload'), { filename: 'x.txt', contentType: 'text/plain' });
      expect(response.status).toBe(415);
      expect(uploadFileMock).not.toHaveBeenCalled();
    });

    it('415 при подмене: заявлен PNG, содержимое — не PNG', async () => {
      const response = await request(app)
        .post('/api/s3/upload-image')
        .set('Authorization', `Bearer ${freshToken('spoof')}`)
        .attach('image', Buffer.from('#!/bin/sh echo pwned'), { filename: 'safe.png', contentType: 'image/png' });
      expect(response.status).toBe(415);
      expect(uploadFileMock).not.toHaveBeenCalled();
    });

    it('200 для валидного PNG; S3 key серверный, без originalname', async () => {
      uploadFileMock.mockResolvedValue({ success: true, url: 'https://s3.example.com/stories/x.png' });
      const response = await request(app)
        .post('/api/s3/upload-image')
        .set('Authorization', `Bearer ${freshToken('ok')}`)
        .attach('image', validPng, { filename: '../../../evil<script>.png', contentType: 'image/png' });
      expect(response.status).toBe(200);
      expect(response.body.data.url).toBe('https://s3.example.com/stories/x.png');
      expect(uploadFileMock).toHaveBeenCalledTimes(1);
      const { key, contentType } = uploadFileMock.mock.calls[0][0];
      expect(key).toMatch(/^stories\/story-\d+-[0-9a-f]{16}\.png$/);
      expect(key).not.toContain('evil');
      expect(key).not.toContain('..');
      expect(contentType).toBe('image/png');
    });

    it('500 без утечки внутреннего error.message при сбое S3', async () => {
      const internal = 'AccessDenied: bucket smm-secret-bucket key rotation failed';
      uploadFileMock.mockResolvedValue({ success: false, error: internal });
      const response = await request(app)
        .post('/api/s3/upload-image')
        .set('Authorization', `Bearer ${freshToken('s3fail')}`)
        .attach('image', validJpeg, { filename: 'a.jpg', contentType: 'image/jpeg' });
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Ошибка загрузки изображения');
      expect(JSON.stringify(response.body)).not.toContain('smm-secret-bucket');
    });
  });
});

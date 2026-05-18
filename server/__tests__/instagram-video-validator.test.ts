/**
 * Unit tests for server/utils/instagram-video-validator.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateVideoReport,
  validateInstagramVideoUrl,
  quickInstagramCheck,
  type VideoValidationResult,
} from '../utils/instagram-video-validator';

vi.mock('../utils/logger', () => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('server/utils/instagram-video-validator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateVideoReport', () => {
    it('должен генерировать отчет для валидного видео', () => {
      const validation: VideoValidationResult = {
        isValid: true,
        errors: [],
        warnings: [],
        details: {
          statusCode: 200,
          contentType: 'video/mp4',
          acceptRanges: true,
          contentLength: 5 * 1024 * 1024,
        },
      };

      const report = generateVideoReport(validation, 'https://example.com/video.mp4');

      expect(report).toContain('=== ДИАГНОСТИКА ВИДЕО ДЛЯ INSTAGRAM ===');
      expect(report).toContain('https://example.com/video.mp4');
      expect(report).toContain('✅ ВАЛИДНЫЙ');
      expect(report).toContain('HTTP Status: 200');
      expect(report).toContain('Content-Type: video/mp4');
      expect(report).toContain('Accept-Ranges: ✅ bytes');
      expect(report).toContain('Размер файла: 5.0 MB');
    });

    it('должен включать ошибки в отчет', () => {
      const validation: VideoValidationResult = {
        isValid: false,
        errors: ['HTTP Error: 404', 'Content-Type invalid'],
        warnings: [],
        details: {},
      };

      const report = generateVideoReport(validation, 'https://bad.com/video');

      expect(report).toContain('❌ НЕВАЛИДНЫЙ');
      expect(report).toContain('🚫 ОШИБКИ:');
      expect(report).toContain('HTTP Error: 404');
      expect(report).toContain('Content-Type invalid');
    });

    it('должен включать предупреждения', () => {
      const validation: VideoValidationResult = {
        isValid: true,
        errors: [],
        warnings: ['Content-Length не определен'],
        details: {},
      };

      const report = generateVideoReport(validation, 'https://example.com/v');

      expect(report).toContain('⚠️ ПРЕДУПРЕЖДЕНИЯ:');
      expect(report).toContain('Content-Length не определен');
    });

    it('должен включать заголовки при их наличии', () => {
      const validation: VideoValidationResult = {
        isValid: true,
        errors: [],
        warnings: [],
        details: {
          headers: { 'content-type': 'video/mp4', 'accept-ranges': 'bytes' },
        },
      };

      const report = generateVideoReport(validation, 'https://x.com/v');

      expect(report).toContain('📋 HTTP ЗАГОЛОВКИ:');
      expect(report).toContain('content-type: video/mp4');
    });
  });

  describe('validateInstagramVideoUrl', () => {
    it('должен возвращать валидный результат при корректных заголовках', async () => {
      const mockHeaders = new Headers({
        'content-type': 'video/mp4',
        'accept-ranges': 'bytes',
        'content-length': '1000000',
      });

      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: mockHeaders,
          })
          .mockResolvedValueOnce({
            status: 206,
            headers: new Headers(),
          })
      );

      const result = await validateInstagramVideoUrl('https://example.com/video.mp4');

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.details?.contentType).toBe('video/mp4');
      expect(result.details?.acceptRanges).toBe(true);
    });

    it('должен возвращать невалидный результат при неверном Content-Type', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({
            'content-type': 'text/html',
            'accept-ranges': 'bytes',
          }),
        })
      );

      const result = await validateInstagramVideoUrl('https://example.com/page');

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('Content-Type'))).toBe(true);
    });

    it('должен возвращать невалидный результат при отсутствии Accept-Ranges', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers({
              'content-type': 'video/mp4',
              'accept-ranges': 'none',
            }),
          })
          .mockResolvedValueOnce({ status: 200 })
      );

      const result = await validateInstagramVideoUrl('https://example.com/v.mp4');

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('Accept-Ranges'))).toBe(true);
    });

    it('должен обрабатывать ошибку сети', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failed')));

      const result = await validateInstagramVideoUrl('https://example.com/video');

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('quickInstagramCheck', () => {
    it('должен возвращать true при валидных заголовках', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers({
            'content-type': 'video/mp4',
            'accept-ranges': 'bytes',
          }),
        })
      );

      const result = await quickInstagramCheck('https://example.com/v.mp4');

      expect(result).toBe(true);
    });

    it('должен возвращать false при невалидном Content-Type', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers({
            'content-type': 'text/html',
            'accept-ranges': 'bytes',
          }),
        })
      );

      const result = await quickInstagramCheck('https://example.com/p');

      expect(result).toBe(false);
    });

    it('должен возвращать false при ошибке fetch', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed')));

      const result = await quickInstagramCheck('https://invalid');

      expect(result).toBe(false);
    });
  });
});

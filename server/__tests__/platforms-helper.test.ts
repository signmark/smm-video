/**
 * Unit tests for server/utils/platforms-helper.ts
 */

import { describe, it, expect } from 'vitest';
import {
  normalizePlatforms,
  createPendingStatuses,
  updatePlatformData,
  isValidPlatformsObject,
  extractPlatformNames,
} from '../utils/platforms-helper';

describe('server/utils/platforms-helper', () => {
  describe('normalizePlatforms', () => {
    it('должен возвращать {} для null', () => {
      expect(normalizePlatforms(null)).toEqual({});
    });

    it('должен возвращать {} для undefined', () => {
      expect(normalizePlatforms(undefined)).toEqual({});
    });

    it('должен преобразовывать массив в объект', () => {
      const arr = [
        { platform: 'instagram', status: 'published' },
        { platform: 'vk', status: 'pending' },
      ];
      const result = normalizePlatforms(arr);
      expect(result).toEqual({
        instagram: { platform: 'instagram', status: 'published' },
        vk: { platform: 'vk', status: 'pending' },
      });
    });

    it('должен очищать числовые ключи из объекта', () => {
      const obj = {
        instagram: { platform: 'instagram', status: 'ok' },
        0: { platform: 'vk' },
        '1': 'junk',
      };
      const result = normalizePlatforms(obj);
      expect(result).toEqual({
        instagram: { platform: 'instagram', status: 'ok' },
      });
    });

    it('должен возвращать объект как есть (без числовых ключей)', () => {
      const obj = { telegram: { platform: 'telegram', status: 'done' } };
      expect(normalizePlatforms(obj)).toEqual(obj);
    });

    it('должен пропускать элементы массива без platform', () => {
      const arr = [
        { platform: 'ig', status: 'ok' },
        { status: 'ok' },
        null,
      ];
      const result = normalizePlatforms(arr);
      expect(result).toEqual({ ig: { platform: 'ig', status: 'ok' } });
    });
  });

  describe('createPendingStatuses', () => {
    it('должен создавать pending статусы', () => {
      const result = createPendingStatuses(['instagram', 'vk']);
      expect(result.instagram).toEqual({
        platform: 'instagram',
        status: 'pending',
        publishedAt: expect.any(String),
      });
      expect(result.vk.status).toBe('pending');
    });

    it('должен создавать scheduled при isScheduled=true', () => {
      const result = createPendingStatuses(['telegram'], true);
      expect(result.telegram.status).toBe('scheduled');
    });

    it('должен обрабатывать пустой массив', () => {
      const result = createPendingStatuses([]);
      expect(result).toEqual({});
    });
  });

  describe('updatePlatformData', () => {
    it('должен обновлять данные платформы', () => {
      const current = {
        instagram: { platform: 'instagram', status: 'pending' },
      };
      const result = updatePlatformData(current, 'instagram', {
        status: 'published',
        postId: 'post-123',
      });
      expect(result.instagram.status).toBe('published');
      expect(result.instagram.postId).toBe('post-123');
      expect(result.instagram.platform).toBe('instagram');
    });

    it('должен добавлять новую платформу', () => {
      const current = { instagram: { platform: 'instagram' } };
      const result = updatePlatformData(current, 'vk', { status: 'pending' });
      expect(result.vk).toEqual({ platform: 'vk', status: 'pending' });
    });

    it('должен нормализовать current если это массив', () => {
      const current = [{ platform: 'ig', status: 'ok' }];
      const result = updatePlatformData(current, 'ig', { postId: 'p1' });
      expect(result.ig.postId).toBe('p1');
    });
  });

  describe('isValidPlatformsObject', () => {
    it('должен возвращать false для null', () => {
      expect(isValidPlatformsObject(null)).toBe(false);
    });

    it('должен возвращать false для примитивов', () => {
      expect(isValidPlatformsObject('string')).toBe(false);
      expect(isValidPlatformsObject(123)).toBe(false);
    });

    it('должен возвращать false для массива', () => {
      expect(isValidPlatformsObject([{ platform: 'ig' }])).toBe(false);
    });

    it('должен возвращать false при наличии числовых ключей', () => {
      expect(isValidPlatformsObject({ 0: 'val', instagram: {} })).toBe(false);
    });

    it('должен возвращать true для валидного объекта', () => {
      expect(isValidPlatformsObject({ instagram: {}, vk: {} })).toBe(true);
    });

    it('должен возвращать true для пустого объекта', () => {
      expect(isValidPlatformsObject({})).toBe(true);
    });
  });

  describe('extractPlatformNames', () => {
    it('должен возвращать [] для null/undefined', () => {
      expect(extractPlatformNames(null)).toEqual([]);
      expect(extractPlatformNames(undefined)).toEqual([]);
    });

    it('должен извлекать имена из массива объектов', () => {
      const arr = [
        { platform: 'instagram' },
        { platform: 'vk' },
        { platform: 'telegram' },
      ];
      expect(extractPlatformNames(arr)).toEqual(['instagram', 'vk', 'telegram']);
    });

    it('должен извлекать имена из массива строк', () => {
      expect(extractPlatformNames(['ig', 'vk', 'tg'])).toEqual(['ig', 'vk', 'tg']);
    });

    it('должен извлекать ключи из объекта (исключая числовые)', () => {
      const obj = { instagram: {}, vk: {}, '0': {} };
      expect(extractPlatformNames(obj)).toEqual(['instagram', 'vk']);
    });
  });
});

/**
 * Unit tests for shared/feature-flags.ts
 * Тестирует feature flags и окружение
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_FEATURE_FLAGS,
  getFeatureFlags,
  FEATURE_DESCRIPTIONS,
  type FeatureFlags,
} from '../feature-flags';

describe('shared/feature-flags', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('DEFAULT_FEATURE_FLAGS', () => {
    it('должен содержать все обязательные ключи', () => {
      const requiredKeys: (keyof FeatureFlags)[] = [
        'instagramStories',
        'videoEditor',
        'aiImageGeneration',
        'youtubePublishing',
        'instagramPublishing',
        'telegramPublishing',
        'sentimentAnalysis',
        'trendsAnalysis',
        'commentCollection',
        'automatedPosting',
        'schedulerAdvanced',
        'multiCampaignManagement',
      ];
      requiredKeys.forEach((key) => {
        expect(DEFAULT_FEATURE_FLAGS).toHaveProperty(key);
        expect(typeof DEFAULT_FEATURE_FLAGS[key]).toBe('boolean');
      });
    });

    it('должен иметь ожидаемые значения для стабильных фич', () => {
      expect(DEFAULT_FEATURE_FLAGS.instagramStories).toBe(true);
      expect(DEFAULT_FEATURE_FLAGS.videoEditor).toBe(true);
      expect(DEFAULT_FEATURE_FLAGS.youtubePublishing).toBe(true);
      expect(DEFAULT_FEATURE_FLAGS.telegramPublishing).toBe(true);
    });
  });

  describe('getFeatureFlags', () => {
    it('должен возвращать production флаги при NODE_ENV=production', () => {
      process.env.NODE_ENV = 'production';
      const flags = getFeatureFlags();
      expect(flags.instagramStories).toBe(true);
      expect(flags.instagramPublishing).toBe(false);
      expect(flags.videoEditor).toBe(true);
    });

    it('должен возвращать staging флаги при NODE_ENV=staging', () => {
      process.env.NODE_ENV = 'staging';
      const flags = getFeatureFlags();
      expect(flags.instagramStories).toBe(true);
      expect(flags.instagramPublishing).toBe(true);
    });

    it('должен возвращать development флаги при NODE_ENV=development', () => {
      process.env.NODE_ENV = 'development';
      const flags = getFeatureFlags();
      expect(flags.instagramStories).toBe(true);
      expect(flags.instagramPublishing).toBe(true);
    });

    it('должен возвращать development флаги по умолчанию (unknown env)', () => {
      process.env.NODE_ENV = 'unknown';
      const flags = getFeatureFlags();
      expect(flags.instagramStories).toBe(true);
      expect(flags.instagramPublishing).toBe(true);
    });

    it('должен возвращать development при undefined NODE_ENV', () => {
      delete process.env.NODE_ENV;
      const flags = getFeatureFlags();
      expect(flags.instagramPublishing).toBe(true);
    });
  });

  describe('FEATURE_DESCRIPTIONS', () => {
    it('должен содержать описание для каждого флага', () => {
      const flagKeys = Object.keys(DEFAULT_FEATURE_FLAGS) as (keyof FeatureFlags)[];
      flagKeys.forEach((key) => {
        expect(FEATURE_DESCRIPTIONS).toHaveProperty(key);
        expect(typeof FEATURE_DESCRIPTIONS[key]).toBe('string');
        expect(FEATURE_DESCRIPTIONS[key].length).toBeGreaterThan(0);
      });
    });
  });
});

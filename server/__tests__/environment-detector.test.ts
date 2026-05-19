/**
 * Unit tests for server/utils/environment-detector.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectEnvironment } from '../utils/environment-detector';

describe('server/utils/environment-detector', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('detectEnvironment', () => {
    it('должен определять development при ENV=development', () => {
      process.env.ENV = 'development';
      const config = detectEnvironment();
      expect(config.environment).toBe('development');
      expect(config.debugScheduler).toBe(true);
      expect(config.verboseLogs).toBe(true);
    });

    it('должен определять production при ENV=production', () => {
      process.env.ENV = 'production';
      const config = detectEnvironment();
      expect(config.environment).toBe('production');
    });

    it('должен определять production по умолчанию', () => {
      delete process.env.ENV;
      delete process.env.NODE_ENV;
      const config = detectEnvironment();
      expect(config.environment).toBe('production');
    });

    it('должен использовать DIRECTUS_URL из env', () => {
      process.env.DIRECTUS_URL = 'https://custom-directus.test';
      const config = detectEnvironment();
      expect(config.directusUrl).toBe('https://custom-directus.test');
    });

    it('должен использовать DIRECTUS_ADMIN_EMAIL и DIRECTUS_ADMIN_PASSWORD', () => {
      process.env.DIRECTUS_ADMIN_EMAIL = 'admin@test.com';
      process.env.DIRECTUS_ADMIN_PASSWORD = 'secret123';
      const config = detectEnvironment();
      expect(config.adminEmail).toBe('admin@test.com');
      expect(config.adminPassword).toBe('secret123');
    });

    it('должен применять LOG_LEVEL из env', () => {
      process.env.LOG_LEVEL = 'warn';
      const config = detectEnvironment();
      expect(config.logLevel).toBe('warn');
    });

    it('должен включать debugScheduler при DEBUG_SCHEDULER=true', () => {
      process.env.ENV = 'production';
      process.env.DEBUG_SCHEDULER = 'true';
      const config = detectEnvironment();
      expect(config.debugScheduler).toBe(true);
    });

    it('должен включать verboseLogs при VERBOSE_LOGS=true', () => {
      process.env.ENV = 'production';
      process.env.VERBOSE_LOGS = 'true';
      const config = detectEnvironment();
      expect(config.verboseLogs).toBe(true);
    });

    it('должен возвращать дефолтные credentials при отсутствии env', () => {
      delete process.env.DIRECTUS_ADMIN_EMAIL;
      delete process.env.DIRECTUS_ADMIN_PASSWORD;
      const config = detectEnvironment();
      expect(config.adminEmail).toBeDefined();
      expect(config.adminPassword).toBeDefined();
    });
  });
});

/**
 * Unit tests for server/utils/url-utils.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeSourceUrl } from '../utils/url-utils';

describe('server/utils/url-utils', () => {
  const domain = 'smm.omemo.tech';

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('normalizeSourceUrl', () => {
    it('должен возвращать undefined для null', () => {
      expect(normalizeSourceUrl(null, domain)).toBeUndefined();
    });

    it('должен возвращать undefined для undefined', () => {
      expect(normalizeSourceUrl(undefined, domain)).toBeUndefined();
    });

    it('должен возвращать undefined для пустой строки', () => {
      expect(normalizeSourceUrl('', domain)).toBeUndefined();
    });

    it('должен возвращать URL если hostname совпадает с domain', () => {
      const url = 'https://smm.omemo.tech/path/to/page';
      expect(normalizeSourceUrl(url, domain)).toBe(url);
    });

    it('должен возвращать undefined если hostname не совпадает', () => {
      const url = 'https://evil.com/path';
      expect(normalizeSourceUrl(url, domain)).toBeUndefined();
    });

    it('должен возвращать undefined для невалидного URL', () => {
      const invalidUrl = 'not-a-valid-url!!!';
      expect(normalizeSourceUrl(invalidUrl, domain)).toBeUndefined();
      expect(console.error).toHaveBeenCalled();
    });

    it('должен учитывать subdomain если domain указан без него', () => {
      const url = 'https://app.smm.omemo.tech/page';
      expect(normalizeSourceUrl(url, 'smm.omemo.tech')).toBeUndefined();
    });

    it('должен обрабатывать URL с портом если hostname совпадает', () => {
      const url = 'https://smm.omemo.tech:443/page';
      const result = normalizeSourceUrl(url, domain);
      expect(result).toBe(url);
    });
  });
});

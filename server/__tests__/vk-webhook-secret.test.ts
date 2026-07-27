/**
 * Юнит-тесты для secret-хелпера VK token-webhook.
 * Генерация уникальна/url-safe; сравнение константно-временное и строгое.
 */
import { describe, it, expect } from 'vitest';
import { generateVkWebhookSecret, vkWebhookSecretMatches } from '../services/vk-webhook-secret';

describe('generateVkWebhookSecret', () => {
  it('url-safe (без /+= и пробелов) и достаточной длины', () => {
    const s = generateVkWebhookSecret();
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBeGreaterThanOrEqual(32);
  });

  it('уникален между вызовами', () => {
    const set = new Set(Array.from({ length: 100 }, () => generateVkWebhookSecret()));
    expect(set.size).toBe(100);
  });
});

describe('vkWebhookSecretMatches', () => {
  it('совпадение → true', () => {
    const s = generateVkWebhookSecret();
    expect(vkWebhookSecretMatches(s, s)).toBe(true);
  });

  it('несовпадение → false', () => {
    expect(vkWebhookSecretMatches('aaa', 'bbb')).toBe(false);
  });

  it('разная длина → false (без исключения timingSafeEqual)', () => {
    expect(vkWebhookSecretMatches('short', 'a-much-longer-secret-value')).toBe(false);
  });

  it('пустые/отсутствующие значения → false', () => {
    expect(vkWebhookSecretMatches('', 'x')).toBe(false);
    expect(vkWebhookSecretMatches('x', '')).toBe(false);
    expect(vkWebhookSecretMatches(undefined, 'x')).toBe(false);
    expect(vkWebhookSecretMatches('x', null)).toBe(false);
    expect(vkWebhookSecretMatches(null, null)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { shouldSkipGlobalApiRateLimit } from '../middleware/global-api-rate-limit';

describe('global API rate-limit exclusions', () => {
  it('keeps provider webhooks outside the generic limiter', () => {
    expect(shouldSkipGlobalApiRateLimit('/yookassa/webhook')).toBe(true);
    expect(shouldSkipGlobalApiRateLimit('/webhook/trend-topics')).toBe(true);
  });

  it('does not exempt authenticated VK token-webhook control endpoints', () => {
    expect(shouldSkipGlobalApiRateLimit('/vk/token-webhook/camp-1/prepare')).toBe(false);
    expect(shouldSkipGlobalApiRateLimit('/vk/token-webhook/camp-1/status')).toBe(false);
    expect(shouldSkipGlobalApiRateLimit('/vk/token-webhook/camp-1/reconnecting')).toBe(false);
    expect(shouldSkipGlobalApiRateLimit('/vk/token-webhook/camp-1/rotate')).toBe(false);
    expect(shouldSkipGlobalApiRateLimit('/vk/token-webhook/camp-1/secret')).toBe(false);
  });
});

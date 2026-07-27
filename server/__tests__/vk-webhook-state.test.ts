/**
 * Одноразовый state для публичного VK token-webhook.
 * Проверяем контракт: валидность, привязка к кампании, TTL, одноразовость, replay.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createVkWebhookState,
  consumeVkWebhookState,
  __resetVkWebhookStateStore,
  VK_WEBHOOK_STATE_TTL_MS,
} from '../services/vk-webhook-state';

const CAMPAIGN = 'camp-1';
const USER = 'user-1';

beforeEach(() => {
  __resetVkWebhookStateStore();
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('vk-webhook-state', () => {
  it('валидный state гасится один раз и отдаёт campaignId/userId', () => {
    const nonce = createVkWebhookState(CAMPAIGN, USER);
    const r = consumeVkWebhookState(nonce, CAMPAIGN);
    expect(r).toEqual({ ok: true, campaignId: CAMPAIGN, userId: USER });
  });

  it('отсутствующий/поддельный state → missing', () => {
    expect(consumeVkWebhookState(undefined, CAMPAIGN)).toEqual({ ok: false, reason: 'missing' });
    expect(consumeVkWebhookState('nope', CAMPAIGN)).toEqual({ ok: false, reason: 'missing' });
  });

  it('state другой кампании → campaign_mismatch, не гасится по чужому id', () => {
    const nonce = createVkWebhookState(CAMPAIGN, USER);
    expect(consumeVkWebhookState(nonce, 'other-campaign')).toEqual({ ok: false, reason: 'campaign_mismatch' });
    // По правильной кампании всё ещё валиден (mismatch не должен гасить).
    expect(consumeVkWebhookState(nonce, CAMPAIGN)).toEqual({ ok: true, campaignId: CAMPAIGN, userId: USER });
  });

  it('replay использованного state → used', () => {
    const nonce = createVkWebhookState(CAMPAIGN, USER);
    expect(consumeVkWebhookState(nonce, CAMPAIGN).ok).toBe(true);
    expect(consumeVkWebhookState(nonce, CAMPAIGN)).toEqual({ ok: false, reason: 'used' });
  });

  it('протухший state → expired', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T00:00:00Z'));
    const nonce = createVkWebhookState(CAMPAIGN, USER);
    vi.setSystemTime(new Date(Date.now() + VK_WEBHOOK_STATE_TTL_MS + 1000));
    expect(consumeVkWebhookState(nonce, CAMPAIGN)).toEqual({ ok: false, reason: 'expired' });
  });
});

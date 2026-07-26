import { describe, expect, it } from 'vitest';
import {
  sanitizeFacebookAccount,
  sanitizeInstagramAccount,
  sanitizeOAuthSecrets,
  mergeOAuthSettings,
} from '../services/oauth-response-sanitizer';

describe('OAuth response sanitizer', () => {
  it('removes Facebook page and user token fields', () => {
    const result = sanitizeFacebookAccount({
      id: 'page-1',
      name: 'Page',
      access_token: 'page-secret',
      user_token: 'user-secret',
      tasks: ['MANAGE'],
    });
    expect(result).toMatchObject({ id: 'page-1', name: 'Page', hasAccessToken: true });
    expect(result).not.toHaveProperty('access_token');
    expect(result).not.toHaveProperty('user_token');
  });

  it('removes Instagram page access tokens', () => {
    const result = sanitizeInstagramAccount({
      instagramId: 'ig-1',
      username: 'account',
      pageAccessToken: 'page-secret',
    });
    expect(result).toMatchObject({ instagramId: 'ig-1', username: 'account' });
    expect(result).not.toHaveProperty('pageAccessToken');
  });

  it('recursively removes credential keys from campaign DTOs', () => {
    const result = sanitizeOAuthSecrets({
      youtube: { accessToken: 'a', refresh_token: 'b', channelId: 'channel' },
      instagram: { appSecret: 'c', accounts: [{ pageAccessToken: 'd', id: 'ig' }] },
      nested: { password: 'e', bot_token: 'f', configured: true },
    });
    expect(result).toEqual({
      youtube: { channelId: 'channel', hasAccessToken: true, hasRefreshToken: true },
      instagram: { hasAppSecret: true, accounts: [{ id: 'ig', hasPageAccessToken: true }] },
      nested: { configured: true, hasPassword: true, hasBotToken: true },
    });
  });

  it('marks a stored secret as present without revealing it', () => {
    const result = sanitizeOAuthSecrets({ telegram: { token: 'bot-secret', chatId: '@channel' } }) as any;
    expect(result.telegram).toEqual({ chatId: '@channel', hasToken: true });
    expect(JSON.stringify(result)).not.toContain('bot-secret');
  });

  it('does not mark absent or empty secrets as present', () => {
    expect(sanitizeOAuthSecrets({ telegram: { token: '', chatId: '@channel' } }))
      .toEqual({ telegram: { chatId: '@channel' } });
    expect(sanitizeOAuthSecrets({ telegram: { chatId: '@channel' } }))
      .toEqual({ telegram: { chatId: '@channel' } });
  });

  it('ignores a stale presence flag coming from storage', () => {
    expect(sanitizeOAuthSecrets({ telegram: { hasToken: true, chatId: '@channel' } }))
      .toEqual({ telegram: { chatId: '@channel' } });
  });

  it('preserves omitted secrets when a sanitized settings form is saved', () => {
    expect(mergeOAuthSettings(
      { youtube: { refreshToken: 'server-secret', channelId: 'old' } },
      { youtube: { refreshToken: '', channelId: 'new' } },
    )).toEqual({ youtube: { refreshToken: 'server-secret', channelId: 'new' } });
  });

  it('never persists presence flags echoed back by the client', () => {
    const merged = mergeOAuthSettings(
      { telegram: { token: 'server-secret', chatId: 'old' } },
      { telegram: { hasToken: true, token: '', chatId: 'new' } },
    );
    expect(merged).toEqual({ telegram: { token: 'server-secret', chatId: 'new' } });
  });

  it('drops a presence flag that already leaked into storage', () => {
    const merged = mergeOAuthSettings(
      { telegram: { token: 'server-secret', hasToken: true, chatId: 'old' } },
      { telegram: { chatId: 'new' } },
    );
    expect(merged).toEqual({ telegram: { token: 'server-secret', chatId: 'new' } });
  });
});

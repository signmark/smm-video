import { describe, expect, it } from 'vitest';
import {
  sanitizeFacebookAccount,
  sanitizeInstagramAccount,
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
});

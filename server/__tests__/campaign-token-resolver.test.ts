import { describe, it, expect } from 'vitest';
import { pickPlatformToken } from '../services/campaign-token-resolver';

describe('pickPlatformToken — каскады fallback\'ов по платформам', () => {
  const fullSettings = {
    instagram: {
      longLivedToken: 'ig-long',
      accessToken: 'ig-access',
      token: 'ig-token',
    },
    facebook: {
      userToken: 'fb-user',
      token: 'fb-page',
    },
    vk: { token: 'vk-token', groupId: '-1' },
    threads: { accessToken: 'th-access', threadsUserId: '42' },
  };

  describe('instagram: longLivedToken → accessToken → token', () => {
    it('предпочитает longLivedToken', () => {
      expect(pickPlatformToken(fullSettings, 'instagram')).toBe('ig-long');
    });
    it('падает на accessToken без longLivedToken', () => {
      const sms = { instagram: { accessToken: 'ig-access', token: 'ig-token' } };
      expect(pickPlatformToken(sms, 'instagram')).toBe('ig-access');
    });
    it('падает на token в конце каскада', () => {
      expect(pickPlatformToken({ instagram: { token: 'ig-token' } }, 'instagram')).toBe('ig-token');
    });
    it('undefined когда instagram не настроен', () => {
      expect(pickPlatformToken({}, 'instagram')).toBeUndefined();
    });
  });

  describe('facebook: IG-каскад → fb.userToken → fb.token («Взять из ИГ»)', () => {
    it('предпочитает Instagram-токен при его наличии', () => {
      expect(pickPlatformToken(fullSettings, 'facebook')).toBe('ig-long');
    });
    it('без IG падает на fb.userToken', () => {
      const sms = { facebook: { userToken: 'fb-user', token: 'fb-page' } };
      expect(pickPlatformToken(sms, 'facebook')).toBe('fb-user');
    });
    it('без IG и userToken падает на fb.token', () => {
      expect(pickPlatformToken({ facebook: { token: 'fb-page' } }, 'facebook')).toBe('fb-page');
    });
    it('undefined когда ни IG, ни FB не настроены', () => {
      expect(pickPlatformToken({}, 'facebook')).toBeUndefined();
    });
  });

  describe('vk и threads', () => {
    it('vk: берёт vk.token', () => {
      expect(pickPlatformToken(fullSettings, 'vk')).toBe('vk-token');
    });
    it('threads: берёт threads.accessToken', () => {
      expect(pickPlatformToken(fullSettings, 'threads')).toBe('th-access');
    });
  });

  describe('устойчивость к мусорным настройкам', () => {
    it('null/undefined настройки → undefined, не throw', () => {
      expect(pickPlatformToken(null, 'vk')).toBeUndefined();
      expect(pickPlatformToken(undefined, 'facebook')).toBeUndefined();
    });
    it('пустые строки не считаются токеном', () => {
      const sms = { instagram: { longLivedToken: '', accessToken: '', token: '' } };
      expect(pickPlatformToken(sms, 'instagram')).toBeUndefined();
      expect(pickPlatformToken({ vk: { token: '' } }, 'vk')).toBeUndefined();
    });
  });
});

/**
 * Ключевой сценарий: настройки приходят с фронта УЖЕ без токенов — их вырезает
 * sanitizeOAuthSecrets на сервере. Статус «подключено» обязан считаться верно
 * именно на таких данных.
 *
 * Регрессия, которую эти тесты стерегут: панель публикации проверяла
 * `instagram.accessToken`, `youtube.accessToken`, `threads.accessToken` — все они
 * вырезаны, поэтому Instagram, YouTube и Threads вечно показывались
 * неподключёнными, хотя в настройках кампании стояло «Настроено».
 */

import { describe, it, expect } from 'vitest';
import {
  CONNECTABLE_PLATFORMS,
  getConnectedPlatformsMap,
  isPlatformConnected,
  parseSocialSettings,
} from '../platform-connection';

/** То, что реально доезжает до браузера после sanitizeOAuthSecrets. */
const SANITIZED_SETTINGS = {
  telegram: { chatId: '@smm_manager_official', hasToken: true },
  vk: { groupId: '123456', groupName: 'SMM агентство', hasToken: true },
  facebook: { pageId: '677089708819410', pageName: 'Page', hasToken: true },
  instagram: { businessAccountId: '17841474548013708', hasAccessToken: true },
  youtube: { channelId: 'UC123', channelTitle: 'Channel', hasAccessToken: true, hasRefreshToken: true },
  threads: { threadsUserId: 'uid-1', username: 'user', hasAccessToken: true },
};

describe('isPlatformConnected — данные без токенов', () => {
  for (const platform of CONNECTABLE_PLATFORMS) {
    it(`${platform}: подключено, хотя токена в данных нет`, () => {
      expect(isPlatformConnected(SANITIZED_SETTINGS, platform)).toBe(true);
    });
  }

  it('не читает секретные поля: одного токена без идентификатора мало', () => {
    // Если бы проверка смотрела на токен, этот объект дал бы «подключено».
    const tokenOnly = {
      telegram: { token: 'secret' },
      vk: { token: 'secret' },
      facebook: { accessToken: 'secret' },
      instagram: { accessToken: 'secret' },
      youtube: { refreshToken: 'secret' },
      threads: { accessToken: 'secret' },
    };
    for (const platform of CONNECTABLE_PLATFORMS) {
      expect(isPlatformConnected(tokenOnly, platform)).toBe(false);
    }
  });

  it('пустые строки не считаются подключением', () => {
    const empty = {
      telegram: { chatId: '' },
      vk: { groupId: '   ' },
      facebook: { pageId: '' },
      instagram: { businessAccountId: '' },
      youtube: { channelId: '' },
      threads: { threadsUserId: '' },
    };
    for (const platform of CONNECTABLE_PLATFORMS) {
      expect(isPlatformConnected(empty, platform)).toBe(false);
    }
  });

  it('instagram: серверного флага configured достаточно', () => {
    expect(isPlatformConnected({ instagram: { configured: true } }, 'instagram')).toBe(true);
    expect(isPlatformConnected({ instagram: { configured: false } }, 'instagram')).toBe(false);
  });

  it('instagram: instagramId — тоже валидный идентификатор', () => {
    expect(isPlatformConnected({ instagram: { instagramId: 'ig-1' } }, 'instagram')).toBe(true);
  });

  it('понимает snake_case из Directus', () => {
    // SM-24: telegram now also requires credential proof (hasToken or token).
    // snake_case chat_id alone is not enough — credential must be present.
    expect(isPlatformConnected({ telegram: { chat_id: '@ch', hasToken: true } }, 'telegram')).toBe(true);
    expect(isPlatformConnected({ vk: { group_id: '1' } }, 'vk')).toBe(true);
    expect(isPlatformConnected({ facebook: { page_id: '1' } }, 'facebook')).toBe(true);
    expect(isPlatformConnected({ youtube: { channel_id: '1' } }, 'youtube')).toBe(true);
    expect(isPlatformConnected({ threads: { threads_user_id: '1' } }, 'threads')).toBe(true);
  });

  it('отсутствующие или битые настройки не роняют проверку', () => {
    for (const platform of CONNECTABLE_PLATFORMS) {
      expect(isPlatformConnected(null, platform)).toBe(false);
      expect(isPlatformConnected({}, platform)).toBe(false);
      expect(isPlatformConnected({ [platform]: null }, platform)).toBe(false);
      expect(isPlatformConnected({ [platform]: 'строка' }, platform)).toBe(false);
    }
  });

  // SM-24: Four explicit connected-fixture cases per sanitiser contract.
  //   server/services/oauth-response-sanitizer.ts:63-79
  //   Non-empty token → hasToken:true, token field stripped entirely.
  //   Empty/missing token → no hasToken, no token.

  it('SM-24: sanitized hasToken + chat = connected', () => {
    expect(isPlatformConnected(
      { telegram: { chatId: '@ch', hasToken: true } }, 'telegram')).toBe(true);
  });

  it('SM-24: unsanitized token + chat = connected (internal callers)', () => {
    expect(isPlatformConnected(
      { telegram: { chatId: '@ch', token: 'abc123' } }, 'telegram')).toBe(true);
  });

  it('SM-24: token-only (no chat) = not connected', () => {
    expect(isPlatformConnected(
      { telegram: { token: 'abc123' } }, 'telegram')).toBe(false);
  });

  it('SM-24: chat-only (no hasToken, no token) = not connected (product red)', () => {
    // Before SM-24, this returned true — the bug this fixes.
    expect(isPlatformConnected(
      { telegram: { chatId: '@ch' } }, 'telegram')).toBe(false);
  });
});

describe('getConnectedPlatformsMap', () => {
  it('на реальных санитайзенных настройках все шесть подключены', () => {
    expect(getConnectedPlatformsMap(SANITIZED_SETTINGS)).toEqual({
      instagram: true,
      telegram: true,
      vk: true,
      facebook: true,
      youtube: true,
      threads: true,
    });
  });

  it('различает подключённые и неподключённые', () => {
    const partial = {
      // SM-24: telegram now requires credential proof. chatId alone is not "connected".
      // Add hasToken:true to model sanitized configured state.
      telegram: { chatId: '@ch', hasToken: true },
      vk: { groupId: '1' },
      facebook: { pageId: '1' },
      instagram: {},
      youtube: {},
      threads: {},
    };
    expect(getConnectedPlatformsMap(partial)).toEqual({
      instagram: false,
      telegram: true,
      vk: true,
      facebook: true,
      youtube: false,
      threads: false,
    });
  });

  it('разбирает настройки, пришедшие строкой JSON', () => {
    const map = getConnectedPlatformsMap(JSON.stringify(SANITIZED_SETTINGS));
    expect(map?.instagram).toBe(true);
    expect(map?.youtube).toBe(true);
  });

  it('возвращает null, когда настроек ещё нет — это не «всё отключено»', () => {
    // Важно отличать «не загрузилось» от «не подключено»: иначе панель публикации
    // на время загрузки соврёт, что ничего не настроено.
    expect(getConnectedPlatformsMap(undefined)).toBeNull();
    expect(getConnectedPlatformsMap(null)).toBeNull();
    expect(getConnectedPlatformsMap('не json')).toBeNull();
    expect(getConnectedPlatformsMap([])).toBeNull();
  });
});

describe('parseSocialSettings', () => {
  it('пропускает объект как есть и разбирает строку', () => {
    expect(parseSocialSettings({ vk: { groupId: '1' } })).toEqual({ vk: { groupId: '1' } });
    expect(parseSocialSettings('{"vk":{"groupId":"1"}}')).toEqual({ vk: { groupId: '1' } });
  });

  it('на битом JSON возвращает null, а не бросает', () => {
    expect(parseSocialSettings('{битый')).toBeNull();
  });
});

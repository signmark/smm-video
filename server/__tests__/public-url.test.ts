/**
 * Тесты на server/utils/public-url.ts и завязанный на него getAppBaseUrl.
 *
 * Главное, что здесь фиксируется, — свойство «Host только по белому списку»:
 * до рефакторинга список доменов был захардкожен в коде, теперь он приезжает
 * из .env, и легко случайно начать доверять произвольному заголовку Host.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ENV_KEYS = [
  'APP_PUBLIC_URL', 'APP_EXTRA_ORIGINS', 'APP_PARTNER_ORIGINS',
  'API_BASE_URL', 'PUBLIC_URL', 'APP_URL', 'SMM_DOMAIN',
  'REPLIT_DEV_DOMAIN', 'NODE_ENV', 'ENV', 'PORT',
];

/** Модуль читает process.env лениво, но кэширует предупреждение — берём свежую копию. */
async function loadModule() {
  vi.resetModules();
  return import('../utils/public-url');
}

describe('server/utils/public-url', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.restoreAllMocks();
  });

  describe('getPublicOrigin', () => {
    it('берёт APP_PUBLIC_URL', async () => {
      process.env.APP_PUBLIC_URL = 'https://smm.example.com';
      const { getPublicOrigin } = await loadModule();
      expect(getPublicOrigin()).toBe('https://smm.example.com');
    });

    it('срезает путь и хвостовой слеш', async () => {
      process.env.APP_PUBLIC_URL = 'https://smm.example.com/app/';
      const { getPublicOrigin } = await loadModule();
      expect(getPublicOrigin()).toBe('https://smm.example.com');
    });

    it('подставляет https голому хосту', async () => {
      process.env.APP_PUBLIC_URL = 'smm.example.com';
      const { getPublicOrigin } = await loadModule();
      expect(getPublicOrigin()).toBe('https://smm.example.com');
    });

    it('сохраняет нестандартный порт', async () => {
      process.env.APP_PUBLIC_URL = 'https://smm.example.com:8443';
      const { getPublicOrigin } = await loadModule();
      expect(getPublicOrigin()).toBe('https://smm.example.com:8443');
    });

    it('APP_PUBLIC_URL имеет приоритет над legacy-именами', async () => {
      process.env.APP_PUBLIC_URL = 'https://new.example.com';
      process.env.API_BASE_URL = 'https://old.example.com';
      const { getPublicOrigin } = await loadModule();
      expect(getPublicOrigin()).toBe('https://new.example.com');
    });

    it('падает на legacy API_BASE_URL, если APP_PUBLIC_URL не задан', async () => {
      process.env.API_BASE_URL = 'https://old.example.com';
      const { getPublicOrigin } = await loadModule();
      expect(getPublicOrigin()).toBe('https://old.example.com');
    });

    it('игнорирует мусорное значение и идёт дальше по цепочке', async () => {
      process.env.APP_PUBLIC_URL = 'не url!!!';
      process.env.API_BASE_URL = 'https://ok.example.com';
      const { getPublicOrigin } = await loadModule();
      expect(getPublicOrigin()).toBe('https://ok.example.com');
    });

    it('в dev без переменных отдаёт localhost с нужным портом', async () => {
      process.env.NODE_ENV = 'development';
      process.env.PORT = '5000';
      const { getPublicOrigin } = await loadModule();
      expect(getPublicOrigin()).toBe('http://localhost:5000');
    });
  });

  describe('publicUrl / oauthRedirectUri', () => {
    it('собирает абсолютный адрес', async () => {
      process.env.APP_PUBLIC_URL = 'https://smm.example.com';
      const { publicUrl, oauthRedirectUri } = await loadModule();
      expect(publicUrl('/sitemap.xml')).toBe('https://smm.example.com/sitemap.xml');
      expect(publicUrl('sitemap.xml')).toBe('https://smm.example.com/sitemap.xml');
      expect(oauthRedirectUri('/api/youtube/auth/callback'))
        .toBe('https://smm.example.com/api/youtube/auth/callback');
    });
  });

  describe('getAllowedOrigins', () => {
    it('включает свой домен, APP_EXTRA_ORIGINS и партнёров', async () => {
      process.env.APP_PUBLIC_URL = 'https://smm.example.com';
      process.env.APP_EXTRA_ORIGINS = 'https://smm.old.example.com, https://alias.example.com';
      const { getAllowedOrigins } = await loadModule();
      const origins = getAllowedOrigins();
      expect(origins).toContain('https://smm.example.com');
      expect(origins).toContain('https://smm.old.example.com');
      expect(origins).toContain('https://alias.example.com');
      expect(origins).toContain('https://t.me');
    });

    it('не плодит дублей', async () => {
      process.env.APP_PUBLIC_URL = 'https://smm.example.com';
      process.env.APP_EXTRA_ORIGINS = 'https://smm.example.com';
      const { getAllowedOrigins } = await loadModule();
      const origins = getAllowedOrigins();
      expect(origins.filter((o) => o === 'https://smm.example.com')).toHaveLength(1);
    });

    it('getOwnOrigins не включает партнёров', async () => {
      process.env.APP_PUBLIC_URL = 'https://smm.example.com';
      const { getOwnOrigins } = await loadModule();
      expect(getOwnOrigins()).toEqual(['https://smm.example.com']);
    });
  });

  describe('getAppBaseUrl — Host только по белому списку', () => {
    const reqWithHost = (host: string) => ({ get: (h: string) => (h === 'host' ? host : undefined) }) as any;

    it('принимает Host, если это наш основной домен', async () => {
      process.env.APP_PUBLIC_URL = 'https://smm.example.com';
      vi.resetModules();
      const { getAppBaseUrl } = await import('../utils/app-base-url');
      expect(getAppBaseUrl(reqWithHost('smm.example.com'))).toBe('https://smm.example.com');
    });

    it('принимает Host из APP_EXTRA_ORIGINS — второй домен обслуживается наравне', async () => {
      process.env.APP_PUBLIC_URL = 'https://smm.example.com';
      process.env.APP_EXTRA_ORIGINS = 'https://smm.alt.example.com';
      vi.resetModules();
      const { getAppBaseUrl } = await import('../utils/app-base-url');
      expect(getAppBaseUrl(reqWithHost('smm.alt.example.com'))).toBe('https://smm.alt.example.com');
    });

    it('ОТБРАСЫВАЕТ подделанный Host и отдаёт канонический домен', async () => {
      process.env.APP_PUBLIC_URL = 'https://smm.example.com';
      vi.resetModules();
      const { getAppBaseUrl } = await import('../utils/app-base-url');
      expect(getAppBaseUrl(reqWithHost('evil.attacker.tld'))).toBe('https://smm.example.com');
    });

    it('партнёрский origin не даёт права подставиться в Host', async () => {
      process.env.APP_PUBLIC_URL = 'https://smm.example.com';
      vi.resetModules();
      const { getAppBaseUrl } = await import('../utils/app-base-url');
      expect(getAppBaseUrl(reqWithHost('t.me'))).toBe('https://smm.example.com');
    });

    it('пустой Host не ломает результат', async () => {
      process.env.APP_PUBLIC_URL = 'https://smm.example.com';
      vi.resetModules();
      const { getAppBaseUrl } = await import('../utils/app-base-url');
      expect(getAppBaseUrl(reqWithHost(''))).toBe('https://smm.example.com');
    });
  });
});

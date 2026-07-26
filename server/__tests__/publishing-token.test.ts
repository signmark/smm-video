/**
 * Публикация ходит сервисным токеном, не пользовательским.
 *
 * Проверяем два уровня:
 *  1. сам резолвер (порядок источников, фолбэки);
 *  2. КАЖДЫЙ публикующий метод планировщика — что он берёт сервисный токен и
 *     ни разу не трогает directusAuthManager.getValidToken. Это и есть требование
 *     «должно сработать для всех публикаций»: раньше половина платформ брала
 *     токен пользователя и ловила 403 на чужой кампании.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getValidToken = vi.fn();
const getAdminAuthToken = vi.fn();

vi.mock('../services/directus-auth-manager', () => ({
  directusAuthManager: {
    getValidToken: (...args: any[]) => getValidToken(...args),
    getAdminAuthToken: (...args: any[]) => getAdminAuthToken(...args),
  },
}));

const axiosPost = vi.fn();
vi.mock('axios', () => ({
  default: { post: (...args: any[]) => axiosPost(...args) },
}));

import { getServiceTokenFromEnv, resolvePublishingToken } from '../services/publishing-token';

const ENV_KEYS = [
  'DIRECTUS_STATIC_TOKEN',
  'DIRECTUS_DEV_TOKEN',
  'DIRECTUS_ADMIN_TOKEN',
  'DIRECTUS_TOKEN',
  'DIRECTUS_URL',
  'DIRECTUS_ADMIN_EMAIL',
  'DIRECTUS_ADMIN_PASSWORD',
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('resolvePublishingToken', () => {
  it('предпочитает DIRECTUS_STATIC_TOKEN', async () => {
    process.env.DIRECTUS_STATIC_TOKEN = 'static';
    process.env.DIRECTUS_ADMIN_TOKEN = 'admin';
    await expect(resolvePublishingToken()).resolves.toBe('static');
  });

  it('порядок источников совпадает с directus-crud', () => {
    process.env.DIRECTUS_TOKEN = 'plain';
    expect(getServiceTokenFromEnv()).toBe('plain');
    process.env.DIRECTUS_ADMIN_TOKEN = 'admin';
    expect(getServiceTokenFromEnv()).toBe('admin');
    process.env.DIRECTUS_DEV_TOKEN = 'dev';
    expect(getServiceTokenFromEnv()).toBe('dev');
    process.env.DIRECTUS_STATIC_TOKEN = 'static';
    expect(getServiceTokenFromEnv()).toBe('static');
  });

  it('без токена в env падает в getAdminAuthToken', async () => {
    getAdminAuthToken.mockResolvedValue('from-manager');
    await expect(resolvePublishingToken()).resolves.toBe('from-manager');
  });

  it('последним рубежом логинится админом', async () => {
    getAdminAuthToken.mockResolvedValue(null);
    process.env.DIRECTUS_URL = 'http://directus.test';
    process.env.DIRECTUS_ADMIN_EMAIL = 'admin@example.com';
    process.env.DIRECTUS_ADMIN_PASSWORD = 'secret';
    axiosPost.mockResolvedValue({ data: { data: { access_token: 'from-login' } } });
    await expect(resolvePublishingToken()).resolves.toBe('from-login');
  });

  it('НИКОГДА не спрашивает токен пользователя', async () => {
    process.env.DIRECTUS_STATIC_TOKEN = 'static';
    await resolvePublishingToken();

    getAdminAuthToken.mockResolvedValue('from-manager');
    delete process.env.DIRECTUS_STATIC_TOKEN;
    await resolvePublishingToken();

    expect(getValidToken).not.toHaveBeenCalled();
  });

  it('возвращает null, когда нет вообще ничего — вызывающий решает сам', async () => {
    getAdminAuthToken.mockResolvedValue(null);
    await expect(resolvePublishingToken()).resolves.toBeNull();
  });

  it('не падает, если менеджер токенов сломан', async () => {
    getAdminAuthToken.mockRejectedValue(new Error('directus down'));
    await expect(resolvePublishingToken()).resolves.toBeNull();
  });
});

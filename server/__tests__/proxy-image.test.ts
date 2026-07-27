/**
 * Публичный прокси картинок /api/proxy-image.
 *
 * Регрессия: <img src="/api/proxy-image?url=..."> ловил 401 от гейта
 * facebookGroupsRouter (router.use(authenticateUser) на /api) — превью картинок
 * были пустыми. Теперь эндпоинт публичный + SSRF-защита (только http(s) на
 * публичные хосты; loopback/приватные/metadata блокируются).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => ({ axiosGet: vi.fn(), dnsLookup: vi.fn() }));
vi.mock('axios', () => ({ default: { get: H.axiosGet }, get: H.axiosGet }));
vi.mock('node:dns/promises', () => ({ default: { lookup: H.dnsLookup } }));
vi.mock('../utils/logger', () => {
  const log: any = vi.fn();
  log.debug = vi.fn(); log.info = vi.fn(); log.warn = vi.fn(); log.error = vi.fn();
  return { log, default: log };
});

import {
  registerProxyImageRoute,
  isSafeProxyImageUrl,
  assertRedirectAllowed,
  resolvesToBlockedIp,
} from '../routes/proxy-image';

const app = express();
registerProxyImageRoute(app);

beforeEach(() => {
  vi.clearAllMocks();
  H.axiosGet.mockResolvedValue({ status: 200, data: Buffer.from('img-bytes'), headers: { 'content-type': 'image/png' } });
  H.dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

describe('GET /api/proxy-image', () => {
  it('публичный URL → 200, тело проксируется, axios вызван', async () => {
    const res = await request(app).get('/api/proxy-image').query({ url: 'https://cdn.example.com/a.png' });
    expect(res.status).toBe(200);
    expect(res.header['content-type']).toBe('image/png');
    expect(H.axiosGet).toHaveBeenCalledTimes(1);
  });

  it('без url → 400, axios не вызван', async () => {
    const res = await request(app).get('/api/proxy-image');
    expect(res.status).toBe(400);
    expect(H.axiosGet).not.toHaveBeenCalled();
  });

  it.each([
    'http://localhost/x.png',
    'http://127.0.0.1/x.png',
    'http://10.0.0.5/x.png',
    'http://192.168.1.10/x.png',
    'http://172.16.0.9/x.png',
    'http://169.254.169.254/latest/meta-data',   // cloud metadata
    'http://[::1]/x.png',
  ])('SSRF: приватный/локальный хост %s → 400, axios не вызван', async (url) => {
    const res = await request(app).get('/api/proxy-image').query({ url });
    expect(res.status).toBe(400);
    expect(H.axiosGet).not.toHaveBeenCalled();
  });

  it.each(['file:///etc/passwd', 'ftp://host/x', 'gopher://host'])(
    'SSRF: неподдерживаемый протокол %s → 400', async (url) => {
      const res = await request(app).get('/api/proxy-image').query({ url });
      expect(res.status).toBe(400);
      expect(H.axiosGet).not.toHaveBeenCalled();
    });

  it('ошибка апстрима → 502', async () => {
    H.axiosGet.mockRejectedValue(new Error('upstream down'));
    const res = await request(app).get('/api/proxy-image').query({ url: 'https://cdn.example.com/a.png' });
    expect(res.status).toBe(502);
  });

  it('SSRF: домен резолвится в приватный IP → 400, axios не вызван', async () => {
    H.dnsLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    const res = await request(app).get('/api/proxy-image').query({ url: 'https://evil.example.com/a.png' });
    expect(res.status).toBe(400);
    expect(H.axiosGet).not.toHaveBeenCalled();
  });

  it('не image/video content-type (text/html) → 502, тело не отдаётся', async () => {
    H.axiosGet.mockResolvedValue({ status: 200, data: Buffer.from('<html>evil</html>'), headers: { 'content-type': 'text/html' } });
    const res = await request(app).get('/api/proxy-image').query({ url: 'https://cdn.example.com/a.png' });
    expect(res.status).toBe(502);
    expect(res.text).not.toContain('evil');
  });

  it('ответ содержит nosniff и кэш-заголовки, redirect-хук передан в axios', async () => {
    const res = await request(app).get('/api/proxy-image').query({ url: 'https://cdn.example.com/a.png' });
    expect(res.status).toBe(200);
    expect(res.header['x-content-type-options']).toBe('nosniff');
    expect(res.header['cache-control']).toContain('max-age=86400');
    expect(H.axiosGet.mock.calls[0][1].beforeRedirect).toBe(assertRedirectAllowed);
  });
});

describe('assertRedirectAllowed (ревалидация redirect-хопов)', () => {
  it('публичный https-хоп проходит', () => {
    expect(() => assertRedirectAllowed({ protocol: 'https:', hostname: 'cdn.example.com' })).not.toThrow();
  });
  it.each(['169.254.169.254', '127.0.0.1', '10.0.0.5', 'localhost'])(
    'redirect на %s → throw', (hostname) => {
      expect(() => assertRedirectAllowed({ protocol: 'http:', hostname })).toThrow();
    });
  it('redirect на не-http протокол → throw', () => {
    expect(() => assertRedirectAllowed({ protocol: 'file:', hostname: 'x' })).toThrow();
  });
});

describe('resolvesToBlockedIp', () => {
  it('домен → приватный IP → true', async () => {
    H.dnsLookup.mockResolvedValue([{ address: '192.168.1.7', family: 4 }]);
    await expect(resolvesToBlockedIp('evil.example.com')).resolves.toBe(true);
  });
  it('литеральный IP не резолвим повторно', async () => {
    await expect(resolvesToBlockedIp('8.8.8.8')).resolves.toBe(false);
    expect(H.dnsLookup).not.toHaveBeenCalled();
  });
  it('ошибка DNS → false (упадёт сам запрос)', async () => {
    H.dnsLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(resolvesToBlockedIp('nope.example.com')).resolves.toBe(false);
  });
});

describe('isSafeProxyImageUrl', () => {
  it('публичный https → ok', () => {
    expect(isSafeProxyImageUrl('https://fal.media/x.jpg').ok).toBe(true);
  });
  it('приватный IP → не ok', () => {
    const r = isSafeProxyImageUrl('http://10.1.2.3/x');
    expect(r.ok).toBe(false);
  });
  it('битый URL → не ok', () => {
    expect(isSafeProxyImageUrl('not a url').ok).toBe(false);
  });
});

/**
 * Публичный прокси картинок /api/proxy-image.
 *
 * Регрессия: <img src="/api/proxy-image?url=..."> ловил 401 от гейта
 * facebookGroupsRouter (router.use(authenticateUser) на /api) — превью картинок
 * были пустыми. Теперь эндпоинт публичный + SSRF-защита (только http(s) на
 * публичные хосты; loopback/приватные/metadata блокируются).
 *
 * 2026-07-28: прокси переведён на safeGet — DNS-валидация всех адресов, pinned
 * lookup и ручная проверка каждого redirect'а. Отсюда моки axios.request и dns.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// safeGet ходит через axios.request (redirect'ы проходим вручную), а не axios.get.
const H = vi.hoisted(() => ({ axiosGet: vi.fn() }));
vi.mock('axios', () => ({ default: { request: H.axiosGet, get: H.axiosGet }, request: H.axiosGet, get: H.axiosGet }));

// DNS подменяем: теперь гард резолвит имя и проверяет все адреса, поэтому без мока
// тест зависел бы от того, существует ли cdn.example.com на самом деле.
vi.mock('dns', () => ({
  default: {
    promises: {
      lookup: vi.fn(async (host: string) => {
        if (host === 'cdn.example.com' || host === 'fal.media') return [{ address: '93.184.216.34', family: 4 }];
        throw new Error('ENOTFOUND');
      }),
    },
  },
}));
vi.mock('../utils/logger', () => {
  const log: any = vi.fn();
  log.debug = vi.fn(); log.info = vi.fn(); log.warn = vi.fn(); log.error = vi.fn();
  return { log, default: log };
});

import { registerProxyImageRoute, isSafeProxyImageUrl } from '../routes/proxy-image';

const app = express();
registerProxyImageRoute(app);

beforeEach(() => {
  vi.clearAllMocks();
  H.axiosGet.mockResolvedValue({ status: 200, data: Buffer.from('img-bytes'), headers: { 'content-type': 'image/png' } });
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
    'http://[::ffff:127.0.0.1]/x.png',   // IPv4-mapped IPv6 — раньше проходил насквозь
    'http://[::ffff:169.254.169.254]/',  // metadata через mapped-запись
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

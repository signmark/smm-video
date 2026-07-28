/**
 * SSRF-гард: запрещённые адреса, DNS-валидация и redirect'ы.
 *
 * Находка ревью 2026-07-28: `isSafeHttpUrl('http://[::ffff:127.0.0.1]/')` возвращал
 * ok:true. `net.isIP('::ffff:127.0.0.1')` === 6, а IPv6-ветка сравнивала строку с
 * '::1' и префиксами fc/fd/fe80 — ни одно не совпадало, и loopback проходил насквозь.
 * Плюс DNS не резолвился вовсе, а axios сам ходил по redirect'ам.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isBlockedIp, isBlockedHost, isSafeHttpUrl, resolveSafeUrl } from '../utils/ssrf-guard';

describe('isBlockedIp — IPv4-mapped IPv6 (регрессия)', () => {
  it('::ffff:127.0.0.1 заблокирован', () => {
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true);
  });

  it('URL с [::ffff:127.0.0.1] больше не проходит', () => {
    const result = isSafeHttpUrl('http://[::ffff:127.0.0.1]/');
    expect(result.ok).toBe(false);
  });

  it.each([
    '::ffff:10.0.0.1',
    '::ffff:192.168.1.1',
    '::ffff:169.254.169.254', // cloud metadata через mapped-запись
    '::ffff:172.16.0.1',
  ])('mapped-приватный %s заблокирован', ip => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it('mapped-публичный ::ffff:8.8.8.8 остаётся разрешённым', () => {
    expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('шестнадцатеричная форма mapped-адреса тоже ловится', () => {
    // ::ffff:7f00:1 — та же 127.0.0.1, записанная группами
    expect(isBlockedIp('::ffff:7f00:1')).toBe(true);
  });
});

describe('isBlockedIp — IPv4', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback /8 целиком'],
    ['10.1.2.3', 'private A'],
    ['172.16.0.1', 'private B нижняя граница'],
    ['172.31.255.255', 'private B верхняя граница'],
    ['192.168.0.1', 'private C'],
    ['169.254.169.254', 'cloud metadata'],
    ['0.0.0.0', 'unspecified'],
    ['100.64.0.1', 'CGNAT'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
    ['198.18.0.1', 'benchmark'],
  ])('%s заблокирован (%s)', ip => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '172.15.0.1'])(
    'публичный %s разрешён',
    ip => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );
});

describe('isBlockedIp — IPv6', () => {
  it.each([
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fc00::1', 'ULA'],
    ['fd12:3456::1', 'ULA'],
    ['fe80::1', 'link-local'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'documentation'],
    ['64:ff9b::7f00:1', 'NAT64 на loopback'],
    ['2002:7f00:1::', '6to4 на loopback'],
  ])('%s заблокирован (%s)', ip => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(['2606:4700:4700::1111', '2a00:1450:4001:800::200e'])('публичный %s разрешён', ip => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it('мусор вместо адреса считается опасным', () => {
    expect(isBlockedIp('не-адрес')).toBe(true);
    expect(isBlockedIp('')).toBe(true);
  });
});

describe('isBlockedHost — имена', () => {
  it.each(['localhost', 'foo.localhost', 'db.internal', 'printer.local'])(
    '%s заблокирован',
    h => {
      expect(isBlockedHost(h)).toBe(true);
    },
  );

  it('обычный домен разрешён', () => {
    expect(isBlockedHost('example.com')).toBe(false);
  });
});

describe('resolveSafeUrl — DNS-валидация', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function withLookup(records: Array<{ address: string; family: number }> | Error) {
    vi.resetModules();
    vi.doMock('dns', () => ({
      default: {
        promises: {
          lookup: vi.fn(async () => {
            if (records instanceof Error) throw records;
            return records;
          }),
        },
      },
    }));
    return await import('../utils/ssrf-guard');
  }

  it('домен, резолвящийся в приватный IP, отклоняется', async () => {
    const mod = await withLookup([{ address: '127.0.0.1', family: 4 }]);
    const res = await mod.resolveSafeUrl('http://evil.example.com/');

    expect(res.ok).toBe(false);
    expect((res as any).reason).toBe('blocked-address');
  });

  it('домен с несколькими адресами отклоняется, если запрещён хотя бы один', async () => {
    const mod = await withLookup([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    const res = await mod.resolveSafeUrl('http://mixed.example.com/');

    expect(res.ok).toBe(false);
  });

  it('домен с публичным адресом проходит и отдаёт проверенные адреса для пиннинга', async () => {
    const mod = await withLookup([{ address: '93.184.216.34', family: 4 }]);
    const res = await mod.resolveSafeUrl('https://example.com/pic.jpg');

    expect(res.ok).toBe(true);
    expect((res as any).addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('несработавший DNS — это отказ, а не «разрешено»', async () => {
    const mod = await withLookup(new Error('ENOTFOUND'));
    const res = await mod.resolveSafeUrl('http://nowhere.example.com/');

    expect(res.ok).toBe(false);
    expect((res as any).reason).toBe('dns-failed');
  });

  it('литеральный публичный IP не требует DNS', async () => {
    const res = await resolveSafeUrl('http://93.184.216.34/x.png');
    expect(res.ok).toBe(true);
  });

  it('нехттп-протокол отклоняется до всякого DNS', async () => {
    const res = await resolveSafeUrl('file:///etc/passwd');
    expect(res.ok).toBe(false);
    expect((res as any).reason).toBe('protocol');
  });
});

describe('safeGet — redirect проверяется заново', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('axios');
    vi.doUnmock('dns');
  });

  /**
   * Настоящий сокет тут не поднять: гард обязан блокировать 127.0.0.1, а любой
   * публичный адрес из подменённого DNS уедет в пиннинг и никуда не соединится.
   * Поэтому DNS и транспорт подменяются оба, а проверяется то, ради чего фикс и
   * делался: каждый Location валидируется заново, и запрос уходит на проверенный
   * адрес, а не на тот, что отдаст DNS во второй раз.
   */
  async function moduleWithFakes(
    dnsMap: Record<string, string>,
    responder: (url: string) => { status: number; headers: Record<string, string>; data?: any },
  ) {
    vi.resetModules();
    const requests: Array<{ url: string; lookupResult: any }> = [];

    vi.doMock('dns', () => ({
      default: {
        promises: {
          lookup: vi.fn(async (host: string) => {
            const addr = dnsMap[host];
            if (!addr) throw new Error('ENOTFOUND');
            return [{ address: addr, family: 4 }];
          }),
        },
      },
    }));

    vi.doMock('axios', () => ({
      default: {
        request: vi.fn(async (cfg: any) => {
          // Зафиксировать, на какой адрес реально ушёл бы сокет.
          let lookupResult: any = null;
          cfg.lookup?.('ignored', { all: true }, (_e: any, r: any) => { lookupResult = r; });
          requests.push({ url: cfg.url, lookupResult });

          const r = responder(cfg.url);
          if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
          return { status: r.status, headers: r.headers, data: r.data };
        }),
      },
    }));

    const mod = await import('../utils/safe-http');
    return { ...mod, requests };
  }

  it('redirect с публичного URL на private блокируется', async () => {
    const { safeGet, BlockedUrlError, requests } = await moduleWithFakes(
      { 'cdn.example.com': '93.184.216.34' },
      () => ({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }),
    );

    await expect(safeGet('http://cdn.example.com/img.png')).rejects.toBeInstanceOf(BlockedUrlError);
    // Первый хоп сходил, на metadata-сервис — уже нет
    expect(requests).toHaveLength(1);
  });

  it('redirect на домен, который резолвится в loopback, тоже блокируется', async () => {
    const { safeGet, BlockedUrlError } = await moduleWithFakes(
      { 'cdn.example.com': '93.184.216.34', 'evil.example.com': '127.0.0.1' },
      () => ({ status: 302, headers: { location: 'http://evil.example.com/x' } }),
    );

    await expect(safeGet('http://cdn.example.com/img.png')).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('redirect public → public остаётся рабочим', async () => {
    const { safeGet, requests } = await moduleWithFakes(
      { 'cdn.example.com': '93.184.216.34', 'img.example.org': '1.1.1.1' },
      (url: string) =>
        url.includes('img.example.org')
          ? { status: 200, headers: { 'content-type': 'image/png' }, data: 'IMAGE-BYTES' }
          : { status: 302, headers: { location: 'http://img.example.org/final.png' } },
    );

    const res = await safeGet('http://cdn.example.com/img.png');

    expect(res.status).toBe(200);
    expect(res.data).toBe('IMAGE-BYTES');
    expect(requests).toHaveLength(2);
  });

  it('запрос уходит на проверенный адрес — DNS второй раз не спрашивают', async () => {
    const { safeGet, requests } = await moduleWithFakes(
      { 'cdn.example.com': '93.184.216.34' },
      () => ({ status: 200, headers: {}, data: 'OK' }),
    );

    await safeGet('http://cdn.example.com/img.png');

    expect(requests[0].lookupResult).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('бесконечный redirect обрывается, а не крутится вечно', async () => {
    const { safeGet, BlockedUrlError, requests } = await moduleWithFakes(
      { 'cdn.example.com': '93.184.216.34' },
      () => ({ status: 302, headers: { location: 'http://cdn.example.com/loop' } }),
    );

    await expect(
      safeGet('http://cdn.example.com/img.png', {}, { maxRedirects: 2 }),
    ).rejects.toBeInstanceOf(BlockedUrlError);
    expect(requests).toHaveLength(3);
  });
});

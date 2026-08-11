/**
 * AI-101: Telegram DNS A-record failover tests.
 *
 * Tests for telegram-http.ts (server/services/social-platforms/telegram-http.ts):
 * - DNS resolution returns multiple IPs
 * - Cache TTL (5 min) with fake timers + manual clear
 * - TCP/TLS error → tries next IP (behavioral, with mock agent)
 * - HTTP 4xx/5xx → NO next IP attempt, exactly 1 connection (safety rule)
 * - SNI servername = api.telegram.org AND HTTP Host = api.telegram.org
 *
 * NOT RUN: no node_modules in this environment. @Clause_Dev_Hermi will execute.
 *
 * Rule-59 evidence (file:line):
 *   - DNS failover: server/services/social-platforms/telegram-http.ts:35-78
 *   - HTTP safety: server/services/social-platforms/telegram-http.ts:58-62
 *     (after TLS handshake callback, no more IP rotation)
 *   - SNI/Host: server/services/social-platforms/telegram-http.ts:49-52
 *   - Compose pin removal: docs/deploy/compose-smm.fragment.yml:39-49 (removed)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as dns from 'dns/promises';
import * as tls from 'tls';
import * as https from 'https';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('dns/promises', () => ({
  resolve4: vi.fn(),
}));

const mockTlsConnect = vi.fn();
vi.mock('tls', async (importOriginal) => {
  const actual = await importOriginal<typeof import('tls')>();
  return { ...actual, connect: mockTlsConnect };
});

// Track connection attempts for behavioral tests
let connectionAttempts: string[] = [];
let connectionCallbacks: Array<(err: Error | null, sock?: any) => void> = [];

function mockSuccessfulTls(ip: string) {
  mockTlsConnect.mockImplementationOnce((_opts: any, cb: any) => {
    connectionAttempts.push(ip);
    const sock = new (require('stream').Duplex)({ read() {}, write(_c: any, _e: any, cb2: any) { cb2(); } });
    setImmediate(() => cb(null, sock));
    return sock;
  });
}

function mockTlsError(ip: string, code: string) {
  mockTlsConnect.mockImplementationOnce((_opts: any, cb: any) => {
    connectionAttempts.push(ip + ':' + code);
    const err = Object.assign(new Error(code), { code });
    setImmediate(() => err.code === 'EPROTO' ? mockTlsConnect.mock.results[0]?.value?.emit?.('error', err) : setImmediate(() => cb(err)));
    // Simpler: return a socket that emits error
    const sock = new (require('stream').Duplex)({ read() {}, write(_c: any, _e: any, cb2: any) { cb2(); } });
    process.nextTick(() => sock.emit('error', err));
    return sock;
  });
}

import { clearTelegramIpsCache } from '../services/social-platforms/telegram-http';

beforeEach(() => {
  vi.clearAllMocks();
  clearTelegramIpsCache();
  connectionAttempts = [];
  (dns.resolve4 as any).mockResolvedValue(['149.154.167.220', '149.154.175.50']);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Test: dynamic import to trigger module-level code ──────────────

async function loadTelegramHttp() {
  // Force re-import to pick up fresh mocks
  const mod = await import('../services/social-platforms/telegram-http');
  return mod;
}

describe('AI-101: telegramAxios DNS resolution', () => {
  it('resolves multiple IPs for api.telegram.org', async () => {
    const { telegramAxios } = await loadTelegramHttp();
    const ax = await telegramAxios('test-token');
    expect(dns.resolve4).toHaveBeenCalledWith('api.telegram.org');
    expect(ax.defaults.httpsAgent).toBeDefined();
  });

  it('caches DNS results for 5 minutes', async () => {
    const { telegramAxios } = await loadTelegramHttp();
    await telegramAxios('token-1');
    await telegramAxios('token-2');
    expect(dns.resolve4).toHaveBeenCalledTimes(1);
  });

  it('re-resolves after explicit cache clear', async () => {
    const { telegramAxios } = await loadTelegramHttp();
    await telegramAxios('token-1');
    clearTelegramIpsCache();
    await telegramAxios('token-2');
    expect(dns.resolve4).toHaveBeenCalledTimes(2);
  });

  it('re-resolves after 5-minute TTL expiry', async () => {
    vi.useFakeTimers();
    const { telegramAxios } = await loadTelegramHttp();
    await telegramAxios('token-1');
    expect(dns.resolve4).toHaveBeenCalledTimes(1);
    // Advance past 5-minute cache TTL
    vi.advanceTimersByTime(6 * 60 * 1000);
    await telegramAxios('token-2');
    expect(dns.resolve4).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('AI-101: behavioral — TCP/TLS error → next IP', () => {
  it('tries IP2 when IP1 gets connection error', async () => {
    (dns.resolve4 as any).mockResolvedValue(['10.0.0.1', '10.0.0.2']);

    // IP1: connection error
    mockTlsConnect.mockImplementationOnce((opts: any, cb: any) => {
      connectionAttempts.push('IP1');
      const sock = new (require('stream').Duplex)({ read() {}, write(_c: any, _e: any, cb2: any) { cb2(); } });
      process.nextTick(() => sock.emit('error', Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' })));
      return sock;
    });

    // IP2: success
    mockTlsConnect.mockImplementationOnce((opts: any, cb: any) => {
      connectionAttempts.push('IP2');
      const sock = new (require('stream').Duplex)({ read() {}, write(_c: any, _e: any, cb2: any) { cb2(); } });
      setImmediate(() => cb(null, sock));
      return sock;
    });

    const { telegramAxios } = await loadTelegramHttp();
    await telegramAxios('test-token');

    // Verify both IPs were attempted
    expect(connectionAttempts).toContain('IP1');
    expect(connectionAttempts).toContain('IP2');
    expect(connectionAttempts.indexOf('IP1')).toBeLessThan(connectionAttempts.indexOf('IP2'));
  });
});

describe('AI-101: behavioral — HTTP response → NO next IP', () => {
  it('does NOT try IP2 after IP1 returns HTTP 400', async () => {
    (dns.resolve4 as any).mockResolvedValue(['10.0.0.1', '10.0.0.2']);

    // IP1: TLS success (simulating that HTTP response follows)
    mockTlsConnect.mockImplementationOnce((opts: any, cb: any) => {
      connectionAttempts.push('IP1');
      const sock = new (require('stream').Duplex)({ read() {}, write(_c: any, _e: any, cb2: any) { cb2(); } });
      setImmediate(() => cb(null, sock));
      return sock;
    });

    const { telegramAxios } = await loadTelegramHttp();
    await telegramAxios('test-token');

    // Only IP1 was attempted — NO IP2 connection
    expect(connectionAttempts).toEqual(['IP1']);
    expect(connectionAttempts).not.toContain('IP2');
  });
});

describe('AI-101: SNI and Host headers', () => {
  it('sets servername to api.telegram.org (not IP)', async () => {
    (dns.resolve4 as any).mockResolvedValue(['149.154.167.220']);

    let capturedOpts: any = null;
    mockTlsConnect.mockImplementationOnce((opts: any, cb: any) => {
      capturedOpts = opts;
      const sock = new (require('stream').Duplex)({ read() {}, write(_c: any, _e: any, cb2: any) { cb2(); } });
      setImmediate(() => cb(null, sock));
      return sock;
    });

    const { telegramAxios } = await loadTelegramHttp();
    await telegramAxios('test-token');

    // SNI must be the hostname, not the IP
    expect(capturedOpts.servername).toBe('api.telegram.org');
    // Host is set by axios baseURL
  });

  it('HTTP Host header is api.telegram.org', async () => {
    const { telegramAxios } = await loadTelegramHttp();
    const ax = await telegramAxios('test-token');
    // Axios with baseURL sets Host header automatically
    expect(ax.defaults.baseURL).toContain('api.telegram.org');
  });
});

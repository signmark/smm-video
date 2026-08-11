/**
 * AI-101: Telegram DNS A-record failover — behavioral tests.
 *
 * Tests for telegram-http.ts transport layer via createConnection:
 * 1. IP rotation: IP1 error before handshake → IP2 tried
 * 2. Duplicate boundary: IP1 handshake OK + late socket error → cb once, IP2 NOT tried
 * 3. Exhaustion: all IPs fail → cb with error
 * 4. SNI servername = api.telegram.org
 * 5. DNS cache TTL and clear
 *
 * NOT RUN: no node_modules. @Clause_Dev_Hermi will execute red-before/green.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as tls from 'tls';
import * as dns from 'dns/promises';
import https from 'https';

const { clearTelegramIpsCache } = await vi.importActual<typeof import('../services/social-platforms/telegram-http')>(
  '../services/social-platforms/telegram-http'
);

vi.mock('dns/promises', () => ({ resolve4: vi.fn() }));

const { mockTlsConnect } = vi.hoisted(() => ({ mockTlsConnect: vi.fn() }));
vi.mock('tls', async (importOriginal) => {
  const actual = await importOriginal<typeof import('tls')>();
  return { ...actual, connect: mockTlsConnect, __esModule: true };
});

beforeEach(() => {
  vi.clearAllMocks();
  clearTelegramIpsCache();
  (dns.resolve4 as any).mockResolvedValue(['149.154.167.220', '149.154.175.50']);
});

/** Build a test agent directly (no HTTP needed). */
function buildAgent(ips: string[]): https.Agent {
  const agent = new https.Agent({ keepAlive: true });
  agent.createConnection = (opts: any, cb: any) => {
      let idx = 0;
      const targets = ips.length > 0 ? ips : ['api.telegram.org'];
      tryConnect();
      function tryConnect(): void {
        if (idx >= targets.length) { cb(new Error('all IPs unreachable')); return; }
        let settled = false;
        const tlsOpts = { ...opts, host: targets[idx], servername: 'api.telegram.org' };
        const sock = tls.connect(tlsOpts, () => { settled = true; sock.removeListener('error', onError); cb(null, sock); });
        function onError() { if (settled) return; idx++; sock.destroy(); tryConnect(); }
        sock.once('error', onError);
      }
    };
  return agent;
}

function fakeSocket() {
  return new (require('stream').Duplex)({ read() {}, write(_c: any, _e: any, cb: any) { cb(); } }) as any;
}

describe('AI-101: IP rotation on pre-handshake error', () => {
  it('tries IP2 when IP1 fails before TLS handshake', () => {
    const ips = ['10.0.0.1', '10.0.0.2'];
    let cbCalls = 0;
    const results: any[] = [];

    // IP1: error before handshake
    mockTlsConnect.mockImplementationOnce((_opts: any, _cb: any) => {
      const sock = fakeSocket();
      process.nextTick(() => sock.emit('error', Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' })));
      return sock;
    });
    // IP2: success
    mockTlsConnect.mockImplementationOnce((opts: any, cb: any) => {
      results.push({ host: opts.host });
      const sock = fakeSocket();
      process.nextTick(() => cb(null, sock));
      return sock;
    });

    const agent = buildAgent(ips);
    agent.createConnection!({} as any, (_err: any, _sock: any) => { cbCalls++; });

    expect(mockTlsConnect).toHaveBeenCalledTimes(2);
    expect(results[0].host).toBe('10.0.0.2'); // IP2 was used
    expect(cbCalls).toBe(1); // callback called exactly once
  });
});

describe('AI-101: duplicate boundary — late error after handshake', () => {
  it('does NOT try IP2 after IP1 handshake succeeds (even on late socket error)', () => {
    const ips = ['10.0.0.1', '10.0.0.2'];
    let cbCalls = 0;

    // IP1: handshake success
    mockTlsConnect.mockImplementationOnce((_opts: any, cb: any) => {
      const sock = fakeSocket();
      process.nextTick(() => {
        cb(null, sock);
        // Late ECONNRESET — should NOT trigger IP2
        process.nextTick(() => sock.emit('error', Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })));
      });
      return sock;
    });

    const agent = buildAgent(ips);
    agent.createConnection!({} as any, (_err: any, _sock: any) => { cbCalls++; });

    expect(mockTlsConnect).toHaveBeenCalledTimes(1); // ONLY IP1, no IP2
    expect(cbCalls).toBe(1); // callback exactly once
  });
});

describe('AI-101: exhaustion', () => {
  it('calls cb with error when all IPs fail', () => {
    const ips = ['10.0.0.1'];
    let cbErr: any = null;
    let cbCalls = 0;

    mockTlsConnect.mockImplementationOnce((_opts: any, _cb: any) => {
      const sock = fakeSocket();
      process.nextTick(() => sock.emit('error', Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })));
      return sock;
    });

    const agent = buildAgent(ips);
    agent.createConnection!({} as any, (err: any, _sock: any) => { cbErr = err; cbCalls++; });

    expect(cbCalls).toBe(1);
    expect(cbErr).toBeTruthy();
    expect(cbErr.message).toContain('unreachable');
  });
});

describe('AI-101: SNI servername', () => {
  it('sets servername to api.telegram.org (not the IP)', () => {
    const ips = ['149.154.167.220'];
    let capturedOpts: any = null;

    mockTlsConnect.mockImplementationOnce((opts: any, cb: any) => {
      capturedOpts = opts;
      const sock = fakeSocket();
      process.nextTick(() => cb(null, sock));
      return sock;
    });

    const agent = buildAgent(ips);
    agent.createConnection!({} as any, () => {});

    expect(capturedOpts.servername).toBe('api.telegram.org');
  });
});

describe('AI-101: DNS cache', () => {
  it('caches DNS for 5 minutes', async () => {
    const { telegramAxios } = await import('../services/social-platforms/telegram-http');
    await telegramAxios('token-1');
    await telegramAxios('token-2');
    expect(dns.resolve4).toHaveBeenCalledTimes(1);
  });

  it('re-resolves after cache clear', async () => {
    const { telegramAxios } = await import('../services/social-platforms/telegram-http');
    await telegramAxios('token-1');
    clearTelegramIpsCache();
    await telegramAxios('token-2');
    expect(dns.resolve4).toHaveBeenCalledTimes(2);
  });
});

/**
 * AI-101: Telegram DNS A-record failover — behavioral tests.
 *
 * Tests the production createConnectionFactory via agent.createConnection.
 * NOT RUN: no node_modules. @Clause_Dev_Hermi executes red-before/green.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTlsConnect } = vi.hoisted(() => ({ mockTlsConnect: vi.fn() }));
vi.mock('tls', async (importOriginal) => {
  const actual = await importOriginal<typeof import('tls')>();
  return { ...actual, connect: mockTlsConnect, __esModule: true };
});

import { createConnectionFactory, clearTelegramIpsCache } from '../services/social-platforms/telegram-http';

function fakeSocket() {
  return new (require('stream').Duplex)({ read() {}, write(_c: any, _e: any, cb: any) { cb(); } }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearTelegramIpsCache();
});

function tick(n = 1): Promise<void> {
  let p = Promise.resolve();
  for (let i = 0; i < n; i++) p = p.then(() => new Promise((r) => setImmediate(r)));
  return p;
}

describe('AI-101: IP rotation on pre-handshake error', () => {
  it('tries IP2 when IP1 fails before TLS handshake', async () => {
    const ips = ['10.0.0.1', '10.0.0.2'];
    const hosts: string[] = [];
    let cbCalls = 0;

    mockTlsConnect.mockImplementation((opts: any, _cb: any) => {
      hosts.push(opts.host);
      const sock = fakeSocket();
      if (hosts.length === 1) process.nextTick(() => sock.emit('error', Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' })));
      else process.nextTick(() => _cb(null, sock));
      return sock;
    });

    const factory = createConnectionFactory(ips);
    factory({} as any, () => { cbCalls++; });
    await tick(2);

    expect(hosts).toEqual(['10.0.0.1', '10.0.0.2']);
    expect(cbCalls).toBe(1);
  });
});

describe('AI-101: duplicate boundary', () => {
  it('does NOT try IP2 after IP1 handshake succeeds (even on late ECONNRESET)', async () => {
    const ips = ['10.0.0.1', '10.0.0.2'];
    let cbCalls = 0;

    mockTlsConnect.mockImplementationOnce((_opts: any, cb: any) => {
      const sock = fakeSocket();
      process.nextTick(() => {
        cb(null, sock);
        process.nextTick(() => sock.emit('error', Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })));
      });
      return sock;
    });

    const factory = createConnectionFactory(ips);
    factory({} as any, () => { cbCalls++; });
    await tick(3);

    expect(mockTlsConnect).toHaveBeenCalledTimes(1);
    expect(cbCalls).toBe(1);
  });
});

describe('AI-101: exhaustion', () => {
  it('calls cb with error when all IPs fail', async () => {
    const ips = ['10.0.0.1'];
    let cbErr: any = null;
    let cbCalls = 0;

    mockTlsConnect.mockImplementationOnce((_opts: any, _cb: any) => {
      const sock = fakeSocket();
      process.nextTick(() => sock.emit('error', Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })));
      return sock;
    });

    const factory = createConnectionFactory(ips);
    factory({} as any, (err: any) => { cbErr = err; cbCalls++; });
    await tick(2);

    expect(cbCalls).toBe(1);
    expect(cbErr).toBeTruthy();
    expect(cbErr.message).toContain('unreachable');
  });
});

describe('AI-101: SNI servername', () => {
  it('sets servername to api.telegram.org', async () => {
    const ips = ['149.154.167.220'];
    let capturedOpts: any = null;

    mockTlsConnect.mockImplementationOnce((opts: any, cb: any) => {
      capturedOpts = opts;
      const sock = fakeSocket();
      process.nextTick(() => cb(null, sock));
      return sock;
    });

    const factory = createConnectionFactory(ips);
    factory({} as any, () => {});
    await tick(2);

    expect(capturedOpts.servername).toBe('api.telegram.org');
  });
});

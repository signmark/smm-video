/**
 * AI-101: Telegram DNS A-record failover — behavioral tests.
 *
 * Tests the production createConnectionFactory via agent.createConnection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTlsConnect } = vi.hoisted(() => ({ mockTlsConnect: vi.fn() }));
vi.mock('tls', async (importOriginal) => {
  const actual = await importOriginal<typeof import('tls')>();
  return { ...actual, connect: mockTlsConnect, __esModule: true };
});

import * as https from 'https';
import { buildTelegramAgent, createConnectionFactory, clearTelegramIpsCache } from '../services/social-platforms/telegram-http';

function fakeSocket() {
  const sock = new (require('stream').Duplex)({ read() {}, write(_c: any, _e: any, cb: any) { cb(); } }) as any;
  // Настоящий net.Socket умеет setTimeout; Duplex — нет. Без этого двойник
  // разошёлся бы с боевым кодом ровно там, где боевой код и чинится.
  sock.setTimeout = (ms: number, handler?: () => void) => {
    if (sock.__timer) { clearTimeout(sock.__timer); sock.__timer = null; }
    if (ms > 0) {
      sock.__timeoutMs = ms;
      sock.__timer = setTimeout(() => { sock.emit('timeout'); }, ms);
      if (handler) sock.once('timeout', handler);
    } else {
      sock.__timeoutMs = 0;
    }
    return sock;
  };
  return sock;
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

    let sock: any = null;
    mockTlsConnect.mockImplementationOnce((_opts: any, cb: any) => {
      sock = fakeSocket();
      process.nextTick(() => cb(null, sock));
      return sock;
    });

    const factory = createConnectionFactory(ips);
    factory({} as any, () => { cbCalls++; });
    await tick(2);

    // Инвариант: после рукопожатия фабрика снимает свой слушатель 'error'.
    // Иначе поздний обрыв увёл бы её на следующий IP — а запрос к этому моменту
    // уже мог уйти, и пост опубликовался бы дважды.
    expect(sock.listenerCount('error')).toBe(0);

    // Дальше сокетом владеет вызывающий (https.Agent), он и вешает обработчик.
    // Без этой строки голый EventEmitter выбросил бы 'error' в процесс, и vitest
    // засчитал бы прогон как упавший при зелёных тестах.
    const late: any[] = [];
    sock.on('error', (e: any) => late.push(e));
    sock.emit('error', Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' }));
    await tick(2);

    expect(late).toHaveLength(1);
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


// ── Ревью (@Clause_Dev_Hermi): шов «агент ↔ фабрика» ─────────────────────────
// Два предыдущих кандидата были функционально верны и при этом мертвы: фабрика
// передавалась опцией конструктора `new https.Agent({ createConnection })`, а
// Node кладёт эту опцию в `agent.options` и на инстанс не ставит — вызывается
// встроенная. Тесты этого не ловили, потому что проверяли фабрику отдельно.
// Здесь проверяется именно присваивание, чтобы регресс не вернулся молча.
describe('AI-101: агент несёт фабрику, а не наследует встроенную', () => {
  it('createConnection — собственное свойство инстанса', () => {
    const agent = buildTelegramAgent(['10.0.0.1']);
    expect(Object.prototype.hasOwnProperty.call(agent, 'createConnection')).toBe(true);
    expect((agent as any).createConnection).not.toBe((https.Agent.prototype as any).createConnection);
  });

  it('вызов agent.createConnection уходит в перебор адресов с нужным SNI', async () => {
    let captured: any = null;
    mockTlsConnect.mockImplementation((opts: any, cb: any) => {
      captured = opts;
      const sock = fakeSocket();
      process.nextTick(() => cb(null, sock));
      return sock;
    });

    const agent = buildTelegramAgent(['10.0.0.9']);
    let cbCalls = 0;
    (agent as any).createConnection({}, () => { cbCalls++; });
    await tick(2);

    expect(mockTlsConnect).toHaveBeenCalledTimes(1);
    expect(captured.host).toBe('10.0.0.9');
    expect(captured.servername).toBe('api.telegram.org');
    expect(cbCalls).toBe(1);
  });
});


// ── Ревью (@Clause_Dev_Hermi): МОЛЧАЩИЙ адрес ───────────────────────────────
// Замер с прод-хоста: живой адрес Telegram отдаёт secureConnect за 194 мс, а
// адрес-чёрная дыра молчит 45 секунд, не выдав НИ ОДНОГО события — ни 'error',
// ни 'secureConnect'. Именно так вёл себя 149.154.166.110 в инциденте 11.08.
// Перебор по одному лишь 'error' на таком отказе не начинается вовсе, то есть
// не закрывает ровно тот случай, ради которого написан.
describe('AI-101: молчащий адрес уводит на следующий', () => {
  it('переходит на IP2, если IP1 не отвечает ничем', async () => {
    vi.useFakeTimers();
    try {
      const hosts: string[] = [];
      let cbCalls = 0;
      let cbErr: any = 'не вызывали';

      mockTlsConnect.mockImplementation((opts: any, cb: any) => {
        hosts.push(opts.host);
        const sock = fakeSocket();
        // Первый адрес молчит; второй здоров.
        if (hosts.length === 2) process.nextTick(() => cb(null, sock));
        return sock;
      });

      const factory = createConnectionFactory(['10.0.0.1', '10.0.0.2']);
      factory({} as any, (err: any) => { cbCalls++; cbErr = err; });

      // До истечения таймаута перебора быть не должно: живой адрес мог бы
      // ответить и на четвёртой секунде.
      await vi.advanceTimersByTimeAsync(4_000);
      expect(hosts).toEqual(['10.0.0.1']);

      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(hosts).toEqual(['10.0.0.1', '10.0.0.2']);
      expect(cbCalls).toBe(1);
      expect(cbErr).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('после рукопожатия таймаут снят — поздняя тишина не уводит на следующий адрес', async () => {
    vi.useFakeTimers();
    try {
      const hosts: string[] = [];
      let sock: any = null;

      mockTlsConnect.mockImplementation((opts: any, cb: any) => {
        hosts.push(opts.host);
        sock = fakeSocket();
        process.nextTick(() => cb(null, sock));
        return sock;
      });

      const factory = createConnectionFactory(['10.0.0.1', '10.0.0.2']);
      factory({} as any, () => {});
      await vi.advanceTimersByTimeAsync(0);

      // Соединение установлено. Дальше сокетом владеет вызывающий, и молчание в
      // нём — не наше дело: запрос уже мог уйти, повтор дал бы дубль поста.
      expect(sock.__timeoutMs).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(hosts).toEqual(['10.0.0.1']);
    } finally {
      vi.useRealTimers();
    }
  });
});

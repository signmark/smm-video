/**
 * AI-101 Phase 2C: библиотека Telegraf ходит через наш агент, а не мимо.
 *
 * Здесь проверяются свойства фасада и то, что вызовы бота реально уходят в
 * нашу фабрику соединений: `tls` подменён, и каждая попытка соединения видна.
 * Ответа по подделанному сокету не будет — он и не нужен: проверяется путь,
 * а не содержимое ответа.
 *
 * Проволочные свойства — перебор адресов до рукопожатия, запрет повтора после
 * него и один тик long polling на настоящем ответе — живут в
 * `telegram-2c-wire.test.ts`, на настоящем TLS-сервере.
 *
 * Версия библиотеки: telegraf 4.16.3, ссылки на её исходники даны по ней.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

/** Адреса, которые отдаёт DNS. Меняется по ходу теста — на этом держится ротация. */
const dnsAnswer = vi.hoisted(() => ({ ips: ['1.1.1.1'] }));
vi.mock('dns/promises', () => ({
  resolve4: async () => dnsAnswer.ips,
  default: { resolve4: async () => dnsAnswer.ips },
}));

/** Записанные попытки TLS-соединения: адрес и SNI. */
const connects = vi.hoisted(() => [] as Array<{ host: string; servername: string }>);
vi.mock('tls', () => {
  const connect = (opts: any, cb: any) => {
    connects.push({ host: opts.host, servername: opts.servername });
    const sock: any = new EventEmitter();
    sock.setTimeout = () => {};
    sock.destroy = () => {};
    sock.end = () => {};
    // Рукопожатие «состоялось» — колбэк зовётся асинхронно, как у настоящего tls.
    // Сразу после этого сокет падает: ответа по подделке всё равно не будет, а
    // так запрос завершается ошибкой и не держит ни таймеров, ни прогона.
    // Важен сам факт соединения через нашу фабрику.
    setImmediate(() => {
      cb();
      setImmediate(() => {
        // Только если сокет кому-то отдан: в тестах самой фабрики слушателей
        // после рукопожатия нет, и `emit('error')` без слушателя — исключение.
        if (sock.listenerCount('error') > 0) sock.emit('error', new Error('подделанный сокет'));
      });
    });
    return sock;
  };
  return { connect, default: { connect } };
});

beforeEach(() => {
  vi.clearAllMocks();
  connects.length = 0;
  dnsAnswer.ips = ['1.1.1.1'];
  process.env.TELEGRAM_API_IPS = '';
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Phase 2C: бот отдаёт Telegraf наш агент', () => {
  /**
   * Сервис поднимается по-настоящему — иначе проверка не о production.
   * Гасим только периодику: `startSessionSync` вешает интервал, который
   * пережил бы файл и держал прогон.
   */
  async function buildService() {
    const timer = vi.spyOn(global, 'setInterval').mockReturnValue(0 as any);
    // Шину событий Directus поднимает сервер; в тесте её нет, а конструктор
    // на неё подписывается.
    (global as any).directusEventEmitter ??= new EventEmitter();
    const { TelegramBotService } = await import('../telegram-bot/index');
    const service: any = new TelegramBotService('BOTTOKEN');
    timer.mockRestore();
    return service;
  }

  async function expectGoesThroughAgent(call: () => Promise<unknown>) {
    connects.length = 0;
    await call().catch(() => {});
    // Проверяется путь, а не число попыток: на битом сокете node сам решает,
    // переоткрыть ли соединение. Сколько раз можно соединяться после ответа —
    // предмет проволочного теста, там это считается на настоящем сервере.
    expect(connects.length).toBeGreaterThanOrEqual(1);
    for (const c of connects) {
      expect(c).toEqual({ host: '1.1.1.1', servername: 'api.telegram.org' });
    }
  }

  it('sendMessage, getFile и вызов long polling идут через наш агент', async () => {
    const { getTelegramAgent } = await import('../services/social-platforms/telegram-http');
    const service = await buildService();
    const facade = getTelegramAgent();

    // Объект берётся один раз при `new Telegraf`, а не подменой поля потом.
    // Telegraf читает `options.agent` на каждый вызов (client.js:300).
    expect(service.bot.telegram.options.agent).toBe(facade);
    // Им качаются произвольные URL медиа (client.js:197) — нашему агенту там не место.
    expect(service.bot.telegram.options.attachmentAgent).toBeUndefined();

    await expectGoesThroughAgent(() => service.bot.telegram.sendMessage(555, 'привет'));
    await expectGoesThroughAgent(() => service.bot.telegram.getFile('file-1'));
    // Ровно тот вызов, которым живёт long polling (polling.js:29).
    await expectGoesThroughAgent(() =>
      service.bot.telegram.callApi('getUpdates', { timeout: 50, offset: 0, allowed_updates: ['message'] }),
    );
  });
});

describe('Phase 2C: свойства фасада', () => {
  async function facadeConnect(options: any) {
    const { getTelegramAgent, _resetTelegramAgentForTests } = await import(
      '../services/social-platforms/telegram-http'
    );
    _resetTelegramAgentForTests();
    const agent: any = getTelegramAgent();
    return new Promise<{ err: Error | null; calls: number }>((resolve) => {
      let calls = 0;
      let last: Error | null = null;
      agent.createConnection(options, (err: Error | null) => {
        calls++;
        last = err;
        // Ждём лишний тик: второй вызов колбэка, если он есть, успеет прийти.
        setTimeout(() => resolve({ err: last, calls }), 20);
      });
    });
  }

  it('смена ответа DNS применяется на ТОМ ЖЕ объекте агента', async () => {
    const { getTelegramAgent, _resetTelegramAgentForTests } = await import(
      '../services/social-platforms/telegram-http'
    );
    _resetTelegramAgentForTests();
    const agent: any = getTelegramAgent();
    const opts = { host: 'api.telegram.org', servername: 'api.telegram.org', port: 443 };

    await new Promise<void>((done) => agent.createConnection(opts, () => done()));
    expect(connects[0].host).toBe('1.1.1.1');

    // Кэш адресов живёт 5 минут — двигаем часы, а не ждём.
    dnsAnswer.ips = ['2.2.2.2'];
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + 6 * 60 * 1000);

    await new Promise<void>((done) => agent.createConnection(opts, () => done()));
    expect(connects[1].host).toBe('2.2.2.2');
    // Тот же объект — это и есть проверяемое свойство: захваченный агент так не умеет.
    expect(getTelegramAgent()).toBe(agent);
    expect(connects.every((c) => c.servername === 'api.telegram.org')).toBe(true);
  });

  it('чужой хост и чужой порт отклоняются, соединение не создаётся', async () => {
    const foreign = await facadeConnect({ host: 'localhost', port: 8081 });
    expect(foreign.err).toBeInstanceOf(Error);
    expect(String(foreign.err?.message)).toContain('localhost:8081');
    expect(foreign.calls).toBe(1);

    const wrongPort = await facadeConnect({ host: 'api.telegram.org', port: 8443 });
    expect(wrongPort.err).toBeInstanceOf(Error);
    expect(wrongPort.calls).toBe(1);

    expect(connects).toHaveLength(0);
  });

  it('падение резолва уходит в колбэк один раз, без unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    // Роняем ветку предупреждения о пустом запасе — единственное место внутри
    // getTargets, где может выброситься исключение. Проверяется путь ошибки,
    // а не сам логгер.
    vi.doMock('../utils/logger', () => ({
      log: () => {
        throw new Error('логгер упал');
      },
    }));

    const res = await facadeConnect({ host: 'api.telegram.org', port: 443 });
    expect(res.err).toBeInstanceOf(Error);
    expect(res.calls).toBe(1);
    expect(connects).toHaveLength(0);

    await new Promise((r) => setTimeout(r, 30));
    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
  });
});

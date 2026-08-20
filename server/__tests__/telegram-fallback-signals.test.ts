/**
 * AI-101 Phase 1 (task #31): запасные адреса из TELEGRAM_API_IPS и сигналы о них.
 *
 * Смысл сигналов. Пин адреса в compose — костыль, который однажды протухнет
 * молча: Telegram сменит адрес, публикация встанет, и мы снова будем искать
 * причину в правах бота. Поэтому запас обязан о себе сообщать, но только по
 * факту, а не по составу списка:
 *   «запас спас»  — соединение УСТАНОВЛЕНО через адрес, которого нет в DNS.
 *   «запас протух» — адрес не из DNS ПРОБОВАЛИ, и он не ответил.
 * Оба решения принимаются по принадлежности к DNS, а не по индексу в переборе
 * и не по вхождению в env: адрес, попавший и в DNS, и в env, — это «DNS догнал
 * запас», хорошая новость, о которой молчат.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockTlsConnect, mockResolve4, mockLog } = vi.hoisted(() => ({
  mockTlsConnect: vi.fn(),
  mockResolve4: vi.fn(),
  mockLog: Object.assign(vi.fn(), { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('tls', async (importOriginal) => {
  const actual = await importOriginal<typeof import('tls')>();
  return { ...actual, connect: mockTlsConnect, __esModule: true };
});
vi.mock('dns/promises', () => ({ resolve4: mockResolve4, default: { resolve4: mockResolve4 } }));
// Путь считается от тестового файла: server/__tests__/.. + utils/logger — тот же
// модуль, который telegram-http.ts тянет как '../../utils/logger'.
vi.mock('../utils/logger', () => ({ log: mockLog, default: mockLog }));

import axios from 'axios';
import {
  createConnectionFactory,
  getTargets,
  getFallbackIps,
  shouldWarn,
  telegramAxios,
  clearTelegramIpsCache,
} from '../services/social-platforms/telegram-http';

/** Двойник сокета: Duplex + setTimeout, как в telegram-http-failover.test.ts. */
function fakeSocket() {
  const sock = new (require('stream').Duplex)({
    read() {},
    write(_c: any, _e: any, cb: any) { cb(); },
  }) as any;
  sock.setTimeout = (ms: number, handler?: () => void) => {
    if (sock.__timer) { clearTimeout(sock.__timer); sock.__timer = null; }
    if (ms > 0 && handler) sock.once('timeout', handler);
    return sock;
  };
  return sock;
}

function tick(n = 3): Promise<void> {
  let p = Promise.resolve();
  for (let i = 0; i < n; i++) p = p.then(() => new Promise((r) => setImmediate(r)));
  return p;
}

/**
 * Сценарий перебора: для каждого адреса сказать, отвечает он или нет.
 * Возвращает список адресов в порядке реальных попыток.
 */
function runFactory(targets: string[], dnsIps: string[], alive: (ip: string) => boolean) {
  const tried: string[] = [];
  mockTlsConnect.mockImplementation((opts: any, onSecure: any) => {
    tried.push(opts.host);
    const sock = fakeSocket();
    if (alive(opts.host)) {
      process.nextTick(() => onSecure());
    } else {
      process.nextTick(() =>
        sock.emit('error', Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' })),
      );
    }
    return sock;
  });
  const outcome: { err: any } = { err: undefined };
  const factory = createConnectionFactory(targets, dnsIps);
  factory({} as any, (err: any) => { outcome.err = err; });
  return { tried, outcome };
}

/**
 * Агент, который telegramAxios отдал axios последним вызовом create.
 * Смотрим именно его, а не возвращённый инстанс: axios в этом наборе тестов
 * подменён глобально в setup.ts и конфиг до defaults не доносит.
 */
function lastAgent(): any {
  const calls = (axios as any).create.mock.calls;
  return calls[calls.length - 1][0].httpsAgent;
}

/**
 * Дёрнуть перебор через конкретный агент — то, что реально пойдёт в сеть.
 *
 * Опции соединения передаём настоящие: фасад (AI-112) разрешает адреса внутри
 * `createConnection` и по этим же опциям проверяет, что его не позвали для чужого
 * хоста. Пустой объект здесь означал бы «соединение неизвестно куда» — фасад его
 * отклоняет, и это правильно.
 *
 * Await обязателен: фасад резолвит цели асинхронно, до тика ни одной попытки ещё нет.
 */
async function connectVia(agent: any, alive: (ip: string) => boolean) {
  const tried: string[] = [];
  mockTlsConnect.mockImplementation((opts: any, onSecure: any) => {
    tried.push(opts.host);
    const sock = fakeSocket();
    if (alive(opts.host)) process.nextTick(() => onSecure());
    else process.nextTick(() => sock.emit('error', new Error('ECONNREFUSED')));
    return sock;
  });
  agent.createConnection({ host: 'api.telegram.org', port: 443, servername: 'api.telegram.org' }, () => {});
  await tick();
  return { tried };
}

function warns(): string[] {
  return mockLog.mock.calls
    .filter((c) => c[2] === 'warn')
    .map((c) => String(c[0]));
}
const saved = () => warns().filter((m) => m.includes('запас спас'));
const stale = () => warns().filter((m) => m.includes('запас протух'));

beforeEach(() => {
  vi.clearAllMocks();
  clearTelegramIpsCache();
  delete process.env.TELEGRAM_API_IPS;
});
afterEach(() => {
  delete process.env.TELEGRAM_API_IPS;
});

describe('task #31: «запас спас» — по принадлежности к DNS, а не по индексу', () => {
  it('DNS не дал ничего, запасной адрес ответил первым же — сигнал есть', async () => {
    // Ровно тот случай, ради которого всё затевалось: 11.08 DNS отдавал один
    // мёртвый адрес. Если бы DNS отдал пусто, запас стоял бы под индексом 0.
    const { tried, outcome } = runFactory(['149.154.167.220'], [], () => true);
    await tick();

    expect(tried).toEqual(['149.154.167.220']);
    expect(outcome.err).toBeNull();
    expect(saved()).toHaveLength(1);
    expect(saved()[0]).toContain('149.154.167.220');
  });

  it('адрес из DNS отказал, запасной подхватил — сигнал есть', async () => {
    const { tried } = runFactory(
      ['149.154.166.110', '149.154.167.220'],
      ['149.154.166.110'],
      (ip) => ip === '149.154.167.220',
    );
    await tick();

    expect(tried).toEqual(['149.154.166.110', '149.154.167.220']);
    expect(saved()).toHaveLength(1);
    expect(saved()[0]).toContain('149.154.167.220');
  });

  it('ответил адрес из DNS — молчим, даже если он же перечислен в TELEGRAM_API_IPS', async () => {
    // «DNS догнал запас». Считать по вхождению в env — значит объявлять
    // здоровый DNS спасённым запасом и звать дежурного на пустое место.
    process.env.TELEGRAM_API_IPS = '149.154.167.220';
    const { tried } = runFactory(['149.154.167.220'], ['149.154.167.220'], () => true);
    await tick();

    expect(tried).toEqual(['149.154.167.220']);
    expect(saved()).toHaveLength(0);
    expect(stale()).toHaveLength(0);
  });

  it('всё пришло из DNS и первый же ответил — ни одного warn', async () => {
    const { tried } = runFactory(['1.1.1.1', '2.2.2.2'], ['1.1.1.1', '2.2.2.2'], () => true);
    await tick();

    expect(tried).toEqual(['1.1.1.1']);
    expect(warns()).toHaveLength(0);
  });
});

describe('task #31: «запас протух» — только по факту неудачной попытки', () => {
  it('запасной адрес пробовали и он не ответил — сигнал есть', async () => {
    const { outcome } = runFactory(['1.1.1.1', '9.9.9.9'], ['1.1.1.1'], () => false);
    await tick();

    expect(outcome.err).toBeInstanceOf(Error);
    expect(stale()).toHaveLength(1);
    expect(stale()[0]).toContain('9.9.9.9');
  });

  it('отказ адреса ИЗ DNS протухшим запасом не считается', async () => {
    // DNS отдаёт живые адреса на общих основаниях; их отказ — не наша просрочка.
    runFactory(['1.1.1.1', '2.2.2.2'], ['1.1.1.1', '2.2.2.2'], () => false);
    await tick();

    expect(stale()).toHaveLength(0);
  });

  it('адрес, отрезанный ограничением попыток, протухшим не объявляется', async () => {
    // Он в перебор не попал — сказать про него «не ответил при реальной попытке»
    // означало бы соврать в логе, по которому потом ищут причину.
    // 4 адреса из DNS + 2 из env, потолок 5 -> 8.8.8.8 в перебор не попадает.
    mockResolve4.mockResolvedValue(['1.1.1.1', '1.1.1.2', '1.1.1.3', '1.1.1.4']);
    process.env.TELEGRAM_API_IPS = '9.9.9.9,8.8.8.8';

    const dnsIps = ['1.1.1.1', '1.1.1.2', '1.1.1.3', '1.1.1.4'];
    const targets = await getTargets();
    expect(targets).not.toContain('8.8.8.8'); // отрезан потолком

    runFactory(targets, dnsIps, () => false);
    await tick(6);

    expect(stale().join(' ')).toContain('9.9.9.9');
    expect(stale().join(' ')).not.toContain('8.8.8.8');
  });

  it('одна и та же попытка не даёт сразу и «спас», и «протух»', async () => {
    runFactory(['9.9.9.9'], [], () => true);
    await tick();

    expect(saved()).toHaveLength(1);
    expect(stale()).toHaveLength(0);
  });
});

describe('task #31: throttle — час на пару событие+адрес', () => {
  it('тот же ключ подавляется, другой адрес проходит, другое событие проходит', () => {
    expect(shouldWarn('fallback_saved:9.9.9.9')).toBe(true);
    expect(shouldWarn('fallback_saved:9.9.9.9')).toBe(false);
    expect(shouldWarn('fallback_saved:8.8.8.8')).toBe(true);
    expect(shouldWarn('fallback_stale:9.9.9.9')).toBe(true);
  });

  it('через час ключ снова проходит', () => {
    const real = Date.now;
    let now = 1_700_000_000_000;
    Date.now = () => now;
    try {
      expect(shouldWarn('fallback_saved:7.7.7.7')).toBe(true);
      now += 59 * 60 * 1000;
      expect(shouldWarn('fallback_saved:7.7.7.7')).toBe(false);
      now += 2 * 60 * 1000; // итого 61 минута
      expect(shouldWarn('fallback_saved:7.7.7.7')).toBe(true);
    } finally {
      Date.now = real;
    }
  });

  it('повторный отказ того же запасного адреса не пишет второй раз', async () => {
    runFactory(['9.9.9.9'], [], () => false);
    await tick();
    const first = stale().length;
    runFactory(['9.9.9.9'], [], () => false);
    await tick();

    expect(first).toBe(1);
    expect(stale()).toHaveLength(1); // второго не добавилось
  });
});

describe('task #31: состав списка целей', () => {
  it('DNS впереди, запас добивает остаток, дубли схлопываются', async () => {
    mockResolve4.mockResolvedValue(['1.1.1.1', '2.2.2.2']);
    process.env.TELEGRAM_API_IPS = '2.2.2.2,9.9.9.9';

    expect(await getTargets()).toEqual(['1.1.1.1', '2.2.2.2', '9.9.9.9']);
  });

  it('DNS лёг — идёт один запас', async () => {
    mockResolve4.mockRejectedValue(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
    process.env.TELEGRAM_API_IPS = '149.154.167.220';

    expect(await getTargets()).toEqual(['149.154.167.220']);
  });

  it('DNS лёг и запаса нет — остаётся имя хоста, а не пустота', async () => {
    mockResolve4.mockResolvedValue([]);

    expect(await getTargets()).toEqual(['api.telegram.org']);
  });

  it('список обрезается пятью попытками: 5 × 5 с < 30 с таймаута axios', async () => {
    mockResolve4.mockResolvedValue(['1.1.1.1', '1.1.1.2', '1.1.1.3', '1.1.1.4']);
    process.env.TELEGRAM_API_IPS = '9.9.9.1,9.9.9.2,9.9.9.3';

    const targets = await getTargets();
    expect(targets).toHaveLength(5);
    expect(targets).toEqual(['1.1.1.1', '1.1.1.2', '1.1.1.3', '1.1.1.4', '9.9.9.1']);
  });

  it('мусор в переменной отбрасывается по одному значению, а не целиком', async () => {
    process.env.TELEGRAM_API_IPS = ' 149.154.167.220 , не-адрес ,, 8.8.8.8 ';
    expect(getFallbackIps()).toEqual(['149.154.167.220', '8.8.8.8']);
    expect(warns()).toHaveLength(0); // часть адресов годная — тревоги нет
  });
});

describe('task #31: релиз без своей переменной не проходит молча', () => {
  it('переменная не задана — сообщение в лог, а не тишина', () => {
    // Тишина здесь неотличима от «запас не понадобился», а значит правка может
    // уехать на прод пустышкой и обнаружиться только следующим инцидентом.
    expect(getFallbackIps()).toEqual([]);

    const w = warns();
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('TELEGRAM_API_IPS не задана');
  });

  it('переменная задана мусором целиком — отдельное сообщение с содержимым', () => {
    process.env.TELEGRAM_API_IPS = 'api.telegram.org, 999.1.1.1';

    expect(getFallbackIps()).toEqual([]);
    const w = warns();
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('ни один адрес не разобран');
    expect(w[0]).toContain('999.1.1.1'); // видно, что именно вписали
  });

  it('сообщение о ненастроенной переменной тоже под throttle', () => {
    getFallbackIps();
    getFallbackIps();
    getFallbackIps();

    expect(warns()).toHaveLength(1);
  });
});


/**
 * Оба случая ниже найдены на ревью Phase 1 и внесены в приёмку Phase 2A.
 * Общее у них одно: сигнал остаётся формально правдивым по коду и ложным по смыслу.
 */
describe('task #31 Phase 2A: сигнал не должен врать, когда запаса нет', () => {
  it('ни DNS, ни переменная не дали адресов — это деградация, а не «запас спас»', async () => {
    // Единственная цель — имя хоста, разрешение ушло системному резолверу,
    // перебора нет. Прежний код объявлял такой успех спасением запаса, хотя
    // спасать было нечем: дежурный пошёл бы искать несуществующий запасной адрес.
    const { tried, outcome } = runFactory([], [], () => true);
    await tick();

    expect(tried).toEqual(['api.telegram.org']);
    expect(outcome.err).toBeNull();
    expect(saved()).toHaveLength(0);

    const w = warns();
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('по имени api.telegram.org');
    expect(w[0]).toContain('перебора не будет');
  });

  it('DNS умер, а его адреса совпадали с запасом — смена происхождения видна БЕЗ пересборки агента', async () => {
    // Список целей в обоих замерах один и тот же, меняется только его происхождение.
    //
    // Прежде это была ловушка отпечатка: агент пересобирался по составу целей, одни
    // и те же адреса отпечаток не меняли, агент доживал со старым fromDns, и «запас
    // спас» не печатался ровно тогда, когда запас единственный держал публикацию.
    // Отпечаток пришлось расширять составом DNS.
    //
    // После AI-112 ловушки нет по устройству: агент один на процесс и ничего не
    // помнит, происхождение адресов выясняется в момент КАЖДОГО соединения. Поэтому
    // ниже утверждается более сильное свойство, чем раньше: объект тот же самый, а
    // сигнал всё равно меняется вслед за DNS.
    process.env.TELEGRAM_API_IPS = '149.154.167.220,149.154.166.110';

    // Время двигаем руками, а кэш НЕ сбрасываем: на проде он протухает сам, по TTL.
    const real = Date.now;
    let now = 1_700_000_000_000;
    Date.now = () => now;
    try {
      mockResolve4.mockResolvedValue(['149.154.167.220', '149.154.166.110']);
      await telegramAxios('token');
      const healthy = lastAgent();
      expect((await connectVia(healthy, () => true)).tried).toEqual(['149.154.167.220']);
      expect(saved()).toHaveLength(0); // адрес пришёл из DNS — сигналу неоткуда взяться

      now += 6 * 60 * 1000; // больше CACHE_TTL: следующий вызов идёт в резолвер
      mockLog.mockClear();
      mockResolve4.mockRejectedValue(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));

      await telegramAxios('token');
      const dnsDead = lastAgent();
      expect(dnsDead).toBe(healthy); // тот же объект — пересобирать больше нечего
      expect((await connectVia(dnsDead, () => true)).tried).toEqual(['149.154.167.220']);

      expect(saved()).toHaveLength(1);
      expect(saved()[0]).toContain('149.154.167.220');
    } finally {
      Date.now = real;
    }
  });

  it('фасад отказывается соединяться с чужим хостом, а не молча уводит запрос на адреса Telegram', async () => {
    // Прямые вызовы после AI-112 наследуют fail-close фасада. Проверка нужна
    // именно здесь: раньше агент telegramAxios соединялся куда угодно.
    process.env.TELEGRAM_API_IPS = '149.154.167.220';
    mockResolve4.mockResolvedValue(['149.154.167.220']);
    await telegramAxios('token');
    const agent = lastAgent();

    const tried: string[] = [];
    mockTlsConnect.mockImplementation((opts: any, onSecure: any) => {
      tried.push(opts.host);
      const sock = fakeSocket();
      process.nextTick(() => onSecure());
      return sock;
    });

    let err: any;
    agent.createConnection({ host: 'example.com', port: 443, servername: 'example.com' }, (e: any) => { err = e; });
    await tick();

    expect(tried).toEqual([]);
    expect(String(err?.message)).toContain('соединение отклонено');
  });
});

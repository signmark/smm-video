/**
 * AI-101 Phase 2C, проволочные проверки: настоящий TLS-сервер, настоящее
 * рукопожатие, настоящий HTTP-ответ.
 *
 * Подделка сокета доказывает, что запрос пошёл через нашу фабрику, но не может
 * доказать главного свойства транспорта: перебор адресов допустим ТОЛЬКО до
 * рукопожатия. После того как запрос ушёл, второй адрес — это дубль поста.
 * Такое проверяется только на проводе.
 *
 * Два адреса — 127.0.0.2 и 127.0.0.3 на одном порту: перебор в фабрике идёт по
 * адресам, а порт приходит из запроса.
 *
 * Сертификат ниже — одноразовый, самоподписанный, выпущен для этого теста на
 * CN=api.telegram.org. Ключ публичный по построению и ничего не защищает.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as tls from 'tls';
import * as https from 'https';
import { createRequire } from 'module';
import { buildTelegramAgent } from '../services/social-platforms/telegram-http';

const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDE9sFJuQIrA/Pu
aaWwkFq19rW+8TSRe9GhhMdY1NvhxYGFSdQ+HvE4oCYpvLzjF9/c9Z/x1H6C/ean
P+034RlTzVNJSARTVtRRikHiXakZMTHRRE4Z3RkLm0uUBIzrVFcNN/IUcTWqB/Pt
0wSRQ7afyATFvzusvHbmKb5Gb0CiEmSI+ViCF4f7J8Hgdglf6XENw9qIXloRRdJC
Ehs1kTH2bHT3B3zCVAwgRSfydXmkiTNXq+Wo+TPbb4pWLDgE6egyS7BpE3LQw0tR
/V1N7LNv2DXM4jgDaeBi4GnLbG3Wp5AaqzESFI43QcNhPWSwjp8qzs/7HBwMNVFb
5hhaxASbAgMBAAECggEAG+l5XBXdxXQang9WrajR/LYTl2rd2j1uaFyaq29ZdwCN
lEfxeJmF8aewViXVrBD2u9ILHTLRzYURqg3tyLIblrv4MOBbIeb3e6lYy4LJCIrn
gRJpnFIFeexDT5ySznP19NJCz2bOW2Qjy0YmKuJ/qjD8NtHHhnkcGGM+AFlFEt0X
DSbtnvsklYoxeDZpmPAT1F8XIQ5x5b5oRJ8AoeOJ0EHe6x/TBVRwCBKSrO5lyGl1
ZPGYi3JsJHFc3aTdpM4CUgOfnRjqYu1ADws/u+fFrYHKgW/OLh2tfIR/nEnxAqbj
x7TEYYP+3tJbQxFEfHX/TPuHCvI2YXdHVf3tirZo0QKBgQD6IwmL0j7B21C+jrjF
8Gr42B2whlq+NyHQr0EUo7LdapaThe1qHrioKYbZ8+KVSD2Zqf8mxE2xLT4tNQ0r
DP3G+zw0GtB7XRAnH6M7R+JS9eI3vWMtsmohniylIzD24qIQZRJ1TJIKagULAXob
KzEXUKP6LX/S/ZyWtdxGYs7/vQKBgQDJlKZYvCyxKBZ5psBRse7pSOs3sbP+rLAN
LWZHsGxsg7jLmgrHnRks5PmoZqoLes1vIFDEonhmIvgouq5QPBbvEMjD+MKyLX53
V1zUxk6Lxb2v6LtqvSptBniqog1Egyg313enXbXPkB7f9D86qXrUO9nnwxn2AU0y
55ta1fsPNwKBgHqKM6EF7Ky3roTMEoUV1LH33gOerlHFXJGJac6cq4GBOCcpUzfL
uRbY0TFxIy2S6GqhN1hcjtsfmPg4pyzR/nk+ly3HfR8SZllkTGk8PAn8X0iDRVUb
tJankKON6+zm9hImEbbZPipP6gyMOq+Yp0IOxWZIZ/iLOe0zRqhMu6/ZAoGAZ+bK
5yn3D0lObF3a+0DvmCcRtp9N25M/G0uvUHxLJpOuiKNZsxHyjAVp+bcRJuGhSgoq
F3B3Bo43wyaV+p0+ZPMNyJVMJXL1oKXTH4knqzu9ThJzp8zhNVkEkU7977Z64G2b
KxVORTJP97d5b88zlHlVE/SoSPjaxcZDeUqaIXkCgYARMXzz6/qooT6nAIxdWNL4
BtpZ8mvMeG7ZTdftOZJAYUEDy+ilvmZWMk5cWc4gPCEY/1a6Hg/LmqifXihzjxo0
dTjsTpVM5wfGREctkTOUK4KtL9jm2uRIH4CgHIDuCVPAMoKFLAoe/QsH45R7F4o1
XWK9X7zrB8ogV4mqHcFfuA==
-----END PRIVATE KEY-----`;

const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDFzCCAf+gAwIBAgIUEXDTUTKH4epNDLRY3lD84jD7d7kwDQYJKoZIhvcNAQEL
BQAwGzEZMBcGA1UEAwwQYXBpLnRlbGVncmFtLm9yZzAeFw0yNjA4MTIxMjE0NDRa
Fw00NjA4MDcxMjE0NDRaMBsxGTAXBgNVBAMMEGFwaS50ZWxlZ3JhbS5vcmcwggEi
MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDE9sFJuQIrA/PuaaWwkFq19rW+
8TSRe9GhhMdY1NvhxYGFSdQ+HvE4oCYpvLzjF9/c9Z/x1H6C/eanP+034RlTzVNJ
SARTVtRRikHiXakZMTHRRE4Z3RkLm0uUBIzrVFcNN/IUcTWqB/Pt0wSRQ7afyATF
vzusvHbmKb5Gb0CiEmSI+ViCF4f7J8Hgdglf6XENw9qIXloRRdJCEhs1kTH2bHT3
B3zCVAwgRSfydXmkiTNXq+Wo+TPbb4pWLDgE6egyS7BpE3LQw0tR/V1N7LNv2DXM
4jgDaeBi4GnLbG3Wp5AaqzESFI43QcNhPWSwjp8qzs/7HBwMNVFb5hhaxASbAgMB
AAGjUzBRMB0GA1UdDgQWBBT11iYCg1bou0+0cR5VDseC1Pih5jAfBgNVHSMEGDAW
gBT11iYCg1bou0+0cR5VDseC1Pih5jAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3
DQEBCwUAA4IBAQBBz1nN1bI5DXlY3tYFzyiiXqZ9kdW1R7OpX2ovyHZWug+MUBxX
rHJhTkUK7SQ0CMoGy1da1VmMfc/uHQPto5lm8AmGeI5bDiuoggR0h+8geu8f59i3
L6HbuLfqIBcCXJts8Ag2k2LqCY3bYnwPaZM50NMi3t1Q8jnulkUt7F8V/56av6wp
RVrBuyWHmVAorLtd980y0yajLsV5o8tsOxFEL74JREHBTwJxQi2DQPTN88PjDHV4
eS5ePQk/khKGl9VCHrVGs+s5Sp5fGCDkJy5qNfLVwVkVQopvUn5mTAxQnA+3i8Uf
d0UOaV8cXYdEQuOGlrZlLyz2WEGXMRAnFv7M
-----END CERTIFICATE-----`;

type Fixture = {
  server: tls.Server;
  connections: number;
  /** Что отвечать: обычный ответ, ошибка сервера или молчание. */
  mode: 'ok' | 'error500' | 'silent';
  body: string;
};

const fixtures: Fixture[] = [];
let PORT = 0;

function startFixture(host: string, port: number): Promise<Fixture> {
  const fx: Fixture = {
    server: null as any,
    connections: 0,
    mode: 'ok',
    body: JSON.stringify({ ok: true, result: [] }),
  };
  const server = tls.createServer({ key: TEST_KEY, cert: TEST_CERT }, (socket) => {
    fx.connections++;
    socket.on('error', () => {});
    socket.once('data', () => {
      if (fx.mode === 'silent') {
        // Соединение установлено, запрос принят — и тишина. Ровно так вёл себя
        // адрес Telegram в инциденте 11.08. До рукопожатия на такое молчание
        // положен переход к следующему адресу; после — категорически нет:
        // запрос уже ушёл, и второй адрес означал бы дубль поста.
        return;
      }
      const status = fx.mode === 'error500' ? '500 Internal Server Error' : '200 OK';
      socket.write(
        `HTTP/1.1 ${status}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(fx.body)}\r\nConnection: close\r\n\r\n${fx.body}`,
      );
      socket.end();
    });
  });
  fx.server = server;
  return new Promise((resolve) => server.listen(port, host, () => resolve(fx)));
}

/** Агент с нашей фабрикой + доверие тестовому сертификату. */
function wireAgent(targets: string[]): https.Agent {
  const agent = buildTelegramAgent(targets);
  (agent as any).options = { ...(agent as any).options, ca: TEST_CERT, keepAlive: false };
  return agent;
}

/**
 * Запрос делается голым `https`, а не axios: axios в этом наборе тестов
 * подменён глобально (`setup.ts`), а здесь нужен настоящий клиент — проверяем
 * провод, а не обёртку.
 */
function httpsGet(
  url: string,
  agent: https.Agent,
  timeoutMs = 10_000,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('ответ оборван')));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('таймаут запроса')));
  });
}

beforeAll(async () => {
  const first = await startFixture('127.0.0.2', 0);
  PORT = (first.server.address() as any).port;
  const second = await startFixture('127.0.0.3', PORT);
  fixtures.push(first, second);
});

afterAll(async () => {
  await Promise.all(fixtures.map((f) => new Promise((r) => f.server.close(() => r(null)))));
});

/** Пауза, за которую успело бы состояться нежелательное второе соединение. */
function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 300));
}

function reset() {
  for (const f of fixtures) {
    f.connections = 0;
    f.mode = 'ok';
  }
}

describe('Phase 2C на проводе: перебор адресов и запрет повтора', () => {
  it('до рукопожатия: мёртвый адрес пропускается, следующий отвечает', async () => {
    reset();
    // 127.0.0.9 никто не слушает — отказ приходит до всякого рукопожатия.
    const agent = wireAgent(['127.0.0.9', '127.0.0.2']);
    const res = await httpsGet(`https://api.telegram.org:${PORT}/botX/getMe`, agent);

    expect(res.status).toBe(200);
    expect(fixtures[0].connections).toBe(1);
    expect(fixtures[1].connections).toBe(0);
  });

  it('после рукопожатия: ответ 500 не ведёт на следующий адрес', async () => {
    reset();
    fixtures[0].mode = 'error500';
    const agent = wireAgent(['127.0.0.2', '127.0.0.3']);

    const res = await httpsGet(`https://api.telegram.org:${PORT}/botX/sendMessage`, agent);
    await settle();

    expect(res.status).toBe(500);
    // Ровно одно соединение: второй адрес не пробовался. Это и есть запрет
    // повтора после HTTP — иначе пост ушёл бы дважды.
    expect(fixtures[0].connections).toBe(1);
    expect(fixtures[1].connections).toBe(0);
  });

  it(
    'после рукопожатия: молчание адреса не ведёт на следующий',
    async () => {
      reset();
      fixtures[0].mode = 'silent';
      const agent = wireAgent(['127.0.0.2', '127.0.0.3']);

      await expect(
        httpsGet(`https://api.telegram.org:${PORT}/botX/sendMessage`, agent, 1000),
      ).rejects.toThrow();

      // Ждём дольше, чем таймаут соединения в фабрике (5 с). Если бы сторож
      // молчания остался вооружён после рукопожатия, ровно здесь и случился бы
      // уход на второй адрес.
      await new Promise((r) => setTimeout(r, 7000));

      expect(fixtures[0].connections).toBe(1);
      expect(fixtures[1].connections).toBe(0);
    },
    20_000,
  );
});

describe('Phase 2C на проводе: один тик long polling', () => {
  it('getUpdates проходит через наш агент и останавливается по abort', async () => {
    reset();
    fixtures[0].body = JSON.stringify({ ok: true, result: [] });
    const agent = wireAgent(['127.0.0.2']);

    const { Telegraf } = await import('telegraf');
    const bot = new Telegraf('TESTTOKEN', {
      // apiRoot с портом — единственный способ увести библиотеку на локальный
      // сервер; сам агент и его перебор адресов при этом настоящие.
      telegram: { apiRoot: `https://api.telegram.org:${PORT}`, agent },
    });

    const nodeRequire = createRequire(__filename);
    // Класс Polling не выставлен в exports пакета — берём файл по абсолютному
    // пути от точки входа библиотеки. Настоящий, не заглушка.
    const telegrafRoot = nodeRequire.resolve('telegraf').split('/lib/')[0];
    const { Polling } = nodeRequire(`${telegrafRoot}/lib/core/network/polling.js`);

    const polling: any = new Polling((bot as any).telegram, ['message']);
    const iterator = polling[Symbol.asyncIterator]();
    const tick = await iterator.next();

    // Явная остановка: генератор не остаётся висеть после теста.
    polling.abortController.abort();
    await iterator.return?.();

    expect(tick.value).toEqual([]);
    expect(fixtures[0].connections).toBe(1);
    expect(fixtures[1].connections).toBe(0);
  });
});

/**
 * AI-101: Telegram HTTP transport with DNS A-record failover.
 *
 * api.telegram.org resolves to multiple IPs. When one is unreachable at
 * TCP/TLS level (ECONNREFUSED, ETIMEDOUT, ENOTFOUND), the client tries
 * the next IP rather than failing immediately.
 *
 * CRITICAL: After ANY HTTP response (2xx, 4xx, 5xx — anything), NO retry
 * and NO next-IP is allowed. The post may already be published on Telegram's
 * side; retrying would create a duplicate.
 *
 * Rule-59 file:line references:
 *   - DNS cache: :25-27 (cachedIps/cachedAt)
 *   - TCP/TLS failover: :55-82 (tryConnect with IP rotation)
 *   - HTTP safety (listener removal after handshake): see tls.connect callback
 *   - Silent-address timeout (incident 11.08): CONNECT_TIMEOUT_MS + onTimeout
 *   - SNI servername: :63
 *   - Shared agent: :30-32, :46, :87
 */
import * as dns from 'dns/promises';
import * as tls from 'tls';
import * as https from 'https';
import axios, { AxiosInstance } from 'axios';

const TELEGRAM_HOST = 'api.telegram.org';

let cachedIps: string[] | null = null;
let cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

// Shared keepAlive agent — one per process (AI-101 review fix)
let _agent: https.Agent | null = null;
let _agentBuiltFor: string | null = null;

async function getTelegramIps(): Promise<string[]> {
  if (cachedIps && Date.now() - cachedAt < CACHE_TTL) return cachedIps;
  try {
    cachedIps = await dns.resolve4(TELEGRAM_HOST);
    cachedAt = Date.now();
  } catch {
    cachedIps = [];
  }
  return cachedIps;
}

/** Create an axios instance with Telegram DNS failover on the given token. */
export async function telegramAxios(token: string): Promise<AxiosInstance> {
  const ips = await getTelegramIps();
  const ipFingerprint = ips.join(',');

  if (!_agent || _agentBuiltFor !== ipFingerprint) {
    _agent = buildTelegramAgent(ips);
    _agentBuiltFor = ipFingerprint;
  }

  return axios.create({
    baseURL: `https://${TELEGRAM_HOST}/bot${token}`,
    httpsAgent: _agent,
    timeout: 30_000,
  });
}

/** Export for tests — the same factory used by telegramAxios in production. */
export function buildTelegramAgent(ips: string[]): https.Agent {
  const agent = new https.Agent({ keepAlive: true });
  // Assign after construction — passing createConnection as an option
  // does NOT work (Node uses the built-in, not the option).
  (agent as any).createConnection = createConnectionFactory(ips);
  return agent;
}

/**
 * Сколько ждать установки соединения, прежде чем считать адрес мёртвым.
 *
 * Замерено с прод-хоста: живой адрес Telegram отдаёт `secureConnect` за 194 мс,
 * а адрес-чёрная дыра молчит 45 секунд подряд, не выдав НИ ОДНОГО события —
 * ни `error`, ни `secureConnect`. Именно так вёл себя `149.154.166.110` в
 * инциденте 11.08: не отказ, а тишина.
 *
 * Пять секунд — с запасом к 194 мс и заведомо меньше, чем таймаут axios на
 * ответ (30 с), иначе перебор не успел бы начаться.
 */
const CONNECT_TIMEOUT_MS = 5_000;

export function createConnectionFactory(ips: string[]) {
  const targets = ips.length > 0 ? ips : [TELEGRAM_HOST];
  return (options: any, cb: any) => {
    let idx = 0;
    tryConnect();

    function tryConnect(): void {
      if (idx >= targets.length) {
        cb(new Error(`Telegram: all ${targets.length} IPs unreachable`));
        return;
      }
      let settled = false;
      const tlsOpts = {
        ...options,
        host: targets[idx],
        servername: TELEGRAM_HOST,
      };
      const sock = tls.connect(tlsOpts, () => {
        settled = true;
        // Снимаем ОБА наших обработчика: после рукопожатия запрос уже мог уйти,
        // и любой поздний обрыв обязан достаться вызывающему, а не увести нас
        // на следующий адрес — это был бы дубль поста.
        sock.removeListener('error', onError);
        sock.removeListener('timeout', onTimeout);
        sock.setTimeout(0);
        cb(null, sock);
      });
      function onError() {
        if (settled) return;
        idx++;
        sock.destroy();
        tryConnect();
      }
      // Молчащий адрес не даёт события `error` порядка двух минут — дольше, чем
      // живёт сам запрос. Без этого перебор на таком отказе не начинается вовсе.
      function onTimeout() {
        if (settled) return;
        idx++;
        sock.destroy();
        tryConnect();
      }
      sock.once('error', onError);
      sock.setTimeout(CONNECT_TIMEOUT_MS, onTimeout);
    }
  };
}

/** Clear the DNS cache (for testing / manual recovery). */
export function clearTelegramIpsCache(): void {
  cachedIps = null;
  cachedAt = 0;
  _agentBuiltFor = null;
}

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
 */
import * as dns from 'dns/promises';
import * as tls from 'tls';
import * as https from 'https';
import axios, { AxiosInstance } from 'axios';

const TELEGRAM_HOST = 'api.telegram.org';

let cachedIps: string[] | null = null;
let cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

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

  const agent = new https.Agent({
    keepAlive: true,
    createConnection: (options: any, cb: any) => {
      let idx = 0;
      const targets = ips.length > 0 ? ips : [TELEGRAM_HOST];
      tryConnect();

      function tryConnect(): void {
        if (idx >= targets.length) {
          cb(new Error(`Telegram: all ${targets.length} IPs unreachable`));
          return;
        }
        const tlsOpts = {
          ...options,
          host: targets[idx],
          servername: TELEGRAM_HOST, // SNI must be the hostname
        };
        const sock = tls.connect(tlsOpts, () => {
          // TLS handshake OK — after this, NO more IP rotation
          // (any HTTP response means the post may be live)
          cb(null, sock);
        });
        sock.once('error', () => {
          idx++;
          sock.destroy();
          tryConnect();
        });
      }
    },
  });

  return axios.create({
    baseURL: `https://${TELEGRAM_HOST}/bot${token}`,
    httpsAgent: agent,
    timeout: 30_000,
  });
}

/** Clear the DNS cache (for testing / manual recovery). */
export function clearTelegramIpsCache(): void {
  cachedIps = null;
  cachedAt = 0;
}

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
 *   - HTTP safety (listener removal after handshake): :69-71
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

  // Reuse agent unless IP list changed
  if (!_agent || _agentBuiltFor !== ipFingerprint) {
    _agent = new https.Agent({ keepAlive: true });
    // Assign after construction — passing createConnection as an option
    // does NOT work (Node uses the built-in, not the option).
    (_agent as any).createConnection = (options: any, cb: any) => {
        let idx = 0;
        const targets = ips.length > 0 ? ips : [TELEGRAM_HOST];
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
            // TLS handshake OK. After this, NO more IP rotation — any HTTP
            // response means the post may already be live on Telegram's side.
            // Remove error listener so a late ECONNRESET does NOT trigger IP2.
            settled = true;
            sock.removeListener('error', onError);
            cb(null, sock);
          });
          function onError() {
            if (settled) return;
            idx++;
            sock.destroy();
            tryConnect();
          }
          sock.once('error', onError);
        }
      };
    _agentBuiltFor = ipFingerprint;
  }

  return axios.create({
    baseURL: `https://${TELEGRAM_HOST}/bot${token}`,
    httpsAgent: _agent,
    timeout: 30_000,
  });
}

/** Clear the DNS cache (for testing / manual recovery). */
export function clearTelegramIpsCache(): void {
  cachedIps = null;
  cachedAt = 0;
  _agentBuiltFor = null;
}

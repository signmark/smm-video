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
 * Phase 1 (task #31): env-based fallback IPs + dedupe + cap 5 attempts total.
 *   - TELEGRAM_API_IPS: comma-separated IPs as fallback when DNS fails/empty.
 *   - DNS resolved IPs come first, fallback fills remaining slots.
 *   - dedupe: same IP from DNS and fallback = one attempt, not two.
 *   - Total attempts capped at MAX_CONNECT_ATTEMPTS (5): 5×5s = 25s < 30s axios timeout.
 *   - Outcome-based warns in connection factory, rate-limited ~1h per event+IP.
 *
 * Rule-59 file:line references:
 *   - DNS cache: :34-36 (cachedIps/cachedAt)
 *   - Fallback env: :68-78 (getFallbackIps + TELEGRAM_API_IPS)
 *   - DNS empty-array handling: :60 (cachedIps = [])
 *   - Merged+deduped targets: :81-103 (getTargets)
 *   - Warn throttle: :44-57 (_warnThrottle + shouldWarn)
 *   - TCP/TLS failover: :137-175 (tryConnect with IP rotation)
 *   - Outcome warns (fallback saved/failed): :149-152, :161-165
 *   - HTTP safety (listener removal after handshake): see tls.connect callback
 *   - Silent-address timeout (incident 11.08): CONNECT_TIMEOUT_MS + onTimeout
 *   - SNI servername: :146
 *   - Shared agent: :39-41, :75, :128
 */
import * as dns from 'dns/promises';
import * as tls from 'tls';
import * as https from 'https';
import axios, { AxiosInstance } from 'axios';
import { log } from '../../utils/logger';

const TELEGRAM_HOST = 'api.telegram.org';

let cachedIps: string[] | null = null;
let cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

// Shared keepAlive agent — one per process (AI-101 review fix)
let _agent: https.Agent | null = null;
let _agentBuiltFor: string | null = null;

/**
 * Максимум попыток соединения (DNS + fallback, после дедупликации).
 * 5 попыток × 5 секунд CONNECT_TIMEOUT_MS = 25 с — гарантированно меньше
 * таймаута axios (30 с), чтобы перебор успел завершиться до ответа.
 */
const MAX_CONNECT_ATTEMPTS = 5;

/**
 * Throttle для warn-сообщений фабрики: не чаще одного в час на один и тот же
 * event+IP ключ. Следующий вызов с тем же ключом подавляется, другой IP проходит.
 * Формула по образцу shouldLogTerminalError из publish-scheduler.ts (AI-102).
 */
const _warnThrottle = new Map<string, number>();
const WARN_THROTTLE_MS = 60 * 60 * 1000; // 1 час

export function shouldWarn(key: string): boolean {
  const now = Date.now();
  const last = _warnThrottle.get(key);
  if (last !== undefined && now - last < WARN_THROTTLE_MS) return false;
  // Evict expired entries if map grows too large
  if (_warnThrottle.size > 500) {
    for (const [k, ts] of _warnThrottle) {
      if (now - ts >= WARN_THROTTLE_MS) _warnThrottle.delete(k);
    }
  }
  _warnThrottle.set(key, now);
  return true;
}

async function getDnsIps(): Promise<string[]> {
  if (cachedIps && Date.now() - cachedAt < CACHE_TTL) return cachedIps;
  try {
    const resolved = await dns.resolve4(TELEGRAM_HOST);
    // resolve4 может вернуть пустой массив без исключения при кривом резолвере
    cachedIps = resolved.length > 0 ? resolved : [];
    cachedAt = Date.now();
  } catch {
    // Исключение (ENOTFOUND, EAI_AGAIN и т.д.) — тоже пусто
    cachedIps = [];
  }
  return cachedIps;
}

/**
 * IPs из переменной окружения TELEGRAM_API_IPS (comma-separated).
 * Пустая строка или отсутствие = нет fallback.
 * Пример: `149.154.167.220,149.154.166.110`
 */
export function getFallbackIps(): string[] {
  const raw = (process.env.TELEGRAM_API_IPS || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s));
}

/**
 * Объединённый список целей: DNS первым, fallback заполняет остаток,
 * дедупликация (сохраняем первое вхождение = DNS-порядок), обрезка
 * хвоста до MAX_CONNECT_ATTEMPTS.
 *
 * Warn-сигналы перенесены в фабрику (outcome-based): «спас» = соединение
 * установлено через fallback после отказа DNS; «протух» = fallback адрес
 * не ответил при реальной попытке. Составление списка не генерирует warns.
 */
export async function getTargets(): Promise<string[]> {
  const dnsIps = await getDnsIps();
  const fallbackIps = getFallbackIps();

  // Дедупликация: DNS имеет приоритет (первое вхождение сохраняется)
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const ip of dnsIps) {
    if (!seen.has(ip)) {
      seen.add(ip);
      merged.push(ip);
    }
  }
  for (const ip of fallbackIps) {
    if (!seen.has(ip)) {
      seen.add(ip);
      merged.push(ip);
    }
  }

  // Cap: обрезаем ХВОСТ (fallback-конец), а не голову (DNS-начало)
  const capped = merged.slice(0, MAX_CONNECT_ATTEMPTS);

  // Если вообще ничего нет — hostname как последний resort
  if (capped.length === 0) {
    capped.push(TELEGRAM_HOST);
  }

  return capped;
}

/** Create an axios instance with Telegram DNS failover on the given token. */
export async function telegramAxios(token: string): Promise<AxiosInstance> {
  const targets = await getTargets();
  const fingerprint = targets.join(',');

  if (!_agent || _agentBuiltFor !== fingerprint) {
    _agent = buildTelegramAgent(targets, getFallbackIps());
    _agentBuiltFor = fingerprint;
  }

  return axios.create({
    baseURL: `https://${TELEGRAM_HOST}/bot${token}`,
    httpsAgent: _agent,
    timeout: 30_000,
  });
}

/** Export for tests — the same factory used by telegramAxios in production. */
export function buildTelegramAgent(ips: string[], fallbackIps: string[] = []): https.Agent {
  const agent = new https.Agent({ keepAlive: true });
  // Assign after construction — passing createConnection as an option
  // does NOT work (Node uses the built-in, not the option).
  (agent as any).createConnection = createConnectionFactory(ips, fallbackIps);
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

export function createConnectionFactory(ips: string[], fallbackIps: string[] = []) {
  const targets = ips.length > 0 ? ips : [TELEGRAM_HOST];
  return (options: any, cb: any) => {
    let idx = 0;
    tryConnect();

    function tryConnect(): void {
      if (idx >= targets.length) {
        // Warn: all fallback addresses tried and all failed (outcome-based)
        for (const fb of fallbackIps) {
          if (shouldWarn('fallback_failed:' + fb)) {
            log(`[telegram-transport] fallback протух: ${fb} не ответил при реальной попытке`, 'telegram-transport', 'warn');
          }
        }
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
        // Warn: fallback IP saved the connection after DNS targets failed
        // Only fires when idx > 0 (at least one DNS target failed) AND
        // the successful IP is from fallback (not DNS) — throttled per IP
        if (idx > 0 && fallbackIps.includes(targets[idx]) && shouldWarn('fallback_saved:' + targets[idx])) {
          log(`[telegram-transport] fallback спас: ${targets[idx]} ответил после отказа предыдущих ${idx} адресов`, 'telegram-transport', 'warn');
        }
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

/** Clear the DNS cache and warn throttle (for testing / manual recovery). */
export function clearTelegramIpsCache(): void {
  cachedIps = null;
  cachedAt = 0;
  _agentBuiltFor = null;
  _warnThrottle.clear();
}

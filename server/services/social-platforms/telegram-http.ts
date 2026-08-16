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
 *   - Потолок попыток: :53 (MAX_CONNECT_ATTEMPTS = 5), 5×5 с = 25 с < 30 с таймаута axios.
 *   - Outcome-based warns in connection factory, rate-limited ~1h per event+IP.
 *
 * Rule-59 file:line references:
 *   - Кэш DNS: :40-42 (cachedIps/cachedAt)
 *   - Запас из окружения: :117 (getFallbackIps + TELEGRAM_API_IPS), проверка октетов :105 (isIpv4)
 *   - Пустой ответ DNS: :86 (cachedIps = [])
 *   - Слияние и дедупликация целей: :155 (getTargets)
 *   - Throttle сообщений: :60-67 (_warnThrottle + shouldWarn)
 *   - Перебор адресов: :232 (createConnectionFactory / tryConnect)
 *   - Сигналы по факту: «запас спас» :256, «запас протух» :270 (reportStale)
 *   - HTTP safety (listener removal after handshake): see tls.connect callback
 *   - Silent-address timeout (incident 11.08): CONNECT_TIMEOUT_MS + onTimeout
 *   - SNI servername: :248
 *   - Общий agent: getTelegramAgent (один фасад на процесс, AI-112)
 */
import * as dns from 'dns/promises';
import * as tls from 'tls';
import * as https from 'https';
import axios, { AxiosInstance } from 'axios';
import { log } from '../../utils/logger';

/**
 * Операционализация failover-сигнала: кроме warn-лога, шлём событие в
 * notification-bus (WebSocket → UI), чтобы сигнал дошёл до оператора в реальном
 * времени, а не тонул в stdout. Ленивый import — модуль грузится рано, циклическая
 * зависимость исключена (как в publish-scheduler).
 */
function broadcastFailoverSignal(kind: 'not_configured' | 'all_invalid' | 'saved' | 'stale', detail: string): void {
  import('../../services/notification-bus').then(({ broadcastNotification }) => {
    broadcastNotification('telegram_failover', { kind, detail, timestamp: new Date().toISOString() });
  }).catch(() => {
    // notification-bus недоступен (например, вне полного приложения) —
    // warn-лог ниже всё равно записан; это не должно ронять соединение.
  });
}

const TELEGRAM_HOST = 'api.telegram.org';

let cachedIps: string[] | null = null;
let cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000;


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

/**
 * Не чистая проверка: успешный ответ СРАЗУ занимает слот на час. Звать её
 * только тогда, когда собираешься писать сообщение, и никогда — ради проверки.
 */
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
/**
 * Октеты проверяются по диапазону, а не только по форме: шаблон из трёх цифр
 * пропускает 999.1.1.1. Такой адрес не ответит никогда, но съест одну из пяти
 * попыток и пять секунд таймаута — ровно тогда, когда запас и нужен.
 */
function isIpv4(s: string): boolean {
  const parts = s.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/**
 * Пустой запас — это не «всё хорошо», это «правка уехала без своей переменной».
 * Различить их по логам иначе невозможно: молчание выглядит одинаково и когда
 * запас не понадобился, и когда его нет. Сообщаем один раз в час, чтобы это
 * попадалось на глаза дежурному, но не заливало журнал.
 */
export function getFallbackIps(): string[] {
  const raw = (process.env.TELEGRAM_API_IPS || '').trim();
  if (!raw) {
    if (shouldWarn('fallback_not_configured')) {
      log(
        '[telegram-transport] TELEGRAM_API_IPS не задана: запасных адресов нет, ' +
          'перебор ограничен тем, что отдаёт DNS',
        'telegram-transport',
        'warn',
      );
      broadcastFailoverSignal('not_configured', 'TELEGRAM_API_IPS не задана');
    }
    return [];
  }
  const parsed = raw
    .split(',')
    .map((s) => s.trim())
    .filter(isIpv4);
  // Переменная задана, но ни одного годного адреса — опечатка в деплое.
  // Молча вернуть пусто значило бы спрятать её ровно до следующего инцидента.
  if (parsed.length === 0 && shouldWarn('fallback_all_invalid')) {
    log(
      `[telegram-transport] TELEGRAM_API_IPS задана, но ни один адрес не разобран: ${raw}`,
      'telegram-transport',
      'warn',
    );
    broadcastFailoverSignal('all_invalid', raw);
  }
  return parsed;
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

/**
 * Create an axios instance with Telegram DNS failover on the given token.
 *
 * Агент — общий фасад `getTelegramAgent()`. Раньше здесь жил свой агент,
 * пересобираемый по отпечатку состава DNS: объект хранил список адресов, и при
 * смене ответа DNS его надо было строить заново. Фасад разрешает адреса не при
 * постройке, а в момент КАЖДОГО нового соединения, поэтому ни отпечатка, ни
 * пересборки, ни хранимого состояния ему не нужно — при том же поведении (AI-112).
 */
export async function telegramAxios(token: string): Promise<AxiosInstance> {
  return axios.create({
    baseURL: `https://${TELEGRAM_HOST}/bot${token}`,
    httpsAgent: getTelegramAgent(),
    timeout: 30_000,
  });
}

/**
 * Тот же агент, но без baseURL и без своего таймаута — для мест, где URL уже
 * собран и переписывать его незачем. Отсутствие таймаута здесь намеренно: у
 * загрузки медиа он свой, больше общего, и подставить общий значило бы тихо
 * оборвать длинную загрузку, которая раньше доходила.
 */
export async function telegramHttp(): Promise<AxiosInstance> {
  return axios.create({ httpsAgent: getTelegramAgent() });
}

/**
 * Канонический порт Telegram API. Фасад не соединяется никуда, кроме
 * `api.telegram.org:443` — см. проверку в `getTelegramAgent`.
 */
const TELEGRAM_PORT = 443;

let _facadeAgent: https.Agent | null = null;

/**
 * Единственный агент соединений с Telegram: один объект на процесс, адреса
 * разрешаются в момент соединения. Через него ходят и библиотека бота, и все
 * прямые вызовы (`telegramAxios`, `telegramHttp`).
 *
 * Требование пришло от Telegraf: он читает `options.agent` на КАЖДЫЙ вызов
 * (`node_modules/telegraf/lib/core/network/client.js:300`), но сам объект
 * получает один раз — при `new Telegraf`. Агент, который помнит список адресов,
 * застыл бы здесь на весь процесс — ровно та беда, ради которой транспорт и
 * делался. Отсюда и устройство: ничего не помнить.
 *
 * Оказалось, что так лучше и прямым вызовам. Раньше у них был свой агент,
 * пересобираемый по отпечатку состава DNS; отпечаток приходилось расширять,
 * потому что одни и те же адреса из разных источников он не различал. Агенту,
 * который резолвит цели на каждое соединение, различать нечего — состояния нет
 * (AI-112).
 *
 * Поэтому цели резолвятся не при постройке, а внутри `createConnection`, на
 * каждое НОВОЕ соединение; callback-форма это позволяет. Уже открытые сокеты
 * keepAlive остаются на своих адресах: ротация касается новых соединений,
 * рвать живые незачем.
 *
 * `attachmentAgent` этим агентом НЕ задаётся. Telegraf качает им произвольные
 * URL медиа (`client.js:197`) — наш S3, ссылки пользователей; перебор адресов
 * Telegram увёл бы эти запросы не туда.
 */
export function getTelegramAgent(): https.Agent {
  if (_facadeAgent) return _facadeAgent;

  const agent = new https.Agent({ keepAlive: true });

  (agent as any).createConnection = (options: any, cb: (err: Error | null, sock?: any) => void) => {
    let settled = false;
    const settle = (err: Error | null, sock?: any) => {
      // Колбэк обязан сработать ровно один раз: и перебор, и проверка хоста,
      // и падение резолва ведут сюда.
      if (settled) return;
      settled = true;
      cb(err, sock);
    };

    // Fail-close. Через custom apiRoot (локальный Bot API, прокси) сюда легко
    // приходит чужой хост — и запрос уехал бы на IP Telegram с чужим SNI.
    // Отказ громче молчаливого соединения не туда.
    const host = options?.servername || options?.host;
    const port = Number(options?.port ?? TELEGRAM_PORT);
    if (host !== TELEGRAM_HOST || port !== TELEGRAM_PORT) {
      settle(new Error(`[telegram-transport] агент Telegram вызван для ${host}:${port} — соединение отклонено`));
      return;
    }

    // Ошибка резолва уходит в колбэк, а не в воздух: промис, упавший мимо cb,
    // оставил бы запрос висеть и всплыл бы unhandledRejection.
    Promise.all([getTargets(), getDnsIps()]).then(
      ([targets, dnsIps]) => {
        try {
          createConnectionFactory(targets, dnsIps)(options, settle);
        } catch (err: any) {
          settle(err instanceof Error ? err : new Error(String(err)));
        }
      },
      (err: any) => settle(err instanceof Error ? err : new Error(String(err))),
    );
  };

  _facadeAgent = agent;
  return agent;
}

/** Только для тестов: сбросить фасад между прогонами. */
export function _resetTelegramAgentForTests(): void {
  _facadeAgent = null;
}

/**
 * Агент с ЗАФИКСИРОВАННЫМ списком целей.
 *
 * В проде не используется: там один `getTelegramAgent()`, который резолвит цели
 * сам (AI-112). Здесь список задаётся снаружи — это нужно проверкам перебора,
 * которым требуется предсказуемый набор адресов без подмены DNS.
 * Новый код должен брать `getTelegramAgent()`.
 */
export function buildTelegramAgent(ips: string[], dnsIps: string[] = ips): https.Agent {
  const agent = new https.Agent({ keepAlive: true });
  // Assign after construction — passing createConnection as an option
  // does NOT work (Node uses the built-in, not the option).
  (agent as any).createConnection = createConnectionFactory(ips, dnsIps);
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

/**
 * Вторым аргументом идёт список адресов ИЗ DNS, а не из запаса. Это не придирка:
 * оба сигнала определены через «адрес НЕ из DNS», и если считать по вхождению в запас,
 * то адрес, попавший и туда, и туда, даст ложный сигнал. DNS догнал запас — это
 * хорошая новость, о ней молчим.
 */
export function createConnectionFactory(ips: string[], dnsIps: string[] = ips) {
  const targets = ips.length > 0 ? ips : [TELEGRAM_HOST];
  const fromDns = new Set(dnsIps);
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
        // «Запас спас» — соединение УСТАНОВЛЕНО через адрес не из DNS.
        // Проверка именно такая, а не «idx > 0»: когда DNS лёг совсем, запасной
        // адрес стоит первым и idx равен нулю — а это ровно тот случай, ради
        // которого всё затевалось.
        const okTarget = targets[idx];
        if (okTarget === TELEGRAM_HOST) {
          // Соединение по имени хоста — не спасение запасом, а деградация: ни DNS,
          // ни TELEGRAM_API_IPS не дали ни одного адреса, и разрешение имени ушло
          // системному резолверу. Перебора здесь нет вовсе — цель одна. Назвать это
          // «запас спас» значит соврать в том самом логе, по которому ищут причину.
          if (shouldWarn('no_targets_hostname')) {
            log(`[telegram-transport] ни DNS, ни TELEGRAM_API_IPS не дали адресов — соединяюсь по имени ${TELEGRAM_HOST}, перебора не будет`, 'telegram-transport', 'warn');
            broadcastFailoverSignal('not_configured', `ни DNS, ни TELEGRAM_API_IPS — соединяюсь по имени ${TELEGRAM_HOST}`);
          }
        } else if (!fromDns.has(okTarget) && shouldWarn('fallback_saved:' + okTarget)) {
          log(`[telegram-transport] запас спас: ${okTarget} ответил, когда адреса из DNS не ответили`, 'telegram-transport', 'warn');
          broadcastFailoverSignal('saved', okTarget);
        }
        // Снимаем ОБА наших обработчика: после рукопожатия запрос уже мог уйти,
        // и любой поздний обрыв обязан достаться вызывающему, а не увести нас
        // на следующий адрес — это был бы дубль поста.
        sock.removeListener('error', onError);
        sock.removeListener('timeout', onTimeout);
        sock.setTimeout(0);
        cb(null, sock);
      });
      // «Запас протух» — адрес не из DNS ПРОБОВАЛИ и он не ответил. Считается на
      // каждом отказе отдельно, а не списком в конце перебора: адрес, отрезанный
      // ограничением попыток, никто не пробовал, и объявлять его протухшим — ложь.
      function reportStale(): void {
        const target = targets[idx];
        if (!fromDns.has(target) && target !== TELEGRAM_HOST && shouldWarn('fallback_stale:' + target)) {
          log(`[telegram-transport] запас протух: ${target} не ответил на реальной попытке соединения`, 'telegram-transport', 'warn');
          broadcastFailoverSignal('stale', target);
        }
      }
      function onError() {
        if (settled) return;
        reportStale();
        idx++;
        sock.destroy();
        tryConnect();
      }
      // Молчащий адрес не даёт события `error` порядка двух минут — дольше, чем
      // живёт сам запрос. Без этого перебор на таком отказе не начинается вовсе.
      function onTimeout() {
        if (settled) return;
        reportStale();
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
  _warnThrottle.clear();
}

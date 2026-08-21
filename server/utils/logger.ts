/**
 * Логгер приложения.
 *
 * Контракт уровней (docs/LOGGING-PLAN.md):
 *   fatal — процесс не может продолжать работу;
 *   error — сломан пользовательский сценарий или упала фоновая задача;
 *   warn  — деградация с фолбэком (ретрай выручил, токен протух, платформа 429);
 *   info  — жизненный цикл и итоги (старт сервиса, результат цикла крона);
 *   debug — трассировки, промпты, тела запросов.
 *
 * error/warn/info печатаются всегда, включая production. debug — только при
 * LOG_LEVEL=debug. Порог берётся из getEnvConfig().logLevel, который читает LOG_LEVEL.
 *
 * Почему так: раньше в production выкидывались все info и debug, а error —
 * всё, кроме совпадений с коротким списком русских фраз. Вдобавок существовал
 * список подавления по подстроке, в котором первыми строками стояли
 * «Request failed with status code 401/403/400», ECONNREFUSED и лимиты соцсетей.
 * То есть приложение по построению не могло сообщить ни об отказе Directus, ни
 * об обрыве сети: сотни 403 были видны только в логах самого Directus.
 * Глушение по тексту сообщения удалено целиком — уровень назначает автор строки.
 *
 * В production строка лога — один JSON-объект (её разбирает сборщик логов),
 * в development — человекочитаемый текст.
 */

import { detectEnvironment } from './environment-detector';
import { currentRequestId } from './request-context';

// AI-82: getEnvConfig() вызывает detectEnvironment() лениво при первом
// обращении, а не на уровне модуля. Модули, импортирующие log, больше
// не платят за вызов detectEnvironment при import.
//
// Исключение: сам detectEnvironment() НЕ может использовать log() —
// это bootstrap-вывод (см. комментарий в environment-detector.ts).
let _envConfig: ReturnType<typeof detectEnvironment> | null = null;

export function getEnvConfig(): ReturnType<typeof detectEnvironment> {
  if (!_envConfig) {
    _envConfig = detectEnvironment();
  }
  return _envConfig;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && value in LEVEL_ORDER;
}

/**
 * Порог вывода. Всё ниже порога отбрасывается, всё остальное печатается —
 * без исключений по тексту сообщения.
 */
function threshold(): number {
  const configured = getEnvConfig()?.logLevel;
  return LEVEL_ORDER[isLogLevel(configured) ? configured : 'info'];
}

// --- In-memory кольцевой буфер последних логов (для эндпоинта /api/debug/logs) ---
// Заполняется самим логгером — глобальный console НЕ патчим.
const LOG_BUFFER_SIZE = 100;
const recentLogs: string[] = [];

function recordLog(line: string): void {
  recentLogs.push(line);
  if (recentLogs.length > LOG_BUFFER_SIZE) recentLogs.shift();
}

/**
 * Возвращает последние записи лога (по умолчанию весь буфер, максимум LOG_BUFFER_SIZE).
 */
export function getRecentLogs(limit = LOG_BUFFER_SIZE): string[] {
  if (limit >= recentLogs.length) return [...recentLogs];
  return recentLogs.slice(-limit);
}

/**
 * Режим подробной отладки отдельных подсистем. Влияет только на то, что сам
 * вызывающий код решает логировать; порогом уровней управляет LOG_LEVEL.
 *
 * Вычисляется лениво при первом обращении через getEnvConfig().
 */
export const DEBUG_LEVELS: Record<string, boolean> = new Proxy({} as any, {
  get(_target, prop: string) {
    const cfg = getEnvConfig();
    switch (prop) {
      case 'GLOBAL': return cfg.environment === 'development' && cfg.verboseLogs;
      case 'SCHEDULER': return cfg.environment === 'development' ? cfg.debugScheduler : false;
      case 'PUBLISHING': case 'SOCIAL': case 'STATUS_CHECKER':
        return cfg.environment === 'development';
      default: return false;
    }
  },
  set(_target, prop) {
    throw new Error(`DEBUG_LEVELS.${String(prop)} управляется env-переменными, не присваиванием`);
  },
  ownKeys() {
    return ['GLOBAL', 'SCHEDULER', 'PUBLISHING', 'SOCIAL', 'STATUS_CHECKER'];
  },
  getOwnPropertyDescriptor() {
    return { enumerable: true, configurable: true };
  },
});

// --- Редакция секретов ---------------------------------------------------
// Режем по имени поля и на любой глубине: расставлять '[REDACTED]' руками по
// коду ненадёжно — рано или поздно один вызов забудут.
const SECRET_KEY = /(pass(word)?|secret|token|api[-_]?key|apikey|authorization|cookie|credential|client[-_]?secret|session)/i;
const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

/**
 * Те же имена, но для поиска внутри текста. Отдельная строка, а не SECRET_KEY.source:
 * здесь нужны невыхватывающие группы, иначе номера групп в шаблонах ниже разъедутся.
 */
const SECRET_WORD =
  '(?:pass(?:word)?|secret|token|api[-_]?key|apikey|authorization|cookie|credential|client[-_]?secret|session)';

/** `"access_token":"..."` — секрет внутри сериализованного JSON. */
const JSON_PAIR = new RegExp(`("[^"]*${SECRET_WORD}[^"]*"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`, 'gi');

/** `access_token=...`, `api-key: ...` — query-строки, формы, произвольный текст. */
const KV_PAIR = new RegExp(
  `([A-Za-z0-9_.\\-]*${SECRET_WORD}[A-Za-z0-9_.\\-]*)(\\s*[=:]\\s*)([^\\s&,;"'}\\]]+)`,
  'gi',
);

/** `Bearer <токен>`, `Basic <креды>` — схема остаётся, значение уходит. */
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/**
 * Секрет в query-параметре с «несекретным» именем: `?key=`, `?sig=`, `?auth=`.
 *
 * KV_PAIR сюда не достаёт — он требует, чтобы имя параметра содержало слово из
 * SECRET_WORD, а у Gemini ключ передаётся параметром `key`. Из-за этого сетевая
 * ошибка node-fetch с полным URL уносила GEMINI_API_KEY в логи целиком
 * (находка ревью 2026-07-28). Ограничиваемся именно query-контекстом: `key=` в
 * обычном тексте встречается слишком часто, чтобы резать его везде.
 */
const QUERY_SECRET = /([?&](?:key|sig|signature|auth|code)=)[^&#\s"'<>]+/gi;

/**
 * Секрет ПОСЛЕДНИМ СЕГМЕНТОМ ПУТИ — колбэки трендов вида
 * `/api/trends/tg-webhook/<32 hex>` (`trendsCallbackToken`, HMAC от
 * `TRENDS_WEBHOOK_SECRET`).
 *
 * Ни одно правило выше сюда не достаёт: у сегмента нет ни имени параметра, ни
 * `=`, ни кавычек — для них это просто часть URL. А сам callback_url логируется
 * при каждой отправке задания скрейперу, и токен переживает ротацию логов
 * (находка ревью 2026-07-30). Токен детерминирован: одного лога достаточно,
 * чтобы дёргать колбэк вечно.
 *
 * Режем непрозрачный hex от 16 символов — короче не бывает ни один наш токен,
 * а обычные сегменты пути такой длины из одних hex-символов не состоят.
 */
const PATH_SECRET = /(\/(?:api\/)?[A-Za-z0-9._-]*(?:webhook|callback)[A-Za-z0-9._-]*\/)[a-f0-9]{16,}/gi;

/**
 * Адрес почты в тексте лога (AI-41).
 *
 * Это персональные данные, а не секрет, и правила выше его не ловят: у адреса
 * нет ни имени параметра, ни кавычек — для них это обычное слово. Замер боевых
 * логов 17.08.2026 показал 40 строк с адресами за сутки, все из сообщений об
 * успешном входе и о признании администратором.
 *
 * Режем ЛОКАЛЬНУЮ часть, домен оставляем: по домену дежурный отличает своего
 * пользователя от служебного отправителя писем, а личность по нему не
 * восстанавливается. Первый символ оставлен намеренно — по нему разработчик
 * подтверждает, что речь об ожидаемом адресе, не зная самого адреса.
 *
 * Это сеть последней надежды, а не основная мера. Основная — не передавать
 * адрес в лог вовсе: в сообщение идёт идентификатор пользователя. Но пишущих
 * мест десятки, и полагаться только на дисциплину нельзя.
 */
const EMAIL_ADDRESS = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

/**
 * Вырезает секреты из готовой строки.
 *
 * До этого редакция применялась только к структурированной ошибке, а `msg`
 * сериализовался как есть — и `access_token=FAKE_SECRET` уезжал в production JSON
 * целиком. Режем значение, но оставляем имя поля и остальной текст: лог, где всё
 * превратилось в `[REDACTED]`, бесполезен ровно так же, как лог с секретами опасен.
 */
export function redactText(text: string): string {
  if (!text) return text;
  return text
    // Схему обязательно раньше KV_PAIR: в «Authorization: Bearer <токен>» значением
    // для KV_PAIR выглядит слово «Bearer» (оно кончается пробелом), и порядок
    // наоборот вырезал бы именно его, оставив сам токен снаружи.
    .replace(AUTH_SCHEME, (_m, scheme) => `${scheme} ${REDACTED}`)
    .replace(QUERY_SECRET, (_m, head) => `${head}${REDACTED}`)
    .replace(PATH_SECRET, (_m, head) => `${head}${REDACTED}`)
    .replace(JSON_PAIR, (_m, head) => `${head}"${REDACTED}"`)
    .replace(KV_PAIR, (match, key, sep, value) => {
      const v = String(value);
      // Уже вырезанное и схему авторизации второй раз не трогаем.
      if (v.startsWith('[REDACT') || /^(Bearer|Basic)$/i.test(v)) return match;
      return `${key}${sep}${REDACTED}`;
    })
    // Почта — ПОСЛЕДНЕЙ: если адрес стоял значением секретного поля, он уже
    // вырезан целиком правилами выше, и трогать там нечего.
    .replace(EMAIL_ADDRESS, (_m, first, domain) => `${first}***@${domain}`);
}

function redact(value: any, depth = 0, seen = new WeakSet<object>()): any {
  // Секрет может лежать не только в поле с говорящим именем, но и внутри строки —
  // например, в теле ответа или в тексте ошибки.
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[depth-limit]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.slice(0, 50).map(v => redact(v, depth + 1, seen));

  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? REDACTED : redact(val, depth + 1, seen);
  }
  return out;
}

/**
 * Разворачивает ошибку в поля, по которым можно что-то понять: статус ответа и
 * тело важнее текста «Request failed with status code 403».
 */
function serializeError(err: any): any {
  if (err === undefined || err === null || err === '') return undefined;
  if (typeof err !== 'object') return String(err);

  const out: Record<string, any> = {};
  // Текст ошибки и стек тоже проходят редакцию: axios кладёт в message полный URL
  // запроса вместе с `?access_token=...`.
  if (err.message) out.message = redactText(String(err.message));
  if (err.name && err.name !== 'Error') out.name = err.name;
  if (err.code) out.code = err.code;
  if (err.response) {
    out.status = err.response.status;
    if (err.response.data !== undefined) out.body = redact(err.response.data);
  }
  if (err.stack) out.stack = redactText(String(err.stack).split('\n').slice(0, 12).join('\n'));
  return Object.keys(out).length ? out : redact(err);
}

function safeStringify(payload: Record<string, any>): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({ ts: payload.ts, level: payload.level, source: payload.source, msg: String(payload.msg) });
  }
}

// --- Ядро ----------------------------------------------------------------

function emit(
  level: LogLevel,
  message: string,
  source: string,
  err?: any,
  extra?: Record<string, string | number | boolean>,
): void {
  if (LEVEL_ORDER[level] < threshold()) return;

  // Редакция до сборки строки — иначе секрет попадёт и в вывод, и в кольцевой
  // буфер recentLogs, который отдаёт /api/debug/logs.
  const text = redactText(typeof message === 'string' ? message : String(message));
  const details = serializeError(err);
  let line: string;

  if (getEnvConfig().environment === 'production') {
    // reqId проставляется здесь, а не в местах вызова: так корреляцию
    // получают ВСЕ существующие строки лога без правки сотен вызовов.
    // Вне запроса (фоновые задачи, старт процесса) поля просто нет.
    const reqId = currentRequestId();
    line = safeStringify({
      ts: new Date().toISOString(),
      level,
      source,
      ...(reqId !== undefined ? { reqId } : {}),
      ...(extra ?? {}),
      msg: text,
      ...(details !== undefined ? { err: details } : {}),
    });
  } else {
    const time = new Date().toLocaleTimeString();
    const reqId = currentRequestId();
    const tail = extra && Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
    line = `${time} [DEV] [${source}]${reqId ? ` [${reqId}]` : ''} ${text}${tail}`;
  }

  recordLog(line);

  if (level === 'error' || level === 'fatal') {
    // В development детали ошибки отдаём вторым аргументом — так их видно
    // раскрытыми в консоли; в production они уже внутри JSON-строки.
    if (getEnvConfig().environment === 'production' || details === undefined) console.error(line);
    else console.error(line, err);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/**
 * AI-65: события со стабильными машинными именами.
 *
 * ЗАЧЕМ ИМЕНА. По тексту сообщения нельзя ни искать, ни строить оповещения:
 * текст меняют при первой же правке формулировки, и все сохранённые запросы
 * молча перестают находить. `event` — это ключ, который менять нельзя.
 *
 * ЗАЧЕМ СПИСОК РАЗРЕШЁННЫХ ПОЛЕЙ. Лог уходит в stdout и хранится дольше, чем
 * живёт инцидент. Запрет «не кладите тело запроса» на словах не работает: рано
 * или поздно кто-то положит объект целиком, потому что «так удобнее отлаживать».
 * Поэтому разрешено перечисленное ниже, а всё остальное молча отбрасывается —
 * отбрасывать безопаснее, чем падать в момент разбора аварии.
 *
 * Здесь НЕТ и не должно появиться: body, query, cookies, заголовков, токенов,
 * почты, полного URL, сырого ответа Directus, текста промпта.
 */
export const EVENT_FIELD_ALLOWLIST = [
  'reason',      // стабильная машинная причина: 'timeout', 'forbidden', 'quota'
  'route',       // шаблон маршрута, не подставленный id
  'method',
  'status',
  'durationMs',
  'system',      // внешняя система: 'directus', 'telegram', 'openrouter'
  'operation',
  'provider',
  'platform',
  'collection',
  'entityType',
  'entityId',
  'contentId',
  'campaignId',
  'userId',
  'count',
  'attempt',
  // AI-65. Идентификатор одного прогона фоновой задачи: по нему начало,
  // окончание и отказ одного и того же прогона сходятся в одну строку истории.
  // Без него в журнале видно только «какая-то задача что-то делала».
  'jobId',
] as const;

export type EventField = (typeof EVENT_FIELD_ALLOWLIST)[number];

const ALLOWED = new Set<string>(EVENT_FIELD_ALLOWLIST);

/** Длина значения в логе. Дальше начинается не идентификатор, а содержимое. */
const MAX_FIELD_LENGTH = 120;

/**
 * Оставляет только разрешённые поля и приводит значения к безопасному виду.
 * Экспортируется ради теста: правило про запрещённые поля должно проверяться
 * напрямую, а не через наблюдение за выводом.
 */
export function filterEventFields(
  fields: Record<string, unknown> = {},
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED.has(key)) continue;
    if (value === undefined || value === null) continue;

    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'string') {
      // Редакция всё равно применяется: идентификатор кампании безобиден, но
      // в `reason` легко занести текст ошибки внешней системы с токеном внутри.
      out[key] = redactText(value).slice(0, MAX_FIELD_LENGTH);
    }
    // объекты и массивы не пропускаем вовсе: это путь, которым в лог попадает
    // тело запроса целиком.
  }

  return out;
}

/**
 * Записывает событие: стабильное имя плюс разрешённые поля.
 * `message` остаётся человекочитаемым, машинный разбор идёт по `event`.
 */
export function logEvent(
  event: string,
  fields: Record<string, unknown> = {},
  level: LogLevel = 'info',
  source = 'event',
  message?: string,
): void {
  const safe = filterEventFields(fields);
  const text = message ?? event;
  emit(level, text, source, undefined, { event, ...safe });
}

/**
 * AI-65 срез B2: ЕДИНАЯ точка эмиссии события «публикация поставлена в расписание»
 * (publish.scheduled). Отвечает на вопрос «когда пост попал в расписание» — основной
 * случай это запланированный пользователем пост; вызовы из всех точек постановки.
 *
 * Поле `kind` отличает смысл, чтобы под одним именем не смешались два разных события:
 *   - 'initially_scheduled' — пользователь поставил пост в расписание (главный случай);
 *   - 'rescheduled_after_failure' — планировщик переносит пост на следующую попытку
 *     (остался в расписании после неудачной попытки).
 */
export function emitPublishScheduled(
  contentId: string,
  opts: { campaignId?: string; kind?: 'initially_scheduled' | 'rescheduled_after_failure' } = {},
): void {
  try {
    logEvent('publish.scheduled', {
      contentId,
      ...(opts.campaignId ? { campaignId: opts.campaignId } : {}),
      kind: opts.kind ?? 'initially_scheduled',
      at: new Date().toISOString(),
    }, 'info', 'publish');
  } catch {
    // Наблюдение не должно уметь ронять систему: ошибка внутри журналирования
    // не прерывает проход планировщика/публикации (AI-65 срез B2 v3).
  }
}

/** ЕДИНАЯ точка эмиссии «период планировщика начался» (cron.started). */
export function emitCronStarted(tick: number, at = new Date().toISOString()): void {
  try {
    logEvent('cron.started', { tick, at }, 'info', 'scheduler');
  } catch {
    // Наблюдение не должно уметь ронять систему (см. emitPublishScheduled).
  }
}

/**
 * Ограниченный по времени сброс вывода перед завершением процесса.
 *
 * ЗАЧЕМ. Когда stdout уходит в конвейер (docker json-file — именно такой
 * случай), запись асинхронна. `process.exit(1)` сразу после записи об аварии
 * теряет ровно ту строку, ради которой всё и делалось. Ждём слива, но не
 * бесконечно: зависший сброс не должен превращать падение в вечно живой
 * процесс, который мониторинг считает здоровым.
 */
export function flushLogs(timeoutMs = 250): Promise<void> {
  const drain = (stream: NodeJS.WriteStream): Promise<void> =>
    new Promise((resolve) => {
      try {
        if (!stream || typeof stream.write !== 'function') return resolve();
        stream.write('', () => resolve());
      } catch {
        resolve();
      }
    });

  return Promise.race([
    Promise.all([drain(process.stdout), drain(process.stderr)]).then(() => undefined),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
}

/**
 * Выводит сообщение с указанием источника и уровня.
 * @param message Сообщение
 * @param source Источник сообщения
 * @param level Уровень: debug | info | warn | error | fatal
 */
export function logMessage(message: string, source = 'express', level: string = 'info'): void {
  emit(isLogLevel(level) ? level : 'info', message, source);
}

/**
 * Информационное сообщение: жизненный цикл и итоги.
 */
export function info(message: string, source = 'express'): void {
  emit('info', message, source);
}

/**
 * Ошибка: сломан пользовательский сценарий или упала фоновая задача.
 * Печатается всегда, включая production.
 */
export function error(message: string, err?: any, source = 'express'): void {
  emit('error', message, source, err);
}

/**
 * Критический сбой: процесс не может продолжать работу.
 */
export function criticalError(message: string, source = 'system', userFriendlyMessage?: string): void {
  const text = userFriendlyMessage
    ? `КРИТИЧЕСКАЯ ОШИБКА: ${userFriendlyMessage}. Обратитесь к администрации. Детали: ${message}`
    : `КРИТИЧЕСКАЯ ОШИБКА: ${message}. Обратитесь к администрации.`;
  emit('fatal', text, source);
}

/**
 * Системная ошибка. Раньше печаталась только в development — то есть в проде
 * молчала именно там, где нужнее всего. Теперь это обычный error.
 */
export function systemError(message: string, source = 'system'): void {
  emit('error', message, source);
}

/**
 * Предупреждение: деградация, с которой система справилась.
 */
export function warn(message: string, source = 'express'): void {
  emit('warn', message, source);
}

/**
 * Отладочное сообщение. В production не печатается, если не задан LOG_LEVEL=debug.
 */
export function debug(message: string, source = 'express'): void {
  emit('debug', message, source);
}

/**
 * Выводит информацию о конфигурации окружения
 */
export function logEnvironmentInfo(): void {
  info(`Running in ${getEnvConfig().environment} mode`, 'env');
  info(`Log level: ${getEnvConfig().logLevel}`, 'env');
  info(`Directus URL: ${getEnvConfig().directusUrl}`, 'env');
}

/**
 * Перечитывает окружение (используется в тестах и при смене конфигурации)
 */
export function refreshEnvironmentConfig(): void {
  // Reset cache so getEnvConfig() re-reads from detectEnvironment()
  _envConfig = null;
  const cfg = getEnvConfig();

  // DEBUG_LEVELS is a Proxy — individual properties are computed on read,
  // so we just need the cache primed. Nothing else to do here.

  debug('Environment configuration refreshed', 'env');
}

/**
 * Основная функция логирования с поддержкой различных уровней
 */
export const log: {
  (message: string, source?: string, level?: string): void;
  info: typeof info;
  error: typeof error;
  warn: typeof warn;
  debug: typeof debug;
} = logMessage as any;

log.info = info;
log.error = error;
log.warn = warn;
log.debug = debug;

// Экспортируем все функции как единый объект для удобства использования
export default {
  log,
  error,
  warn,
  debug,
  info,
};

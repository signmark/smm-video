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
 * LOG_LEVEL=debug. Порог берётся из envConfig.logLevel, который читает LOG_LEVEL.
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

// Получаем конфигурацию окружения
export let envConfig = detectEnvironment();

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
  const configured = envConfig?.logLevel;
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
 */
export const DEBUG_LEVELS = {
  GLOBAL: envConfig.environment === 'development' && envConfig.verboseLogs,
  SCHEDULER: envConfig.environment === 'development' ? envConfig.debugScheduler : false,
  PUBLISHING: envConfig.environment === 'development',
  SOCIAL: envConfig.environment === 'development',
  STATUS_CHECKER: envConfig.environment === 'development',
};

// --- Редакция секретов ---------------------------------------------------
// Режем по имени поля и на любой глубине: расставлять '[REDACTED]' руками по
// коду ненадёжно — рано или поздно один вызов забудут.
const SECRET_KEY = /(pass(word)?|secret|token|api[-_]?key|apikey|authorization|cookie|credential|client[-_]?secret|session)/i;
const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

function redact(value: any, depth = 0, seen = new WeakSet<object>()): any {
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
  if (err.message) out.message = String(err.message);
  if (err.name && err.name !== 'Error') out.name = err.name;
  if (err.code) out.code = err.code;
  if (err.response) {
    out.status = err.response.status;
    if (err.response.data !== undefined) out.body = redact(err.response.data);
  }
  if (err.stack) out.stack = String(err.stack).split('\n').slice(0, 12).join('\n');
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

function emit(level: LogLevel, message: string, source: string, err?: any): void {
  if (LEVEL_ORDER[level] < threshold()) return;

  const text = typeof message === 'string' ? message : String(message);
  const details = serializeError(err);
  let line: string;

  if (envConfig.environment === 'production') {
    line = safeStringify({
      ts: new Date().toISOString(),
      level,
      source,
      msg: text,
      ...(details !== undefined ? { err: details } : {}),
    });
  } else {
    const time = new Date().toLocaleTimeString();
    line = `${time} [DEV] [${source}] ${text}`;
  }

  recordLog(line);

  if (level === 'error' || level === 'fatal') {
    // В development детали ошибки отдаём вторым аргументом — так их видно
    // раскрытыми в консоли; в production они уже внутри JSON-строки.
    if (envConfig.environment === 'production' || details === undefined) console.error(line);
    else console.error(line, err);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
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
  info(`Running in ${envConfig.environment} mode`, 'env');
  info(`Log level: ${envConfig.logLevel}`, 'env');
  info(`Directus URL: ${envConfig.directusUrl}`, 'env');
}

/**
 * Перечитывает окружение (используется в тестах и при смене конфигурации)
 */
export function refreshEnvironmentConfig(): void {
  envConfig = detectEnvironment();

  DEBUG_LEVELS.GLOBAL = envConfig.environment === 'development' && envConfig.verboseLogs;
  DEBUG_LEVELS.SCHEDULER = envConfig.environment === 'development' ? envConfig.debugScheduler : false;
  DEBUG_LEVELS.PUBLISHING = envConfig.environment === 'development';
  DEBUG_LEVELS.SOCIAL = envConfig.environment === 'development';
  DEBUG_LEVELS.STATUS_CHECKER = envConfig.environment === 'development';

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

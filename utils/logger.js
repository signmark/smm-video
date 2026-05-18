/**
 * Простая утилита для логирования сообщений с поддержкой ENV переменной
 * Не использует vite.config.ts напрямую или через импорты
 */
import { detectEnvironment } from './environment-detector';
// Получаем конфигурацию окружения
const envConfig = detectEnvironment();
/**
 * Режим отладки для всех модулей с учетом ENV переменной
 * В production режиме отключаем почти все логи
 */
export const DEBUG_LEVELS = {
    // Общий режим отладки для всех модулей - только в development
    GLOBAL: envConfig.environment === 'development' && envConfig.verboseLogs,
    // Отладка планировщика - только в development или с явным включением
    SCHEDULER: envConfig.environment === 'development' ? envConfig.debugScheduler : false,
    // Отладка публикаций - только в development
    PUBLISHING: envConfig.environment === 'development',
    // Отладка социальных платформ - только в development
    SOCIAL: envConfig.environment === 'development',
    // Отладка сервиса проверки статусов - только в development
    STATUS_CHECKER: envConfig.environment === 'development'
};
/**
 * Список сообщений, которые не нужно выводить в логи в production
 */
const FILTERED_MESSAGES = [
    // Ошибки авторизации
    "Request failed with status code 401",
    "Request failed with status code 403",
    "Request failed with status code 400",
    "Unauthorized",
    "Ошибка авторизации",
    "Не удалось получить токен",
    "token expired",
    "token is expired",
    "jwt expired",
    // Ошибки сетевых запросов
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "socket hang up",
    "network error",
    "Network Error",
    // Частые ошибки социальных сетей
    "API rate limit exceeded",
    "Too many requests",
    "(#4) Application request limit reached",
    "(#32) Page request limit reached",
    "Flood control exceeded",
    // Информационные сообщения в production
    "successfully logged in",
    "Admin session for user",
    "успешно инициализированы",
    "registered successfully",
    "операция выполнена успешно",
    "токен сохранен в кэше",
    "cache refreshed",
    "Использование токена",
    "Системный токен получен"
];
/**
 * Критически серьезные ошибки, которые всегда показываем пользователю
 * Только ошибки, требующие немедленного обращения к администратору
 */
const CRITICAL_ERROR_KEYWORDS = [
    "КРИТИЧЕСКАЯ ОШИБКА",
    "SYSTEM ERROR",
    "DATABASE ERROR",
    "FATAL ERROR",
    "SERVICE UNAVAILABLE",
    "обратитесь к администрации",
    "свяжитесь с поддержкой",
    "Системная ошибка",
    "Сервис недоступен",
    "База данных недоступна",
    "Критический сбой"
];
/**
 * Проверяет, нужно ли выводить отладочные сообщения для конкретного источника
 * @param source Источник сообщения
 * @returns true, если нужно выводить отладочные сообщения
 */
function shouldDebug(source) {
    if (DEBUG_LEVELS.GLOBAL)
        return true;
    if (source === 'scheduler' && DEBUG_LEVELS.SCHEDULER)
        return true;
    if (source.includes('publish') && DEBUG_LEVELS.PUBLISHING)
        return true;
    if (['facebook', 'telegram', 'vk', 'instagram'].some(p => source.includes(p)) && DEBUG_LEVELS.SOCIAL)
        return true;
    return false;
}
/**
 * Выводит сообщение в консоль с указанием источника
 * @param message Сообщение для вывода
 * @param source Источник сообщения (по умолчанию "express")
 * @param level Уровень логирования (info, debug, error)
 */
export function logMessage(message, source = "express", level = "info") {
    // В production режиме строгая фильтрация
    if (envConfig.environment === 'production') {
        // Показываем только критические ошибки
        const isCriticalError = level === "error" && CRITICAL_ERROR_KEYWORDS.some(keyword => message.includes(keyword));
        // Фильтруем все обычные сообщения в production
        if (!isCriticalError && FILTERED_MESSAGES.some(msg => message.includes(msg))) {
            return;
        }
        // Показываем только критические ошибки и важные системные сообщения
        if (level === "info" || level === "debug") {
            return; // Отключаем все info и debug логи в production
        }
        // Если не критическая ошибка, тоже скрываем
        if (level === "error" && !isCriticalError) {
            return;
        }
    }
    // Development режим - показываем в зависимости от debug уровней
    if (envConfig.environment === 'development') {
        // Проверка на отладочные сообщения
        if (level === "debug" && !shouldDebug(source)) {
            return;
        }
        // Фильтруем известные ошибки даже в development
        if (FILTERED_MESSAGES.some(msg => message.includes(msg))) {
            return;
        }
    }
    const time = new Date().toLocaleTimeString();
    const envPrefix = envConfig.environment === 'development' ? '[DEV] ' : '';
    console.log(`${time} ${envPrefix}[${source}] ${message}`);
    // Детальное логирование только в development
    if (envConfig.environment === 'development') {
        const isDebug = source.endsWith('-debug') || level === "debug";
        if (isDebug) {
            try {
                // Простое логирование в консоль для debug сообщений
                console.log(`[DEBUG-LOG] ${new Date().toISOString()} [${source}] ${message}`);
            }
            catch (err) {
                // Игнорируем ошибки
            }
        }
    }
}
/**
 * Выводит информацию о конфигурации окружения
 */
export function logEnvironmentInfo() {
    logMessage(`Running in ${envConfig.environment} mode`, 'env', 'info');
    logMessage(`Log level: ${envConfig.logLevel}`, 'env', 'info');
    logMessage(`Directus URL: ${envConfig.directusUrl}`, 'env', 'info');
    if (envConfig.verboseLogs) {
        logMessage(`Verbose logs: enabled`, 'env', 'debug');
        logMessage(`Debug scheduler: ${envConfig.debugScheduler}`, 'env', 'debug');
    }
}
/**
 * Обновляет конфигурацию окружения
 */
export function refreshEnvironmentConfig() {
    const newConfig = detectEnvironment();
    DEBUG_LEVELS.GLOBAL = newConfig.environment === 'development' && newConfig.verboseLogs;
    DEBUG_LEVELS.SCHEDULER = newConfig.environment === 'development' ? newConfig.debugScheduler : false;
    DEBUG_LEVELS.PUBLISHING = newConfig.environment === 'development';
    DEBUG_LEVELS.SOCIAL = newConfig.environment === 'development';
    DEBUG_LEVELS.STATUS_CHECKER = newConfig.environment === 'development';
    if (newConfig.environment === 'development') {
        logMessage('Environment configuration refreshed', 'env', 'info');
    }
}
/**
 * Выводит информационное сообщение в консоль с указанием источника
 * @param message Сообщение для вывода
 * @param source Источник сообщения (по умолчанию "express")
 */
export function info(message, source = "express") {
    // Фильтруем некоторые часто повторяющиеся информационные сообщения
    if (FILTERED_MESSAGES.some(msg => message.includes(msg))) {
        return;
    }
    const time = new Date().toLocaleTimeString();
    console.log(`${time} [${source}] ${message}`);
}
/**
 * Выводит сообщение об ошибке в консоль с указанием источника
 * @param message Сообщение для вывода
 * @param error Объект ошибки
 * @param source Источник сообщения (по умолчанию "express")
 */
export function error(message, error, source = "express") {
    // В production режиме применяем строгую фильтрацию
    if (envConfig.environment === 'production') {
        // Проверяем, является ли это критической ошибкой
        const isCritical = CRITICAL_ERROR_KEYWORDS.some(keyword => message.includes(keyword));
        if (!isCritical) {
            return; // Скрываем все некритические ошибки в production
        }
    }
    // В development режиме фильтруем известные ошибки
    if (envConfig.environment === 'development') {
        if (FILTERED_MESSAGES.some(msg => message.includes(msg) || (error && typeof error === 'string' && error.includes(msg)))) {
            return;
        }
        // Дополнительная проверка ошибки axios
        if (error && typeof error === 'object') {
            if (error.response) {
                if (error.response.status === 401 || error.response.status === 403 || error.response.status === 429) {
                    return;
                }
                if (error.response.data && typeof error.response.data === 'object') {
                    if (error.response.data.error && typeof error.response.data.error === 'string') {
                        if (FILTERED_MESSAGES.some(msg => error.response.data.error.includes(msg))) {
                            return;
                        }
                    }
                    if (error.response.data.error && typeof error.response.data.error === 'object' && error.response.data.error.message) {
                        if (FILTERED_MESSAGES.some(msg => error.response.data.error.message.includes(msg))) {
                            return;
                        }
                    }
                }
            }
            if (error.message && typeof error.message === 'string') {
                if (FILTERED_MESSAGES.some(msg => error.message.includes(msg))) {
                    return;
                }
            }
            if (error.code && typeof error.code === 'string') {
                if (FILTERED_MESSAGES.some(msg => error.code.includes(msg))) {
                    return;
                }
            }
        }
    }
    const time = new Date().toLocaleTimeString();
    const envPrefix = envConfig.environment === 'development' ? '[DEV] ' : '';
    console.error(`${time} ${envPrefix}[${source}] ${message}`, error || '');
}
/**
 * Логирует критическую ошибку, которая всегда показывается пользователю
 * @param message Сообщение об ошибке
 * @param source Источник сообщения
 * @param userFriendlyMessage Понятное пользователю сообщение
 */
export function criticalError(message, source = "system", userFriendlyMessage) {
    const criticalMessage = userFriendlyMessage
        ? `КРИТИЧЕСКАЯ ОШИБКА: ${userFriendlyMessage}. Обратитесь к администрации. Детали: ${message}`
        : `КРИТИЧЕСКАЯ ОШИБКА: ${message}. Обратитесь к администрации.`;
    const time = new Date().toLocaleTimeString();
    console.error(`${time} [${source}] ${criticalMessage}`);
}
/**
 * Логирует системную ошибку только в development режиме
 * @param message Сообщение об ошибке
 * @param source Источник сообщения
 */
export function systemError(message, source = "system") {
    if (envConfig.environment === 'development') {
        const time = new Date().toLocaleTimeString();
        console.error(`${time} [DEV] [${source}] SYSTEM ERROR: ${message}`);
    }
}
/**
 * Выводит предупреждение в консоль с указанием источника
 * @param message Сообщение для вывода
 * @param source Источник сообщения (по умолчанию "express")
 */
export function warn(message, source = "express") {
    const time = new Date().toLocaleTimeString();
    console.warn(`${time} [${source}] ${message}`);
}
/**
 * Выводит отладочное сообщение в консоль с указанием источника
 * @param message Сообщение для вывода
 * @param source Источник сообщения (по умолчанию "express")
 */
export function debug(message, source = "express") {
    const time = new Date().toLocaleTimeString();
    console.debug(`${time} [${source}] ${message}`);
}
/**
 * Основная функция логирования с поддержкой различных уровней
 */
export const log = logMessage;
// Добавляем методы для функции log
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
    info
};

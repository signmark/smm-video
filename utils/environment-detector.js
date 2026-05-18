/**
 * Environment detector for multi-server deployments
 * Handles different admin credentials across Docker, Replit, and production environments
 */
/**
 * Detects current environment and returns appropriate admin credentials
 */
export function detectEnvironment() {
    // Используем переменную ENV для определения окружения
    const envVariable = process.env.ENV || 'production';
    const environment = envVariable === 'development' ? 'development' : 'production';
    // URL Directus в зависимости от окружения
    const directusUrl = environment === 'development'
        ? (process.env.DIRECTUS_URL || 'https://directus.roboflow.tech')
        : (process.env.DIRECTUS_URL || 'https://directus.nplanner.ru');
    // Конфигурация логгирования в зависимости от окружения
    const logLevel = process.env.LOG_LEVEL ||
        (environment === 'development' ? 'debug' : 'info');
    const debugScheduler = process.env.DEBUG_SCHEDULER === 'true' || environment === 'development';
    const verboseLogs = process.env.VERBOSE_LOGS === 'true' || environment === 'development';
    return {
        adminEmail: 'admin@roboflow.tech',
        adminPassword: 'asdASD123!@#',
        directusUrl,
        environment,
        logLevel,
        debugScheduler,
        verboseLogs
    };
}

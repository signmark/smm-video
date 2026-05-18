/**
 * Production Logger Utility
 * Централизованное управление логированием для продакшена
 */

export class ProductionLogger {
  private static readonly IS_PRODUCTION = process.env.NODE_ENV === 'production';
  private static readonly DEBUG_ENABLED = process.env.DEBUG_SCHEDULER === 'true';
  private static readonly LOG_LEVEL = process.env.LOG_LEVEL || 'info';

  /**
   * Логирует отладочную информацию только если включен debug режим
   */
  static debug(message: string, category?: string): void {
    if (this.DEBUG_ENABLED && !this.IS_PRODUCTION) {
      console.log(`[${category || 'debug'}] DEBUG: ${message}`);
    }
  }

  /**
   * Логирует информационные сообщения
   */
  static info(message: string, category?: string): void {
    if (this.LOG_LEVEL !== 'error') {
      console.log(`[${category || 'info'}] ${message}`);
    }
  }

  /**
   * Логирует предупреждения
   */
  static warn(message: string, category?: string): void {
    console.warn(`[${category || 'warn'}] ${message}`);
  }

  /**
   * Логирует ошибки (всегда показываются)
   */
  static error(message: string, category?: string): void {
    console.error(`[${category || 'error'}] ${message}`);
  }

  /**
   * Проверяет, включено ли детальное логирование
   */
  static get isVerbose(): boolean {
    return this.DEBUG_ENABLED && !this.IS_PRODUCTION;
  }

  /**
   * Проверяет, работает ли система в продакшене
   */
  static get isProduction(): boolean {
    return this.IS_PRODUCTION;
  }
}
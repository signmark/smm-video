/**
 * Browser logging utility with environment-aware controls
 * Disables console logs in production environment
 */

interface EnvironmentConfig {
  environment: 'development' | 'production';
  logLevel: string;
  debugScheduler: boolean;
  verboseLogs: boolean;
}

class BrowserLogger {
  private config: EnvironmentConfig | null = null;
  private originalConsole: {
    log: typeof console.log;
    debug: typeof console.debug;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
  };

  constructor() {
    // Сохраняем оригинальные методы консоли
    this.originalConsole = {
      log: console.log.bind(console),
      debug: console.debug.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console)
    };

    this.initializeConfig();
  }

  private async initializeConfig() {
    try {
      const response = await fetch('/api/config');
      this.config = await response.json();
      this.setupConsoleOverrides();
    } catch (error) {
      // Если не удалось получить конфигурацию, по умолчанию разрешаем логи
      this.config = {
        environment: 'development',
        logLevel: 'debug',
        debugScheduler: true,
        verboseLogs: true
      };
      this.setupConsoleOverrides();
    }
  }

  private setupConsoleOverrides() {
    if (!this.config) return;

    if (this.config.environment === 'production') {
      // В production отключаем все логи кроме критических ошибок
      console.log = () => {};
      console.debug = () => {};
      console.info = () => {};
      console.warn = () => {};
      
      // Оставляем только критически серьезные ошибки для пользователей
      console.error = (...args: any[]) => {
        const message = args.join(' ');
        
        // Скрываем обычные HTTP ошибки (401, 403, 404, 429, 500) - они не критичны для пользователей
        if (message.includes('401 (Unauthorized)') || 
            message.includes('403 (Forbidden)') ||
            message.includes('404 (Not Found)') ||
            message.includes('429 (Too Many Requests)') ||
            message.includes('500 (Internal Server Error)')) {
          return; // Полностью скрываем эти ошибки в production
        }
        
        // Только ошибки, которые требуют обращения к администратору
        const isCriticalUserError = message.includes('КРИТИЧЕСКАЯ ОШИБКА') || 
                                   message.includes('SYSTEM ERROR') ||
                                   message.includes('DATABASE ERROR') ||
                                   message.includes('FATAL ERROR') ||
                                   message.includes('обратитесь к администрации') ||
                                   message.includes('свяжитесь с поддержкой') ||
                                   message.includes('Системная ошибка') ||
                                   message.includes('Сервис недоступен');
        
        if (isCriticalUserError) {
          this.originalConsole.error(...args);
        }
      };
    } else {
      // В development режиме оставляем все логи как есть
      console.log = this.originalConsole.log;
      console.debug = this.originalConsole.debug;
      console.info = this.originalConsole.info;
      console.warn = this.originalConsole.warn;
      console.error = this.originalConsole.error;
    }
  }

  // Методы для принудительного логирования (игнорируют окружение)
  forceLog(...args: any[]) {
    this.originalConsole.log(...args);
  }

  forceError(...args: any[]) {
    this.originalConsole.error(...args);
  }

  // Метод для критически серьезных ошибок, которые всегда показываются
  criticalError(message: string, details?: any) {
    const criticalMessage = `КРИТИЧЕСКАЯ ОШИБКА: ${message}. Обратитесь к администрации.`;
    this.originalConsole.error(criticalMessage, details || '');
  }

  // Системная ошибка для пользователей
  systemError(userMessage: string, technicalDetails?: any) {
    const systemMessage = `Системная ошибка: ${userMessage}. Свяжитесь с поддержкой.`;
    this.originalConsole.error(systemMessage, technicalDetails || '');
  }

  // Ошибка сервиса
  serviceError(serviceName: string, userMessage?: string) {
    const message = userMessage || `Сервис ${serviceName} недоступен`;
    const serviceMessage = `Сервис недоступен: ${message}. Обратитесь к администрации.`;
    this.originalConsole.error(serviceMessage);
  }

  // Обновление конфигурации
  async refreshConfig() {
    await this.initializeConfig();
  }

  // Получение текущей конфигурации
  getConfig() {
    return this.config;
  }
}

// Создаем глобальный экземпляр логгера
export const browserLogger = new BrowserLogger();

// Экспортируем удобные методы
export const log = (...args: any[]) => console.log(...args);
export const debug = (...args: any[]) => console.debug(...args);
export const info = (...args: any[]) => console.info(...args);
export const warn = (...args: any[]) => console.warn(...args);
export const error = (...args: any[]) => console.error(...args);

// Специализированные методы для критических ошибок
export const criticalError = (message: string, details?: any) => browserLogger.criticalError(message, details);
export const systemError = (userMessage: string, technicalDetails?: any) => browserLogger.systemError(userMessage, technicalDetails);
export const serviceError = (serviceName: string, userMessage?: string) => browserLogger.serviceError(serviceName, userMessage);

// Принудительные методы (игнорируют фильтры окружения)
export const forceLog = (...args: any[]) => browserLogger.forceLog(...args);
export const forceError = (...args: any[]) => browserLogger.forceError(...args);
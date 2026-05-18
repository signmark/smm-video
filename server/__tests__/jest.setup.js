/**
 * Файл настройки для тестов Jest
 * Устанавливает глобальные моки и переменные окружения для тестирования
 */

// Устанавливаем переменные окружения для тестов
process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';
process.env.DIRECTUS_URL = 'https://test-directus.example.com';

// Мокируем глобальные объекты
global.FormData = require('form-data');

// Мокируем модуль directus.ts до его импорта
jest.mock('../../server/lib/directus', () => {
  // Создаем мок для axios instance
  const axiosMock = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() }
    }
  };
  
  return {
    directusApi: axiosMock,
    DIRECTUS_URL: 'https://test-directus.example.com'
  };
});

// Настройка таймаутов для тестов с асинхронными операциями
jest.setTimeout(30000);

// Отключаем вывод консоли во время тестирования, если нужно
if (process.env.SUPPRESS_CONSOLE === 'true') {
  global.console = {
    ...console,
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

// Настройка для отслеживания утечек памяти в тестах
// global.gc - должен быть доступен при запуске Node.js с флагом --expose-gc
if (global.gc) {
  beforeEach(() => {
    global.gc();
  });
}

// Сообщение о запуске тестов
console.log('\n🧪 Запуск тестов в режиме:', process.env.NODE_ENV);
console.log('📅 Дата запуска:', new Date().toLocaleString());
console.log('--------------------------------------------------\n');
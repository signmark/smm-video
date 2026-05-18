/**
 * Скрипт для проверки форматирования URL сообщений Telegram
 * Запуск: node test-telegram-url.js
 */

// Импортируем модуль телеграм-сервиса напрямую (ESM синтаксис)
import { TelegramService } from './server/services/social/telegram-service.js';

// Создаем экземпляр сервиса
const telegramService = new TelegramService();

// Тестовые данные
const TEST_CASES = [
  {
    chatId: '123456789',
    messageId: '1234',
    expectedUrl: 'https://t.me/c/123456789/1234'
  },
  {
    chatId: '-100123456789',
    messageId: '1234',
    expectedUrl: 'https://t.me/c/123456789/1234'
  },
  {
    chatId: '@test_channel',
    messageId: '1234',
    expectedUrl: 'https://t.me/test_channel/1234'
  },
  {
    chatId: '-100123456789',
    messageId: null, // Специальный случай без messageId
    expectedError: true
  }
];

// Функция для тестирования форматирования URL
function testFormatUrl() {
  console.log('🔍 Тестирование форматирования URL для Telegram\n');
  
  TEST_CASES.forEach((testCase, index) => {
    console.log(`✅ Тест ${index + 1}: chatId = ${testCase.chatId}, messageId = ${testCase.messageId}`);
    
    try {
      // Для экземпляров с chatId, начинающимся с -100, извлекаем чистый ID
      let formattedChatId = testCase.chatId;
      if (formattedChatId.startsWith('-100')) {
        formattedChatId = formattedChatId.substring(4);
      }
      
      // Пытаемся сформировать URL
      const url = telegramService.formatTelegramUrl(
        testCase.chatId, 
        formattedChatId, 
        testCase.messageId
      );
      
      // Проверяем ожидаемый результат
      if (testCase.expectedError) {
        console.log(`❌ Ошибка: Должна была быть выброшена ошибка, но получен URL: ${url}`);
      } else if (url === testCase.expectedUrl) {
        console.log(`✓ Успех: URL сформирован корректно: ${url}`);
      } else {
        console.log(`✗ Ошибка: URL не соответствует ожидаемому`);
        console.log(`  Ожидался: ${testCase.expectedUrl}`);
        console.log(`  Получен:  ${url}`);
      }
    } catch (error) {
      if (testCase.expectedError) {
        console.log(`✓ Успех: Корректно выброшена ошибка: ${error.message}`);
      } else {
        console.log(`✗ Неожиданная ошибка: ${error.message}`);
      }
    }
    
    console.log(''); // Пустая строка для разделения тестов
  });
}

// Запускаем тесты
testFormatUrl();
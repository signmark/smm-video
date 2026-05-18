/**
 * Тест форматирования URL Telegram после исправлений
 * Проверяет корректность обработки различных типов chatId
 */
import axios from 'axios';

async function testTelegramUrlFormatting() {
  try {
    console.log('Запуск теста форматирования URL Telegram...');
    
    // Тестовые случаи
    const testCases = [
      { chatId: '-1002302366310', messageId: '12345', expected: 'https://t.me/c/2302366310/12345', description: 'Отрицательный ID с префиксом -100' },
      { chatId: '-12345678', messageId: '54321', expected: 'https://t.me/c/12345678/54321', description: 'Отрицательный ID без префикса -100' },
      { chatId: '@testchannel', messageId: '98765', expected: 'https://t.me/testchannel/98765', description: 'Канал с именем пользователя' }
    ];
    
    // Локальный сервер (должен быть запущен)
    const apiUrl = 'http://localhost:5000/api/test/format-telegram-url';
    
    for (const test of testCases) {
      console.log(`\nТестирование: ${test.description}`);
      console.log(`Входные данные: chatId=${test.chatId}, messageId=${test.messageId}`);
      
      const response = await axios.post(apiUrl, {
        chatId: test.chatId,
        messageId: test.messageId
      });
      
      const result = response.data;
      console.log(`Полученный URL: ${result.url}`);
      console.log(`Ожидаемый URL:  ${test.expected}`);
      
      if (result.url === test.expected) {
        console.log('✅ Тест пройден');
      } else {
        console.log('❌ Тест не пройден');
      }
    }
    
    console.log('\nТестирование завершено');
  } catch (error) {
    console.error('Ошибка при тестировании:', error.message);
    if (error.response) {
      console.error('Ответ сервера:', error.response.data);
    }
  }
}

// Запускаем тесты
testTelegramUrlFormatting();
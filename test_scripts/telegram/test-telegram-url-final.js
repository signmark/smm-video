/**
 * Финальный тест форматирования URL Telegram через API
 * Проверяет правильность исправления URL с отрицательным ID чата
 */
import fetch from 'node-fetch';

async function testTelegramUrlFormatting() {
  console.log('Тестирование форматирования URL Telegram...');
  
  // Тестовые данные
  const testCases = [
    { 
      chatId: '-1002302366310', 
      messageId: '12345', 
      expectedUrl: 'https://t.me/c/2302366310/12345'
    },
    { 
      chatId: '-100987654321', 
      messageId: '54321', 
      expectedUrl: 'https://t.me/c/987654321/54321'
    },
    { 
      chatId: '@test_channel', 
      messageId: '98765', 
      expectedUrl: 'https://t.me/test_channel/98765'
    },
    { 
      chatId: '-12345678', 
      messageId: '11111', 
      expectedUrl: 'https://t.me/c/12345678/11111'
    }
  ];
  
  // Выполнение тестов
  for (const test of testCases) {
    try {
      const response = await fetch('http://localhost:5000/api/test/format-telegram-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chatId: test.chatId,
          messageId: test.messageId
        })
      });
      
      if (!response.ok) {
        console.error(`Ошибка при тестировании ${test.chatId}: ${response.status} ${response.statusText}`);
        continue;
      }
      
      const data = await response.json();
      const formattedUrl = data.url;
      
      console.log(`Тест для chat ID: ${test.chatId}`);
      console.log(`  Ожидаемый URL: ${test.expectedUrl}`);
      console.log(`  Полученный URL: ${formattedUrl}`);
      
      if (formattedUrl === test.expectedUrl) {
        console.log('  ✅ Тест пройден');
      } else {
        console.log('  ❌ Тест не пройден');
      }
      console.log();
      
    } catch (error) {
      console.error(`Ошибка при тестировании ${test.chatId}:`, error);
    }
  }
}

testTelegramUrlFormatting();
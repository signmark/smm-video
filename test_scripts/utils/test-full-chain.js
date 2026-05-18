/**
 * Тест полной цепочки форматирования URL Telegram
 * Выполняет тесты непосредственно с экземпляром класса SocialPublishingWithImgurService
 */
import { socialPublishingWithImgurService } from './server/services/social-publishing-with-imgur.ts';

// Тестовая функция, имитирующая вызов метода на сервере
function formatTelegramUrlServer(chatId, messageId) {
  // Форматируем chatId для API
  let formattedChatId = chatId;
  if (formattedChatId.startsWith('@')) {
    formattedChatId = formattedChatId.substring(1);
  } else if (formattedChatId.startsWith('-100')) {
    // Для ID вида -100XXXXX убираем только префикс -100
    formattedChatId = formattedChatId.substring(4);
  } else if (formattedChatId.startsWith('-')) {
    // Для других отрицательных ID (например, -XXXXX) убираем только минус
    formattedChatId = formattedChatId.substring(1);
  }
  
  try {
    // Проверяем обязательное наличие message_id
    if (!messageId) {
      console.error('Ошибка: messageId обязателен для формирования URL согласно TELEGRAM_POSTING_ALGORITHM.md');
      return null;
    }
    
    // Вызываем метод класса для форматирования URL
    return socialPublishingWithImgurService.formatTelegramUrl(chatId, formattedChatId, messageId);
  } catch (error) {
    console.error('Ошибка при форматировании URL:', error.message);
    return null;
  }
}

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
  },
  // Тест на отсутствие messageId - должен вернуть null или бросить ошибку
  { 
    chatId: '-1002302366310', 
    messageId: null, 
    expectedUrl: null
  }
];

// Выполнение тестов
console.log('Тестирование форматирования URL Telegram...');

for (const test of testCases) {
  const formattedUrl = formatTelegramUrlServer(test.chatId, test.messageId);
  
  console.log(`\nТест для chat ID: ${test.chatId}`);
  console.log(`  Ожидаемый URL: ${test.expectedUrl || 'null (ожидается ошибка)'}`);
  console.log(`  Полученный URL: ${formattedUrl || 'null'}`);
  
  if ((formattedUrl === test.expectedUrl) || (formattedUrl === null && test.expectedUrl === null)) {
    console.log('  ✅ Тест пройден');
  } else {
    console.log('  ❌ Тест не пройден');
  }
}
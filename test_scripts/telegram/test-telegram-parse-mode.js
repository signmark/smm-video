/**
 * Тестовый скрипт для проверки настройки parse_mode в Telegram API
 * Проверяет отображение HTML тегов в сообщении
 */

import axios from 'axios';

// Настройки для тестирования
const token = '7529101043:AAG298h0iubyeKPuZ-WRtEFbNEnEyqy_XJU';
const chatId = '-1002302366310';

// Тестовые тексты с HTML форматированием
const testCases = [
  {
    name: 'С parse_mode',
    text: '<b>Жирный текст</b> и <i>курсивный текст</i> и <u>подчеркнутый</u>',
    parse_mode: 'HTML'
  },
  {
    name: 'Без parse_mode',
    text: '<b>Жирный текст</b> и <i>курсивный текст</i> и <u>подчеркнутый</u>',
    parse_mode: null
  },
  {
    name: 'С вложенными тегами',
    text: '<b>Жирный <i>и курсивный</i> текст</b> с <u>подчеркиванием</u>',
    parse_mode: 'HTML'
  }
];

/**
 * Отправляет сообщение в Telegram
 * @param {string} text Текст для отправки
 * @param {string|null} parse_mode Режим разбора (HTML, Markdown или null)
 * @returns {Promise<object>} Результат запроса
 */
async function sendToTelegram(text, parse_mode) {
  try {
    // Формируем тело запроса
    const requestBody = { chat_id: chatId, text };
    
    // Добавляем parse_mode, если он указан
    if (parse_mode) {
      requestBody.parse_mode = parse_mode;
    }
    
    console.log(`Отправка текста${parse_mode ? ` с parse_mode=${parse_mode}` : ' без parse_mode'}:`, text);
    
    // Выполняем запрос
    const response = await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`, 
      requestBody,
      { headers: { 'Content-Type': 'application/json' } }
    );
    
    return response.data;
  } catch (error) {
    console.error('Ошибка при отправке:', error.message);
    if (error.response) {
      console.error('Данные ошибки:', error.response.data);
    }
    return { ok: false, error: error.message };
  }
}

/**
 * Запускает все тесты
 */
async function runTests() {
  console.log('=== Тестирование parse_mode для Telegram API ===\n');
  
  for (let i = 0; i < testCases.length; i++) {
    const test = testCases[i];
    console.log(`\n[Тест ${i+1}] ${test.name}`);
    
    const result = await sendToTelegram(test.text, test.parse_mode);
    
    if (result.ok) {
      console.log('✅ Сообщение успешно отправлено');
      console.log('Message ID:', result.result.message_id);
      
      // Получаем информацию о чате для URL
      try {
        const chatInfo = await axios.post(
          `https://api.telegram.org/bot${token}/getChat`,
          { chat_id: chatId },
          { headers: { 'Content-Type': 'application/json' } }
        );
        
        if (chatInfo.data.ok) {
          let messageUrl;
          if (chatInfo.data.result.username) {
            messageUrl = `https://t.me/${chatInfo.data.result.username}/${result.result.message_id}`;
          } else {
            const formattedChatId = chatId.startsWith('-100') ? chatId.substring(4) : chatId;
            messageUrl = `https://t.me/c/${formattedChatId}/${result.result.message_id}`;
          }
          console.log('URL сообщения:', messageUrl);
        }
      } catch (error) {
        console.log('Не удалось получить URL сообщения');
      }
    } else {
      console.log('❌ Ошибка при отправке:', result.error || result.description);
    }
  }
  
  console.log('\n=== Тестирование завершено ===');
}

// Запускаем тесты
runTests().catch(error => {
  console.error('Ошибка при выполнении тестов:', error);
});
/**
 * Тестовый скрипт для проверки отправки сообщений в Telegram
 * Использует точно такие же заголовки и формат запроса, как в TelegramService
 */

import axios from 'axios';

// Настройки Telegram
const token = '7529101043:AAG298h0iubyeKPuZ-WRtEFbNEnEyqy_XJU';
const chatId = '-1002302366310';

// Проверяем отправку с HTML-тегами
const htmlText = '<b>Жирный текст</b> и <i>курсивный текст</i>\n<u>Подчеркнутый текст</u> и <s>зачеркнутый</s>\n<code>Моноширинный код</code>';

/**
 * Отправляет сообщение в Telegram в точно таком же формате, как в TelegramService
 */
async function sendMessage() {
  try {
    console.log('Отправка сообщения с HTML-тегами в Telegram...');
    
    // Подготавливаем тело запроса точно как в TelegramService
    const messageBody = {
      chat_id: chatId,
      text: htmlText,
      parse_mode: 'HTML',
      protect_content: false,
      disable_notification: false
    };
    
    // Используем те же заголовки и опции, что и в TelegramService
    const baseUrl = `https://api.telegram.org/bot${token}`;
    const response = await axios.post(`${baseUrl}/sendMessage`, messageBody, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
      validateStatus: () => true // Всегда возвращаем ответ, даже если это ошибка
    });
    
    // Обрабатываем ответ
    if (response.status === 200 && response.data && response.data.ok) {
      console.log('✅ Сообщение успешно отправлено!');
      console.log(`Message ID: ${response.data.result.message_id}`);
      
      // Получаем информацию о чате
      try {
        const chatInfo = await axios.post(
          `${baseUrl}/getChat`,
          { chat_id: chatId },
          { 
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
          }
        );
        
        if (chatInfo.data && chatInfo.data.ok) {
          let messageUrl;
          if (chatInfo.data.result.username) {
            messageUrl = `https://t.me/${chatInfo.data.result.username}/${response.data.result.message_id}`;
            console.log(`Публичный канал с username: ${chatInfo.data.result.username}`);
          } else {
            const formattedChatId = chatId.startsWith('-100') ? chatId.substring(4) : chatId;
            messageUrl = `https://t.me/c/${formattedChatId}/${response.data.result.message_id}`;
            console.log('Приватный канал (без username)');
          }
          console.log(`URL сообщения: ${messageUrl}`);
        }
      } catch (error) {
        console.error('Ошибка при получении информации о чате:', error);
      }
    } else {
      console.error('Ошибка при отправке сообщения:');
      console.error('Статус:', response.status);
      console.error('Данные:', response.data);
    }
  } catch (error) {
    console.error('Исключение:', error);
  }
}

// Запускаем отправку
sendMessage().then(() => {
  console.log('\nТест завершен');
});
/**
 * Простой скрипт для тестирования отправки сообщения в Telegram
 * Запустите: node telegram-test.js
 */

import axios from 'axios';

// Токен и ID чата из кампании "Правильное питание"
const TELEGRAM_TOKEN = '7529101043:AAG298h0iubyeKPuZ-WRtEFbNEnEyqy_XJU';
const TELEGRAM_CHAT_ID = '-1002302366310';

// Форматирует URL канала для Telegram
function formatTelegramUrl(chatId, messageId) {
  // Публичные каналы и группы (начинаются с -100)
  if (chatId.startsWith('-100')) {
    return `https://t.me/${chatId.replace('-100', '')}/${messageId}`;
  }
  
  // Приватные каналы и группы (начинаются с -)
  if (chatId.startsWith('-')) {
    return `https://t.me/c/${chatId.substring(1)}/${messageId}`;
  }
  
  // Username начинается с @
  if (chatId.startsWith('@')) {
    return `https://t.me/${chatId.substring(1)}/${messageId}`;
  }
  
  // Простой username без @
  if (!chatId.match(/^-?\d+$/)) {
    return `https://t.me/${chatId}/${messageId}`;
  }
  
  // По умолчанию для числовых ID используем c/
  return `https://t.me/c/${chatId}/${messageId}`;
}

async function sendMessage() {
  try {
    console.log(`Отправка тестового сообщения в чат ${TELEGRAM_CHAT_ID}`);
    
    const baseUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
    const text = `
<b>Тестовое сообщение из скрипта</b>

Это сообщение отправлено для проверки <i>HTML-форматирования</i> и корректного формирования ссылок.

<b>Список возможностей:</b>
• <b>Жирный текст</b>
• <i>Курсивный текст</i>
• <u>Подчеркнутый текст</u>
• <s>Зачеркнутый текст</s>
• <code>Моноширинный текст</code>
• <a href="https://t.me/ya_delayu_moschno">Ссылка на канал</a>

#тест #форматирование #telegram
    `;
    
    const response = await axios.post(`${baseUrl}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: false
    });
    
    if (response.data && response.data.ok) {
      const messageId = response.data.result.message_id;
      const messageUrl = formatTelegramUrl(TELEGRAM_CHAT_ID, messageId);
      
      console.log('✅ Сообщение успешно отправлено!');
      console.log(`ID сообщения: ${messageId}`);
      console.log(`URL сообщения: ${messageUrl}`);
    } else {
      console.error('❌ Ошибка при отправке сообщения:', response.data);
    }
  } catch (error) {
    console.error('❌ Произошла ошибка:', error.message);
    if (error.response) {
      console.error('Детали ошибки:', error.response.data);
    }
  }
}

// Запускаем отправку сообщения
sendMessage();
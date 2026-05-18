/**
 * Тестовый скрипт для проверки HTML-форматирования в Telegram сообщениях
 * Проверяет корректность отображения различных HTML-тегов
 */
import axios from 'axios';
import { config } from 'dotenv';

config();

// Настройки Telegram из кампании "Правильное питание"
const TELEGRAM_TOKEN = '7529101043:AAG298h0iubyeKPuZ-WRtEFbNEnEyqy_XJU';
const TELEGRAM_CHAT_ID = '-1002302366310';

// Текст с различными HTML-тегами для тестирования
const TEST_HTML = `<b>Это текст в жирном шрифте</b>

<i>Это курсивный текст</i>

<u>Этот текст подчеркнут</u>

<b>Вложенный <i>текст с</i> разными <u>тегами</u></b>

<i>Незакрытый тег курсива

<b>Незакрытый тег жирного

Проверка работы HTML-тегов в Telegram`;

async function testHtmlFormatting() {
  console.log('=== Тест HTML-форматирования в Telegram ===\n');
  console.log('Отправляемый текст:');
  console.log('--------------------------------------------------');
  console.log(TEST_HTML);
  console.log('--------------------------------------------------\n');

  try {
    // Отправляем сообщение с HTML-форматированием напрямую через Telegram API
    console.log('Отправка сообщения в Telegram...');
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const response = await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: TEST_HTML,
      parse_mode: 'HTML'
    });

    if (response.data && response.data.ok) {
      const messageId = response.data.result.message_id;
      console.log(`\n✅ УСПЕХ: Сообщение успешно отправлено в Telegram, message_id: ${messageId}`);
      
      // Формируем URL на сообщение
      let messageUrl;
      if (TELEGRAM_CHAT_ID.startsWith('-100')) {
        // Для приватного канала
        const channelId = TELEGRAM_CHAT_ID.substring(4);
        messageUrl = `https://t.me/c/${channelId}/${messageId}`;
      } else {
        // Для публичного канала (мы бы получили информацию о канале, но для простоты используем приватный формат)
        messageUrl = `https://t.me/c/${TELEGRAM_CHAT_ID.replace('-', '')}/${messageId}`;
      }
      
      console.log(`URL сообщения: ${messageUrl}`);
    } else {
      console.error('\n❌ ОШИБКА: Сообщение не отправлено');
      console.error(JSON.stringify(response.data, null, 2));
    }
  } catch (error) {
    console.error('\n❌ ОШИБКА при выполнении теста:', error.message);
    if (error.response) {
      console.error('Ответ сервера:', error.response.status);
      console.error('Данные ответа:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Запускаем тест
testHtmlFormatting();
/**
 * Тестовый скрипт для проверки TelegramService после исправления проблемы с forceImageTextSeparation
 * Запустите: node test-telegram-service.js
 */
import axios from 'axios';

// Настройки Telegram из кампании "Правильное питание"
const TELEGRAM_TOKEN = '7529101043:AAG298h0iubyeKPuZ-WRtEFbNEnEyqy_XJU';
const TELEGRAM_CHAT_ID = '-1002302366310';

// URL нашего API 
const API_URL = 'http://localhost:3000';

// Текст с HTML-тегами для тестирования
const TEST_HTML = `<b>Жирный текст</b>

<i>Курсивный текст</i>

<u>Подчеркнутый текст</u>

<b>Вложенный <i>текст с</i> разными <u>тегами</u></b>

<i>Незакрытый тег курсива

<b>Незакрытый тег жирного

Проверка работы HTML-тегов в Telegram через наш API`;

async function testTelegramService() {
  console.log('=== Тест отправки HTML-форматированного текста через API приложения ===\n');
  console.log('Отправляемый текст:');
  console.log('--------------------------------------------------');
  console.log(TEST_HTML);
  console.log('--------------------------------------------------\n');

  try {
    // Отправляем сообщение через наш API приложения
    console.log('Отправка сообщения через API приложения...');
    
    // Используем тестовый маршрут нашего API
    const response = await axios.post(`${API_URL}/api/test/telegram-post`, {
      text: TEST_HTML,
      chatId: TELEGRAM_CHAT_ID,
      token: TELEGRAM_TOKEN
    });

    console.log('\nРезультат публикации:');
    console.log(JSON.stringify(response.data, null, 2));

    if (response.data && response.data.success) {
      const result = response.data.data;
      
      if (result.status === 'published') {
        console.log('\n✅ УСПЕХ: Сообщение успешно опубликовано в Telegram!');
        console.log(`URL сообщения: ${result.postUrl || 'URL не доступен'}`);
      } else {
        console.log(`\n❌ ОШИБКА: Не удалось опубликовать сообщение. Статус: ${result.status}`);
        if (result.error) {
          console.log(`Описание ошибки: ${result.error}`);
        }
      }
    } else {
      console.log('\n❌ ОШИБКА: Неожиданный ответ от API приложения');
      console.log(JSON.stringify(response.data, null, 2));
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
testTelegramService();
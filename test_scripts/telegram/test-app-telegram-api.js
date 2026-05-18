/**
 * Тестовый скрипт для проверки HTML форматирования в Telegram через API нашего приложения
 * Запуск: node test-app-telegram-api.js
 */
import axios from 'axios';

// Настройки Telegram из кампании "Правильное питание"
const TELEGRAM_TOKEN = '7529101043:AAG298h0iubyeKPuZ-WRtEFbNEnEyqy_XJU';
const TELEGRAM_CHAT_ID = '-1002302366310';

// URL нашего API
const API_URL = 'http://localhost:3000';

// Набор тестовых примеров с разными вариантами HTML-форматирования
const testCases = [
  {
    name: 'Простые HTML-теги',
    text: `<b>Жирный текст</b>

<i>Курсивный текст</i>

<u>Подчеркнутый текст</u>

<s>Зачеркнутый текст</s>

<code>Моноширинный текст</code>

<a href="https://example.com">Ссылка</a>`
  },
  {
    name: 'Вложенные теги',
    text: `<b>Вложенный <i>текст с</i> разными <u>тегами</u></b>

<b><i><u>Три уровня вложенности</u></i></b>

<b>Текст с <a href="https://example.com">ссылкой</a> внутри жирного</b>`
  },
  {
    name: 'Незакрытые теги',
    text: `<b>Незакрытый тег жирного

<i>Незакрытый тег курсива

<u>Незакрытый тег подчеркивания

Обычный текст после незакрытых тегов`
  },
  {
    name: 'Смешанное форматирование',
    text: `<b>Заголовок</b>

<i>Подзаголовок с курсивом</i>

Обычный текст

• <u>Подчеркнутый пункт</u>
• <b>Жирный пункт</b>
• <i>Курсивный пункт</i>
• <s>Зачеркнутый пункт</s>

<code>console.log('Hello world');</code>

<b>Незакрытый тег в конце`
  }
];

/**
 * Основная функция теста
 */
async function testTelegramHtmlFormatting() {
  console.log('=== Тест HTML-форматирования через API приложения ===\n');
  
  // Перебираем все тестовые случаи
  for (const testCase of testCases) {
    console.log(`\n--- Тестируем: ${testCase.name} ---`);
    console.log('Отправляемый текст:');
    console.log('--------------------------------------------------');
    console.log(testCase.text);
    console.log('--------------------------------------------------\n');
    
    try {
      // Отправляем сообщение через наш API
      console.log(`Отправка сообщения через API...`);
      
      // Используем тестовый маршрут нашего API
      const response = await axios.post(`${API_URL}/api/test/telegram-post`, {
        text: testCase.text,
        chatId: TELEGRAM_CHAT_ID,
        token: TELEGRAM_TOKEN
      });
      
      // Проверяем успешность отправки
      if (response.data && response.data.success) {
        const result = response.data.data;
        console.log(`\n✅ УСПЕХ: Сообщение успешно отправлено в Telegram!`);
        
        if (result.postUrl) {
          console.log(`URL сообщения: ${result.postUrl}`);
        }
        
        if (result.messageId) {
          console.log(`ID сообщения: ${result.messageId}`);
        }
      } else {
        console.log(`\n❌ ОШИБКА: Не удалось отправить сообщение`);
        if (response.data && response.data.error) {
          console.log(`Описание ошибки: ${response.data.error}`);
        }
        console.log(JSON.stringify(response.data, null, 2));
      }
    } catch (error) {
      console.error(`\n❌ ОШИБКА при выполнении теста:`, error.message);
      if (error.response) {
        console.error('Ответ сервера:', error.response.status);
        console.error('Данные ответа:', JSON.stringify(error.response.data, null, 2));
      }
    }
    
    // Добавляем паузу между тестами, чтобы не отправлять слишком много сообщений
    console.log('\nЖдем 3 секунды перед следующим тестом...');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

// Запускаем тест
testTelegramHtmlFormatting();
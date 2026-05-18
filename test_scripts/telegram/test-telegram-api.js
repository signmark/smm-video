/**
 * Тестовый скрипт для отправки HTML-сообщений в Telegram через API
 * Запустите: node test-telegram-api.js
 */

const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

// Порт, на котором запущен сервер
const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}/api/test`;

// Токен и ID чата Telegram
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// Различные типы HTML-разметки для тестирования
const TEST_CASES = [
  {
    name: 'Базовые теги',
    html: '<b>Жирный текст</b> и <i>курсивный текст</i> и <u>подчеркнутый</u>'
  },
  {
    name: 'Ссылки',
    html: 'Это <a href="https://example.com">ссылка</a> для проверки'
  },
  {
    name: 'Вложенные теги',
    html: '<b>Жирный <i>и курсивный</i> текст</b>'
  },
  {
    name: 'Комбинированный текст',
    html: '<b>Важное объявление!</b>\n\n<p>Мы рады сообщить о <i>новом</i> продукте.</p>\n\nПосетите наш <a href="https://example.com">сайт</a> для более подробной информации.'
  }
];

/**
 * Отправляет сообщение в Telegram через API
 * @param {string} text HTML-текст для отправки
 * @returns {Promise<Object>} Результат отправки
 */
async function sendMessageThroughApi(text) {
  try {
    // Проверяем, есть ли токен и chatId
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
      throw new Error('TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID должны быть указаны в .env файле');
    }

    const response = await axios.post(`${BASE_URL}/telegram-post`, {
      text,
      token: TELEGRAM_TOKEN,
      chatId: TELEGRAM_CHAT_ID
    });
    return response.data;
  } catch (error) {
    console.error('Ошибка при отправке запроса:', error.message);
    if (error.response) {
      console.error('Ответ сервера:', error.response.data);
    }
    return { success: false, error: error.message };
  }
}

/**
 * Запускает все тесты
 */
async function runTests() {
  console.log('\n=== ТЕСТ ОТПРАВКИ HTML-СООБЩЕНИЙ В TELEGRAM ===\n');
  
  for (let i = 0; i < TEST_CASES.length; i++) {
    const testCase = TEST_CASES[i];
    console.log(`\n--- Тест #${i + 1}: ${testCase.name} ---`);
    console.log(`Отправляемый HTML: ${testCase.html}`);
    
    try {
      const result = await sendMessageThroughApi(testCase.html);
      
      if (result.success) {
        console.log(`\nРезультат: Успешно отправлено!`);
        console.log(`ID сообщения: ${result.messageId}`);
        console.log(`URL сообщения: ${result.postUrl}`);
      } else {
        console.log(`\nОшибка: ${result.error}`);
      }
    } catch (error) {
      console.error(`\nНеожиданная ошибка: ${error.message}`);
    }
    
    console.log('\n' + '-'.repeat(50));
    
    // Делаем паузу между отправками, чтобы не превысить лимиты API
    if (i < TEST_CASES.length - 1) {
      console.log('Ожидание 3 секунды перед следующим тестом...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  console.log('\n=== ТЕСТЫ ЗАВЕРШЕНЫ ===\n');
}

// Запускаем тесты
runTests().catch(console.error);
/**
 * Тестирование функции форматирования текста для Telegram из TelegramService
 * Запустите: node test-server-formatter.js
 */

import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

// Настройки Telegram
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '7529101043:AAG298h0iubyeKPuZ-WRtEFbNEnEyqy_XJU';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-1002302366310';
const API_URL = 'http://localhost:5000/api/test/format-telegram';

// Функция для логирования в консоль
function log(message) {
  console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}

// Функция для форматирования через наш сервер
async function formatUsingServer(text) {
  try {
    log(`Форматирование текста через API сервера: ${text.substring(0, 50)}...`);
    const response = await axios.post(API_URL, { text });
    
    if (response.data && response.data.success) {
      log(`Текст успешно отформатирован: ${response.data.formattedText.substring(0, 50)}...`);
      return response.data.formattedText;
    } else {
      log(`Ошибка при форматировании: ${JSON.stringify(response.data)}`);
      return null;
    }
  } catch (error) {
    log(`Ошибка при обращении к API: ${error.message}`);
    if (error.response) {
      log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    return null;
  }
}

// Функция для отправки отформатированного текста в Telegram
async function sendFormattedMessage(text) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const data = {
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: 'HTML'
    };

    log(`Отправка сообщения в Telegram: ${text.substring(0, 50)}...`);
    const response = await axios.post(url, data, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.ok) {
      log(`Сообщение успешно отправлено. ID: ${response.data.result.message_id}`);
      return response.data.result;
    } else {
      log(`Ошибка при отправке: ${JSON.stringify(response.data)}`);
      return null;
    }
  } catch (error) {
    log(`Ошибка при отправке: ${error.message}`);
    if (error.response) {
      log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    return null;
  }
}

// Проверка обработки HTML нашим сервером
async function runTests() {
  const tests = [
    {
      name: 'Простое форматирование',
      text: 'Привет! <b>Жирный текст</b>, <i>курсив</i>, <u>подчеркнутый</u> и <s>зачеркнутый</s>.'
    },
    {
      name: 'HTML-теги разных типов',
      text: '<b>Жирный <i>и курсив</i></b> <u>и подчеркнутый <s>и зачеркнутый</s></u>'
    },
    {
      name: 'Ссылки',
      text: 'Перейдите на <a href="https://t.me">Telegram</a> для получения информации.'
    },
    {
      name: 'Блочные элементы',
      text: '<p>Параграф</p><div>Блок</div><h1>Заголовок</h1>'
    },
    {
      name: 'Альтернативные теги',
      text: '<strong>Жирный</strong>, <em>курсив</em>, <ins>подчеркнутый</ins>, <del>зачеркнутый</del>'
    }
  ];

  log(`Запуск ${tests.length} тестов форматирования через сервер...`);

  for (const test of tests) {
    log(`\nТест: ${test.name}`);
    
    // Получаем отформатированный текст через сервер
    const formattedText = await formatUsingServer(test.text);
    
    if (formattedText) {
      // Отправляем отформатированный текст в Telegram
      await sendFormattedMessage(formattedText);
    }
    
    // Пауза между тестами
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  log('Все тесты завершены!');
}

// Запускаем тесты
runTests().catch(error => {
  log(`Ошибка в основном коде: ${error}`);
});
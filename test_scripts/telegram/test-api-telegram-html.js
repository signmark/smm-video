/**
 * Автоматический тест для проверки HTML форматирования в Telegram
 * Тест использует внутренний API приложения и авторизуется через существующие маршруты
 * 
 * Запуск: node test-api-telegram-html.js
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

// Настройки тестирования
const CONFIG = {
  apiUrl: 'http://localhost:5000',
  // Учетные данные для авторизации
  credentials: {
    email: 'lbrspb@gmail.com',
    password: 'admin'
  },
  
  // Маршруты API
  apiRoutes: {
    login: '/api/auth/login',
    formatHtml: '/api/test/format-client-html',
    telegramHtml: '/api/test/telegram-html',
    telegramEmojiHtml: '/api/test/telegram-emoji-html'
  },
  
  // ID кампании с настройками Telegram
  campaignId: '46868c44-c6a4-4bed-accf-9ad07bba790e'
};

// Тестовые случаи с различными HTML-конструкциями
const TEST_CASES = [
  {
    name: '1. Базовые HTML-теги',
    html: '<p>Текст с <b>жирным</b>, <i>курсивом</i> и <u>подчеркнутым</u> форматированием</p>'
  },
  {
    name: '2. Альтернативные HTML-теги',
    html: '<p>Текст с <strong>жирным через strong</strong>, <em>курсивом через em</em> и <del>зачеркнутым</del> текстом</p>'
  },
  {
    name: '3. Вложенные теги',
    html: '<p>Вложенные <b>жирные <i>и курсивные</i></b> теги</p>'
  },
  {
    name: '4. Эмодзи',
    html: '<p>Текст с эмодзи 😀 👍 🎉 и <b>форматированием</b></p>'
  },
  {
    name: '5. Ссылки',
    html: '<p>Текст с <a href="https://example.com">ссылкой на сайт</a></p>'
  },
  {
    name: '6. Незакрытые теги',
    html: '<p>Текст с <b>незакрытым тегом и <i>вложенным форматированием</p>'
  },
  {
    name: '7. Заголовки и списки',
    html: '<h2>Заголовок</h2><ul><li>Первый пункт</li><li>Второй пункт</li><li>Третий пункт</li></ul>'
  },
  {
    name: '8. Блочные элементы',
    html: '<p>Первый абзац</p><p>Второй абзац</p><p>Третий абзац с <b>форматированием</b></p>'
  },
  {
    name: '9. Длинный текст',
    html: '<p>Первый параграф обычного текста.</p><p>Второй параграф с <b>жирным</b> и <i>курсивным</i> текстом. А также с эмодзи 🎉</p><p>Третий параграф с <a href="https://example.com">ссылкой</a> и дополнительным текстом для проверки обработки длинных сообщений в Telegram. Нам важно, чтобы форматирование сохранялось даже в длинных сообщениях с большим количеством текста.</p>'
  },
  {
    name: '10. Смешанный HTML',
    html: '<h1>Заголовок документа</h1><p>Параграф с <b>жирным текстом</b> и <i>курсивом</i>.</p><ul><li><b>Важный</b> пункт списка</li><li>Обычный пункт списка</li></ul><p>Еще один параграф с <a href="https://example.com">ссылкой</a> и эмодзи 👍</p>'
  }
];

/**
 * HTTP клиент с настроенными заголовками для авторизации
 */
const apiClient = axios.create({
  baseURL: CONFIG.apiUrl,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
});

/**
 * Авторизуется в системе и возвращает токен
 * @returns {Promise<string>} Токен авторизации
 */
async function login() {
  try {
    console.log(`🔑 Авторизация пользователя: ${CONFIG.credentials.email}`);
    const response = await apiClient.post(CONFIG.apiRoutes.login, {
      email: CONFIG.credentials.email,
      password: CONFIG.credentials.password
    });
    
    if (response.data.success) {
      console.log(`✅ Авторизация успешна, получен токен`);
      // Устанавливаем токен авторизации для всех последующих запросов
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${response.data.token}`;
      return response.data.token;
    } else {
      throw new Error(response.data.error || 'Ошибка авторизации');
    }
  } catch (error) {
    console.error(`❌ Ошибка авторизации: ${error.message}`);
    throw error;
  }
}

/**
 * Проверяет форматирование HTML через API endpoint format-client-html
 * @param {string} html HTML для форматирования
 * @returns {Promise<object>} Результаты форматирования
 */
async function testFormatHtml(html) {
  try {
    console.log(`🔄 Проверка форматирования HTML через API`);
    const response = await apiClient.post(CONFIG.apiRoutes.formatHtml, { html });
    return response.data;
  } catch (error) {
    console.error(`❌ Ошибка форматирования HTML: ${error.message}`);
    throw error;
  }
}

/**
 * Отправляет тестовое сообщение с HTML форматированием в Telegram
 * @param {string} text Текст с HTML разметкой
 * @returns {Promise<object>} Результат отправки
 */
async function testTelegramHtmlFormat(text) {
  try {
    console.log(`📤 Отправка HTML в Telegram через API`);
    
    // Добавляем уникальный идентификатор к сообщению для отслеживания
    const testId = uuidv4().substring(0, 8);
    const htmlWithId = `${text}\n\n[Test ID: ${testId}]`;
    
    // Используем endpoint для отправки HTML и эмодзи в Telegram
    const response = await apiClient.post(CONFIG.apiRoutes.telegramEmojiHtml, {
      text: htmlWithId,
      campaignId: CONFIG.campaignId
    });
    
    return {
      ...response.data,
      testId,
      original: text
    };
  } catch (error) {
    console.error(`❌ Ошибка отправки HTML в Telegram: ${error.message}`);
    console.error(error.response?.data || error);
    throw error;
  }
}

/**
 * Задержка на указанное количество миллисекунд
 * @param {number} ms Количество миллисекунд
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Запускает все тесты
 */
async function runAllTests() {
  console.log('🚀 Запуск тестирования HTML форматирования для Telegram через API приложения');
  console.log(`📋 Всего тестовых случаев: ${TEST_CASES.length}`);
  console.log('───────────────────────────────────────────────');
  
  // Сначала авторизуемся в системе
  try {
    await login();
  } catch (error) {
    console.error(`❌ Не удалось авторизоваться, тестирование прервано: ${error.message}`);
    return;
  }
  
  // Результаты всех тестов
  const results = [];
  
  // Запускаем тесты по очереди
  for (let i = 0; i < TEST_CASES.length; i++) {
    const testCase = TEST_CASES[i];
    console.log(`\n⏳ Тест ${i + 1}/${TEST_CASES.length}: ${testCase.name}`);
    
    try {
      // 1. Проверка форматирования HTML
      const formatResult = await testFormatHtml(testCase.html);
      console.log(`   ✅ HTML отформатирован для Telegram`);
      
      // 2. Отправка форматированного HTML в Telegram
      const sendResult = await testTelegramHtmlFormat(testCase.html);
      
      // 3. Анализ результатов
      if (sendResult.success) {
        console.log(`   ✅ Сообщение успешно отправлено в Telegram`);
        if (sendResult.message_url) {
          console.log(`   🔗 URL сообщения: ${sendResult.message_url}`);
        }
        
        results.push({
          testCase: testCase.name,
          html: testCase.html,
          success: true,
          messageId: sendResult.message_id,
          messageUrl: sendResult.message_url,
          formattedText: sendResult.formatted_text,
          originalText: sendResult.original_text,
          timestamp: new Date().toISOString(),
          testId: sendResult.testId
        });
      } else {
        console.log(`   ❌ Ошибка при отправке сообщения: ${sendResult.error || 'Неизвестная ошибка'}`);
        
        results.push({
          testCase: testCase.name,
          html: testCase.html,
          success: false,
          error: sendResult.error || 'Неизвестная ошибка',
          timestamp: new Date().toISOString(),
          testId: sendResult.testId
        });
      }
    } catch (error) {
      console.error(`   ❌ Исключение при тестировании: ${error.message}`);
      
      results.push({
        testCase: testCase.name,
        html: testCase.html,
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
    
    // Пауза между тестами, чтобы не перегружать API
    if (i < TEST_CASES.length - 1) {
      console.log(`   ⏱️ Пауза перед следующим тестом...`);
      await sleep(2000);
    }
  }
  
  // Выводим итоговые результаты
  const successCount = results.filter(r => r.success).length;
  console.log(`\n📈 Итоговые результаты тестирования:`);
  console.log(`   Всего тестов: ${results.length}`);
  console.log(`   Успешных: ${successCount}`);
  console.log(`   Неудачных: ${results.length - successCount}`);
  
  // Выводим результаты по каждому тесту
  console.log('\n🔍 Результаты по каждому тесту:');
  results.forEach((result, index) => {
    console.log(`   ${index + 1}. ${result.testCase}: ${result.success ? '✅ УСПЕХ' : '❌ ОШИБКА'}`);
    if (!result.success) {
      console.log(`      Причина: ${result.error}`);
    }
    if (result.messageUrl) {
      console.log(`      URL: ${result.messageUrl}`);
    }
  });
}

// Запускаем тесты
runAllTests().catch(error => {
  console.error('❌ Критическая ошибка при выполнении тестов:', error);
});
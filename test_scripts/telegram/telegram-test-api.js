/**
 * Тест прямого API для отправки HTML-сообщений в Telegram
 * 
 * Скрипт не требует авторизации, использует только тестовый маршрут
 * /api/test/telegram-post, который позволяет напрямую передать token и chatId,
 * что значительно упрощает тестирование.
 * 
 * Запуск: node telegram-test-api.js
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

// Настройки для тестирования - использует прямые токены без авторизации
const CONFIG = {
  // URL API
  apiUrl: 'http://localhost:5000',
  // Проверенные настройки Telegram
  telegram: {
    token: 'REVOKED_TELEGRAM_TOKEN_USE_ENV',
    chatId: '-1002302366310'
  },
  // Задержка между запросами (мс)
  requestDelay: 2000
};

// Тестовые случаи с различными HTML конструкциями
const TEST_CASES = [
  {
    name: '1. Базовые HTML-теги',
    html: '<p>Базовый текст с <b>жирным</b>, <i>курсивом</i> и <u>подчеркнутым</u> форматированием</p>'
  },
  {
    name: '2. Альтернативные HTML-теги',
    html: '<p>Текст с <strong>жирным через strong</strong>, <em>курсивом через em</em> и <del>зачеркиванием</del></p>'
  },
  {
    name: '3. Вложенные теги',
    html: '<p>Текст с <b>вложенным <i>форматированием</i> разных</b> <u>типов</u></p>'
  },
  {
    name: '4. Эмодзи в HTML',
    html: '<p>Текст с эмодзи 😀 👍 🎉 и <b>форматированием</b></p>'
  },
  {
    name: '5. Незакрытые теги',
    html: '<p>Текст с <b>незакрытым тегом и <i>вложенным форматированием</p>'
  },
  {
    name: '6. Длинный текст',
    html: '<p>Первый параграф текста.</p><p>Второй параграф с <b>жирным</b> и <i>курсивным</i> форматированием.</p><p>Третий параграф с <a href="https://example.com">ссылкой</a> и более длинным текстом для проверки обработки многострочных сообщений, их правильной обработки и форматирования в Telegram.</p>'
  }
];

/**
 * Задержка выполнения на указанное количество миллисекунд
 * @param {number} ms Количество миллисекунд для ожидания
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Тестирует отправку HTML-сообщения в Telegram через API
 * @param {object} testCase Объект с тестовым случаем
 * @returns {Promise<object>} Результат теста
 */
async function testHtmlFormatting(testCase) {
  try {
    // Добавляем уникальный идентификатор для отслеживания
    const testId = uuidv4().substring(0, 8);
    const html = `${testCase.html}\n\n[Test ID: ${testId}]`;
    
    console.log(`\n🔄 Тестирование: ${testCase.name}`);
    console.log(`   📝 HTML: ${html.substring(0, 50)}${html.length > 50 ? '...' : ''}`);
    
    // Используем маршрут telegram-post, который позволяет напрямую передать token и chatId
    const response = await axios.post(`${CONFIG.apiUrl}/api/test/telegram-post`, {
      text: html,
      token: CONFIG.telegram.token,
      chatId: CONFIG.telegram.chatId
    });
    
    const result = response.data;
    
    if (result.success) {
      console.log(`   ✅ УСПЕХ: Сообщение успешно отправлено в Telegram`);
      if (result.postUrl) {
        console.log(`   🔗 URL: ${result.postUrl}`);
      }
      
      return {
        testCase: testCase.name,
        html: testCase.html,
        success: true,
        messageId: result.messageId,
        postUrl: result.postUrl,
        timestamp: new Date().toISOString(),
        testId
      };
    } else {
      console.log(`   ❌ ОШИБКА: ${result.error || 'Неизвестная ошибка'}`);
      
      return {
        testCase: testCase.name,
        html: testCase.html,
        success: false,
        error: result.error || 'Неизвестная ошибка',
        timestamp: new Date().toISOString(),
        testId
      };
    }
  } catch (error) {
    console.error(`   ❌ ИСКЛЮЧЕНИЕ: ${error.message}`);
    console.error(error.response?.data || error);
    
    return {
      testCase: testCase.name,
      html: testCase.html,
      success: false,
      error: error.message,
      details: error.response?.data,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Запускает все тесты и сохраняет результаты
 */
async function runAllTests() {
  console.log('🚀 Запуск автоматического тестирования HTML форматирования в Telegram');
  console.log(`📋 Всего тестовых случаев: ${TEST_CASES.length}`);
  console.log('───────────────────────────────────────────────');
  
  const results = [];
  
  for (let i = 0; i < TEST_CASES.length; i++) {
    const testCase = TEST_CASES[i];
    console.log(`\n⏳ Тест ${i + 1}/${TEST_CASES.length}: ${testCase.name}`);
    
    // Выполняем тест
    const result = await testHtmlFormatting(testCase);
    results.push(result);
    
    // Добавляем задержку между запросами, чтобы не перегружать API
    if (i < TEST_CASES.length - 1) {
      console.log(`   ⏱️ Ожидание перед следующим тестом...`);
      await sleep(CONFIG.requestDelay);
    }
  }
  
  // Выводим итоговую статистику
  const successCount = results.filter(r => r.success).length;
  console.log(`\n📈 Итоговые результаты:`);
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
    if (result.postUrl) {
      console.log(`      URL: ${result.postUrl}`);
    }
  });
}

// Запускаем тесты
runAllTests().catch(error => {
  console.error('❌ Критическая ошибка при выполнении тестов:', error);
});
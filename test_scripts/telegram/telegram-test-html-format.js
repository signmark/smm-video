/**
 * Автоматический тест форматирования HTML в Telegram 
 * Напрямую использует маршрут /api/test/telegram-emoji-html
 * 
 * Запуск: node telegram-test-html-format.js
 */

import axios from 'axios';
import { promises as fs } from 'fs';
import { v4 as uuidv4 } from 'uuid';

// Настройки теста
const CONFIG = {
  apiUrl: 'http://localhost:5000',
  campaignId: '46868c44-c6a4-4bed-accf-9ad07bba790e', // ID кампании с настройками Telegram
  resultsFile: './telegram-test-results.json',
  requestDelay: 1000 // Задержка между запросами (мс)
};

// Тестовые случаи с разными HTML-конструкциями
const TEST_CASES = [
  {
    name: '1. Базовые HTML-теги',
    html: '<p>Обычный текст с <b>жирным</b>, <i>курсивом</i> и <u>подчеркнутым</u> форматированием</p>'
  },
  {
    name: '2. Альтернативные HTML-теги',
    html: '<p>Текст с <strong>жирным</strong>, <em>курсивом</em>, <ins>подчеркнутым</ins> и <del>зачеркнутым</del> форматированием</p>'
  },
  {
    name: '3. Вложенные теги',
    html: '<p>Вложенные <b>жирные <i>и курсивные</i></b> теги</p>'
  },
  {
    name: '4. Эмодзи в тексте',
    html: '<p>Текст с эмодзи 😀 👍 🎉 и <b>форматированием</b></p>'
  },
  {
    name: '5. Списки',
    html: '<ul><li>Первый пункт</li><li>Второй пункт</li><li>Третий пункт</li></ul>'
  },
  {
    name: '6. Заголовки',
    html: '<h1>Заголовок 1</h1><h2>Заголовок 2</h2><h3>Заголовок 3</h3>'
  },
  {
    name: '7. Ссылки',
    html: '<p>Текст с <a href="https://example.com">ссылкой</a></p>'
  },
  {
    name: '8. Незакрытые теги',
    html: '<p>Текст с <b>незакрытым тегом и <i>вложенными тегами</p>'
  },
  {
    name: '9. Длинный текст',
    html: '<p>Первый параграф текста</p><p>Второй параграф с <b>жирным</b> и <i>курсивным</i> форматированием и эмодзи 🎉</p><p>Третий параграф с <a href="https://example.com">ссылкой</a> и дополнительным текстом для увеличения длины сообщения, чтобы проверить обработку длинных текстов.</p>'
  },
  {
    name: '10. Блоки кода',
    html: '<p>Пример кода: <code>console.log("Hello world");</code></p><pre>function test() {\n  return true;\n}</pre>'
  }
];

/**
 * Задержка на указанное количество миллисекунд
 * @param {number} ms Миллисекунды
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Тестирует HTML форматирование, отправляя сообщение через API в Telegram
 * @param {object} testCase Объект с тестовым случаем
 * @returns {Promise<object>} Результат теста
 */
async function testHtmlFormatting(testCase) {
  try {
    // Добавляем уникальный идентификатор к каждому тесту для отслеживания
    const testId = uuidv4().substring(0, 8);
    const html = `${testCase.html}\n\n[Test ID: ${testId}]`;
    
    console.log(`\n🔄 Выполняется тест: ${testCase.name}`);
    console.log(`   📝 HTML: ${html.substring(0, 50)}${html.length > 50 ? '...' : ''}`);
    
    // Отправляем запрос через наш API маршрут для тестирования
    const response = await axios.post(`${CONFIG.apiUrl}/api/test/telegram-emoji-html`, {
      text: html,
      campaignId: CONFIG.campaignId
    });
    
    // Проверяем результат
    if (response.data.success) {
      console.log(`   ✅ УСПЕХ: Сообщение успешно отправлено в Telegram`);
      if (response.data.message_url) {
        console.log(`   🔗 URL: ${response.data.message_url}`);
      }
      
      return {
        testCase: testCase.name,
        html: html,
        success: true,
        messageId: response.data.message_id,
        messageUrl: response.data.message_url,
        formattedText: response.data.formatted_text,
        originalText: response.data.original_text,
        timestamp: new Date().toISOString(),
        testId
      };
    } else {
      console.log(`   ❌ ОШИБКА: ${response.data.error || 'Неизвестная ошибка'}`);
      
      return {
        testCase: testCase.name,
        html: html,
        success: false,
        error: response.data.error || 'Неизвестная ошибка',
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
      console.log(`   ⏱️ Пауза перед следующим тестом...`);
      await sleep(CONFIG.requestDelay);
    }
  }
  
  // Сохраняем результаты в файл
  await fs.writeFile(CONFIG.resultsFile, JSON.stringify(results, null, 2));
  console.log(`\n📊 Результаты сохранены в файл: ${CONFIG.resultsFile}`);
  
  // Выводим итоговую статистику
  const successCount = results.filter(r => r.success).length;
  console.log(`\n📈 Итоговая статистика:`);
  console.log(`   Всего тестов: ${results.length}`);
  console.log(`   Успешных: ${successCount}`);
  console.log(`   Неудачных: ${results.length - successCount}`);
  
  // Выводим краткие результаты по каждому тесту
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
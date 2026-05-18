/**
 * Автоматический тест для проверки HTML-форматирования в Telegram
 * Скрипт отправляет различные HTML-конструкции в Telegram и проверяет корректность форматирования
 * Запуск: node telegram-html-autotest.js
 */

const axios = require('axios');
const fs = require('fs/promises');

// Настройки теста
const config = {
  // API URL приложения
  apiUrl: 'http://localhost:5000',
  // ID кампании для тестирования (с настроенным подключением к Telegram)
  campaignId: '46868c44-c6a4-4bed-accf-9ad07bba790e',
  // Путь к файлу с результатами
  resultPath: './telegram-html-test-results.json',
  // Маршруты API для тестирования
  endpoints: {
    formatClientHtml: '/api/test/format-client-html',
    telegramEmojiHtml: '/api/test/telegram-emoji-html'
  }
};

// Тестовые случаи для различных HTML-конструкций
const testCases = [
  {
    name: 'Базовые HTML-теги',
    html: '<p>Параграф с <b>жирным текстом</b>, <i>курсивом</i> и <u>подчеркиванием</u>.</p>'
  },
  {
    name: 'Эквивалентные HTML-теги',
    html: '<p>Текст с <strong>жирным через strong</strong>, <em>курсивом через em</em>, <ins>подчеркиванием через ins</ins> и <del>зачеркиванием через del</del>.</p>'
  },
  {
    name: 'Вложенные теги',
    html: '<p>Текст с <b>жирным <i>и курсивным</i></b> форматированием.</p>'
  },
  {
    name: 'HTML-списки',
    html: '<ul><li>Первый пункт</li><li>Второй пункт</li><li>Третий пункт</li></ul>'
  },
  {
    name: 'Заголовки',
    html: '<h1>Заголовок первого уровня</h1><h2>Заголовок второго уровня</h2><h3>Заголовок третьего уровня</h3>'
  },
  {
    name: 'Ссылки',
    html: '<p>Текст со <a href="https://example.com">ссылкой на сайт</a>.</p>'
  },
  {
    name: 'Незакрытые теги',
    html: '<p>Текст с <b>жирным <i>и курсивным форматированием без закрытия b-тега.</p>'
  },
  {
    name: 'Эмодзи',
    html: '<p>Текст с эмодзи 😀 👍 🎉</p>'
  },
  {
    name: 'Комбинированный текст с HTML и эмодзи',
    html: '<p>Тестовое сообщение с <b>жирным текстом</b>, <i>курсивом</i>, эмодзи 🎉 и <a href="https://example.com">ссылкой</a>.</p>'
  },
  {
    name: 'Текст с переносами строк',
    html: '<p>Первый параграф</p><p>Второй параграф</p><p>Третий параграф</p>'
  }
];

/**
 * Форматирует текст на стороне клиента через API
 * @param {string} html HTML для форматирования
 * @returns {Promise<Object>} Результат форматирования
 */
async function formatClientHtml(html) {
  try {
    const response = await axios.post(`${config.apiUrl}${config.endpoints.formatClientHtml}`, { html });
    return response.data;
  } catch (error) {
    console.error(`Ошибка при форматировании HTML: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Отправляет текст в Telegram через API
 * @param {string} text Текст для отправки
 * @returns {Promise<Object>} Результат отправки
 */
async function sendToTelegram(text) {
  try {
    const response = await axios.post(`${config.apiUrl}${config.endpoints.telegramEmojiHtml}`, {
      text,
      campaignId: config.campaignId
    });
    return response.data;
  } catch (error) {
    console.error(`Ошибка при отправке в Telegram: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Запускает все тесты и сохраняет результаты
 */
async function runAllTests() {
  console.log('🚀 Запуск автоматического тестирования HTML-форматирования для Telegram');
  console.log(`📋 Всего тестовых случаев: ${testCases.length}`);
  console.log('───────────────────────────────────────────────');

  const results = [];
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`⏳ [${i + 1}/${testCases.length}] Тестирование: ${testCase.name}`);
    
    // 1. Форматируем текст через клиентский API
    console.log(`   🔄 Форматирование HTML...`);
    const formatResult = await formatClientHtml(testCase.html);
    
    // 2. Отправляем форматированный текст в Telegram через API
    console.log(`   📤 Отправка в Telegram...`);
    let sendResult;
    
    if (formatResult.success) {
      sendResult = await sendToTelegram(testCase.html);
    } else {
      sendResult = {
        success: false,
        error: 'Не удалось отформатировать HTML'
      };
    }
    
    // 3. Формируем результат для данного тестового случая
    const testResult = {
      testCase: testCase.name,
      originalHtml: testCase.html,
      formatResult,
      sendResult,
      status: sendResult.success ? 'SUCCESS' : 'FAILED',
      timestamp: new Date().toISOString()
    };
    
    results.push(testResult);
    
    // 4. Выводим результаты теста
    console.log(`   ${sendResult.success ? '✅ УСПЕХ' : '❌ ОШИБКА'}: ${sendResult.success ? 'Сообщение отправлено' : sendResult.error}`);
    if (sendResult.success && sendResult.message_url) {
      console.log(`   🔗 URL сообщения: ${sendResult.message_url}`);
    }
    console.log('───────────────────────────────────────────────');
  }
  
  // Сохраняем результаты тестов в файл
  await fs.writeFile(config.resultPath, JSON.stringify(results, null, 2));
  console.log(`📊 Результаты тестирования сохранены в файл: ${config.resultPath}`);
  
  // Выводим общую статистику
  const successCount = results.filter(r => r.status === 'SUCCESS').length;
  console.log(`📈 Всего тестов: ${results.length}, Успешных: ${successCount}, Неудачных: ${results.length - successCount}`);
}

// Запускаем тесты
runAllTests().catch(error => {
  console.error('❌ Ошибка при выполнении тестов:', error);
});
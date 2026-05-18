/**
 * Тестовый скрипт для проверки HTML-форматирования в Telegram сообщениях
 * Проверяет корректность отображения различных HTML-тегов
 * 
 * Этот скрипт использует прямое API для отправки сообщений, не полагаясь
 * на настройки кампании из Directus
 */

const axios = require('axios');

// Конфигурация для тестирования
const CONFIG = {
  apiUrl: 'http://localhost:5000',
  campaignId: '46868c44-c6a4-4bed-accf-9ad07bba790e', // ID тестовой кампании
  telegram: {
    token: '7529101043:AAG298h0iubyeKPuZ-WRtEFbNEnEyqy_XJU',
    chatId: '-1002302366310'
  }
};

// Функция для задержки выполнения
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Тестирует отправку HTML-сообщения в Telegram
 */
async function testHtmlFormatting() {
  console.log('🚀 Запуск тестов для HTML-форматирования в Telegram\n');
  
  // Массив тестовых случаев с разными HTML-конструкциями
  const testCases = [
    {
      title: "Простой текст с базовыми тегами",
      html: "<p>Текст с <b>жирным шрифтом</b> и <i>курсивом</i>.</p><p>Новый параграф с <u>подчеркнутым</u> текстом.</p>",
      testId: "test-basic-" + Date.now().toString().slice(-5)
    },
    {
      title: "Списки и заголовки",
      html: "<h2>Заголовок</h2><ul><li>Первый пункт</li><li>Второй <b>жирный</b> пункт</li></ul><p>Текст после списка</p>",
      testId: "test-lists-" + Date.now().toString().slice(-5)
    },
    {
      title: "Вложенные теги и эмодзи",
      html: "<p>Текст с <b>жирным и <i>вложенным курсивом</i></b> и эмодзи 🎉 🚀 ✨</p>",
      testId: "test-nested-" + Date.now().toString().slice(-5)
    },
    {
      title: "Незакрытые теги (должны быть исправлены)",
      html: "<p>Текст с <b>незакрытым жирным тегом и <i>вложенным курсивом</p><p>Новый параграф</p>",
      testId: "test-unclosed-" + Date.now().toString().slice(-5)
    }
  ];

  // Последовательно выполняем тесты
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`\n⏳ Тест ${i+1}/${testCases.length}: ${testCase.title}`);
    
    try {
      // Добавляем идентификатор теста для отслеживания в Telegram
      const htmlWithTestId = `${testCase.html}\n\n[Test ID: ${testCase.testId}]`;
      
      // Отправляем запрос через прямой маршрут API
      console.log(`📤 Отправка запроса через POST /api/test/telegram-post`);
      console.log(`📝 HTML: ${htmlWithTestId.slice(0, 60)}${htmlWithTestId.length > 60 ? '...' : ''}`);
      
      const response = await axios.post(`${CONFIG.apiUrl}/api/test/telegram-post`, {
        text: htmlWithTestId,
        token: CONFIG.telegram.token,
        chatId: CONFIG.telegram.chatId
      });
      
      // Проверяем успешность отправки
      if (response.data.success) {
        console.log(`✅ УСПЕХ: Сообщение успешно отправлено в Telegram`);
        console.log(`🔗 URL: ${response.data.postUrl || 'Не получен'}`);
      } else {
        console.log(`❌ ОШИБКА: ${response.data.error || 'Неизвестная ошибка'}`);
      }
    } catch (error) {
      console.error(`❌ ИСКЛЮЧЕНИЕ: ${error.message}`);
      if (error.response) {
        console.error(error.response.data);
      }
    }
    
    // Пауза между тестами, чтобы избежать ограничений API
    if (i < testCases.length - 1) {
      console.log('⏱️ Пауза перед следующим тестом...');
      await sleep(3000);
    }
  }
  
  console.log('\n✅ Все тесты завершены!');
}

// Запускаем тесты
testHtmlFormatting().catch(err => {
  console.error('❌ Ошибка выполнения тестов:', err.message);
});
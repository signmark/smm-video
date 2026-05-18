/**
 * Тест публикации HTML-форматированного текста в Telegram
 * Использует тестовый API-маршрут с настройками из кампании
 * 
 * Запуск: node test-html-publish.cjs
 */

const axios = require('axios');
require('dotenv').config();

// ID кампании с настройками
const CAMPAIGN_ID = "46868c44-c6a4-4bed-accf-9ad07bba790e";

// Примеры форматированного текста для тестирования
const testCases = [
  {
    name: "Полное оформление по скриншоту",
    text: "<b>Подсознание наизнанку</b>\n\n<b>Жирный текст</b>\n<i>Курсивный текст</i>\n<u>Подчеркнутый текст</u>\n<s>Зачеркнутый текст</s>\n<code>Моноширинный текст для кода</code>\n<a href='https://example.com'>Ссылка на сайт</a>\n\nКомбинированное форматирование:\n<b><i>Жирный курсив</i></b>\n<b><u>Жирный подчеркнутый</u></b>\n<i><s>Курсивный зачеркнутый</s></i>"
  }
];

/**
 * Выполняет проверку форматирования HTML в Telegram
 * @param {string} text Текст для отправки 
 * @returns {Promise<object>} Результат публикации
 */
async function testHtmlFormatting(text) {
  try {
    console.log("Отправка запроса на публикацию...");
    
    // Отправляем запрос к тестовому API с использованием настроек кампании
    const response = await axios.post('http://localhost:5000/api/test/telegram-html', {
      text,
      campaignId: CAMPAIGN_ID
    });
    
    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    console.error(`Ошибка при тестировании: ${error.message}`);
    if (error.response) {
      console.error(`Статус: ${error.response.status}`);
      console.error(`Данные: ${JSON.stringify(error.response.data)}`);
    }
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Запускает все тесты
 */
async function runAllTests() {
  console.log("=== ТЕСТИРОВАНИЕ HTML-ФОРМАТИРОВАНИЯ В TELEGRAM ===\n");
  
  let successful = 0;
  let failed = 0;
  
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`\n[ТЕСТ ${i+1}] ${testCase.name}`);
    
    // Краткий показ текста для отладки
    console.log(`Текст: ${testCase.text.substring(0, 100)}...`);
    
    // Запускаем тест
    const result = await testHtmlFormatting(testCase.text);
    
    if (result.success) {
      console.log(`✅ ТЕСТ ${i+1} УСПЕШЕН!`);
      if (result.data?.postUrl) {
        console.log(`🔗 URL сообщения: ${result.data.postUrl}`);
      }
      successful++;
    } else {
      console.log(`❌ ТЕСТ ${i+1} ПРОВАЛЕН: ${result.error}`);
      failed++;
    }
    
    // Пауза между тестами
    if (i < testCases.length - 1) {
      console.log("⏳ Пауза 2 секунды перед следующим тестом...");
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log("\n=== РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ ===");
  console.log(`✅ Успешно: ${successful}`);
  console.log(`❌ Провалено: ${failed}`);
  console.log(`📋 Всего тестов: ${testCases.length}`);
}

// Выполняем тестирование
console.log("Запуск тестов форматирования HTML в Telegram");
runAllTests().catch(error => {
  console.error("Критическая ошибка при выполнении тестов:", error);
});
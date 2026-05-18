/**
 * Тестовый скрипт для проверки форматирования HTML через API
 * Запустите: node test-format-api.js
 */

const axios = require('axios');

// Порт, на котором запущен сервер
const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}/api/test`;

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
    name: 'Незакрытые теги',
    html: '<b>Этот тег должен быть закрыт <i>А этот вложенный тоже'
  },
  {
    name: 'Блочные элементы',
    html: '<div>Блочный элемент</div><p>Параграф, который должен быть обработан</p>'
  },
  {
    name: 'Неподдерживаемые теги',
    html: '<h1>Заголовок</h1><span>Спан</span><ul><li>Список</li></ul>'
  },
  {
    name: 'Комбинированный текст',
    html: '<b>Важное объявление!</b>\n\n<p>Мы рады сообщить о <i>новом</i> продукте.</p>\n\nПосетите наш <a href="https://example.com">сайт</a> для более подробной информации.'
  }
];

/**
 * Форматирует текст через API
 * @param {string} text HTML-текст для форматирования
 * @returns {Promise<Object>} Результат форматирования
 */
async function formatTextThroughApi(text) {
  try {
    const response = await axios.post(`${BASE_URL}/format-telegram`, {
      text
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
  console.log('\n=== ТЕСТ ФОРМАТИРОВАНИЯ HTML ЧЕРЕЗ API ===\n');
  
  for (let i = 0; i < TEST_CASES.length; i++) {
    const testCase = TEST_CASES[i];
    console.log(`\n--- Тест #${i + 1}: ${testCase.name} ---`);
    console.log(`Исходный HTML: ${testCase.html}`);
    
    try {
      const result = await formatTextThroughApi(testCase.html);
      
      if (result.success) {
        console.log(`\nОтформатированный текст: ${result.formattedText}`);
        console.log(`Содержит HTML: ${result.containsHtml ? 'Да' : 'Нет'}`);
      } else {
        console.log(`\nОшибка: ${result.error}`);
      }
    } catch (error) {
      console.error(`\nНеожиданная ошибка: ${error.message}`);
    }
    
    console.log('\n' + '-'.repeat(50));
  }
  
  console.log('\n=== ТЕСТЫ ЗАВЕРШЕНЫ ===\n');
}

// Запускаем тесты
runTests().catch(console.error);
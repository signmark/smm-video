/**
 * Тестирование функции исправления незакрытых HTML-тегов
 * Тест использует API-эндпоинт /api/test/fix-html-tags
 * 
 * Запуск: node test-html-tags-fixing.js
 */

import axios from 'axios';

// Базовый URL для API
const API_URL = 'http://0.0.0.0:5000/api/test/fix-html-tags';

// Массив тестовых случаев с незакрытыми тегами
const testCases = [
  {
    name: 'Простой незакрытый тег',
    text: 'Текст с <b>жирным шрифтом, который не закрыт'
  },
  {
    name: 'Несколько незакрытых тегов',
    text: 'Текст с <b>жирным и <i>курсивным шрифтом, которые не закрыты'
  },
  {
    name: 'Вложенные незакрытые теги',
    text: '<b>Жирный <i>курсив <u>подчеркнутый текст'
  },
  {
    name: 'Закрытые и незакрытые теги вперемешку',
    text: '<b>Жирный</b> и <i>курсивный, <u>подчеркнутый</u> и <s>зачеркнутый'
  },
  {
    name: 'Специальный случай с вложенностью',
    text: '<b>Текст с <i>вложенным <b>жирным</i> и потом обычный <u>подчеркнутый'
  },
  {
    name: 'Сложный случай с разными синонимами тегов',
    text: '<strong>Жирный текст через strong и <em>курсив через em и <strike>зачеркнутый текст через strike и <b>обычный жирный <ins>с подчеркиванием'
  },
  {
    name: 'Реальный текст из редактора с тегами',
    text: '<b>Заголовок статьи</b>\n\n<i>Вводный текст с курсивом\n\nОсновной текст статьи с <u>подчеркнутыми терминами и <b>важными моментами, выделенными жирным'
  },
  {
    name: 'Некорректная вложенность тегов',
    text: '<b>Жирный <i>курсивный</b> все еще курсивный?'
  }
];

/**
 * Отправляет запрос к API с текстом, содержащим незакрытые теги
 * @param {string} text Текст с незакрытыми HTML-тегами
 * @returns {Promise<Object>} Ответ API с исправленным текстом
 */
async function testFixHtmlTags(text) {
  try {
    const response = await axios.post(API_URL, { text });
    return response.data;
  } catch (error) {
    console.error(`Ошибка при отправке запроса к API: ${error.message}`);
    if (error.response) {
      console.error(`Статус ошибки: ${error.response.status}`);
      console.error(`Данные ошибки: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

/**
 * Проверяет, все ли HTML-теги корректно закрыты в тексте
 * @param {string} text Текст для проверки
 * @returns {boolean} true если все теги корректно закрыты, иначе false
 */
function areAllTagsClosed(text) {
  const stack = [];
  const regex = /<\/?([a-z][a-z0-9]*)\b[^>]*>|<!--[\s\S]*?-->/gi;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Пропускаем комментарии
    if (match[0].startsWith('<!--')) continue;
    
    // Определяем, открывающий или закрывающий тег
    if (!match[0].startsWith('</')) {
      // Это открывающий тег, добавляем в стек
      const tagName = match[1].toLowerCase();
      
      // Пропускаем самозакрывающиеся теги (например <img />)
      if (!match[0].endsWith('/>')) {
        stack.push(tagName);
      }
    } else {
      // Это закрывающий тег, проверяем соответствие с вершиной стека
      const tagName = match[1].toLowerCase();
      
      // Стек пуст или теги не совпадают
      if (stack.length === 0 || stack[stack.length - 1] !== tagName) {
        return false;
      }
      
      // Удаляем тег из стека, так как он закрыт
      stack.pop();
    }
  }
  
  // Если стек пуст, все теги закрыты
  return stack.length === 0;
}

/**
 * Проверяет результаты исправления тегов
 * @param {Object} result Результат исправления от API
 * @returns {Object} Результаты проверки
 */
function validateResults(result) {
  return {
    originalHasAllClosed: areAllTagsClosed(result.originalText),
    basicFixHasAllClosed: areAllTagsClosed(result.fixedWithBasic),
    aggressiveFixHasAllClosed: areAllTagsClosed(result.fixedWithAggressive),
    preparedHasAllClosed: areAllTagsClosed(result.preparedForTelegram)
  };
}

/**
 * Выводит результаты теста в консоль в удобном формате
 * @param {Object} testCase Тестовый случай
 * @param {Object} result Результат запроса к API
 * @param {Object} validation Результаты валидации
 */
function printTestResults(testCase, result, validation) {
  console.log('\n--------------------------------------------------');
  console.log(`ТЕСТ: ${testCase.name}`);
  console.log('--------------------------------------------------');
  
  console.log('\nИсходный текст:');
  console.log(testCase.text);
  
  console.log('\nПроверка закрытия тегов:');
  console.log(`- Исходный текст: ${validation.originalHasAllClosed ? '✅ Все теги закрыты' : '❌ Есть незакрытые теги'}`);
  console.log(`- Базовое исправление: ${validation.basicFixHasAllClosed ? '✅ Все теги закрыты' : '❌ Есть незакрытые теги'}`);
  console.log(`- Агрессивное исправление: ${validation.aggressiveFixHasAllClosed ? '✅ Все теги закрыты' : '❌ Есть незакрытые теги'}`);
  console.log(`- Подготовлено для Telegram: ${validation.preparedHasAllClosed ? '✅ Все теги закрыты' : '❌ Есть незакрытые теги'}`);
  
  console.log('\nБазовое исправление:');
  console.log(result.fixedWithBasic);
  
  console.log('\nАгрессивное исправление:');
  console.log(result.fixedWithAggressive);
  
  console.log('\nПодготовлено для Telegram:');
  console.log(result.preparedForTelegram);
  
  console.log('\nСравнение длин:');
  console.log(`- Исходный текст: ${result.comparison.originalLength} символов`);
  console.log(`- Базовое исправление: ${result.comparison.basicFixLength} символов`);
  console.log(`- Агрессивное исправление: ${result.comparison.aggressiveFixLength} символов`);
  console.log(`- Подготовлено для Telegram: ${result.comparison.preparedForTelegramLength} символов`);
}

/**
 * Запускает все тесты и выводит результаты
 */
async function runAllTests() {
  console.log('=== НАЧАЛО ТЕСТИРОВАНИЯ ИСПРАВЛЕНИЯ HTML-ТЕГОВ ===\n');
  
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    try {
      console.log(`Тест ${i + 1}/${testCases.length}: ${testCase.name}`);
      
      // Запрашиваем исправление текста
      const result = await testFixHtmlTags(testCase.text);
      
      // Проверяем результаты
      const validation = validateResults(result);
      
      // Выводим результаты
      printTestResults(testCase, result, validation);
      
      // Проверяем успешность теста (агрессивное исправление должно закрывать все теги)
      if (validation.aggressiveFixHasAllClosed) {
        console.log('\n✅ ТЕСТ УСПЕШЕН: Агрессивное исправление закрыло все теги');
        successCount++;
      } else {
        console.log('\n❌ ТЕСТ НЕУДАЧЕН: Агрессивное исправление не закрыло все теги');
        failCount++;
      }
    } catch (error) {
      console.error(`\n❌ ОШИБКА В ТЕСТЕ ${i + 1}: ${error.message}`);
      failCount++;
    }
  }
  
  // Выводим общую статистику
  console.log('\n=== РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ ===');
  console.log(`Всего тестов: ${testCases.length}`);
  console.log(`Успешных: ${successCount} (${Math.round(successCount / testCases.length * 100)}%)`);
  console.log(`Неудачных: ${failCount} (${Math.round(failCount / testCases.length * 100)}%)`);
  console.log('=== ЗАВЕРШЕНИЕ ТЕСТИРОВАНИЯ ===');
}

// Запускаем все тесты
runAllTests();
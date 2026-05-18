/**
 * Тест для проверки обработки сложных случаев вложенных и незакрытых тегов в Telegram
 * Запустите: node test-complex-nested-unclosed-tags.js
 */
import axios from 'axios';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Настройки для тестирования
const API_URL = 'http://localhost:5000/api';
const CAMPAIGN_ID = '46868c44-c6a4-4bed-accf-9ad07bba790e';
const USER_ID = '53921f16-f51d-4591-80b9-8caa4fde4d13';

// Сложные случаи с вложенными и незакрытыми тегами
const TEST_CASES = [
  {
    name: 'Вложенные незакрытые теги с одним закрывающим',
    content: `<b><i><u>Три вложенных незакрытых тега</b>`,
    expected: {
      success: true,
      // Ожидаемый исправленный HTML: "<b><i><u>Три вложенных незакрытых тега</u></i></b>"
    }
  },
  {
    name: 'Закрытие вложенных тегов в неправильном порядке',
    content: `<b><i><u>Теги закрыты в неправильном порядке</b></u></i>`,
    expected: {
      success: true,
      // Должен автоматически исправить порядок закрытия тегов
    }
  },
  {
    name: 'Множественные вложенные незакрытые теги с внутренними закрытыми тегами',
    content: `<b>Внешний тег <i>Средний тег <s>Зачеркнутый закрытый</s> продолжение среднего <u>Подчеркнутый незакрытый`,
    expected: {
      success: true,
      // Ожидаемый результат: все теги должны быть правильно закрыты
    }
  },
  {
    name: 'Комбинация разных типов незакрытых тегов с ссылками',
    content: `<b>Жирный текст с <a href="https://example.com">ссылкой без закрытия <i>и курсивом`,
    expected: {
      success: true,
      // Все теги должны быть правильно закрыты
    }
  },
  {
    name: 'Переплетенные открытые и закрытые теги',
    content: `<b>Первый <i>Второй <u>Третий</b> Остался второй и третий</i> Остался третий</u>`,
    expected: {
      success: true,
      // Сложный случай с переплетением тегов
    }
  },
  {
    name: 'Лишние закрывающие теги без открывающих',
    content: `Текст с лишними закрывающими тегами </b></i></u> продолжение текста`,
    expected: {
      success: true,
      // Лишние закрывающие теги должны быть удалены
    }
  },
  {
    name: 'Вложенные блочные элементы с незакрытыми тегами',
    content: `<div><p><b>Заголовок</b></p>
<p>Параграф с <i>курсивом</p>
<p>Еще параграф с <u>подчеркнутым</div>`,
    expected: {
      success: true,
      // Блочные элементы должны быть преобразованы, а теги закрыты
    }
  },
  {
    name: 'Сложные многоуровневые вложения с разными типами тегов',
    content: `<h1>Заголовок <b>с важной <i>и выделенной <s>но ненужной</s></i> информацией</h1>
<p>А тут <u>подчеркнутый <b>и жирный <a href="https://test.com">со ссылкой</p>
<div>И еще блок <i>с курсивом <u>и подчеркнутым текстом`,
    expected: {
      success: true,
      // Очень сложный случай с множеством вложенных незакрытых тегов
    }
  },
  {
    name: 'Незакрытые теги с разрывами строк и дополнительными атрибутами',
    content: `<p><b style="color:red">Текст с атрибутами</b>
<i class="special">Тег с классом
<u id="unique">Тег с ID
<a href="https://example.com" target="_blank">Ссылка с атрибутами`,
    expected: {
      success: true,
      // Теги с атрибутами должны быть корректно обработаны
    }
  }
];

/**
 * Вывод сообщения в консоль с отметкой времени
 * @param {string} message Сообщение для вывода
 */
function log(message) {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.log(`[${timestamp}] ${message}`);
}

/**
 * Отправляет контент на публикацию через API
 * @param {object} testCase Тестовый случай
 * @returns {Promise<object>} Результат публикации
 */
async function publishContent(testCase) {
  try {
    // Формируем объект для публикации
    const publishRequest = {
      content: {
        id: `test-complex-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        title: `Тест сложных тегов: ${testCase.name}`,
        content: testCase.content,
        contentType: 'html',
        status: 'ready',
        userId: USER_ID,
        campaignId: CAMPAIGN_ID,
        socialPlatforms: ['telegram'],
        createdAt: new Date(),
        hashtags: [],
        links: []
      },
      userId: USER_ID,
      force: true,
      platforms: ['telegram']
    };

    // Отправляем запрос
    log(`Отправка сложного теста: "${testCase.name}"`);
    const response = await axios.post(`${API_URL}/publish/content`, publishRequest, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000 // Увеличенный таймаут для сложных случаев
    });

    if (response.status === 200 && response.data) {
      // Получаем результат публикации в Telegram
      const telegramPublication = response.data.publications?.find(p => p.platform === 'telegram');
      
      // Выводим информацию о публикации
      if (telegramPublication) {
        log(`✅ Тест "${testCase.name}" успешно опубликован в Telegram`);
        if (telegramPublication.url) {
          log(`🔗 URL публикации: ${telegramPublication.url}`);
        }
        return {
          success: true,
          result: response.data,
          publication: telegramPublication
        };
      } else {
        log(`❌ Публикация в Telegram не найдена в ответе API`);
        return {
          success: false,
          result: response.data,
          error: 'Telegram publication not found in API response'
        };
      }
    } else {
      log(`❌ Ошибка при публикации: ${response.status} ${response.statusText}`);
      return {
        success: false,
        result: response.data,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }
  } catch (error) {
    log(`❌ Исключение при отправке запроса: ${error.message}`);
    if (error.response) {
      log(`Ответ сервера: ${JSON.stringify(error.response.data || {})}`);
    }
    return {
      success: false,
      error: error.message,
      details: error.response?.data || {}
    };
  }
}

/**
 * Запускает все тестовые сценарии
 */
async function runTests() {
  log('📊 Начало тестирования сложных случаев с вложенными и незакрытыми тегами');
  log(`Всего тестов: ${TEST_CASES.length}`);
  
  // Результаты всех тестов
  const results = [];
  let succeeded = 0;
  let failed = 0;

  // Запускаем тесты последовательно
  for (let i = 0; i < TEST_CASES.length; i++) {
    const testCase = TEST_CASES[i];
    log(`\n🔄 [${i + 1}/${TEST_CASES.length}] Запуск теста: "${testCase.name}"`);
    
    try {
      // Выводим тестируемый HTML
      log(`📝 Исходный HTML:\n${testCase.content}`);
      
      // Публикуем контент
      const result = await publishContent(testCase);
      
      // Определяем успешность теста
      const isSuccess = result.success && 
                        result.publication?.status === 'published';
      
      if (isSuccess) {
        succeeded++;
        log(`✅ Тест "${testCase.name}" пройден успешно`);
      } else {
        failed++;
        log(`❌ Тест "${testCase.name}" не пройден`);
        log(`Причина: ${result.error || 'Неизвестная ошибка'}`);
      }
      
      // Сохраняем результат
      results.push({
        name: testCase.name,
        success: isSuccess,
        content: testCase.content,
        result: result
      });
      
      // Пауза между тестами (10 секунд)
      if (i < TEST_CASES.length - 1) {
        log('⏳ Ожидание 10 секунд перед следующим тестом...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    } catch (error) {
      failed++;
      log(`❌ Исключение при выполнении теста "${testCase.name}": ${error.message}`);
      results.push({
        name: testCase.name,
        success: false,
        content: testCase.content,
        error: error.message
      });
    }
  }

  // Итоговый отчет
  log('\n📋 === ИТОГОВЫЙ ОТЧЕТ ===');
  log(`Всего тестов: ${TEST_CASES.length}`);
  log(`✅ Успешно: ${succeeded}`);
  log(`❌ Не пройдено: ${failed}`);
  log('=====================');

  // Сохраняем отчет в файл
  const report = {
    timestamp: new Date().toISOString(),
    totalTests: TEST_CASES.length,
    succeeded,
    failed,
    results
  };
  
  fs.writeFileSync('complex-tags-test-report.json', JSON.stringify(report, null, 2));
  log('📄 Отчет сохранен в complex-tags-test-report.json');
}

// Запускаем тесты
runTests().catch(error => {
  log(`🔥 Критическая ошибка: ${error.message}`);
  process.exit(1);
});
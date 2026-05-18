/**
 * Интеграционный тест для проверки HTML-форматирования при публикации в Telegram через основное API
 * Запустите: node test-integration-telegram-html.js
 */
import axios from 'axios';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Настройки для тестирования
const API_URL = 'http://localhost:5000/api';
const TEST_CASES = [
  {
    name: 'Базовое форматирование',
    content: `Это <b>жирный</b> текст, <i>курсив</i> и <u>подчеркнутый</u> текст. 
А вот <s>зачеркнутый</s> текст. <a href="https://example.com">Ссылка</a>!`,
    expected: {
      // Проверяем успешный ответ
      status: 'success'
    }
  },
  {
    name: 'Поддержка заголовков',
    content: `<h1>Большой заголовок</h1>
<h2>Средний заголовок</h2>
<h3>Маленький заголовок</h3>
<p>Это обычный параграф текста. Проверка перевода строки.</p>`,
    expected: {
      status: 'success'
    }
  },
  {
    name: 'Вложенное форматирование',
    content: `<b>Жирный <i>жирный и курсивный</i> текст</b>
<i>Курсивный <b>жирный и курсивный</b> текст</i>
<u>Подчеркнутый <s>подчеркнутый и зачеркнутый</s> текст</u>`,
    expected: {
      status: 'success'
    }
  },
  {
    name: 'Комбинированное форматирование с параграфами',
    content: `<p><b>Важное объявление!</b></p>
<p>Это обычный текст <i>с курсивным элементом</i> внутри параграфа.</p>
<p>А это еще один параграф <u>с подчеркнутым текстом</u> и <a href="https://telegram.org">ссылкой</a>.</p>`,
    expected: {
      status: 'success'
    }
  },
  {
    name: 'Списки',
    content: `<b>Список покупок:</b>
<ul>
  <li>Молоко</li>
  <li>Хлеб</li>
  <li>Яйца</li>
  <li>Мука</li>
</ul>
<b>План на день:</b>
<ol>
  <li>Встать пораньше</li>
  <li>Сделать зарядку</li>
  <li>Приготовить завтрак</li>
</ol>`,
    expected: {
      status: 'success'
    }
  },
  {
    name: 'Незакрытые теги',
    content: `Это <b>жирный текст, который не закрыт.
А это <i>курсивный текст, который тоже не закрыт.
И <u>подчеркнутый незакрытый.
<s>Зачеркнутый, <a href="https://example.com">ссылка`,
    expected: {
      status: 'success'
    }
  }
];

/**
 * Логирует сообщение в консоль с отметкой времени
 * @param {string} message Сообщение для вывода
 */
function log(message) {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.log(`[${timestamp}] ${message}`);
}

/**
 * Отправляет контент через основное API публикации
 * @param {object} testCase Тестовый случай с контентом
 * @returns {Promise<object>} Результат отправки
 */
async function publishThroughAPI(testCase) {
  try {
    // Формируем тестовый контент для публикации
    const campaignId = 'fde4ae82-e492-4c94-965d-902bfe721d97'; // ID тестовой кампании "Правильное питание"
    const publishRequest = {
      content: {
        id: `test-${Date.now()}`, // Уникальный ID для тестирования
        title: `Тест: ${testCase.name}`,
        content: testCase.content,
        contentType: 'html',
        status: 'ready',
        userId: '53921f16-f51d-4591-80b9-8caa4fde4d13', // ID пользователя в Directus
        campaignId,
        socialPlatforms: ['telegram'], // Публикуем только в Telegram
        createdAt: new Date(),
        hashtags: [],
        links: [],
        metadata: {}
      },
      userId: '53921f16-f51d-4591-80b9-8caa4fde4d13',
      force: true, // Принудительная публикация без проверки статуса
      platforms: ['telegram'] // Указываем только Telegram
    };

    // Отправляем запрос к API
    log(`Отправка контента для публикации: "${testCase.name}"`);
    const response = await axios.post(`${API_URL}/publish/content`, publishRequest, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    // Проверяем результат
    if (response.status === 200 && response.data) {
      log(`Ответ от API: ${JSON.stringify(response.data)}`);
      return {
        success: true,
        message: `Успешная публикация: ${testCase.name}`,
        result: response.data
      };
    } else {
      return {
        success: false,
        message: `Ошибка при публикации: ${response.status} ${response.statusText}`,
        result: response.data
      };
    }
  } catch (error) {
    log(`Ошибка при отправке запроса: ${error.message}`);
    if (error.response) {
      log(`Ответ сервера: ${JSON.stringify(error.response.data)}`);
    }
    return {
      success: false,
      message: `Исключение при публикации: ${error.message}`,
      error
    };
  }
}

/**
 * Запускает все тестовые сценарии последовательно
 */
async function runAllTests() {
  log('Начало интеграционных тестов HTML-форматирования для Telegram');
  log(`Всего тестов: ${TEST_CASES.length}`);

  // Результаты тестов
  const results = [];
  let succeeded = 0;
  let failed = 0;

  // Последовательно запускаем тесты с задержкой
  for (let i = 0; i < TEST_CASES.length; i++) {
    const testCase = TEST_CASES[i];
    log(`\n[${i + 1}/${TEST_CASES.length}] Запуск теста: ${testCase.name}`);
    
    try {
      const result = await publishThroughAPI(testCase);
      
      // Проверяем соответствие ожидаемому результату
      const isSuccess = result.success === true;
      
      // Для успешных запросов проверяем детали ответа
      let additionalChecks = true;
      if (isSuccess && testCase.expected) {
        const telegramResult = result.result?.publications?.find(p => p.platform === 'telegram');
        // Проверяем ожидаемый статус
        if (testCase.expected.status && telegramResult && telegramResult.status !== testCase.expected.status) {
          additionalChecks = false;
          log(`Статус не соответствует ожидаемому: ${telegramResult.status} вместо ${testCase.expected.status}`);
        }
      }
      
      // Общий результат теста
      const testSuccess = isSuccess && additionalChecks;
      if (testSuccess) {
        log(`✅ Тест "${testCase.name}" успешно пройден`);
        succeeded++;
      } else {
        log(`❌ Тест "${testCase.name}" не пройден`);
        log(`Причина: ${result.message}`);
        failed++;
      }
      
      results.push({
        name: testCase.name,
        success: testSuccess,
        result
      });
      
      // Добавляем задержку между тестами (5 секунд)
      if (i < TEST_CASES.length - 1) {
        log('Ожидание 5 секунд перед следующим тестом...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    } catch (error) {
      log(`❌ Исключение при выполнении теста "${testCase.name}": ${error.message}`);
      results.push({
        name: testCase.name,
        success: false,
        error: error.message
      });
      failed++;
    }
  }

  // Выводим итоговый отчет
  log('\n=== Результаты интеграционных тестов ===');
  log(`Всего тестов: ${TEST_CASES.length}`);
  log(`Успешно: ${succeeded}`);
  log(`Не пройдено: ${failed}`);
  log('=======================================');

  // Сохраняем результаты в файл
  const reportData = {
    date: new Date().toISOString(),
    totalTests: TEST_CASES.length,
    succeeded,
    failed,
    results
  };
  
  fs.writeFileSync('telegram-html-test-results.json', JSON.stringify(reportData, null, 2));
  log('Отчет о тестировании сохранен в telegram-html-test-results.json');
}

// Запуск всех тестов
runAllTests().catch(error => {
  log(`Ошибка при выполнении тестов: ${error.message}`);
  process.exit(1);
});
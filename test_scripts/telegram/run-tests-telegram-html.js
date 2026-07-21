/**
 * Комплексные тесты для проверки HTML-форматирования в Telegram
 * Скрипт выполняет набор тестов для проверки корректности обработки HTML-тегов
 * При каждом запуске публикует реальные сообщения в канал для визуальной проверки
 * 
 * Запуск: node run-tests-telegram-html.js
 */
import axios from 'axios';
import { config } from 'dotenv';

// Загружаем переменные окружения
config();

// API URL по умолчанию
const API_URL = process.env.API_URL || 'http://localhost:5000';

// ID кампании из переменных окружения
const CAMPAIGN_ID = process.env.CAMPAIGN_ID || '46868c44-c6a4-4bed-accf-9ad07bba790e';

// Хранилище для настроек, полученных из кампании
let settings = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || 'REVOKED_TELEGRAM_TOKEN_USE_ENV',
    chatId: process.env.TELEGRAM_CHAT_ID || '-1002302366310'
  }
};

// Тестовые кейсы для разных сценариев HTML-форматирования
const testCases = [
  {
    name: '1. Базовые HTML-теги',
    description: 'Проверка всех поддерживаемых HTML-тегов Telegram',
    text: `<b>Жирный текст</b>

<i>Курсивный текст</i>

<u>Подчеркнутый текст</u>

<s>Зачеркнутый текст</s>

<code>Моноширинный текст</code>

<a href="https://example.com">Ссылка</a>

<pre>
function test() {
  return 'Блок предварительно отформатированного текста';
}
</pre>`
  },
  {
    name: '2. Вложенные теги',
    description: 'Проверка корректной обработки вложенных HTML-тегов',
    text: `<b>Вложенный <i>текст с</i> разными <u>тегами</u></b>

<b><i><u>Три уровня вложенности</u></i></b>

<b>Текст с <a href="https://example.com">ссылкой</a> внутри жирного</b>

<i>Курсив с <code>кодом</code> внутри</i>`
  },
  {
    name: '3. Незакрытые теги',
    description: 'Проверка автоматического закрытия незакрытых HTML-тегов',
    text: `<b>Незакрытый тег жирного

<i>Незакрытый тег курсива

<u>Незакрытый тег подчеркивания

<s>Незакрытый тег зачеркивания

<code>Незакрытый тег кода

Обычный текст после незакрытых тегов`
  },
  {
    name: '4. Неправильно закрытые теги',
    description: 'Проверка исправления тегов с неправильным порядком закрытия',
    text: `<b>Жирный <i>курсивный</b> текст</i>

<u>Подчеркнутый <b>жирный <i>курсивный</u> текст</i></b>

<b>Жирный <u>подчеркнутый <i>курсивный</b> текст</u></i>

Текст после неправильно закрытых тегов`
  },
  {
    name: '5. Форматированные списки',
    description: 'Проверка форматирования списков с HTML-тегами',
    text: `<b>Форматированный список:</b>

• <i>Курсивный пункт</i>
• <u>Подчеркнутый пункт</u>
• <b>Жирный пункт</b>
• <s>Зачеркнутый пункт</s>
• <code>Моноширинный пункт</code>
• <a href="https://example.com">Пункт со ссылкой</a>
• Пункт с <b>вложенным <i>форматированием</i></b>`
  },
  {
    name: '6. Маркдаун конвертация',
    description: 'Проверка конвертации Markdown в HTML-теги',
    text: `**Жирный текст из markdown**

*Курсивный текст из markdown*

__Подчеркнутый текст из markdown__

~~Зачеркнутый текст из markdown~~

\`Моноширинный текст из markdown\`

**Жирный с *вложенным курсивом* из markdown**`
  },
  {
    name: '7. Смешанное форматирование с незакрытыми тегами',
    description: 'Проверка сложного текста с разным форматированием и незакрытыми тегами',
    text: `<b>Заголовок</b>

<i>Подзаголовок с курсивом</i>

Обычный текст

• <u>Подчеркнутый пункт</u>
• <b>Жирный <i>с курсивом</i> пункт

<code>console.log('Hello world');</code>

<b>Незакрытый жирный с <i>незакрытым курсивом и <u>подчеркиванием`
  },
  {
    name: '8. Длинный текст',
    description: 'Проверка обработки длинного текста с HTML-форматированием',
    text: `<b>Длинный текст с форматированием</b>

${`<i>Повторяющийся текст с курсивом. </i>`.repeat(50)}

<u>Повторяющийся подчеркнутый текст в середине.</u>

${`<b>Повторяющийся жирный текст. </b>`.repeat(50)}

<code>Моноширинный текст в конце длинного сообщения</code>`
  },
  {
    name: '9. HTML-сущности и спецсимволы',
    description: 'Проверка обработки HTML-сущностей и спецсимволов',
    text: `<b>Текст с HTML-сущностями</b>

&lt;Это не тег&gt;

&amp; - амперсанд

&quot;Кавычки&quot;

&apos;Апостроф&apos;

<code>&lt;b&gt;Это код, а не жирный текст&lt;/b&gt;</code>

Текст < с > символами & без & экранирования`
  },
  {
    name: '10. Теги с атрибутами',
    description: 'Проверка обработки тегов с различными атрибутами',
    text: `<a href="https://example.com" title="Пример ссылки">Ссылка с атрибутом title</a>

<a href="https://example.com" target="_blank" rel="nofollow">Ссылка с несколькими атрибутами</a>

<a href="https://example.com" style="color: red;">Ссылка со стилем</a>

<a href="https://example.com" onclick="alert('click')">Ссылка с обработчиком</a>

<b style="color: red;">Жирный текст с атрибутом style</b>

<i class="some-class">Курсивный текст с атрибутом class</i>`
  }
];

/**
 * Выводит информацию о настройках
 * @returns {void}
 */
function loadSettings() {
  console.log('✅ Используем настройки для Telegram:');
  console.log(`Канал: ${settings.telegram.chatId}`);
  console.log(`Токен: ${settings.telegram.token.substring(0, 10)}...`);
}

/**
 * Публикует тестовое сообщение через API приложения
 * @param {object} testCase Тестовый случай
 * @param {number} index Индекс теста
 * @returns {Promise<object>} Результат публикации
 */
async function runTest(testCase, index) {
  try {
    console.log(`\n----- Тест ${index+1}/${testCases.length}: ${testCase.name} -----`);
    console.log(`Описание: ${testCase.description}`);
    
    // Добавляем информацию о тесте в начало сообщения
    const testHeader = `🧪 <b>ТЕСТ HTML-ФОРМАТИРОВАНИЯ #${index+1}</b>: ${testCase.name}\n\n`;
    const testContent = testHeader + testCase.text;
    
    // Делаем запрос к API для отправки сообщения
    console.log(`Отправка сообщения через API...`);
    const response = await axios.post(`${API_URL}/api/test/telegram-post`, {
      text: testContent,
      chatId: settings.telegram.chatId,
      token: settings.telegram.token
    });
    
    // Обрабатываем ответ
    if (response.data && response.data.success) {
      const result = response.data.data;
      console.log(`✅ УСПЕХ: Тест #${index+1} пройден успешно!`);
      
      if (result.postUrl) {
        console.log(`🔗 URL сообщения: ${result.postUrl}`);
      }
      
      if (result.messageId) {
        console.log(`📝 ID сообщения: ${result.messageId}`);
      }
      
      return { 
        success: true, 
        messageId: result.messageId,
        postUrl: result.postUrl 
      };
    } else {
      console.log(`❌ ОШИБКА: Тест #${index+1} не пройден!`);
      
      if (response.data && response.data.error) {
        console.log(`Описание ошибки: ${response.data.error}`);
      }
      
      console.log(JSON.stringify(response.data, null, 2));
      
      return { 
        success: false, 
        error: response.data?.error || 'Неизвестная ошибка' 
      };
    }
  } catch (error) {
    console.error(`❌ ОШИБКА при выполнении теста #${index+1}:`, error.message);
    
    if (error.response) {
      console.error('Ответ сервера:', error.response.status);
      console.error('Данные ответа:', JSON.stringify(error.response.data, null, 2));
    }
    
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Запускает все тесты и выводит общий результат
 */
async function runAllTests() {
  console.log('======================================================');
  console.log('🧪 ЗАПУСК ТЕСТОВ HTML-ФОРМАТИРОВАНИЯ В TELEGRAM');
  console.log('======================================================\n');
  
  // Загружаем настройки
  await loadSettings();
  
  // Результаты тестов
  const results = [];
  
  // Запускаем тесты поочередно
  for (let i = 0; i < testCases.length; i++) {
    const result = await runTest(testCases[i], i);
    results.push(result);
    
    // Пауза между тестами, чтобы не превысить лимиты API Telegram
    if (i < testCases.length - 1) {
      console.log('⏳ Пауза 3 секунды перед следующим тестом...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  // Выводим общий результат
  console.log('\n======================================================');
  console.log('📊 СВОДКА РЕЗУЛЬТАТОВ ТЕСТОВ:');
  console.log('======================================================');
  
  // Подсчитываем количество успешных и неуспешных тестов
  const successCount = results.filter(r => r.success).length;
  
  // Выводим результаты для каждого теста
  for (let i = 0; i < testCases.length; i++) {
    const status = results[i].success ? '✅ УСПЕХ' : '❌ ОШИБКА';
    console.log(`${status}: Тест #${i+1} - ${testCases[i].name}`);
    
    if (!results[i].success && results[i].error) {
      console.log(`   Причина: ${results[i].error}`);
    }
    
    if (results[i].postUrl) {
      console.log(`   URL: ${results[i].postUrl}`);
    }
  }
  
  // Итоговый результат
  console.log('\n======================================================');
  console.log(`ИТОГО: ${successCount}/${testCases.length} тестов успешно`);
  
  if (successCount === testCases.length) {
    console.log('✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО!');
  } else {
    console.log(`❌ ${testCases.length - successCount} ТЕСТОВ НЕ ПРОЙДЕНО!`);
  }
  console.log('======================================================');
}

// Запускаем все тесты
runAllTests().catch(error => {
  console.error('Критическая ошибка при выполнении тестов:', error);
  process.exit(1);
});
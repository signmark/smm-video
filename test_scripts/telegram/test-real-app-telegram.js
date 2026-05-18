/**
 * Тест для проверки реальной публикации в Telegram через основной API приложения
 * Этот тест использует тот же путь, что и реальное приложение при публикации контента
 * 
 * Запуск: node test-real-app-telegram.js
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Конфигурация теста
const config = {
  // URL API приложения
  apiUrl: 'http://localhost:5000',
  // ID существующей кампании с настройками Telegram
  campaignId: '46868c44-c6a4-4bed-accf-9ad07bba790e',
  // ID тестового пользователя
  userId: '53921f16-f51d-4591-80b9-8caa4fde4d13',
  // Таймаут между запросами (мс)
  requestDelay: 1000
};

// Тестовые кейсы с различными HTML-конструкциями
const testCases = [
  {
    name: 'Базовые HTML-теги',
    content: '<p>Тестовое сообщение с <b>жирным текстом</b>, <i>курсивом</i> и <u>подчеркиванием</u>.</p>',
    platforms: ['telegram']
  },
  {
    name: 'Эквивалентные HTML-теги',
    content: '<p>Текст с <strong>жирным через strong</strong>, <em>курсивом через em</em> и <del>зачеркиванием</del>.</p>',
    platforms: ['telegram']
  },
  {
    name: 'Заголовки и списки',
    content: '<h2>Заголовок</h2><ul><li>Пункт 1</li><li>Пункт 2</li><li>Пункт 3</li></ul>',
    platforms: ['telegram']
  },
  {
    name: 'Смайлы и эмодзи',
    content: '<p>Текст с эмодзи 😀 👍 🎉 и <b>форматированием</b></p>',
    platforms: ['telegram']
  },
  {
    name: 'Ссылки',
    content: '<p>Текст со <a href="https://example.com">ссылкой</a> на сайт.</p>',
    platforms: ['telegram']
  },
  {
    name: 'Незакрытые теги',
    content: '<p>Текст с <b>незакрытым жирным <i>и курсивным форматированием.</p>',
    platforms: ['telegram']
  },
  {
    name: 'Длинный текст с форматированием',
    content: '<p>Первый параграф с <b>жирным</b> и <i>курсивным</i> текстом.</p><p>Второй параграф с <u>подчеркнутым</u> текстом и эмодзи 🎉.</p><p>Третий параграф с <a href="https://example.com">ссылкой</a> на сайт.</p>',
    platforms: ['telegram']
  }
];

/**
 * Задержка на указанное количество миллисекунд
 * @param {number} ms Миллисекунды для задержки
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Создает новый контент в системе через API
 * @param {object} testCase Тестовый случай
 * @returns {Promise<object>} Результат создания контента
 */
async function createContent(testCase) {
  try {
    const content = {
      id: uuidv4(), // Генерируем уникальный ID для контента
      title: `Тест: ${testCase.name} [${new Date().toISOString()}]`,
      content: testCase.content,
      contentType: 'text',
      status: 'draft',
      userId: config.userId,
      campaignId: config.campaignId,
      socialPlatforms: testCase.platforms,
      // Установим empty arrays для полей, которые требуются в схеме
      hashtags: [],
      links: [],
      imageUrl: null,
      additionalImages: []
    };

    console.log(`[${testCase.name}] Создание контента...`);
    const response = await axios.post(`${config.apiUrl}/api/content`, content);
    return response.data;
  } catch (error) {
    console.error(`[${testCase.name}] Ошибка при создании контента:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Публикует контент через API
 * @param {string} contentId ID контента
 * @param {object} testCase Тестовый случай
 * @returns {Promise<object>} Результат публикации
 */
async function publishContent(contentId, testCase) {
  try {
    console.log(`[${testCase.name}] Публикация контента ${contentId}...`);
    const response = await axios.post(`${config.apiUrl}/api/content/${contentId}/publish`, {
      platforms: testCase.platforms
    });
    return response.data;
  } catch (error) {
    console.error(`[${testCase.name}] Ошибка при публикации контента:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Проверяет статус публикации
 * @param {string} contentId ID контента
 * @param {object} testCase Тестовый случай
 * @returns {Promise<object>} Результат проверки статуса
 */
async function checkPublicationStatus(contentId, testCase) {
  try {
    console.log(`[${testCase.name}] Проверка статуса публикации ${contentId}...`);
    const response = await axios.get(`${config.apiUrl}/api/content/${contentId}`);
    return response.data;
  } catch (error) {
    console.error(`[${testCase.name}] Ошибка при проверке статуса:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Запускает все тесты последовательно
 */
async function runAllTests() {
  console.log('🚀 Запуск тестов публикации в Telegram через основной API приложения');
  console.log(`📋 Всего тестов: ${testCases.length}`);
  console.log('───────────────────────────────────────────────');

  const results = [];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`\n⏳ Тест ${i + 1}/${testCases.length}: ${testCase.name}`);
    
    try {
      // 1. Создаем контент
      const content = await createContent(testCase);
      console.log(`✅ Контент создан с ID: ${content.id}`);
      
      // Небольшая пауза между запросами
      await sleep(config.requestDelay);
      
      // 2. Публикуем контент
      const publication = await publishContent(content.id, testCase);
      console.log(`📤 Публикация инициирована: ${JSON.stringify(publication.results)}`);
      
      // Ожидаем некоторое время, чтобы публикация завершилась
      console.log(`⏱️ Ожидание завершения публикации (5 секунд)...`);
      await sleep(5000);
      
      // 3. Проверяем статус публикации
      const status = await checkPublicationStatus(content.id, testCase);
      console.log(`📊 Финальный статус: ${status.status}`);
      
      // 4. Получаем URL публикации (если есть)
      let publicationUrl = 'Недоступно';
      if (status.publications && status.publications.length > 0) {
        const telegramPub = status.publications.find(pub => pub.platform === 'telegram');
        if (telegramPub && telegramPub.postUrl) {
          publicationUrl = telegramPub.postUrl;
        }
      }
      
      // 5. Сохраняем результат теста
      const testResult = {
        name: testCase.name,
        content: testCase.content,
        contentId: content.id,
        status: status.status,
        success: status.status === 'published',
        publicationUrl
      };
      
      results.push(testResult);
      
      console.log(`${testResult.success ? '✅ УСПЕХ' : '❌ ОШИБКА'}: ${testCase.name}`);
      if (publicationUrl !== 'Недоступно') {
        console.log(`🔗 URL публикации: ${publicationUrl}`);
      }
    } catch (error) {
      console.error(`❌ Тест "${testCase.name}" завершился с ошибкой:`, error.message);
      results.push({
        name: testCase.name,
        content: testCase.content,
        error: error.message,
        success: false
      });
    }
    
    console.log('───────────────────────────────────────────────');
    // Пауза между тестами
    await sleep(config.requestDelay * 2);
  }
  
  // Выводим общие результаты
  const successCount = results.filter(r => r.success).length;
  console.log(`\n📈 Итоговые результаты:`);
  console.log(`   Всего тестов: ${results.length}`);
  console.log(`   Успешных: ${successCount}`);
  console.log(`   Неудачных: ${results.length - successCount}`);
  
  console.log('\n🔍 Результаты по каждому тесту:');
  results.forEach((result, index) => {
    console.log(`   ${index + 1}. ${result.name}: ${result.success ? 'УСПЕХ' : 'ОШИБКА'}`);
    if (result.publicationUrl && result.publicationUrl !== 'Недоступно') {
      console.log(`      URL: ${result.publicationUrl}`);
    }
    if (!result.success && result.error) {
      console.log(`      Ошибка: ${result.error}`);
    }
  });
}

// Запускаем тесты
runAllTests().catch(error => {
  console.error('\n❌ Критическая ошибка при выполнении тестов:', error);
});
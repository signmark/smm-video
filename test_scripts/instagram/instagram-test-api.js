/**
 * Тест прямого API для публикации изображений в Instagram
 * 
 * Скрипт использует тестовый маршрут /api/test/instagram-post,
 * который позволяет напрямую передать token и businessAccountId,
 * что значительно упрощает тестирование Instagram API.
 * 
 * Запуск: node instagram-test-api.js
 */

const axios = require('axios');
const fetch = require('node-fetch');

// Настройки для тестирования Instagram API
const CONFIG = {
  // URL API
  apiUrl: 'http://localhost:3001',
  // Настройки Instagram
  instagram: {
    token: 'EAA520SFRtvcBO9Y7LhiiZBqwsqdZCP9JClMUoJZCvjsSc8qs9aheLdWefOqrZBLQhe5T0ZBerS6mZAZAP6D4i8Ln5UBfiIyVEif1LrzcAzG6JNrhW2DJeEzObpp9Mzoh8tDZA9I0HigkLnFZCaJVZCQcGDAkZBRxwnVimZBdbvokeg19i5RuGTbfuFs9UC9R',
    businessAccountId: '17841422577074562'
  },
  // Тестовые изображения
  testImages: {
    food: 'https://i.imgur.com/HbNJQyD.jpg',
    nature: 'https://i.imgur.com/KNJnIR9.jpg',
    technology: 'https://i.imgur.com/9LRwEJS.jpg'
  }
};

// Функция для задержки выполнения
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Запускает тест публикации в Instagram
 * @param {object} testCase Объект с тестовым контентом
 * @returns {Promise<object>} Результат публикации
 */
async function testInstagramPost(testCase) {
  console.log(`\n📱 Тест Instagram: ${testCase.name}`);
  console.log(`📝 Публикация текста: ${testCase.text.substring(0, 50)}...`);
  console.log(`🖼️ Изображение: ${testCase.imageUrl.substring(0, 30)}...`);

  try {
    console.log(`⏳ Отправка запроса в API...`);
    
    // Прямой запрос к API для отладки
    console.log(`🔄 Проверка доступности API...`);
    const testResponse = await axios.get(`${CONFIG.apiUrl}/api`);
    console.log(`✓ API доступен: ${typeof testResponse.data === 'object' ? 'JSON-ответ' : 'другой формат'}`);
    
    // Отправляем запрос на публикацию через наш тестовый API с указанием формата
    console.log(`🔄 Отправка запроса публикации...`);
    const response = await fetch(`${CONFIG.apiUrl}/api/test/instagram-post`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        text: testCase.text,
        token: CONFIG.instagram.token,
        businessAccountId: CONFIG.instagram.businessAccountId,
        imageUrl: testCase.imageUrl
      })
    });
    
    // Проверяем, что получили JSON-ответ
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.log(`⚠️ Предупреждение: Сервер вернул не JSON: ${contentType}`);
      // Если получили HTML, то это не то, что нам нужно
      if (contentType && contentType.includes('text/html')) {
        const text = await response.text();
        console.log(`❌ ОШИБКА: Получен HTML вместо JSON (${text.length} байт)`);
        return {
          success: false,
          error: 'Сервер вернул HTML вместо JSON',
          details: { contentType }
        };
      }
    }
    
    // Парсим данные ответа
    const data = await response.json();
    console.log(`📊 Получен ответ: ${JSON.stringify(data, null, 2).substring(0, 300)}...`);

    // Проверяем успешность операции
    if (data.success) {
      console.log(`✅ УСПЕХ! Публикация завершена`);
      console.log(`🔗 URL публикации: ${data.postUrl || 'Недоступен'}`);
    } else {
      console.log(`❌ ОШИБКА: ${data.error || 'Неизвестная ошибка'}`);
      
      if (data.result && data.result.error) {
        console.log(`📋 Детали ошибки API: ${data.result.error}`);
      }
    }

    return {
      success: data.success,
      details: data
    };
  } catch (error) {
    console.error(`❌ ОШИБКА при запросе API: ${error.message}`);
    
    if (error.response) {
      console.error('📋 Детали ответа:', error.response.data || error.response.statusText);
    }
    
    return {
      success: false,
      error: error.message,
      details: error.response?.data
    };
  }
}

/**
 * Запускает все тесты последовательно
 */
async function runAllTests() {
  console.log('====================================');
  console.log('🧪 ЗАПУСК ТЕСТОВ ПУБЛИКАЦИИ В INSTAGRAM');
  console.log('====================================');
  console.log('🔑 Используем Business Account ID:', CONFIG.instagram.businessAccountId);
  console.log('====================================');

  // Тестовые случаи с разным контентом
  const testCases = [
    {
      name: "Простой текст с эмодзи",
      text: "Тестовая публикация в Instagram! 🎉\n\nПроверка работы API для публикации контента в Instagram через Graph API.\n\nВремя публикации: " + new Date().toLocaleTimeString(),
      imageUrl: CONFIG.testImages.food
    },
    {
      name: "Текст с HTML форматированием и списком",
      text: "<h2>Преимущества правильного питания:</h2>\n\n<ul><li>Больше энергии 💪</li><li>Улучшение здоровья 🏥</li><li>Хорошее настроение 😊</li><li>Лучший сон 💤</li></ul><p>Публикация с <b>форматированным</b> текстом</p>",
      imageUrl: CONFIG.testImages.nature
    },
    {
      name: "Текст с хэштегами",
      text: "Технологические новинки этого месяца! 📱✨\n\nСамые интересные гаджеты и технологии, которые изменят будущее.\n\n#технологии #инновации #будущее #гаджеты",
      imageUrl: CONFIG.testImages.technology
    }
  ];

  // Запускаем тесты последовательно с задержкой между ними
  const results = [];
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`\n🧪 Запуск теста ${i+1} из ${testCases.length}: ${testCase.name}`);
    
    // Запускаем тест
    const result = await testInstagramPost(testCase);
    results.push({
      name: testCase.name,
      result
    });

    // Делаем паузу между тестами (кроме последнего)
    if (i < testCases.length - 1) {
      console.log(`⏳ Пауза перед следующим тестом (5 секунд)...`);
      await sleep(5000);
    }
  }

  // Выводим общий результат
  console.log('\n====================================');
  console.log('📊 РЕЗУЛЬТАТЫ ТЕСТОВ INSTAGRAM:');
  console.log('====================================');

  let successCount = 0;
  for (const test of results) {
    console.log(`${test.result.success ? '✅' : '❌'} ${test.name}`);
    if (test.result.success) successCount++;
  }

  console.log('\n====================================');
  console.log(`✅ Успешно: ${successCount}/${results.length}`);
  console.log('====================================');
}

// Запускаем тесты
runAllTests();
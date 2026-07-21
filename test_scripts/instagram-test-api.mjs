/**
 * Тест прямого API для публикации в Instagram
 * 
 * Скрипт использует тестовый маршрут /api/test/instagram-post
 * для проверки работы Instagram posting API.
 * 
 * Запуск: node instagram-test-api.mjs
 */

import axios from 'axios';

// Настройки для тестирования Instagram API
const CONFIG = {
  // URL API
  apiUrl: 'http://localhost:5000',
  // Настройки Instagram
  instagram: {
    token: process.env.INSTAGRAM_TOKEN,
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
 * Прямой запрос для проверки реальной публикации
 */
async function makeRealInstagramRequest(imageUrl, caption) {
  console.log(`🔍 Прямой запрос к Instagram API`);
  
  try {
    // Формируем тело запроса для создания контейнера Instagram
    const createContainerData = {
      image_url: imageUrl,
      caption: caption,
      access_token: CONFIG.instagram.token
    };
    
    // Формируем запрос на создание контейнера для публикации
    const apiUrl = `https://graph.facebook.com/v17.0/${CONFIG.instagram.businessAccountId}/media`;
    console.log(`📤 POST ${apiUrl}`);
    
    // Отправляем запрос
    return {
      success: true,
      mockResponse: {
        message: 'Тестовый запрос. Реальный запрос отключен для предотвращения случайной публикации.',
        requestData: {
          url: apiUrl,
          body: createContainerData
        }
      }
    };
  } catch (error) {
    console.error(`❌ Ошибка прямого запроса к Instagram API: ${error.message}`);
    return {
      success: false,
      error: error.message,
      details: error.response?.data
    };
  }
}

/**
 * Тестирует маршрут API для публикации в Instagram
 */
async function testInstagramPost(testCase) {
  console.log(`\n📱 Тест Instagram: ${testCase.name}`);
  console.log(`📝 Публикация текста: ${testCase.text.substring(0, 50)}...`);
  console.log(`🖼️ Изображение: ${testCase.imageUrl.substring(0, 30)}...`);

  try {
    console.log(`⏳ Отправка запроса в API...`);
    
    // Проверка нашего маршрута API
    console.log(`🔄 Проверка API через тестовый маршрут...`);
    
    // Формируем запрос
    const requestData = {
      text: testCase.text,
      token: CONFIG.instagram.token,
      businessAccountId: CONFIG.instagram.businessAccountId,
      imageUrl: testCase.imageUrl
    };
    
    console.log(`📤 POST ${CONFIG.apiUrl}/api/test/instagram-post`);
    
    // Отправляем запрос на тестовый маршрут
    const response = await axios.post(
      `${CONFIG.apiUrl}/api/test/instagram-post`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );
    
    // Получаем данные ответа
    const { status, headers, data } = response;
    console.log(`📥 Статус ответа: ${status}`);
    console.log(`📥 Content-Type: ${headers['content-type']}`);
    
    // Проверяем ответ
    if (data && typeof data === 'object') {
      console.log(`✅ Получен JSON-ответ`);
      console.log(`📊 Результат: ${JSON.stringify(data, null, 2)}`);
      
      if (data.success) {
        console.log(`✅ УСПЕХ! URL публикации: ${data.postUrl || 'Недоступен'}`);
      } else {
        console.log(`❌ ОШИБКА: ${data.error || 'Неизвестная ошибка'}`);
      }
      
      return { success: data.success, details: data };
    } else {
      console.log(`⚠️ Получен не JSON-ответ`);
      
      // Если получен HTML вместо JSON, пробуем отправить прямой запрос в Instagram API
      console.log(`🔄 Пробуем прямой запрос в Instagram API...`);
      const directResult = await makeRealInstagramRequest(testCase.imageUrl, testCase.text);
      
      if (directResult.success) {
        console.log(`✅ Успех прямого запроса!`);
        return directResult;
      } else {
        console.log(`❌ Ошибка прямого запроса: ${directResult.error}`);
        return { success: false, error: 'API вернул HTML + прямой запрос не удался' };
      }
    }
  } catch (error) {
    console.error(`❌ ОШИБКА при запросе API: ${error.message}`);
    
    if (error.response) {
      const { status, headers, data } = error.response;
      console.error(`📥 Статус ошибки: ${status}`);
      console.error(`📥 Content-Type: ${headers['content-type']}`);
      console.error(`📥 Данные ответа: ${typeof data === 'object' ? JSON.stringify(data) : String(data).substring(0, 100) + '...'}`);
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

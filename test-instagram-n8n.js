/**
 * Тестовый скрипт для проверки Instagram N8N workflow
 * Проверяет публикацию контента через N8N webhook
 */

import axios from 'axios';

async function testInstagramN8N() {
  try {
    console.log('🔄 Начинаем тест Instagram N8N workflow...');

    // Тестовые данные для публикации
    const testData = {
      content: "Тестовый пост от SMM Manager\n\nЭто автоматическая публикация через N8N workflow! 🚀\n\n#test #smm #automation #nplanner",
      imageUrl: "https://picsum.photos/1080/1080?random=1", // Случайное изображение для теста
      contentId: `test-content-${Date.now()}`,
      campaignId: `test-campaign-${Date.now()}`,
      settings: {
        username: "test_username", // ЗАМЕНИТЬ на реальные данные
        password: "test_password"  // ЗАМЕНИТЬ на реальные данные
      },
      hashtags: ["#test", "#smm", "#automation", "#nplanner"],
      location: "Москва, Россия",
      caption: "Тестовый пост от SMM Manager\n\nЭто автоматическая публикация через N8N workflow! 🚀\n\n#test #smm #automation #nplanner"
    };

    // URL N8N webhook (нужно заменить на реальный)
    const webhookUrl = process.env.N8N_INSTAGRAM_WEBHOOK || 'https://n8n.roboflow.tech/webhook/publish-instagram';

    console.log('📡 Отправляем данные на Instagram webhook:', webhookUrl);
    console.log('📦 Данные для публикации:', {
      ...testData,
      settings: { username: testData.settings.username, password: '[СКРЫТО]' }
    });

    // Отправляем запрос на N8N webhook
    const response = await axios.post(webhookUrl, testData, {
      timeout: 120000, // 2 минуты таймаут для Instagram публикации
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Успешный ответ от Instagram N8N workflow:');
    console.log(JSON.stringify(response.data, null, 2));

    // Проверяем статус публикации
    if (response.data.success) {
      console.log('🎉 Instagram пост успешно опубликован!');
      if (response.data.postUrl) {
        console.log('🔗 URL поста:', response.data.postUrl);
      }
      console.log('⏰ Время публикации:', response.data.publishedAt);
    } else {
      console.log('❌ Ошибка публикации в Instagram:');
      console.log('📝 Сообщение об ошибке:', response.data.message);
      console.log('🔍 Детали ошибки:', response.data.error);
    }

  } catch (error) {
    console.error('💥 Ошибка при тестировании Instagram N8N:');
    
    if (error.response) {
      // Ошибка HTTP ответа
      console.error('📊 Статус ответа:', error.response.status);
      console.error('📄 Данные ответа:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      // Ошибка запроса (нет ответа)
      console.error('📡 Запрос отправлен, но ответ не получен');
      console.error('🔍 Детали запроса:', error.message);
    } else {
      // Другая ошибка
      console.error('🔍 Сообщение об ошибке:', error.message);
    }
    
    console.error('📚 Полная информация об ошибке:', error);
  }
}

// Дополнительная функция для тестирования через основное приложение
async function testInstagramViaApp() {
  try {
    console.log('\n🔄 Тестируем Instagram через основное приложение...');

    // URL основного приложения - используем правильный эндпоинт для немедленной публикации
    const appUrl = process.env.APP_URL || 'http://localhost:5000';
    const publishUrl = `${appUrl}/api/publish/now`;

    // Данные для тестирования - правильный формат
    const testContentId = 'test-content-instagram-' + Date.now();

    console.log('📡 Отправляем запрос на:', publishUrl);
    console.log('📦 Тестовый contentId:', testContentId);

    const response = await axios.post(publishUrl, {
      contentId: testContentId,
      platforms: {
        instagram: true  // Указываем Instagram как выбранную платформу
      }
    }, {
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DIRECTUS_TOKEN}` // Для тестирования
      }
    });

    console.log('✅ Ответ от приложения:');
    console.log(JSON.stringify(response.data, null, 2));

  } catch (error) {
    console.error('💥 Ошибка при тестировании через приложение:');
    console.error('📝 Сообщение:', error.message);
    
    if (error.response) {
      console.error('📊 Статус:', error.response.status);
      console.error('📄 Ответ:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Функция для проверки доступности N8N
async function checkN8NAvailability() {
  try {
    console.log('\n🔄 Проверяем доступность N8N сервера...');
    
    const n8nUrl = process.env.N8N_URL || 'https://n8n.roboflow.tech';
    console.log('📡 N8N URL:', n8nUrl);

    const response = await axios.get(n8nUrl, {
      timeout: 10000
    });

    console.log('✅ N8N сервер доступен');
    console.log('📊 Статус ответа:', response.status);

  } catch (error) {
    console.error('❌ N8N сервер недоступен:');
    console.error('📝 Ошибка:', error.message);
  }
}

// Основная функция
async function main() {
  console.log('🚀 Instagram N8N Workflow Test Suite');
  console.log('=====================================\n');

  // Проверяем переменные окружения
  console.log('🔧 Переменные окружения:');
  console.log('N8N_URL:', process.env.N8N_URL || 'не задана');
  console.log('APP_URL:', process.env.APP_URL || 'не задана');
  console.log('DIRECTUS_TOKEN:', process.env.DIRECTUS_TOKEN ? '[УСТАНОВЛЕН]' : 'не задан');
  console.log();

  // Проверяем доступность N8N
  await checkN8NAvailability();

  // Основной тест
  await testInstagramN8N();

  // Тест через приложение
  await testInstagramViaApp();

  console.log('\n🏁 Тестирование завершено');
}

// Запускаем тесты
main().catch(console.error);

export {
  testInstagramN8N,
  testInstagramViaApp,
  checkN8NAvailability
};
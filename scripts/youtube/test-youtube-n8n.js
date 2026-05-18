/**
 * Тестовый скрипт для проверки YouTube N8N workflow
 * Отправляет webhook в N8N для тестирования публикации видео
 */

const fetch = require('node-fetch');

const N8N_YOUTUBE_WEBHOOK = 'https://n8n.nplanner.ru/webhook/publish-youtube';

/**
 * Тестирует YouTube N8N workflow с реальными данными
 */
async function testYouTubeN8nWorkflow() {
  console.log('🔧 Тестирование YouTube N8N Workflow');
  console.log('🌐 Webhook URL:', N8N_YOUTUBE_WEBHOOK);
  
  // Тестовые данные для отправки в N8N
  const testData = {
    contentId: 'ea5a4482-8885-408e-9495-bca8293b7f85', // Реальный ID контента с видео
    platform: 'youtube'
  };
  
  console.log('📤 Отправляем данные:', JSON.stringify(testData, null, 2));
  
  try {
    console.log('⏳ Отправка webhook запроса...');
    
    const response = await fetch(N8N_YOUTUBE_WEBHOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testData)
    });
    
    console.log('📊 Статус ответа:', response.status);
    console.log('📊 Заголовки:', Object.fromEntries(response.headers.entries()));
    
    const responseText = await response.text();
    
    if (response.ok) {
      console.log('✅ Webhook успешно отправлен!');
      
      try {
        const result = JSON.parse(responseText);
        console.log('📋 Результат выполнения:');
        console.log(JSON.stringify(result, null, 2));
        
        if (result.success) {
          console.log('🎉 YouTube публикация УСПЕШНА!');
          if (result.postUrl) {
            console.log('🔗 Ссылка на видео:', result.postUrl);
          }
        } else {
          console.log('❌ YouTube публикация НЕУДАЧНА:');
          console.log('💀 Ошибка:', result.error);
          console.log('📊 Статус:', result.status);
        }
        
      } catch (parseError) {
        console.log('📄 Ответ (текст):', responseText);
      }
      
    } else {
      console.log('❌ Ошибка webhook:');
      console.log('📄 Ответ:', responseText);
    }
    
  } catch (error) {
    console.log('💥 КРИТИЧЕСКАЯ ОШИБКА:');
    console.log(error.message);
    console.log(error.stack);
  }
  
  console.log('\n🏁 Тест завершен');
}

/**
 * Тестирует валидацию входных данных
 */
async function testValidation() {
  console.log('\n🧪 Тестирование валидации входных данных');
  
  const invalidTests = [
    { name: 'Отсутствует contentId', data: { platform: 'youtube' } },
    { name: 'Отсутствует platform', data: { contentId: 'test-id' } },
    { name: 'Неверная platform', data: { contentId: 'test-id', platform: 'tiktok' } },
    { name: 'Пустые данные', data: {} }
  ];
  
  for (const test of invalidTests) {
    console.log(`\n📝 Тест: ${test.name}`);
    console.log('📤 Данные:', JSON.stringify(test.data));
    
    try {
      const response = await fetch(N8N_YOUTUBE_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(test.data)
      });
      
      const responseText = await response.text();
      console.log('📊 Статус:', response.status);
      
      try {
        const result = JSON.parse(responseText);
        console.log('📋 Результат:', JSON.stringify(result, null, 2));
      } catch {
        console.log('📄 Ответ:', responseText);
      }
      
    } catch (error) {
      console.log('❌ Ошибка:', error.message);
    }
  }
}

/**
 * Проверяет доступность N8N сервера
 */
async function checkN8nAvailability() {
  console.log('\n🔍 Проверка доступности N8N сервера');
  
  try {
    const response = await fetch('https://n8n.nplanner.ru/', {
      method: 'GET'
    });
    
    console.log('📊 Статус N8N сервера:', response.status);
    
    if (response.ok) {
      console.log('✅ N8N сервер доступен');
    } else {
      console.log('⚠️ N8N сервер вернул ошибку');
    }
    
  } catch (error) {
    console.log('❌ N8N сервер недоступен:', error.message);
  }
}

/**
 * Главная функция запуска всех тестов
 */
async function main() {
  console.log('🚀 Запуск тестирования YouTube N8N Integration');
  console.log('=' * 50);
  
  // Проверка доступности N8N
  await checkN8nAvailability();
  
  // Тест валидации
  await testValidation();
  
  // Основной тест публикации
  await testYouTubeN8nWorkflow();
  
  console.log('\n🎯 Все тесты завершены!');
  console.log('\nДля импорта workflow в N8N:');
  console.log('1. Откройте N8N: https://n8n.nplanner.ru/');
  console.log('2. Перейдите в Workflows');
  console.log('3. Import from JSON');
  console.log('4. Вставьте содержимое youtube-posting.json');
  console.log('5. Замените DIRECTUS_TOKEN_PLACEHOLDER на реальный токен');
  console.log('6. Активируйте workflow');
}

// Запуск тестов
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  testYouTubeN8nWorkflow,
  testValidation,
  checkN8nAvailability
};
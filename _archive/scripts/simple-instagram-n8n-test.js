/**
 * Простой тест N8N webhook для Instagram публикации
 * Отправляет запрос напрямую в N8N webhook для проверки
 */
import axios from 'axios';
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

async function testInstagramN8NWebhook() {
  console.log('🚀 Тестируем N8N webhook для Instagram публикации...');
  
  // Проверяем наличие N8N URL
  const N8N_URL = process.env.N8N_URL;
  if (!N8N_URL) {
    console.error('❌ N8N_URL не настроен в переменных окружения');
    return;
  }
  
  console.log(`📡 N8N URL: ${N8N_URL}`);
  
  const testData = {
    content: '🚀 Тестовый пост из SMM Manager через N8N webhook! Автоматизация Instagram работает! #SMM #test #n8n',
    imageUrl: 'https://picsum.photos/1080/1080?random=3',
    username: 'it.zhdanov',
    password: process.env.INSTAGRAM_TEST_PASSWORD,
    timestamp: new Date().toISOString(),
    platform: 'instagram'
  };
  
  try {
    console.log('📝 Данные для отправки в N8N webhook:');
    console.log(JSON.stringify(testData, null, 2));
    
    const webhookUrl = `${N8N_URL}/webhook/publish-instagram`;
    console.log(`📤 Отправляем данные в webhook: ${webhookUrl}`);
    
    // Отправляем POST запрос в N8N webhook
    const response = await axios.post(webhookUrl, testData, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });
    
    console.log('✅ Ответ от N8N webhook:', response.status);
    console.log('📋 Данные ответа:', JSON.stringify(response.data, null, 2));
    
    if (response.status === 200) {
      console.log('🎉 Тест N8N webhook успешно пройден!');
      console.log('📤 Данные отправлены в Instagram workflow');
    } else {
      console.log('⚠️ Неожиданный статус ответа:', response.status);
    }
    
  } catch (error) {
    console.error('❌ Ошибка при тестировании N8N webhook:');
    
    if (error.response) {
      console.error('Статус ответа:', error.response.status);
      console.error('Данные ответа:', error.response.data);
    } else if (error.request) {
      console.error('Нет ответа от сервера:', error.message);
    } else {
      console.error('Ошибка настройки запроса:', error.message);
    }
  }
}

// Запускаем тест
testInstagramN8NWebhook();

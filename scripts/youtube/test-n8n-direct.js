/**
 * Тест прямого вызова N8N workflow для YouTube публикации
 */
import axios from 'axios';

async function testN8NDirectCall() {
  console.log('🚀 Тестирование прямого вызова N8N workflow для YouTube...');
  
  try {
    const webhookUrl = process.env.N8N_URL ? `${process.env.N8N_URL}/webhook/publish-youtube` : 'https://n8n.roboflow.space/webhook/publish-youtube';
    
    const payload = {
      contentId: 'b6f8a5a1-5bdf-4e05-b9ad-8083f3a89702',
      platform: 'youtube'
    };
    
    console.log('📤 Отправляемые данные:', payload);
    console.log('🔗 URL:', webhookUrl);
    
    const response = await axios.post(webhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    console.log('✅ Ответ N8N:');
    console.log('📊 Статус:', response.status);
    console.log('📋 Данные:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error('❌ Ошибка при вызове N8N:');
    if (error.response) {
      console.error('📊 Статус:', error.response.status);
      console.error('📋 Данные:', error.response.data);
    } else if (error.request) {
      console.error('🔗 Запрос не дошел до сервера');
      console.error('📋 Детали:', error.message);
    } else {
      console.error('📋 Ошибка:', error.message);
    }
  }
}

// Запускаем тест
testN8NDirectCall();
/**
 * Тестовый скрипт для проверки API маршрута прямой публикации в Instagram
 */
import axios from 'axios';

async function testInstagramAPI() {
  console.log('🚀 Тестируем API маршрут для Instagram публикации...');
  
  const testData = {
    caption: '🚀 Тестовый пост из SMM Manager через API! Автоматизация работает! #SMM #test #автоматизация',
    imageUrl: 'https://picsum.photos/1080/1080?random=2'
  };
  
  try {
    console.log('📝 Данные для отправки:', JSON.stringify(testData, null, 2));
    
    // Отправляем POST запрос к нашему API
    const response = await axios.post('http://localhost:5000/api/test-instagram-publish', testData, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });
    
    console.log('✅ Ответ от API:', response.data);
    
    if (response.data.success) {
      console.log('🎉 Тест успешно пройден!');
      console.log('📤 Данные отправлены в N8N webhook для Instagram');
    } else {
      console.log('❌ Тест не пройден:', response.data.error);
    }
    
  } catch (error) {
    console.error('❌ Ошибка при тестировании API:', error.response?.data || error.message);
  }
}

// Запускаем тест
testInstagramAPI();
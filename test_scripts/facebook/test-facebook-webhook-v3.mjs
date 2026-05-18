/**
 * Скрипт для тестирования нового Facebook webhook v3
 * Отправляет запрос на публикацию существующего контента в Facebook
 */
import axios from 'axios';

async function testFacebookWebhookV3() {
  try {
    console.log('Тестирование Facebook webhook v3...');
    
    // Используем существующий пост с ID из базы данных
    const contentId = '006c2b56-ebd6-475b-a64c-0b931754e71f';
    
    console.log(`Отправляем запрос на публикацию контента с ID: ${contentId}`);
    
    // Отправляем запрос на webhook
    const response = await axios.post('http://localhost:5000/api/facebook-webhook-v3', {
      contentId
    });
    
    console.log('Ответ от webhook:');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('Статус публикации:', response.data.success ? 'Успешно' : 'Ошибка');
    
    if (response.data.permalink) {
      console.log('Ссылка на пост:', response.data.permalink);
    }
  } catch (error) {
    console.error('Ошибка при тестировании webhook:');
    
    if (error.response) {
      console.error('Статус ошибки:', error.response.status);
      console.error('Данные ошибки:', error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

// Запускаем тест
testFacebookWebhookV3();
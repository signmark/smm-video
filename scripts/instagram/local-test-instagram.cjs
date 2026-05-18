// local-test-instagram.cjs
const axios = require('axios');
require('dotenv').config();

// Directus credentials
const directusUrl = 'http://localhost:5000';
const contentId = process.argv[2] || '8186b9ef-b290-4cad-970e-c39b8afda63e';
const testUrl = `https://instagram.com/p/test_${Date.now()}`;

async function main() {
  console.log('==== ТЕСТ ЛОКАЛЬНОГО МАРШРУТА INSTAGRAM ====');
  console.log(`ID контента: ${contentId}`);
  console.log(`Тестовый URL: ${testUrl}`);
  
  try {
    // Тестирование маршрута сохранения URL
    console.log('\nОтправка запроса на /api/test/save-instagram-url...');
    const response = await axios.post(`${directusUrl}/api/test/save-instagram-url`, {
      contentId,
      postUrl: testUrl,
      messageId: `test_message_${Date.now()}`
    });
    
    console.log(`Статус ответа: ${response.status}`);
    console.log('Тело ответа:');
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.success) {
      console.log('\n✅ API запрос выполнен успешно');
    } else {
      console.log('\n❌ API запрос завершился с ошибкой');
    }
    
    // Проверяем наличие URL в ответе
    const instagramData = response.data.instagram;
    if (instagramData && instagramData.postUrl === testUrl) {
      console.log(`\n✅ URL Instagram сохранен правильно: ${instagramData.postUrl}`);
    } else {
      console.log(`\n❌ URL Instagram не сохранен или сохранен неверно`);
      console.log(`Ожидаемый URL: ${testUrl}`);
      console.log(`Полученный URL: ${instagramData?.postUrl || 'отсутствует'}`);
      
      if (response.data.error) {
        console.log(`\nОшибка API: ${response.data.error}`);
      }
    }
    
  } catch (error) {
    console.error(`\n❌ ОШИБКА: ${error.message}`);
    
    if (error.response) {
      console.error('Детали ответа API:');
      console.error(`Статус: ${error.response.status}`);
      console.error(JSON.stringify(error.response.data, null, 2));
    }
  }
}

main();
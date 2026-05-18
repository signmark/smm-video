/**
 * Скрипт для проверки исправленной интеграции с Instagram
 */

const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// Параметры для тестирования
const testData = {
  contentId: "183fa71a-3e08-401c-b2c8-6eac2e97552e", // ID контента для публикации
  platform: "instagram",
  directusToken: process.env.DIRECTUS_ADMIN_TOKEN || ''
};

/**
 * Публикует контент через API
 */
async function publishToInstagram() {
  try {
    console.log(`=== Публикация в Instagram ===`);
    console.log(`Контент ID: ${testData.contentId}`);
    
    // Отправляем запрос на публикацию
    const response = await axios.post(
      `http://localhost:5000/api/publish/now`,
      {
        contentId: testData.contentId,
        platform: testData.platform
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testData.directusToken}`
        }
      }
    );
    
    console.log(`Ответ API:`);
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.success) {
      console.log(`✅ Публикация успешно отправлена!`);
      
      if (response.data.result && response.data.result.postUrl) {
        console.log(`📱 URL публикации: ${response.data.result.postUrl}`);
      } else {
        console.log(`⚠️ URL публикации не найден в ответе API`);
      }
    } else {
      console.log(`❌ Ошибка публикации: ${response.data.error || 'Неизвестная ошибка'}`);
    }
  } catch (error) {
    console.error(`❌ ОШИБКА: ${error.message}`);
    
    if (error.response) {
      console.error(`Статус ошибки: ${error.response.status}`);
      console.error(`Детали: ${JSON.stringify(error.response.data)}`);
    }
  }
}

// Запускаем тест
publishToInstagram();
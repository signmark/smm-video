// test-instagram-url.js
const axios = require('axios');
require('dotenv').config();

// Directus credentials
const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
const adminEmail = process.env.DIRECTUS_ADMIN_EMAIL;
const adminPassword = process.env.DIRECTUS_ADMIN_PASSWORD;

// Test with a specific content ID from command line argument or use default
const contentId = process.argv[2] || '8186b9ef-b290-4cad-970e-c39b8afda63e';
const testUrl = `https://instagram.com/p/test_${Date.now()}`;

async function main() {
  console.log('==== ТЕСТ СОХРАНЕНИЯ URL INSTAGRAM ====');
  console.log(`ID контента: ${contentId}`);
  console.log(`Тестовый URL: ${testUrl}`);
  
  try {
    // 1. Аутентификация в Directus
    console.log('\n1. Получение токена администратора...');
    const authResponse = await axios.post(`${directusUrl}/auth/login`, {
      email: adminEmail,
      password: adminPassword
    });
    
    if (!authResponse?.data?.data?.access_token) {
      throw new Error('Токен не получен');
    }
    
    const token = authResponse.data.data.access_token;
    console.log(`Токен получен: ${token.substring(0, 10)}...`);
    
    // 2. Получение текущих данных контента
    console.log('\n2. Получение исходных данных контента...');
    const initialResponse = await axios.get(
      `${directusUrl}/items/campaign_content/${contentId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!initialResponse?.data?.data) {
      throw new Error('Данные контента не получены');
    }
    
    const initialData = initialResponse.data.data;
    console.log('Исходные данные получены');
    
    // Парсинг текущих social_platforms
    let currentPlatforms = {};
    if (initialData.social_platforms) {
      if (typeof initialData.social_platforms === 'string') {
        currentPlatforms = JSON.parse(initialData.social_platforms);
      } else if (typeof initialData.social_platforms === 'object') {
        currentPlatforms = {...initialData.social_platforms};
      }
    }
    
    console.log(`Текущие платформы: ${Object.keys(currentPlatforms).join(', ') || 'нет'}`);
    
    // 3. Обновление данных Instagram
    console.log('\n3. Обновление данных Instagram...');
    const instagramData = {
      platform: 'instagram',
      status: 'published',
      publishedAt: new Date().toISOString(),
      postUrl: testUrl,
      messageId: `test_${Date.now()}`
    };
    
    // Добавляем или обновляем данные Instagram
    currentPlatforms.instagram = instagramData;
    
    // 4. Сохранение обновленных данных
    console.log('\n4. Сохранение обновленных данных...');
    const updateResponse = await axios.patch(
      `${directusUrl}/items/campaign_content/${contentId}`,
      {
        social_platforms: currentPlatforms
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!updateResponse?.data?.data) {
      throw new Error('Ошибка при обновлении данных');
    }
    
    console.log('Данные успешно обновлены');
    
    // 5. Проверка сохранения
    console.log('\n5. Проверка сохранения данных...');
    const finalResponse = await axios.get(
      `${directusUrl}/items/campaign_content/${contentId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!finalResponse?.data?.data) {
      throw new Error('Не удалось получить обновленные данные');
    }
    
    // Парсинг обновленных social_platforms
    let finalPlatforms = {};
    const finalData = finalResponse.data.data;
    
    if (finalData.social_platforms) {
      if (typeof finalData.social_platforms === 'string') {
        finalPlatforms = JSON.parse(finalData.social_platforms);
      } else if (typeof finalData.social_platforms === 'object') {
        finalPlatforms = {...finalData.social_platforms};
      }
    }
    
    console.log(`Финальные платформы: ${Object.keys(finalPlatforms).join(', ') || 'нет'}`);
    
    // Проверяем URL Instagram
    if (finalPlatforms.instagram && finalPlatforms.instagram.postUrl === testUrl) {
      console.log(`\n✅ УСПЕХ: URL Instagram сохранен правильно: ${finalPlatforms.instagram.postUrl}`);
    } else {
      console.log(`\n❌ ОШИБКА: URL Instagram не сохранен или сохранен неверно`);
      console.log(`Ожидаемый URL: ${testUrl}`);
      console.log(`Полученный URL: ${finalPlatforms.instagram?.postUrl || 'отсутствует'}`);
    }

    console.log('\n====================================');
    console.log('Исходные данные платформ:');
    console.log(JSON.stringify(currentPlatforms, null, 2));
    
    console.log('\nФинальные данные платформ:');
    console.log(JSON.stringify(finalPlatforms, null, 2));
    console.log('====================================');
    
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
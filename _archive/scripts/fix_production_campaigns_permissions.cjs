/**
 * Скрипт для исправления прав доступа к коллекции campaigns на продакшене
 * Предоставляет пользовательской роли права на чтение campaigns
 */

const axios = require('axios');

const PRODUCTION_URL = 'https://directus.nplanner.ru';

async function getAdminToken() {
  try {
    console.log('Получение административного токена...');
    
    // Пробуем разные варианты админа
    const adminVariants = [
      { email: 'admin@nplanner.ru', password: 'QtpZ3dh7' },
      { email: 'lbrspb@gmail.com', password: 'QtpZ3dh7' },
      { email: 'admin@roboflow.tech', password: 'QtpZ3dh7' }
    ];
    
    for (const admin of adminVariants) {
      try {
        const response = await axios.post(`${PRODUCTION_URL}/auth/login`, admin);
        if (response.data?.data?.access_token) {
          console.log(`Успешная авторизация как ${admin.email}`);
          return response.data.data.access_token;
        }
      } catch (err) {
        console.log(`Не удалось авторизоваться как ${admin.email}`);
      }
    }
    
    throw new Error('Не удалось получить административный токен');
  } catch (error) {
    console.error('Ошибка получения токена:', error.message);
    throw error;
  }
}

async function checkCurrentPermissions(token) {
  try {
    console.log('Проверка текущих прав на campaigns...');
    
    const response = await axios.get(`${PRODUCTION_URL}/permissions`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        'filter[collection][_eq]': 'campaigns',
        'filter[role][_eq]': '285bde69-2f04-4f3f-989c-f7dfec3dd405'
      }
    });
    
    console.log('Текущие права на campaigns:', response.data.data);
    return response.data.data;
  } catch (error) {
    console.error('Ошибка проверки прав:', error.message);
    return [];
  }
}

async function createCampaignsReadPermission(token) {
  try {
    console.log('Создание права на чтение campaigns...');
    
    const permissionData = {
      collection: 'campaigns',
      role: '285bde69-2f04-4f3f-989c-f7dfec3dd405', // SMM Manager User роль
      action: 'read',
      permissions: {
        user_id: {
          _eq: '$CURRENT_USER'
        }
      },
      validation: {},
      presets: {},
      fields: ['*']
    };
    
    const response = await axios.post(`${PRODUCTION_URL}/permissions`, permissionData, {
      headers: { 
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Право на чтение campaigns создано:', response.data.data);
    return response.data.data;
  } catch (error) {
    console.error('Ошибка создания права на чтение:', error.response?.data || error.message);
    throw error;
  }
}

async function checkCampaignKeywordsPermissions(token) {
  try {
    console.log('Проверка прав на campaign_keywords...');
    
    const response = await axios.get(`${PRODUCTION_URL}/permissions`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        'filter[collection][_eq]': 'campaign_keywords',
        'filter[role][_eq]': '285bde69-2f04-4f3f-989c-f7dfec3dd405'
      }
    });
    
    console.log('Права на campaign_keywords:', response.data.data);
    return response.data.data;
  } catch (error) {
    console.error('Ошибка проверки прав на campaign_keywords:', error.message);
    return [];
  }
}

async function testKeywordCreation(userToken, campaignId) {
  try {
    console.log(`Тестирование создания ключевого слова в кампании ${campaignId}...`);
    
    const testData = {
      keyword: 'test_keyword_after_fix',
      campaign_id: campaignId,
      trend_score: 100,
      mentions_count: 50,
      date_created: new Date().toISOString(),
      last_checked: new Date().toISOString()
    };
    
    const response = await axios.post(`${PRODUCTION_URL}/items/campaign_keywords`, testData, {
      headers: { 
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Тестовое ключевое слово успешно создано:', response.data.data);
    
    // Удаляем тестовое ключевое слово
    await axios.delete(`${PRODUCTION_URL}/items/campaign_keywords/${response.data.data.id}`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    
    console.log('Тестовое ключевое слово удалено');
    return true;
  } catch (error) {
    console.error('Ошибка тестирования:', error.response?.data || error.message);
    return false;
  }
}

async function main() {
  try {
    console.log('=== ИСПРАВЛЕНИЕ ПРАВ ДОСТУПА НА ПРОДАКШЕНЕ ===');
    
    // Получаем административный токен
    const adminToken = await getAdminToken();
    
    // Проверяем текущие права
    await checkCurrentPermissions(adminToken);
    await checkCampaignKeywordsPermissions(adminToken);
    
    // Создаем право на чтение campaigns
    await createCampaignsReadPermission(adminToken);
    
    // Получаем пользовательский токен для тестирования
    console.log('Получение пользовательского токена для тестирования...');
    const userResponse = await axios.post(`${PRODUCTION_URL}/auth/login`, {
      email: 'lbrspb@gmail.com',
      password: 'QtpZ3dh7'
    });
    
    const userToken = userResponse.data.data.access_token;
    
    // Проверяем доступ к кампаниям
    console.log('Проверка доступа к кампаниям...');
    const campaignsResponse = await axios.get(`${PRODUCTION_URL}/items/campaigns`, {
      headers: { Authorization: `Bearer ${userToken}` },
      params: {
        'filter[user_id][_eq]': '53921f16-f51d-4591-80b9-8caa4fde4d13',
        'fields': 'id,name',
        'limit': 1
      }
    });
    
    if (campaignsResponse.data.data && campaignsResponse.data.data.length > 0) {
      const testCampaignId = campaignsResponse.data.data[0].id;
      console.log(`Найдена кампания для тестирования: ${testCampaignId}`);
      
      // Тестируем создание ключевого слова
      const testResult = await testKeywordCreation(userToken, testCampaignId);
      
      if (testResult) {
        console.log('✅ ИСПРАВЛЕНИЕ ЗАВЕРШЕНО УСПЕШНО');
        console.log('Пользователи теперь могут добавлять ключевые слова в свои кампании');
      } else {
        console.log('❌ Тест не прошел, возможно нужны дополнительные права');
      }
    } else {
      console.log('❌ Кампании не найдены, проверьте права доступа');
    }
    
  } catch (error) {
    console.error('❌ ОШИБКА:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
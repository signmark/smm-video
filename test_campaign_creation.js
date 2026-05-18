/**
 * Тест создания кампании для диагностики проблемы
 */

import axios from 'axios';

const DIRECTUS_URL = 'https://directus.roboflow.tech';
const ADMIN_EMAIL = 'lbrspb@gmail.com';
const ADMIN_PASSWORD = 'QtpZ3dh7';

async function authenticate() {
  try {
    const response = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    
    return response.data.data.access_token;
  } catch (error) {
    console.error('Ошибка авторизации:', error.response?.data || error.message);
    throw error;
  }
}

async function checkCollectionStructure(token) {
  try {
    console.log('Проверка структуры коллекции user_campaigns...');
    
    const response = await axios.get(`${DIRECTUS_URL}/fields/user_campaigns`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Поля коллекции user_campaigns:');
    response.data.data.forEach(field => {
      console.log(`- ${field.field} (${field.type})`);
    });
    
    return response.data.data;
  } catch (error) {
    console.error('Ошибка при проверке структуры коллекции:', error.response?.data || error.message);
    return null;
  }
}

async function testCampaignCreation(token) {
  try {
    console.log('Тестирование создания кампании...');
    
    const campaignData = {
      name: 'Test Campaign',
      description: 'Test Description',
      user_id: '2b4812a5-5b7f-4cef-b762-30cc4379431d'
    };
    
    console.log('Данные для создания:', campaignData);
    
    const response = await axios.post(`${DIRECTUS_URL}/items/user_campaigns`, campaignData, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Кампания создана успешно:', response.data);
    return response.data;
    
  } catch (error) {
    console.error('Ошибка создания кампании:');
    console.error('Статус:', error.response?.status);
    console.error('Данные ошибки:', JSON.stringify(error.response?.data, null, 2));
    return null;
  }
}

async function listExistingCampaigns(token) {
  try {
    console.log('Проверка существующих кампаний...');
    
    const response = await axios.get(`${DIRECTUS_URL}/items/user_campaigns`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Найдено ${response.data.data.length} кампаний`);
    if (response.data.data.length > 0) {
      console.log('Первая кампания:', response.data.data[0]);
    }
    
    return response.data.data;
    
  } catch (error) {
    console.error('Ошибка при получении кампаний:', error.response?.data || error.message);
    return null;
  }
}

async function main() {
  try {
    console.log('=== Диагностика создания кампаний ===\n');
    
    // Авторизация
    const token = await authenticate();
    console.log('Авторизация успешна\n');
    
    // Проверка структуры коллекции
    const fields = await checkCollectionStructure(token);
    console.log('');
    
    // Проверка существующих кампаний
    const existingCampaigns = await listExistingCampaigns(token);
    console.log('');
    
    // Тест создания кампании
    const newCampaign = await testCampaignCreation(token);
    
    console.log('\n=== Результат ===');
    if (newCampaign) {
      console.log('✅ Кампания создана успешно');
    } else {
      console.log('❌ Не удалось создать кампанию');
    }
    
  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
  }
}

main();
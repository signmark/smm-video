/**
 * Скрипт для проверки доступа к API с использованием административного токена
 * 
 * Использование:
 * node scripts/test_admin_token.js [TOKEN]
 * 
 * Если токен не указан в аргументах, скрипт пытается использовать DIRECTUS_ADMIN_TOKEN из .env
 */

require('dotenv').config();
const axios = require('axios');

// URL Directus API
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';

// Получаем токен из аргументов командной строки или из переменных окружения
const token = process.argv[2] || process.env.DIRECTUS_ADMIN_TOKEN;

async function testAdminToken(adminToken) {
  if (!adminToken) {
    console.error('Ошибка: токен администратора не найден');
    console.log('Укажите токен в аргументе или в переменной DIRECTUS_ADMIN_TOKEN в файле .env');
    process.exit(1);
  }

  console.log(`Тестирование токена администратора...`);
  
  try {
    // Получаем информацию о текущем пользователе
    const userResponse = await axios.get(`${DIRECTUS_URL}/users/me`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    });
    
    if (!userResponse.data || !userResponse.data.data) {
      console.error('Ошибка: неверный формат ответа API');
      process.exit(1);
    }
    
    const userData = userResponse.data.data;
    
    console.log(`\n✅ Токен действителен!`);
    console.log(`\nИнформация о пользователе:`);
    console.log(`ID: ${userData.id}`);
    console.log(`Email: ${userData.email}`);
    console.log(`Имя: ${userData.first_name} ${userData.last_name}`);
    console.log(`Роль: ${userData.role?.name || userData.role}`);
    
    // Проверяем доступ к коллекции campaign_content
    console.log(`\nПроверка доступа к коллекции campaign_content...`);
    
    const contentResponse = await axios.get(`${DIRECTUS_URL}/items/campaign_content`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`
      },
      params: {
        limit: 1
      }
    });
    
    if (contentResponse.data) {
      console.log(`✅ Доступ к коллекции campaign_content успешен!`);
      console.log(`Получено элементов: ${contentResponse.data.data?.length || 0}`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Ошибка при использовании токена:', error.message);
    
    if (error.response) {
      console.error('Детали ошибки API:');
      console.error(`Статус: ${error.response.status}`);
      console.error('Данные:', JSON.stringify(error.response.data, null, 2));
    }
    
    return false;
  }
}

// Запускаем проверку токена
testAdminToken(token);
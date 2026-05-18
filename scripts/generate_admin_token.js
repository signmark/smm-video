/**
 * Скрипт для генерации долгоживущего административного токена Directus
 * 
 * Использование:
 * node scripts/generate_admin_token.js EMAIL PASSWORD
 * 
 * Полученный токен должен быть добавлен в переменную DIRECTUS_ADMIN_TOKEN в файле .env
 */

const axios = require('axios');

// URL Directus API
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';

async function generateAdminToken(email, password) {
  if (!email || !password) {
    console.error('Ошибка: необходимо указать email и пароль администратора');
    console.log('Использование: node generate_admin_token.js EMAIL PASSWORD');
    process.exit(1);
  }

  try {
    console.log(`Попытка авторизации с учетными данными администратора...`);
    
    // Получаем токен авторизации
    const authResponse = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email,
      password
    });
    
    if (!authResponse.data || !authResponse.data.data || !authResponse.data.data.access_token) {
      console.error('Ошибка: неверный формат ответа API');
      process.exit(1);
    }
    
    const token = authResponse.data.data.access_token;
    const refreshToken = authResponse.data.data.refresh_token;
    const expiresIn = authResponse.data.data.expires || 900000; // 15 минут по умолчанию
    
    console.log(`Токен авторизации успешно получен!`);
    console.log(`Срок действия токена: ${expiresIn / 1000 / 60} минут`);
    console.log(`\nДолгоживущий токен администратора:`);
    console.log(`\nDIRECTUS_ADMIN_TOKEN="${token}"`);
    console.log(`\nДобавьте этот токен в файл .env`);
    
    // Также выводим refresh token для возможности продления
    console.log(`\nRefresh Token (для продления токена):`);
    console.log(refreshToken);
    
    return token;
  } catch (error) {
    console.error('Ошибка при получении токена:', error.message);
    
    if (error.response) {
      console.error('Детали ошибки API:', JSON.stringify(error.response.data, null, 2));
    }
    
    process.exit(1);
  }
}

// Получаем email и пароль из аргументов командной строки
const email = process.argv[2];
const password = process.argv[3];

// Запускаем генерацию токена
generateAdminToken(email, password);
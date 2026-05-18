/**
 * Скрипт для создания статического токена администратора через Directus API
 * 
 * Статические токены имеют неограниченный срок действия и идеально подходят
 * для системных операций, таких как планировщик публикаций
 * 
 * Использование:
 * node scripts/create_static_admin_token.js EMAIL PASSWORD
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// URL Directus API
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
const ENV_FILE = path.resolve(__dirname, '../.env');

async function createStaticToken(email, password) {
  if (!email || !password) {
    console.error('Ошибка: необходимо указать email и пароль администратора');
    console.log('Использование: node create_static_admin_token.js EMAIL PASSWORD');
    process.exit(1);
  }

  try {
    console.log(`Шаг 1/3: Авторизация с учетными данными администратора...`);
    
    // Получаем временный токен авторизации
    const authResponse = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email,
      password
    });
    
    if (!authResponse.data?.data?.access_token) {
      console.error('Ошибка: неверный формат ответа API при авторизации');
      process.exit(1);
    }
    
    const temporaryToken = authResponse.data.data.access_token;
    console.log(`✅ Успешная авторизация`);
    
    // Создаем статический токен
    console.log(`\nШаг 2/3: Создание статического токена...`);
    
    const tokenName = `scheduler_token_${new Date().toISOString().slice(0, 10)}`;
    
    const tokenResponse = await axios.post(
      `${DIRECTUS_URL}/users/me/tokens`,
      {
        name: tokenName,
        // Не указываем срок действия токена, чтобы он был постоянным
      },
      {
        headers: {
          'Authorization': `Bearer ${temporaryToken}`
        }
      }
    );
    
    if (!tokenResponse.data?.data?.token) {
      console.error('Ошибка: неверный формат ответа API при создании токена');
      process.exit(1);
    }
    
    const staticToken = tokenResponse.data.data.token;
    console.log(`✅ Статический токен успешно создан`);
    
    // Обновляем .env файл
    console.log(`\nШаг 3/3: Сохранение токена в .env файл...`);
    
    // Читаем текущее содержимое .env файла
    let envContent = fs.readFileSync(ENV_FILE, 'utf8');
    
    // Регулярное выражение для поиска строки с DIRECTUS_ADMIN_TOKEN
    const tokenRegex = /DIRECTUS_ADMIN_TOKEN=".*"/;
    
    if (envContent.match(tokenRegex)) {
      // Заменяем существующий токен
      envContent = envContent.replace(tokenRegex, `DIRECTUS_ADMIN_TOKEN="${staticToken}"`);
    } else {
      // Добавляем новую переменную
      envContent += `\nDIRECTUS_ADMIN_TOKEN="${staticToken}"\n`;
    }
    
    // Записываем обновленное содержимое в файл
    fs.writeFileSync(ENV_FILE, envContent);
    
    console.log(`✅ Токен сохранен в .env файл`);
    
    console.log(`\n🎉 Процесс успешно завершен!`);
    console.log(`\nСтатический токен администратора:`);
    console.log(`\nDIRECTUS_ADMIN_TOKEN="${staticToken}"`);
    console.log(`\nЭтот токен не имеет срока действия и будет работать постоянно.`);
    console.log(`\nПерезапустите приложение, чтобы токен вступил в силу.`);
    
    return staticToken;
  } catch (error) {
    console.error('\n❌ Ошибка при создании токена:', error.message);
    
    if (error.response) {
      console.error('Детали ошибки API:');
      console.error(`Статус: ${error.response.status}`);
      console.error(`Данные:`, JSON.stringify(error.response.data, null, 2));
    }
    
    process.exit(1);
  }
}

// Получаем email и пароль из аргументов командной строки
const email = process.argv[2];
const password = process.argv[3];

// Запускаем создание токена
createStaticToken(email, password);
/**
 * Скрипт для сохранения кэшированного токена администратора в переменную окружения
 * 
 * Этот скрипт использует существующие механизмы кэширования токенов в приложении
 * и записывает найденный токен в .env файл
 */

const fs = require('fs');
const path = require('path');
const { directusApiManager } = require('../server/directus');

// ID администратора из env
const ADMIN_USER_ID = process.env.DIRECTUS_ADMIN_USER_ID || '53921f16-f51d-4591-80b9-8caa4fde4d13';

// Путь к файлу .env
const ENV_PATH = path.resolve(__dirname, '../.env');

function updateEnvFile(token) {
  try {
    // Читаем текущее содержимое .env файла
    let envContent = fs.readFileSync(ENV_PATH, 'utf8');
    
    // Проверяем, существует ли переменная DIRECTUS_ADMIN_TOKEN
    if (envContent.includes('DIRECTUS_ADMIN_TOKEN=')) {
      // Заменяем существующую переменную новым значением
      envContent = envContent.replace(
        /DIRECTUS_ADMIN_TOKEN=".*"/g,
        `DIRECTUS_ADMIN_TOKEN="${token}"`
      );
    } else {
      // Добавляем новую переменную в конец файла
      envContent += `\nDIRECTUS_ADMIN_TOKEN="${token}"\n`;
    }
    
    // Записываем обновленное содержимое в .env файл
    fs.writeFileSync(ENV_PATH, envContent);
    
    console.log(`Токен администратора успешно сохранен в файл .env`);
    return true;
  } catch (error) {
    console.error(`Ошибка при обновлении файла .env: ${error.message}`);
    return false;
  }
}

function saveCachedAdminToken() {
  // Проверяем, есть ли у нас кэшированный токен для администратора
  const cachedToken = directusApiManager.getCachedToken(ADMIN_USER_ID);
  
  if (cachedToken && cachedToken.token) {
    console.log(`Найден кэшированный токен для администратора ${ADMIN_USER_ID}`);
    console.log(`Срок действия токена: до ${new Date(cachedToken.expiresAt).toLocaleString()}`);
    
    // Обновляем .env файл
    const success = updateEnvFile(cachedToken.token);
    
    if (success) {
      console.log(`\nДолгоживущий токен администратора:`);
      console.log(`\nDIRECTUS_ADMIN_TOKEN="${cachedToken.token}"`);
    }
    
    return cachedToken.token;
  } else {
    console.error(`Кэшированный токен для администратора ${ADMIN_USER_ID} не найден`);
    console.log('Запустите приложение и выполните вход с учетными данными администратора,');
    console.log('затем повторно запустите этот скрипт');
    return null;
  }
}

// Запускаем сохранение токена
saveCachedAdminToken();
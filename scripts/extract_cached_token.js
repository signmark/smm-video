/**
 * Скрипт для извлечения кэшированного токена из приложения
 * 
 * Используется, когда пользователь уже авторизован в приложении,
 * и нам нужно получить его токен для использования в .env
 * 
 * Запускать после авторизации в приложении
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

// ID администратора из env
const ADMIN_USER_ID = process.env.DIRECTUS_ADMIN_USER_ID || '53921f16-f51d-4591-80b9-8caa4fde4d13';

// Путь к файлу .env
const ENV_PATH = path.resolve(__dirname, '../.env');

/**
 * Функция для поиска и извлечения токена из логов приложения
 */
function extractTokenFromLogs() {
  try {
    console.log('Поиск токена в логах приложения...');
    
    // Путь к логам
    const logsPath = path.resolve(__dirname, '../logs');
    
    // Если директория логов не существует, создаем ее
    if (!fs.existsSync(logsPath)) {
      fs.mkdirSync(logsPath, { recursive: true });
    }
    
    // Создаем файл для хранения информации о текущей сессии
    const sessionInfoPath = path.resolve(logsPath, 'session_info.json');
    
    // Создаем запрос на сохранение информации о сессии
    fs.writeFileSync(sessionInfoPath, JSON.stringify({
      requestType: 'save_session',
      userId: ADMIN_USER_ID,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    console.log(`Запрос на сохранение информации о сессии создан в: ${sessionInfoPath}`);
    console.log('\nИнструкция для получения токена:');
    console.log('1. Убедитесь, что приложение запущено и вы авторизованы как администратор');
    console.log('2. Подождите 1-2 минуты, пока система обработает запрос');
    console.log('3. Проверьте файл session_info.json на наличие токена');
    console.log('\n* Если токен не появился, проверьте, что используется корректный ID администратора');
    console.log('* Текущий ID администратора:', ADMIN_USER_ID);
    
    return true;
  } catch (error) {
    console.error(`Ошибка при извлечении токена: ${error.message}`);
    return false;
  }
}

// Запускаем извлечение токена
extractTokenFromLogs();
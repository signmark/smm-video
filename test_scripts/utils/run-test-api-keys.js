/**
 * Скрипт для проверки загрузки API ключей из user_api_keys
 * Запустите: node run-test-api-keys.js
 */

import axios from 'axios';
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

// Хранилище для API ключей внешних сервисов
const apiKeys = {
  perplexity: '',
  apify: '',
  deepseek: '',
  falai: '',
  claude: '',
  xmlriver: {
    userId: '',
    apiKey: ''
  }
};

/**
 * Авторизуется в Directus и получает токен доступа
 * @returns {Promise<string|null>} Токен доступа
 */
async function authenticate() {
  const email = process.env.DIRECTUS_ADMIN_EMAIL;
  const password = process.env.DIRECTUS_ADMIN_PASSWORD;
  const directusUrl = process.env.DIRECTUS_URL || 'https://cms.smm-manager.ru';
  
  if (!email || !password) {
    console.error('Отсутствуют учетные данные DIRECTUS_ADMIN_EMAIL или DIRECTUS_ADMIN_PASSWORD');
    return null;
  }
  
  try {
    console.log(`Авторизация в Directus (${email})...`);
    const response = await axios.post(`${directusUrl}/auth/login`, {
      email,
      password
    });
    
    if (response.data && response.data.data && response.data.data.access_token) {
      console.log('Авторизация успешна');
      return response.data.data.access_token;
    } else {
      console.error('Ошибка авторизации: нет токена в ответе');
      return null;
    }
  } catch (error) {
    console.error('Ошибка авторизации:', error.message);
    if (error.response) {
      console.error('Детали ошибки:', JSON.stringify(error.response.data));
    }
    return null;
  }
}

/**
 * Загружает API ключи из user_api_keys
 * @param {string} token Токен авторизации Directus
 */
async function loadApiKeys(token) {
  const directusUrl = process.env.DIRECTUS_URL || 'https://cms.smm-manager.ru';
  
  try {
    console.log('Загрузка API ключей из user_api_keys...');
    
    const response = await axios.get(`${directusUrl}/items/user_api_keys`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (response.data && response.data.data && response.data.data.length > 0) {
      console.log(`Найдено ${response.data.data.length} записей с API ключами:`);
      console.log(JSON.stringify(response.data.data, null, 2));
      
      // Обрабатываем полученные ключи
      for (const keyData of response.data.data) {
        if (keyData.service_name && keyData.api_key) {
          switch (keyData.service_name.toLowerCase()) {
            case 'perplexity':
              apiKeys.perplexity = keyData.api_key;
              console.log('✓ Загружен ключ для Perplexity API');
              break;
            case 'apify':
              apiKeys.apify = keyData.api_key;
              console.log('✓ Загружен ключ для Apify API');
              break;
            case 'deepseek':
              apiKeys.deepseek = keyData.api_key;
              console.log('✓ Загружен ключ для DeepSeek API');
              break;
            case 'fal_ai':
              apiKeys.falai = keyData.api_key;
              console.log('✓ Загружен ключ для FAL.AI API');
              break;
            case 'claude':
              apiKeys.claude = keyData.api_key;
              console.log('✓ Загружен ключ для Claude AI API');
              break;
            case 'xmlriver':
              // Для XMLRiver, ключ может храниться как JSON-строка
              try {
                const xmlriverData = JSON.parse(keyData.api_key);
                if (xmlriverData.user && xmlriverData.key) {
                  apiKeys.xmlriver.userId = xmlriverData.user;
                  apiKeys.xmlriver.apiKey = xmlriverData.key;
                  console.log('✓ Загружен составной ключ для XMLRiver из JSON');
                }
              } catch (e) {
                // Если это не JSON, то проверяем другие форматы
                if (keyData.api_key.includes(':')) {
                  const [userId, apiKey] = keyData.api_key.split(':');
                  apiKeys.xmlriver.userId = userId;
                  apiKeys.xmlriver.apiKey = apiKey;
                  console.log('✓ Загружен составной ключ для XMLRiver из строки с разделителем');
                }
              }
              break;
            default:
              console.log(`✓ Найден ключ для сервиса: ${keyData.service_name}`);
          }
        }
      }
      
      // Выводим итоговое состояние ключей
      console.log('\nИтоговое состояние API ключей:');
      const safeApiKeys = {
        ...apiKeys,
        perplexity: apiKeys.perplexity ? '******' : '',
        apify: apiKeys.apify ? '******' : '',
        deepseek: apiKeys.deepseek ? '******' : '',
        falai: apiKeys.falai ? '******' : '',
        claude: apiKeys.claude ? '******' : '',
        xmlriver: {
          userId: apiKeys.xmlriver.userId ? '******' : '',
          apiKey: apiKeys.xmlriver.apiKey ? '******' : ''
        }
      };
      console.log(JSON.stringify(safeApiKeys, null, 2));
    } else {
      console.warn('API ключи не найдены в таблице user_api_keys');
    }
  } catch (error) {
    console.error('Ошибка при загрузке API ключей:', error.message);
    if (error.response) {
      console.error('Детали ошибки:', JSON.stringify(error.response.data));
    }
  }
}

/**
 * Основная функция
 */
async function main() {
  try {
    // Получаем токен авторизации
    const token = await authenticate();
    
    if (token) {
      // Загружаем API ключи
      await loadApiKeys(token);
    }
  } catch (error) {
    console.error('Ошибка выполнения скрипта:', error.message);
  }
}

// Запускаем основную функцию
main();

// Экспортируем функции для использования в тестах
export {
  authenticate,
  loadApiKeys,
  apiKeys
};
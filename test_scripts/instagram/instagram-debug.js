/**
 * Скрипт для отладки Instagram API интеграции
 * Этот скрипт проверяет каждый шаг процесса публикации в Instagram по отдельности
 */

const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// Параметры для тестирования
const CONFIG = {
  instagram: {
    token: process.env.INSTAGRAM_TOKEN || '',
    businessAccountId: process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || ''
  },
  testImage: 'https://i.imgur.com/abc123.jpg' // Заменить на реальное изображение
};

// Функция для логирования
function log(message) {
  console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}

/**
 * Шаг 1: Проверка доступа и токена
 */
async function checkCredentials() {
  log('=== ПРОВЕРКА УЧЕТНЫХ ДАННЫХ ===');
  try {
    const baseUrl = 'https://graph.facebook.com/v17.0';
    
    // Проверяем информацию о бизнес-аккаунте
    const accountUrl = `${baseUrl}/${CONFIG.instagram.businessAccountId}`;
    
    log(`Отправляем запрос к ${accountUrl}`);
    const response = await axios.get(accountUrl, {
      params: {
        fields: 'name,username,profile_picture_url',
        access_token: CONFIG.instagram.token
      }
    });
    
    log('Ответ API:');
    console.log(response.data);
    
    return true;
  } catch (error) {
    log(`❌ ОШИБКА: ${error.message}`);
    
    if (error.response) {
      log(`Статус ошибки: ${error.response.status}`);
      log(`Детали: ${JSON.stringify(error.response.data)}`);
    }
    
    return false;
  }
}

/**
 * Шаг 2: Создание контейнера для изображения
 */
async function createContainer() {
  log('=== СОЗДАНИЕ КОНТЕЙНЕРА ДЛЯ МЕДИА ===');
  try {
    const baseUrl = 'https://graph.facebook.com/v17.0';
    const containerUrl = `${baseUrl}/${CONFIG.instagram.businessAccountId}/media`;
    
    // Параметры запроса
    const containerParams = {
      caption: 'Тестовая публикация для отладки API Instagram',
      image_url: CONFIG.testImage,
      access_token: CONFIG.instagram.token
    };
    
    log(`Отправляем запрос на создание контейнера: ${containerUrl}`);
    log(`С изображением: ${CONFIG.testImage}`);
    
    const containerResponse = await axios.post(
      containerUrl, 
      containerParams, 
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000
      }
    );
    
    log('Ответ API:');
    console.log(containerResponse.data);
    
    return containerResponse.data.id;
  } catch (error) {
    log(`❌ ОШИБКА: ${error.message}`);
    
    if (error.response) {
      log(`Статус ошибки: ${error.response.status}`);
      log(`Детали: ${JSON.stringify(error.response.data)}`);
    }
    
    return null;
  }
}

/**
 * Шаг 3: Публикация контейнера
 */
async function publishContainer(containerId) {
  log('=== ПУБЛИКАЦИЯ КОНТЕЙНЕРА ===');
  try {
    if (!containerId) {
      log('❌ Отсутствует ID контейнера, публикация невозможна');
      return null;
    }
    
    const baseUrl = 'https://graph.facebook.com/v17.0';
    const publishUrl = `${baseUrl}/${CONFIG.instagram.businessAccountId}/media_publish`;
    
    // Параметры запроса
    const publishParams = {
      creation_id: containerId,
      access_token: CONFIG.instagram.token
    };
    
    log(`Отправляем запрос на публикацию контейнера ${containerId}`);
    
    const publishResponse = await axios.post(
      publishUrl, 
      publishParams, 
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      }
    );
    
    log('Ответ API:');
    console.log(publishResponse.data);
    
    return publishResponse.data.id;
  } catch (error) {
    log(`❌ ОШИБКА: ${error.message}`);
    
    if (error.response) {
      log(`Статус ошибки: ${error.response.status}`);
      log(`Детали: ${JSON.stringify(error.response.data)}`);
    }
    
    return null;
  }
}

/**
 * Шаг 4: Получение постоянной ссылки
 */
async function getPermalink(mediaId) {
  log('=== ПОЛУЧЕНИЕ ПОСТОЯННОЙ ССЫЛКИ ===');
  try {
    if (!mediaId) {
      log('❌ Отсутствует ID медиа, получение ссылки невозможно');
      return null;
    }
    
    const baseUrl = 'https://graph.facebook.com/v17.0';
    const mediaInfoUrl = `${baseUrl}/${mediaId}`;
    
    log(`Отправляем запрос на получение информации о медиа ${mediaId}`);
    
    const mediaInfoResponse = await axios.get(mediaInfoUrl, {
      params: {
        fields: 'permalink',
        access_token: CONFIG.instagram.token
      },
      timeout: 30000
    });
    
    log('Ответ API:');
    console.log(mediaInfoResponse.data);
    
    return mediaInfoResponse.data.permalink;
  } catch (error) {
    log(`❌ ОШИБКА: ${error.message}`);
    
    if (error.response) {
      log(`Статус ошибки: ${error.response.status}`);
      log(`Детали: ${JSON.stringify(error.response.data)}`);
    }
    
    return null;
  }
}

/**
 * Запускает все шаги последовательно
 */
async function runTest() {
  log('====================================');
  log('🧪 ЗАПУСК ТЕСТОВ ПУБЛИКАЦИИ В INSTAGRAM');
  log('====================================');
  log(`🔑 Используем Business Account ID: ${CONFIG.instagram.businessAccountId}`);
  log('====================================');
  
  // Шаг 1: Проверка учетных данных
  const credentialsOk = await checkCredentials();
  if (!credentialsOk) {
    log('❌ Проверка учетных данных не пройдена');
    return;
  }
  
  // Шаг 2: Создание контейнера
  const containerId = await createContainer();
  if (!containerId) {
    log('❌ Создание контейнера не удалось');
    return;
  }
  
  // Шаг 3: Публикация контейнера
  const mediaId = await publishContainer(containerId);
  if (!mediaId) {
    log('❌ Публикация контейнера не удалась');
    return;
  }
  
  // Шаг 4: Получение постоянной ссылки
  const permalink = await getPermalink(mediaId);
  if (!permalink) {
    log('⚠️ Получение постоянной ссылки не удалось, но публикация может быть успешной');
  } else {
    log(`✅ Получена постоянная ссылка: ${permalink}`);
  }
  
  log('====================================');
  log('✅ ТЕСТЫ УСПЕШНО ЗАВЕРШЕНЫ');
  log('====================================');
}

// Запускаем тесты
runTest();
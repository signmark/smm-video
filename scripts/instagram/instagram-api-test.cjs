/**
 * Интеграционный тест для основного API Instagram
 * Проверяет публикацию через основной API маршрут /api/content/:id/publish-social
 * 
 * Как запустить:
 * node instagram-api-test.cjs
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Константы для тестирования
const API_URL = 'http://localhost:5000';
const CAMPAIGN_ID = '46868c44-c6a4-4bed-accf-9ad07bba790e';
const TEST_IMAGE_URL = 'https://picsum.photos/800/800'; // Квадратное изображение 1:1
const TEST_TEXT = `Интеграционный тест Instagram API через основной маршрут - ${new Date().toISOString()}`;

// Цвета для вывода в консоль
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Функция логирования с отметкой времени
function log(message, color = 'reset') {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`${colors[color]}[${timestamp}] ${message}${colors.reset}`);
}

/**
 * Авторизуется в системе и получает токен пользователя
 * @returns {Promise<string>} Токен для авторизации
 */
async function login() {
  try {
    log('Авторизация пользователя...', 'cyan');
    
    // Здесь используем учетные данные для тестового пользователя
    const loginResponse = await axios.post(`${API_URL}/api/auth/login`, {
      email: 'lbrspb@gmail.com',
      password: 'replit_test_2025'
    }, {
      validateStatus: () => true
    });
    
    if (loginResponse.status !== 200) {
      log(`Ошибка авторизации: ${loginResponse.data?.error || loginResponse.statusText}`, 'red');
      throw new Error('Не удалось авторизоваться');
    }
    
    log(`Ответ авторизации: ${JSON.stringify(loginResponse.data)}`, 'cyan');
    
    const token = loginResponse.data.token || loginResponse.data.accessToken || loginResponse.data.access_token;
    if (!token) {
      log('Токен отсутствует в ответе авторизации', 'red');
      throw new Error('Не удалось получить токен авторизации');
    }
    
    log('Авторизация успешна', 'green');
    return token;
  } catch (error) {
    log(`Критическая ошибка при авторизации: ${error.message}`, 'red');
    throw error;
  }
}

/**
 * Создает новый контент в кампании для публикации
 * @param {string} token Токен авторизации
 * @returns {Promise<string>} ID созданного контента
 */
async function createContent(token) {
  try {
    log('Создание тестового контента для публикации...', 'cyan');
    
    const contentPayload = {
      title: 'Тест Instagram API',
      content: TEST_TEXT,
      imageUrl: TEST_IMAGE_URL,
      campaignId: CAMPAIGN_ID,
      contentType: 'image',
      status: 'draft'
    };
    
    const response = await axios.post(`${API_URL}/api/campaign-content`, contentPayload, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      validateStatus: () => true
    });
    
    if (response.status !== 201 || !response.data.data?.id) {
      log(`Ошибка создания контента: ${response.data?.error || response.statusText}`, 'red');
      throw new Error('Не удалось создать контент');
    }
    
    const contentId = response.data.data.id;
    log(`Контент успешно создан, ID: ${contentId}`, 'green');
    return contentId;
  } catch (error) {
    log(`Критическая ошибка при создании контента: ${error.message}`, 'red');
    throw error;
  }
}

/**
 * Публикует контент в Instagram через основной API
 * @param {string} token Токен авторизации
 * @param {string} contentId ID контента для публикации
 * @returns {Promise<Object>} Результат публикации
 */
async function publishToInstagram(token, contentId) {
  try {
    log(`Публикация контента ${contentId} в Instagram...`, 'cyan');
    
    const publishPayload = {
      platforms: ['instagram']
    };
    
    const response = await axios.post(`${API_URL}/api/content/${contentId}/publish-social`, publishPayload, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      validateStatus: () => true
    });
    
    if (response.status !== 200) {
      log(`Ошибка публикации: ${response.data?.error || response.statusText}`, 'red');
      log(`Детали ошибки: ${JSON.stringify(response.data)}`, 'red');
      return {
        success: false,
        error: response.data?.error || response.statusText,
        details: response.data
      };
    }
    
    // Проверяем результат публикации
    const instagramResult = response.data.results.find(r => r.platform === 'instagram');
    const isSuccess = instagramResult?.status === 'published';
    
    if (isSuccess) {
      log(`Публикация в Instagram успешна!`, 'green');
      log(`URL публикации: ${instagramResult.postUrl || 'URL не предоставлен'}`, 'green');
    } else {
      log(`Публикация в Instagram не удалась: ${instagramResult?.error || 'Неизвестная ошибка'}`, 'red');
    }
    
    return {
      success: isSuccess,
      result: instagramResult,
      allResults: response.data.results
    };
  } catch (error) {
    log(`Критическая ошибка при публикации в Instagram: ${error.message}`, 'red');
    throw error;
  }
}

/**
 * Проверяет статус публикации контента
 * @param {string} token Токен авторизации
 * @param {string} contentId ID контента
 * @returns {Promise<Object>} Обновленный статус контента
 */
async function checkPublicationStatus(token, contentId) {
  try {
    log(`Проверка статуса публикации контента ${contentId}...`, 'cyan');
    
    const response = await axios.get(`${API_URL}/api/campaign-content/${contentId}`, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      validateStatus: () => true
    });
    
    if (response.status !== 200 || !response.data.data) {
      log(`Ошибка получения контента: ${response.data?.error || response.statusText}`, 'red');
      throw new Error('Не удалось получить контент');
    }
    
    const content = response.data.data;
    const instagramStatus = content.socialPlatforms?.instagram;
    
    if (instagramStatus) {
      log(`Статус публикации в Instagram: ${instagramStatus.status}`, 
        instagramStatus.status === 'published' ? 'green' : 'yellow');
      
      if (instagramStatus.postUrl) {
        log(`URL публикации в Instagram: ${instagramStatus.postUrl}`, 'green');
      }
      
      if (instagramStatus.error) {
        log(`Ошибка публикации: ${instagramStatus.error}`, 'red');
      }
    } else {
      log('Информация о публикации в Instagram отсутствует', 'yellow');
    }
    
    return {
      socialPlatforms: content.socialPlatforms,
      status: content.status,
      instagramStatus: instagramStatus
    };
  } catch (error) {
    log(`Критическая ошибка при проверке статуса: ${error.message}`, 'red');
    throw error;
  }
}

/**
 * Запускает полный тест Instagram API
 */
async function runTest() {
  log('Запуск интеграционного теста основного API Instagram', 'magenta');
  log('------------------------------------------------------', 'magenta');
  
  let token = null;
  let contentId = null;
  let publishResult = null;
  
  try {
    // Шаг 1: Авторизация
    token = await login();
    
    // Шаг 2: Создание контента
    contentId = await createContent(token);
    
    // Шаг 3: Публикация в Instagram
    publishResult = await publishToInstagram(token, contentId);
    
    // Шаг 4: Проверка статуса публикации
    const status = await checkPublicationStatus(token, contentId);
    
    // Формируем итоговый отчет
    log('------------------------------------------------------', 'magenta');
    log('ИТОГОВЫЙ ОТЧЕТ', 'magenta');
    log('------------------------------------------------------', 'magenta');
    
    log(`Контент ID: ${contentId}`, 'cyan');
    log(`Публикация через основное API: ${publishResult.success ? 'УСПЕШНО ✅' : 'ОШИБКА ❌'}`, 
      publishResult.success ? 'green' : 'red');
    
    if (!publishResult.success && publishResult.result?.error) {
      log(`Ошибка: ${publishResult.result.error}`, 'red');
    }
    
    if (status.instagramStatus) {
      log(`Итоговый статус в системе: ${status.instagramStatus.status}`, 
        status.instagramStatus.status === 'published' ? 'green' : 'yellow');
      
      if (status.instagramStatus.postUrl) {
        log(`URL публикации: ${status.instagramStatus.postUrl}`, 'green');
      }
    }
    
    log('------------------------------------------------------', 'magenta');
    
    return {
      success: publishResult.success,
      contentId,
      publishResult,
      status
    };
  } catch (error) {
    log(`Тест завершился с ошибкой: ${error.message}`, 'red');
    return {
      success: false,
      error: error.message,
      contentId,
      publishResult
    };
  }
}

// Запускаем тест
runTest()
  .then(result => {
    log(`Тест завершен. Результат: ${result.success ? 'УСПЕШНО ✅' : 'ОШИБКА ❌'}`, 
      result.success ? 'green' : 'red');
    process.exit(result.success ? 0 : 1);
  })
  .catch(error => {
    log(`Критическая ошибка в тесте: ${error.message}`, 'red');
    process.exit(1);
  });
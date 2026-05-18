/**
 * Проверка идентичности процесса публикации через 
 * моментальную публикацию и отложенную (шедулер).
 * Скрипт проверяет, что оба пути используют один и тот же код.
 * 
 * Запуск: node test-telegram-publish-workflow-check.js
 */

const axios = require('axios');
const fs = require('fs');

// Настройки для теста
const APP_URL = process.env.APP_URL || 'http://localhost:5000';
const API_URL = `${APP_URL}/api`;
const CAMPAIGN_ID = process.env.TEST_CAMPAIGN_ID || '46868c44-c6a4-4bed-accf-9ad07bba790e';
const EMAIL = process.env.ADMIN_EMAIL || 'lbrspb@gmail.com';
const PASSWORD = process.env.ADMIN_PASSWORD;

// Путь к файлу логов
const LOG_FILE = './telegram-publish-workflow-check.log';

/**
 * Логирование с отметкой времени
 * @param {string} message Сообщение для логирования
 */
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync(LOG_FILE, logMessage + '\n');
}

/**
 * Получение токена авторизации
 * @returns {Promise<string>} Токен авторизации
 */
async function login() {
  try {
    if (!PASSWORD) {
      throw new Error('Для теста необходимо указать пароль в переменной окружения ADMIN_PASSWORD');
    }
    
    log('Попытка авторизации...');
    
    const response = await axios.post(`${API_URL}/auth/login`, { 
      email: EMAIL, 
      password: PASSWORD 
    });
    
    if (response.data && response.data.token) {
      log('Авторизация успешна');
      return response.data.token;
    }
    throw new Error('Токен не получен');
  } catch (error) {
    log(`Ошибка авторизации: ${error.message}`);
    if (error.response) {
      log(`Статус: ${error.response.status}, Ответ: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

/**
 * Создание тестового контента для немедленной публикации
 * @param {string} token Токен авторизации
 * @returns {Promise<string>} ID созданного контента
 */
async function createImmediateContent(token) {
  try {
    log('Создание контента для немедленной публикации...');
    
    const content = {
      title: 'Тест моментальной публикации',
      content: '<p>Это тестовый контент для <b>моментальной публикации</b> в Telegram.</p><p>Проверка HTML форматирования.</p>',
      contentType: 'text',
      campaignId: CAMPAIGN_ID,
      socialPlatforms: {
        telegram: {
          status: 'pending'
        }
      },
      imageUrl: null,
      status: 'draft'
    };
    
    const response = await axios.post(`${API_URL}/campaign-content`, content, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (response.data && response.data.data && response.data.data.id) {
      log(`Контент создан, ID: ${response.data.data.id}`);
      return response.data.data.id;
    }
    throw new Error('ID контента не получен');
  } catch (error) {
    log(`Ошибка создания контента: ${error.message}`);
    if (error.response) {
      log(`Статус: ${error.response.status}, Ответ: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

/**
 * Создание тестового контента для отложенной публикации
 * @param {string} token Токен авторизации
 * @returns {Promise<string>} ID созданного контента
 */
async function createScheduledContent(token) {
  try {
    log('Создание контента для отложенной публикации...');
    
    // Запланировать на 1 минуту вперед
    const scheduledTime = new Date();
    scheduledTime.setMinutes(scheduledTime.getMinutes() + 1);
    
    const content = {
      title: 'Тест отложенной публикации',
      content: '<p>Это тестовый контент для <b>отложенной публикации</b> в Telegram.</p><p>Проверка HTML форматирования.</p>',
      contentType: 'text',
      campaignId: CAMPAIGN_ID,
      socialPlatforms: {
        telegram: {
          status: 'pending'
        }
      },
      scheduledAt: scheduledTime.toISOString(),
      imageUrl: null,
      status: 'scheduled'
    };
    
    const response = await axios.post(`${API_URL}/campaign-content`, content, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (response.data && response.data.data && response.data.data.id) {
      log(`Контент создан, ID: ${response.data.data.id}, запланирован на: ${scheduledTime.toISOString()}`);
      return response.data.data.id;
    }
    throw new Error('ID контента не получен');
  } catch (error) {
    log(`Ошибка создания запланированного контента: ${error.message}`);
    if (error.response) {
      log(`Статус: ${error.response.status}, Ответ: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

/**
 * Публикация контента немедленно
 * @param {string} token Токен авторизации
 * @param {string} contentId ID контента
 * @returns {Promise<object>} Результат публикации
 */
async function publishContentImmediately(token, contentId) {
  try {
    log(`Публикация контента ${contentId} в Telegram...`);
    
    const response = await axios.post(`${API_URL}/publish/content`, {
      contentId,
      platforms: ['telegram']
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    log(`Ответ API публикации: ${JSON.stringify(response.data)}`);
    return response.data;
  } catch (error) {
    log(`Ошибка публикации: ${error.message}`);
    if (error.response) {
      log(`Статус: ${error.response.status}, Ответ: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

/**
 * Ожидание публикации запланированного контента
 * @param {string} token Токен авторизации
 * @param {string} contentId ID контента
 * @returns {Promise<object>} Результат публикации
 */
async function waitForScheduledPublication(token, contentId) {
  try {
    log(`Ожидание публикации запланированного контента ${contentId}...`);
    
    let attempts = 0;
    const maxAttempts = 10; // максимум 5 минут (10 попыток по 30 секунд)
    let published = false;
    let contentData = null;
    
    while (attempts < maxAttempts && !published) {
      attempts++;
      log(`Попытка проверки статуса #${attempts}`);
      
      // Ждем 30 секунд между проверками
      await new Promise(resolve => setTimeout(resolve, 30000));
      
      // Получаем обновленные данные о контенте
      const response = await axios.get(`${API_URL}/campaign-content/${contentId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      contentData = response.data.data;
      log(`Текущий статус: ${contentData.status}, детали платформы: ${JSON.stringify(contentData.socialPlatforms)}`);
      
      if (contentData.socialPlatforms && contentData.socialPlatforms.telegram) {
        const telegramStatus = contentData.socialPlatforms.telegram.status;
        if (telegramStatus === 'published') {
          published = true;
          log(`Контент успешно опубликован через шедулер! URL: ${contentData.socialPlatforms.telegram.postUrl}`);
        } else if (telegramStatus === 'failed') {
          throw new Error(`Публикация не удалась: ${contentData.socialPlatforms.telegram.error || 'неизвестная ошибка'}`);
        }
      }
    }
    
    if (!published) {
      throw new Error(`Контент не был опубликован после ${maxAttempts} попыток проверки`);
    }
    
    return contentData;
  } catch (error) {
    log(`Ошибка при ожидании публикации: ${error.message}`);
    if (error.response) {
      log(`Статус: ${error.response.status}, Ответ: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

/**
 * Основная функция проверки
 */
async function runTest() {
  try {
    log('Начало теста проверки процесса публикации...');
    fs.writeFileSync(LOG_FILE, '');  // Очищаем файл логов
    
    // 1. Авторизация
    const token = await login();
    
    // 2. Создание контента для моментальной публикации
    const immediateContentId = await createImmediateContent(token);
    
    // 3. Публикация моментально
    const immediateResult = await publishContentImmediately(token, immediateContentId);
    log(`Результат моментальной публикации: ${JSON.stringify(immediateResult)}`);
    
    let immediateUrl = null;
    if (immediateResult && immediateResult.results && immediateResult.results.telegram) {
      immediateUrl = immediateResult.results.telegram.result?.postUrl;
      log(`URL моментальной публикации: ${immediateUrl}`);
    }
    
    // 4. Создание контента для отложенной публикации
    const scheduledContentId = await createScheduledContent(token);
    
    // 5. Ожидание публикации через шедулер
    const scheduledResult = await waitForScheduledPublication(token, scheduledContentId);
    log(`Результат отложенной публикации: ${JSON.stringify(scheduledResult)}`);
    
    let scheduledUrl = null;
    if (scheduledResult && scheduledResult.socialPlatforms && scheduledResult.socialPlatforms.telegram) {
      scheduledUrl = scheduledResult.socialPlatforms.telegram.postUrl;
      log(`URL отложенной публикации: ${scheduledUrl}`);
    }
    
    // 6. Анализ результатов
    log('Анализ результатов:');
    log(`Моментальная публикация: ${immediateUrl ? 'УСПЕШНО' : 'ОШИБКА'}`);
    log(`Отложенная публикация: ${scheduledUrl ? 'УСПЕШНО' : 'ОШИБКА'}`);
    
    if (immediateUrl && scheduledUrl) {
      log('Обе публикации успешны!');
      
      // Проверяем формат URL
      const immediateUrlPattern = /https:\/\/t\.me\/\w+\/\d+/;
      const scheduledUrlPattern = /https:\/\/t\.me\/\w+\/\d+/;
      
      if (immediateUrlPattern.test(immediateUrl) && scheduledUrlPattern.test(scheduledUrl)) {
        log('Оба URL имеют правильный формат t.me/{username}/{messageId}');
        log('ТЕСТ ПРОЙДЕН: Процесс публикации идентичен для моментальной и отложенной публикации');
      } else {
        log(`Ошибка формата URL: Моментальный URL = ${immediateUrl}, Отложенный URL = ${scheduledUrl}`);
        log('ТЕСТ НЕ ПРОЙДЕН: URL не соответствуют ожидаемому формату');
      }
    } else {
      log('ТЕСТ НЕ ПРОЙДЕН: Одна или обе публикации завершились с ошибкой');
    }
    
  } catch (error) {
    log(`Тест завершился с ошибкой: ${error.message}`);
  }
}

// Запуск теста
runTest();
// test-storage-api.cjs
// Тест для проверки работы сохранения URL публикаций через storage API
const axios = require('axios');
require('dotenv').config();

// Локальный API сервер
const apiUrl = 'http://localhost:5000';
const contentId = process.argv[2] || '8186b9ef-b290-4cad-970e-c39b8afda63e';
const platform = process.argv[3] || 'instagram';
const testUrl = `https://${platform}.com/p/test_${Date.now()}`;

// Функция для логирования
function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

// Функция для авторизации напрямую через API сервера, а не через Directus
async function login() {
  log('Авторизация в локальный API сервер...');
  try {
    // Эндпоинт авторизации на локальном сервере
    const authResponse = await axios.post(`${apiUrl}/api/auth/login`, {
      email: 'lbrspb@gmail.com',
      password: 'smm789hf3'
    });
    
    if (authResponse?.data?.token) {
      const token = authResponse.data.token;
      log('✅ Авторизация в API успешна');
      return token;
    } else {
      throw new Error('Ответ API не содержит токен');
    }
  } catch (error) {
    log(`❌ Ошибка авторизации в API: ${error.message}`);
    if (error.response) {
      log(`Статус ошибки: ${error.response.status}`);
      log(`Тело ответа: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

// Основная функция тестирования
async function testStorageAPI() {
  log('=== ТЕСТ СОХРАНЕНИЯ URL ЧЕРЕЗ STORAGE API ===');
  log(`Контент ID: ${contentId}`);
  log(`Платформа: ${platform}`);
  log(`Тестовый URL: ${testUrl}`);
  
  try {
    // 0. Авторизация
    const token = await login();
    const authHeaders = { Authorization: `Bearer ${token}` };
    
    // 1. Получение текущего контента через API
    log('\n1. Получение текущего контента...');
    const contentResponse = await axios.get(
      `${apiUrl}/api/campaign-content/${contentId}`,
      { headers: authHeaders }
    );
    
    if (!contentResponse?.data) {
      throw new Error('Не удалось получить контент');
    }
    
    const content = contentResponse.data;
    log(`Контент получен: ${content.title || 'без названия'}`);
    
    // Проверяем наличие socialPlatforms
    if (content.socialPlatforms) {
      log(`Текущие платформы: ${Object.keys(content.socialPlatforms).join(', ')}`);
      
      if (content.socialPlatforms[platform]) {
        log(`Текущий URL для ${platform}: ${content.socialPlatforms[platform].postUrl || 'не задан'}`);
      } else {
        log(`Данные для платформы ${platform} не найдены`);
      }
    } else {
      log('Данные социальных платформ отсутствуют');
    }
    
    // 2. Тестируем обновление через test-instagram-route
    log('\n2. Тестирование обновления через /api/test/save-instagram-url...');
    const updateResponse = await axios.post(
      `${apiUrl}/api/test/save-instagram-url`, 
      {
        contentId,
        postUrl: testUrl,
        messageId: `test_msg_${Date.now()}`
      },
      { headers: authHeaders }
    );
    
    log(`Статус ответа: ${updateResponse.status}`);
    if (updateResponse.data) {
      log(`Ответ API: ${JSON.stringify(updateResponse.data, null, 2)}`);
    }
    
    // 3. Проверяем результат обновления
    log('\n3. Проверка результата обновления...');
    const updatedContentResponse = await axios.get(
      `${apiUrl}/api/campaign-content/${contentId}`,
      { headers: authHeaders }
    );
    
    if (!updatedContentResponse?.data) {
      throw new Error('Не удалось получить обновленный контент');
    }
    
    const updatedContent = updatedContentResponse.data;
    
    if (updatedContent.socialPlatforms && updatedContent.socialPlatforms[platform]) {
      const platformData = updatedContent.socialPlatforms[platform];
      
      if (platformData.postUrl === testUrl) {
        log(`✅ УСПЕХ: URL для ${platform} обновлен корректно`);
        log(`Новый URL: ${platformData.postUrl}`);
        log(`Message ID: ${platformData.messageId || 'не задан'}`);
        log(`Статус: ${platformData.status || 'не задан'}`);
      } else {
        log(`❌ ОШИБКА: URL не обновился или обновился неверно`);
        log(`Ожидаемый URL: ${testUrl}`);
        log(`Фактический URL: ${platformData.postUrl || 'отсутствует'}`);
      }
    } else {
      log(`❌ ОШИБКА: Данные для ${platform} не найдены после обновления`);
    }
    
    // 4. Тестируем прямой API маршрут для публикации
    log('\n4. Тестирование прямого API маршрута публикации...');
    const directTestUrl = `https://${platform}.com/p/direct_test_${Date.now()}`;
    
    const publicationResponse = await axios.post(
      `${apiUrl}/api/social/test-publish`, 
      {
        contentId,
        platform,
        postUrl: directTestUrl,
        messageId: `direct_test_msg_${Date.now()}`
      },
      { headers: authHeaders }
    );
    
    log(`Статус ответа: ${publicationResponse.status}`);
    if (publicationResponse.data) {
      log(`Ответ API: ${JSON.stringify(publicationResponse.data, null, 2)}`);
    }
    
    // 5. Финальная проверка
    log('\n5. Финальная проверка результатов...');
    const finalContentResponse = await axios.get(
      `${apiUrl}/api/campaign-content/${contentId}`,
      { headers: authHeaders }
    );
    
    if (!finalContentResponse?.data) {
      throw new Error('Не удалось получить финальный контент');
    }
    
    const finalContent = finalContentResponse.data;
    
    if (finalContent.socialPlatforms && finalContent.socialPlatforms[platform]) {
      const platformData = finalContent.socialPlatforms[platform];
      
      if (platformData.postUrl === directTestUrl) {
        log(`✅ УСПЕХ: URL для ${platform} обновлен через прямой API маршрут`);
        log(`Новый URL: ${platformData.postUrl}`);
      } else {
        log(`❌ ОШИБКА: URL не обновился через прямой API маршрут`);
        log(`Ожидаемый URL: ${directTestUrl}`);
        log(`Фактический URL: ${platformData.postUrl || 'отсутствует'}`);
      }
    } else {
      log(`❌ ОШИБКА: Данные для ${platform} не найдены после прямого обновления`);
    }
    
    log('\n=== ТЕСТИРОВАНИЕ ЗАВЕРШЕНО ===');
    
  } catch (error) {
    log(`\n❌ ОШИБКА: ${error.message}`);
    
    if (error.response) {
      log(`Статус ошибки: ${error.response.status}`);
      log(`Данные ошибки: ${JSON.stringify(error.response.data, null, 2)}`);
    }
  }
}

// Запускаем тест
testStorageAPI();
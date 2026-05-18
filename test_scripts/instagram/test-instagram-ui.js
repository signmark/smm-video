/**
 * Тест публикации в Instagram через UI интерфейс
 * Использует социальный сервис с Imgur для публикации
 */

import axios from 'axios';
import { promises as fs } from 'fs';

// Настройки для публикации
const TEST_IMAGE_URL = 'https://picsum.photos/800/800'; // Квадратное изображение 1:1
const TEST_CONTENT_ID = 'test-content-' + Date.now(); // Генерируем уникальный ID

// Функция логирования с отметкой времени
function log(message) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${timestamp}] ${message}`);
}

/**
 * Выполняет API-запрос на публикацию контента через UI интерфейс
 * (Использует маршрут /api/content/:id/publish-social)
 */
async function testInstagramPublishingThroughUI() {
  try {
    // Базовый URL API
    const baseUrl = 'http://localhost:5000';
    
    // 1. Создаем тестовый контент
    log('Создание тестового контента для публикации...');
    
    const content = {
      id: TEST_CONTENT_ID,
      title: 'Тест публикации в Instagram через UI интерфейс',
      content: '<p>Это тестовый пост для проверки публикации в Instagram. #тест #instagram</p>',
      contentType: 'social',
      imageUrl: TEST_IMAGE_URL,
      status: 'draft',
      userId: 'test-user',
      campaignId: '46868c44-c6a4-4bed-accf-9ad07bba790e', // ID тестовой кампании
      socialPlatforms: ['instagram'],
      hashtags: ['тест', 'instagram', 'публикация'],
      createdAt: new Date()
    };
    
    // 2. Эмулируем запрос на публикацию через маршрут UI, как если бы пользователь нажал кнопку "Опубликовать"
    log('Выполнение запроса на публикацию через UI интерфейс...');
    
    const publishUrl = `${baseUrl}/api/content/${TEST_CONTENT_ID}/publish-social`;
    const response = await axios.post(publishUrl, {
      platform: 'instagram',
      content: content
    });
    
    // 3. Анализируем результат
    log('Ответ API: ' + JSON.stringify(response.data, null, 2));
    
    if (response.data.success && response.data.result.status === 'published') {
      log('✅ Тест успешно пройден! Контент опубликован в Instagram.');
      log(`📎 URL публикации: ${response.data.result.postUrl}`);
      return true;
    } else {
      log('❌ Тест не пройден. Контент не был опубликован в Instagram.');
      if (response.data.error) {
        log(`Ошибка: ${response.data.error}`);
      }
      return false;
    }
    
  } catch (error) {
    log('❌ Произошла ошибка при выполнении теста:');
    if (error.response) {
      // Ошибка API
      log(`Ошибка API (${error.response.status}): ${JSON.stringify(error.response.data)}`);
    } else {
      // Общая ошибка
      log(error.message);
    }
    return false;
  }
}

// Запускаем тест
log('Начинаем тест публикации в Instagram через UI интерфейс...');
testInstagramPublishingThroughUI()
  .then(result => {
    if (result) {
      log('🎉 Тест успешно завершен!');
    } else {
      log('😢 Тест завершен с ошибками.');
    }
  })
  .catch(error => {
    log(`Критическая ошибка при выполнении теста: ${error.message}`);
  });
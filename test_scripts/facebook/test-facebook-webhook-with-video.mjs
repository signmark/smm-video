#!/usr/bin/env node

/**
 * Тестовый скрипт для проверки публикации видео в Facebook через webhook v3
 * Данный скрипт отправляет запрос с contentId, содержащим video_url
 * 
 * Запуск: node test-facebook-webhook-with-video.mjs
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

// Логирование с временной меткой
function log(message) {
  const now = new Date();
  console.log(`[${now.toISOString()}] ${message}`);
}

/**
 * Проверяет наличие video_url в контенте
 * @param {string} contentId ID контента для проверки
 * @param {string} token Токен доступа к Directus API
 * @returns {Promise<boolean>} Результат проверки
 */
async function checkVideoUrlInContent(contentId, token) {
  try {
    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    const response = await fetch(`${directusUrl}/items/campaign_content/${contentId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    const data = await response.json();
    const content = data.data;
    
    if (!content) {
      log(`❌ Контент с ID ${contentId} не найден`);
      return false;
    }
    
    log(`✓ Найден контент: "${content.title}"`);
    
    if (content.video_url) {
      log(`✓ Контент содержит video_url: ${content.video_url}`);
      return true;
    } else {
      log(`❌ Контент НЕ содержит video_url`);
      return false;
    }
  } catch (error) {
    log(`❌ Ошибка при проверке контента: ${error.message}`);
    return false;
  }
}

/**
 * Основная функция теста
 */
async function runTest() {
  try {
    log('Начало теста Facebook webhook с видео');
    
    // Получаем токен Directus из переменных окружения
    const adminToken = process.env.DIRECTUS_ADMIN_TOKEN || 'zQJK4b84qrQeuTYS2-x9QqpEyDutJGsb';
    
    // ID контента для публикации (должен содержать video_url)
    // В реальном сценарии нужно указать ID существующего контента с видео
    const contentId = '3fae3d0e-dd44-4eeb-9ed3-00df49c9a9d7';
    
    // Проверяем, что контент содержит video_url перед тестированием webhook
    const hasVideoUrl = await checkVideoUrlInContent(contentId, adminToken);
    
    if (!hasVideoUrl) {
      log('❌ Тест прерван: контент не содержит video_url');
      return;
    }
    
    // URL вашего Facebook webhook v3
    const webhookUrl = 'http://localhost:5000/api/facebook-webhook-v3';
    
    log(`Отправка запроса на ${webhookUrl} с contentId: ${contentId}`);
    
    // Отправляем запрос к webhook
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ contentId })
    });
    
    const responseData = await response.json();
    
    log(`Статус ответа: ${response.status}`);
    log(`Ответ: ${JSON.stringify(responseData, null, 2)}`);
    
    if (response.ok && responseData.success) {
      log('✅ Тест успешно пройден: видео отправлено на публикацию в Facebook');
      
      // Проверяем наличие postUrl в ответе (должен быть после наших изменений)
      if (responseData.postUrl) {
        log(`✓ Ответ содержит postUrl: ${responseData.postUrl}`);
      } else if (responseData.permalink) {
        log(`⚠️ В ответе все еще используется поле permalink: ${responseData.permalink}`);
      } else {
        log('⚠️ В ответе нет ни postUrl, ни permalink');
      }
    } else {
      log(`❌ Тест не пройден: ${responseData.error || 'Неизвестная ошибка'}`);
    }
  } catch (error) {
    log(`❌ Ошибка при выполнении теста: ${error.message}`);
  }
}

// Запускаем тест
runTest();
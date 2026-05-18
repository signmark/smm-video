#!/usr/bin/env node

/**
 * Тестовый скрипт для проверки публикации видео в Facebook через webhook v3
 * с обновленным форматом API ответа (postUrl вместо permalink)
 * 
 * Запуск: node test-facebook-video-webhook-v3.mjs
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
 * Получает токен администратора Directus
 * @returns {Promise<string>} Токен администратора
 */
async function getAdminToken() {
  try {
    // Пробуем использовать токен из переменных окружения
    if (process.env.DIRECTUS_ADMIN_TOKEN) {
      return process.env.DIRECTUS_ADMIN_TOKEN;
    }
    
    // Иначе авторизуемся и получаем новый токен
    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    const email = process.env.DIRECTUS_ADMIN_EMAIL || 'lbrspb@gmail.com';
    const password = process.env.DIRECTUS_ADMIN_PASSWORD || 'QtpZ3dh7';
    
    const response = await fetch(`${directusUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
    if (!data.data?.access_token) {
      throw new Error('Не удалось получить токен доступа Directus');
    }
    
    return data.data.access_token;
  } catch (error) {
    log(`❌ Ошибка при получении токена администратора: ${error.message}`);
    throw error;
  }
}

/**
 * Находит контент с видео для тестирования
 * @param {string} token Токен администратора Directus
 * @returns {Promise<string>} ID контента с видео
 */
async function findContentWithVideo(token) {
  try {
    log('Поиск контента с видео для тестирования...');
    
    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    const response = await fetch(`${directusUrl}/items/campaign_content?filter[video_url][_nnull]=true&limit=5`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    const data = await response.json();
    
    if (!data.data || data.data.length === 0) {
      throw new Error('Не найдено контента с video_url');
    }
    
    // Находим первый элемент с video_url
    const content = data.data.find(item => item.video_url);
    
    if (!content) {
      throw new Error('Не найдено контента с video_url');
    }
    
    log(`✓ Найден контент с ID: ${content.id}`);
    log(`✓ Видео URL: ${content.video_url}`);
    
    return content.id;
  } catch (error) {
    log(`❌ Ошибка при поиске контента: ${error.message}`);
    throw error;
  }
}

/**
 * Проверяет наличие поля social_platforms.facebook в контенте и его статус
 * @param {string} contentId ID контента для проверки
 * @param {string} token Токен доступа к Directus API
 * @returns {Promise<object>} Информация о статусе Facebook
 */
async function checkFacebookStatus(contentId, token) {
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
      throw new Error(`Контент с ID ${contentId} не найден`);
    }
    
    let socialPlatforms = content.social_platforms || {};
    
    // Если socialPlatforms - строка, парсим JSON
    if (typeof socialPlatforms === 'string') {
      try {
        socialPlatforms = JSON.parse(socialPlatforms);
      } catch (e) {
        log(`❌ Ошибка парсинга JSON в social_platforms: ${e}`);
        socialPlatforms = {};
      }
    }
    
    const facebookStatus = socialPlatforms.facebook || null;
    
    log(`📊 Текущий статус Facebook для контента ${contentId}:`);
    log(JSON.stringify(facebookStatus, null, 2));
    
    return facebookStatus;
  } catch (error) {
    log(`❌ Ошибка при проверке статуса Facebook: ${error.message}`);
    return null;
  }
}

/**
 * Основная функция теста
 */
async function runTest() {
  try {
    log('Начало теста Facebook webhook v3 с видео');
    
    // Получаем токен администратора
    const adminToken = await getAdminToken();
    log('✓ Получен токен администратора');
    
    // Находим контент с видео
    const contentId = await findContentWithVideo(adminToken);
    
    // Проверяем текущий статус Facebook
    const initialStatus = await checkFacebookStatus(contentId, adminToken);
    
    if (initialStatus?.status === 'published') {
      log('⚠️ Предупреждение: контент уже опубликован в Facebook');
      log('⚠️ Тест все равно будет выполнен, но обратите внимание на текущий статус');
    }
    
    // URL вашего Facebook webhook v3
    const webhookUrl = 'http://localhost:5000/api/facebook-webhook-v3';
    
    log(`📤 Отправка запроса на ${webhookUrl} с contentId: ${contentId}`);
    
    // Отправляем запрос к webhook
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ contentId })
    });
    
    const responseData = await response.json();
    
    log(`📥 Статус ответа: ${response.status}`);
    log(`📥 Ответ: ${JSON.stringify(responseData, null, 2)}`);
    
    if (response.ok && responseData.success) {
      log('✅ Тест успешно пройден: запрос обработан');
      
      // Проверяем наличие postUrl в ответе (должен быть после наших изменений)
      if (responseData.postUrl) {
        log(`✓ Ответ содержит postUrl: ${responseData.postUrl}`);
      } else if (responseData.permalink) {
        log(`⚠️ В ответе все еще используется поле permalink: ${responseData.permalink}`);
      } else {
        log('⚠️ В ответе нет ни postUrl, ни permalink');
      }
      
      // Проверяем статус в базе данных после публикации
      log('🔍 Проверка статуса в базе данных после публикации...');
      const updatedStatus = await checkFacebookStatus(contentId, adminToken);
      
      if (updatedStatus?.status === 'published') {
        log('✅ Статус успешно обновлен в базе данных');
        
        // Проверяем, использует ли обновленный статус поле postUrl
        if (updatedStatus.postUrl) {
          log(`✓ Обновленный статус содержит postUrl: ${updatedStatus.postUrl}`);
        } else if (updatedStatus.permalink) {
          log(`⚠️ Обновленный статус все еще использует поле permalink: ${updatedStatus.permalink}`);
        } else {
          log('⚠️ В обновленном статусе нет ни postUrl, ни permalink');
        }
      } else {
        log('❌ Статус не был обновлен в базе данных');
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
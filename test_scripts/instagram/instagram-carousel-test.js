/**
 * Скрипт для тестирования публикации карусели в Instagram
 * 
 * Этот скрипт отправляет запрос на тестовый эндпоинт Instagram карусели,
 * который в свою очередь вызывает webhook маршрут для Instagram карусели.
 * 
 * Использование: node instagram-carousel-test.js
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

// Функция для логирования с поддержкой записи в файл
function log(message) {
  const logMessage = `[${new Date().toISOString()}] ${message}`;
  console.log(logMessage);
  
  // Записываем в лог-файл
  fs.appendFileSync('instagram-carousel-test.log', logMessage + '\n');
}

// Функция для тестирования публикации карусели в Instagram
async function testInstagramCarousel() {
  try {
    log('Запуск теста публикации карусели в Instagram');
    
    // Используем API URL Replit вместо localhost
    const baseUrl = process.env.REPLIT_URL || 'https://b97f8d4a-3eb5-439c-9956-3cacfdeb3f2a-00-30nikq0wek8gj.picard.replit.dev';
    log(`Используем базовый URL: ${baseUrl}`);
    
    // Шаг 1: Получаем токен администратора через Directus API напрямую
    log('Шаг 1: Получение токена администратора через Directus API');
    
    // Email и пароль из нашего .env файла
    const email = process.env.DIRECTUS_ADMIN_EMAIL || 'lbrspb@gmail.com';
    const password = process.env.DIRECTUS_ADMIN_PASSWORD || 'QtpZ3dh7';
    
    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    log(`Отправка запроса на ${directusUrl}/auth/login с email: ${email}`);
    
    const authResponse = await fetch(`${directusUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        mode: 'json'
      }),
    });
    
    if (!authResponse.ok) {
      try {
        const error = await authResponse.json();
        throw new Error(`Ошибка авторизации: ${JSON.stringify(error)}`);
      } catch (parseError) {
        const responseText = await authResponse.text();
        log(`Ошибка при разборе ответа: ${parseError.message}`);
        log(`Полученный ответ: ${responseText.substring(0, 200)}...`);
        throw new Error(`Ошибка авторизации: невозможно разобрать ответ`);
      }
    }
    
    const authData = await authResponse.json();
    
    if (!authData || !authData.data || !authData.data.access_token) {
      throw new Error(`Не удалось получить токен: ${JSON.stringify(authData)}`);
    }
    
    const token = authData.data.access_token;
    
    if (!token) {
      throw new Error('Не удалось получить токен администратора');
    }
    
    log(`Токен получен, длина: ${token.length} символов`);
    
    // Шаг 2: Получаем существующий контент для тестирования
    log('Шаг 2: Получение существующего контента с изображениями');
    const contentResponse = await fetch(`${baseUrl}/api/campaign-content?limit=5`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    
    if (!contentResponse.ok) {
      const error = await contentResponse.json();
      throw new Error(`Ошибка получения контента: ${JSON.stringify(error)}`);
    }
    
    const contentData = await contentResponse.json();
    
    if (!contentData || !contentData.data || contentData.data.length === 0) {
      throw new Error('Нет доступного контента для тестирования');
    }
    
    // Находим первый контент с основным изображением и дополнительными изображениями
    let testContent = null;
    
    for (const content of contentData.data) {
      if (content.imageUrl && content.additionalImages && Array.isArray(content.additionalImages) && content.additionalImages.length > 0) {
        testContent = content;
        break;
      }
    }
    
    if (!testContent) {
      // Если не нашли подходящий контент, используем первый с изображением
      testContent = contentData.data.find(item => item.imageUrl);
      
      if (!testContent) {
        throw new Error('Не найден контент с изображениями для тестирования');
      }
      
      // Добавляем тестовые дополнительные изображения
      log('Добавление тестовых дополнительных изображений');
      testContent.additionalImages = [
        'https://v3.fal.media/files/rabbit/TOLFCrYadFmSqJ5WwwYE-.png',
        'https://v3.fal.media/files/lion/W-HNg-Ax1vlVUVAXoNAva.png'
      ];
    }
    
    log(`Найден тестовый контент: ID=${testContent.id}, Title="${testContent.title}"`);
    log(`Основное изображение: ${testContent.imageUrl}`);
    log(`Дополнительные изображения: ${JSON.stringify(testContent.additionalImages)}`);
    
    // Шаг 3: Убедимся, что у контента есть настройки для Instagram
    if (!testContent.socialPlatforms || !Array.isArray(testContent.socialPlatforms)) {
      log('Добавление настроек Instagram для тестового контента');
      testContent.socialPlatforms = [{
        platform: 'instagram',
        accessToken: process.env.INSTAGRAM_TOKEN || 'EAA520SFRtvcBO9Y7LhiiZBqwsqdZCP9JClMUoJZCvjsSc8qs9aheLdWefOqrZBLQhe5T0ZBerS6mZAZAP6D4i8Ln5UBfiIyVEif1LrzcAzG6JNrhW2DJeEzObpp9Mzoh8tDZA9I0HigkLnFZCaJVZCQcGDAkZBRxwnVimZBdbvokeg19i5RuGTbfuFs9UC9R',
        businessAccountId: process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || '17841422577074562'
      }];
      
      // Обновляем контент в Directus с добавленными настройками
      log('Обновление контента с настройками Instagram');
      const updateResponse = await fetch(`${baseUrl}/api/campaign-content/${testContent.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          socialPlatforms: testContent.socialPlatforms
        }),
      });
      
      if (!updateResponse.ok) {
        const error = await updateResponse.json();
        log(`Предупреждение: Не удалось обновить настройки Instagram: ${JSON.stringify(error)}`);
        // Продолжаем тест, даже если обновление не удалось
      } else {
        log('Настройки Instagram успешно обновлены для тестового контента');
      }
    }
    
    // Шаг 4: Отправка запроса на тестовый эндпоинт для публикации карусели
    log('Шаг 4: Отправка запроса на тестовый эндпоинт Instagram карусели');
    const carouselResponse = await fetch(`${baseUrl}/api/test/instagram-carousel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contentId: testContent.id,
        token: token
      }),
    });
    
    const carouselResult = await carouselResponse.json();
    
    log(`Результат публикации карусели: ${JSON.stringify(carouselResult, null, 2)}`);
    
    if (carouselResult.success) {
      log('✅ Тест публикации карусели в Instagram УСПЕШНО завершен');
      log(`Ссылка на публикацию: ${carouselResult.permalink || 'Не предоставлена'}`);
    } else {
      log(`❌ Тест публикации карусели в Instagram НЕУСПЕШЕН: ${carouselResult.error || 'Неизвестная ошибка'}`);
    }
    
    return carouselResult;
  } catch (error) {
    log(`❌ Ошибка при выполнении теста: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Запускаем тест
testInstagramCarousel().then(result => {
  log('Тест завершен');
  process.exit(result.success ? 0 : 1);
});
/**
 * Прямой скрипт для тестирования публикации карусели в Instagram
 * Этот скрипт напрямую работает с Instagram API, минуя веб-приложение
 * Запуск: node instagram-carousel-direct-test.js
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';

// Инициализация dotenv
config();

// Функция для логирования с поддержкой записи в файл
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  
  // Опционально: запись в файл
  fs.appendFileSync('instagram-carousel-direct.log', logMessage + '\n');
}

// Задержка для асинхронных операций
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Получение токена администратора через Directus API
async function getAdminToken() {
  try {
    log('Получение токена администратора через Directus API');
    
    const response = await axios.post(`${process.env.DIRECTUS_URL}/auth/login`, {
      email: process.env.DIRECTUS_ADMIN_EMAIL,
      password: process.env.DIRECTUS_ADMIN_PASSWORD
    });
    
    if (response.data && response.data.data && response.data.data.access_token) {
      const token = response.data.data.access_token;
      log(`Токен получен, длина: ${token.length} символов`);
      return token;
    } else {
      log('Ошибка: Не удалось получить токен из ответа');
      return null;
    }
  } catch (error) {
    log(`Ошибка при получении токена: ${error.message}`);
    if (error.response) {
      log(`Ответ сервера: ${JSON.stringify(error.response.data)}`);
    }
    return null;
  }
}

// Получение тестового контента
async function getTestContent(token) {
  try {
    log('Получение тестового контента с изображениями');
    
    // Используем тестовые изображения
    const testContent = {
      id: 'test-carousel-content',
      title: 'Тестовый контент для карусели Instagram',
      content: 'Тестовый пост с несколькими изображениями #тест #instagram #карусель',
      imageUrl: 'https://v3.fal.media/files/rabbit/TOLFCrYadFmSqJ5WwwYE-.png',
      additionalImages: ['https://v3.fal.media/files/lion/W-HNg-Ax1vlVUVAXoNAva.png'],
      socialPlatforms: [
        {
          platform: 'instagram',
          token: process.env.INSTAGRAM_TOKEN,
          businessAccountId: process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID
        }
      ]
    };
    
    log(`Используем тестовый контент: ID=${testContent.id}, Title="${testContent.title}"`);
    log(`Основное изображение: ${testContent.imageUrl}`);
    log(`Дополнительные изображения: ${JSON.stringify(testContent.additionalImages)}`);
    
    return testContent;
  } catch (error) {
    log(`Ошибка при подготовке тестового контента: ${error.message}`);
    return null;
  }
}

// Создание контейнера для изображения в Instagram
async function createImageContainer(imageUrl, token, businessAccountId) {
  try {
    log(`Создание контейнера для изображения: ${imageUrl}`);
    
    const response = await axios({
      method: 'post',
      url: `https://graph.facebook.com/v16.0/${businessAccountId}/media`,
      data: {
        access_token: token,
        image_url: imageUrl,
        is_carousel_item: true
      }
    });
    
    if (response.data && response.data.id) {
      log(`Контейнер создан успешно, ID: ${response.data.id}`);
      return response.data.id;
    } else {
      log(`Ошибка: Ответ без ID контейнера`);
      return null;
    }
  } catch (error) {
    log(`Ошибка при создании контейнера: ${error.message}`);
    if (error.response) {
      log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    return null;
  }
}

// Создание карусельного контейнера, объединяющего все изображения
async function createCarouselContainer(containerIds, caption, token, businessAccountId) {
  try {
    log(`Создание контейнера карусели с ${containerIds.length} изображениями`);
    
    const response = await axios({
      method: 'post',
      url: `https://graph.facebook.com/v16.0/${businessAccountId}/media`,
      data: {
        access_token: token,
        media_type: 'CAROUSEL',
        children: containerIds.join(','),
        caption: caption || ''
      }
    });
    
    if (response.data && response.data.id) {
      log(`Контейнер карусели создан успешно, ID: ${response.data.id}`);
      return response.data.id;
    } else {
      log(`Ошибка: Ответ без ID контейнера карусели`);
      return null;
    }
  } catch (error) {
    log(`Ошибка при создании контейнера карусели: ${error.message}`);
    if (error.response) {
      log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    return null;
  }
}

// Публикация карусели
async function publishCarousel(carouselContainerId, token, businessAccountId) {
  try {
    log(`Публикация карусели, контейнер ID: ${carouselContainerId}`);
    
    const response = await axios({
      method: 'post',
      url: `https://graph.facebook.com/v16.0/${businessAccountId}/media_publish`,
      data: {
        access_token: token,
        creation_id: carouselContainerId
      }
    });
    
    if (response.data && response.data.id) {
      const postId = response.data.id;
      log(`Карусель опубликована успешно, ID публикации: ${postId}`);
      return postId;
    } else {
      log(`Ошибка: Ответ без ID публикации`);
      return null;
    }
  } catch (error) {
    log(`Ошибка при публикации карусели: ${error.message}`);
    if (error.response) {
      log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    return null;
  }
}

// Получение постоянной ссылки на публикацию
async function getPermalink(postId, token) {
  try {
    log(`Получение постоянной ссылки для публикации: ${postId}`);
    
    const response = await axios.get(
      `https://graph.facebook.com/v16.0/${postId}?fields=permalink&access_token=${token}`
    );
    
    if (response.data && response.data.permalink) {
      const permalink = response.data.permalink;
      log(`Постоянная ссылка на публикацию: ${permalink}`);
      return permalink;
    } else {
      log(`Не удалось получить постоянную ссылку на публикацию`);
      return null;
    }
  } catch (error) {
    log(`Ошибка при получении ссылки: ${error.message}`);
    if (error.response) {
      log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    return null;
  }
}

// Основная функция для тестирования публикации карусели
async function testInstagramCarousel() {
  try {
    log('Запуск прямого тестирования публикации карусели в Instagram');
    
    // 1. Получение токена администратора
    const directusToken = await getAdminToken();
    if (!directusToken) {
      log('❌ Тест прерван: Не удалось получить токен администратора');
      return;
    }
    
    // 2. Получение тестового контента
    const content = await getTestContent(directusToken);
    if (!content) {
      log('❌ Тест прерван: Не удалось получить подходящий тестовый контент');
      return;
    }
    
    // 3. Извлечение настроек Instagram из контента
    const socialPlatforms = content.socialPlatforms || [];
    const instagramSettings = socialPlatforms.find(p => p.platform === 'instagram');
    
    if (!instagramSettings) {
      log('❌ Тест прерван: Не найдены настройки для Instagram в контенте');
      return;
    }
    
    const INSTAGRAM_TOKEN = instagramSettings.token || process.env.INSTAGRAM_TOKEN;
    const INSTAGRAM_BUSINESS_ACCOUNT_ID = instagramSettings.businessAccountId || process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
    
    if (!INSTAGRAM_TOKEN || !INSTAGRAM_BUSINESS_ACCOUNT_ID) {
      log('❌ Тест прерван: Отсутствуют учетные данные Instagram');
      return;
    }
    
    log(`Instagram Business Account ID: ${INSTAGRAM_BUSINESS_ACCOUNT_ID}`);
    
    // 4. Подготовка изображений для карусели
    const mainImageUrl = content.imageUrl;
    let additionalImages = content.additionalImages || [];
    
    // Преобразуем строку в массив, если это необходимо
    if (typeof additionalImages === 'string') {
      try {
        additionalImages = JSON.parse(additionalImages);
      } catch (e) {
        additionalImages = [];
      }
    }
    
    // Убедимся, что это массив
    if (!Array.isArray(additionalImages)) {
      additionalImages = [];
    }
    
    // Собираем все изображения в один массив, начиная с основного
    const allImages = mainImageUrl ? [mainImageUrl, ...additionalImages] : [...additionalImages];
    
    if (allImages.length < 2) {
      log('❌ Тест прерван: Для карусели необходимо как минимум 2 изображения');
      return;
    }
    
    log(`Подготовлено ${allImages.length} изображений для карусели`);
    
    // 5. Создание контейнеров для отдельных изображений
    const containerIds = [];
    
    for (let i = 0; i < allImages.length; i++) {
      const imageUrl = allImages[i];
      log(`Обработка изображения ${i+1}/${allImages.length}: ${imageUrl}`);
      
      const containerId = await createImageContainer(imageUrl, INSTAGRAM_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID);
      if (containerId) {
        containerIds.push(containerId);
      }
      
      // Задержка между запросами для избежания лимитов API
      await delay(1000);
    }
    
    if (containerIds.length === 0) {
      log('❌ Тест прерван: Не удалось создать контейнеры для изображений');
      return;
    }
    
    log(`Создано ${containerIds.length} контейнеров из ${allImages.length} изображений`);
    
    // 6. Создание карусельного контейнера
    const caption = content.content || '';
    const carouselContainerId = await createCarouselContainer(
      containerIds, caption, INSTAGRAM_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID
    );
    
    if (!carouselContainerId) {
      log('❌ Тест прерван: Не удалось создать контейнер карусели');
      return;
    }
    
    // Задержка перед публикацией
    log('Ожидание 2 секунды перед публикацией...');
    await delay(2000);
    
    // 7. Публикация карусели
    const postId = await publishCarousel(carouselContainerId, INSTAGRAM_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID);
    
    if (!postId) {
      log('❌ Тест прерван: Не удалось опубликовать карусель');
      return;
    }
    
    // 8. Получение постоянной ссылки
    const permalink = await getPermalink(postId, INSTAGRAM_TOKEN);
    
    // 9. Подведение итогов теста
    if (permalink) {
      log(`✅ Тест публикации карусели в Instagram УСПЕШЕН!`);
      log(`ID публикации: ${postId}`);
      log(`Постоянная ссылка: ${permalink}`);
    } else {
      log(`ℹ️ Карусель опубликована, но не удалось получить постоянную ссылку`);
      log(`ID публикации: ${postId}`);
    }
    
  } catch (error) {
    log(`❌ Тест публикации карусели в Instagram НЕУСПЕШЕН: ${error.message}`);
  } finally {
    log('Тест завершен');
  }
}

// Запускаем тест
testInstagramCarousel()
  .catch(error => {
    log(`Необработанная ошибка в основной функции: ${error.message}`);
    if (error.stack) {
      log(`Стек вызовов: ${error.stack}`);
    }
  });
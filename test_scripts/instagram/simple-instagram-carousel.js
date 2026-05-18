/**
 * Простой скрипт для публикации карусели в Instagram
 * Использует только Instagram API без Directus
 */

import axios from 'axios';
import { config } from 'dotenv';
import fs from 'fs';

// Загружаем переменные окружения
config();

// Тестовые изображения
const IMAGE_1 = 'https://v3.fal.media/files/rabbit/TOLFCrYadFmSqJ5WwwYE-.png';
const IMAGE_2 = 'https://v3.fal.media/files/lion/W-HNg-Ax1vlVUVAXoNAva.png';
const CAPTION = 'Тестовая карусель для Instagram #тест #instagram #replit';

// Instagram API конфигурация
const INSTAGRAM_TOKEN = process.env.INSTAGRAM_TOKEN;
const INSTAGRAM_BUSINESS_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

// Функция для логирования с поддержкой записи в файл
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  
  // Запись в файл
  fs.appendFileSync('simple-instagram-carousel.log', logMessage + '\n');
}

// Задержка
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Создание контейнера для изображения
async function createImageContainer(imageUrl) {
  try {
    log(`Создание контейнера для изображения: ${imageUrl}`);
    
    const response = await axios({
      method: 'post',
      url: `https://graph.facebook.com/v16.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/media`,
      data: {
        access_token: INSTAGRAM_TOKEN,
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

// Создание карусельного контейнера
async function createCarouselContainer(containerIds, caption) {
  try {
    log(`Создание контейнера карусели с ${containerIds.length} изображениями`);
    
    const response = await axios({
      method: 'post',
      url: `https://graph.facebook.com/v16.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/media`,
      data: {
        access_token: INSTAGRAM_TOKEN,
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
async function publishCarousel(carouselContainerId) {
  try {
    log(`Публикация карусели, контейнер ID: ${carouselContainerId}`);
    
    const response = await axios({
      method: 'post',
      url: `https://graph.facebook.com/v16.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/media_publish`,
      data: {
        access_token: INSTAGRAM_TOKEN,
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
async function getPermalink(postId) {
  try {
    log(`Получение постоянной ссылки для публикации: ${postId}`);
    
    const response = await axios.get(
      `https://graph.facebook.com/v16.0/${postId}?fields=permalink&access_token=${INSTAGRAM_TOKEN}`
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

// Основная функция
async function postInstagramCarousel() {
  try {
    log('Запуск публикации карусели в Instagram');
    
    // Проверка настроек Instagram
    if (!INSTAGRAM_TOKEN || !INSTAGRAM_BUSINESS_ACCOUNT_ID) {
      log('❌ Ошибка: Отсутствуют токен Instagram или ID бизнес-аккаунта');
      return;
    }
    
    log(`Instagram Business Account ID: ${INSTAGRAM_BUSINESS_ACCOUNT_ID}`);
    log(`Изображения для публикации:\n1. ${IMAGE_1}\n2. ${IMAGE_2}`);
    
    // 1. Создание контейнеров для отдельных изображений
    const containerId1 = await createImageContainer(IMAGE_1);
    if (!containerId1) {
      log('❌ Ошибка: Не удалось создать контейнер для первого изображения');
      return;
    }
    
    // Задержка между запросами
    await delay(1000);
    
    const containerId2 = await createImageContainer(IMAGE_2);
    if (!containerId2) {
      log('❌ Ошибка: Не удалось создать контейнер для второго изображения');
      return;
    }
    
    const containerIds = [containerId1, containerId2];
    log(`Успешно созданы контейнеры для изображений: ${containerIds.join(', ')}`);
    
    // Задержка между запросами
    await delay(1000);
    
    // 2. Создание контейнера карусели
    const carouselContainerId = await createCarouselContainer(containerIds, CAPTION);
    if (!carouselContainerId) {
      log('❌ Ошибка: Не удалось создать контейнер карусели');
      return;
    }
    
    // Задержка перед публикацией
    log('Ожидание 3 секунды перед публикацией...');
    await delay(3000);
    
    // 3. Публикация карусели
    const postId = await publishCarousel(carouselContainerId);
    if (!postId) {
      log('❌ Ошибка: Не удалось опубликовать карусель');
      return;
    }
    
    // 4. Получение ссылки на публикацию
    const permalink = await getPermalink(postId);
    
    // 5. Вывод итогов
    if (permalink) {
      log(`✅ УСПЕХ! Карусель опубликована в Instagram`);
      log(`ID публикации: ${postId}`);
      log(`Постоянная ссылка: ${permalink}`);
    } else {
      log(`ℹ️ Карусель опубликована, но не удалось получить постоянную ссылку`);
      log(`ID публикации: ${postId}`);
    }
    
  } catch (error) {
    log(`❌ Ошибка при публикации карусели: ${error.message}`);
    if (error.stack) {
      log(`Стек вызовов: ${error.stack}`);
    }
  } finally {
    log('Завершение публикации карусели');
  }
}

// Запуск публикации
postInstagramCarousel();
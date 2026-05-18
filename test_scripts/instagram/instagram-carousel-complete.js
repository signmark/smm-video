/**
 * Полный скрипт публикации карусели в Instagram с увеличенными задержками
 */

import axios from 'axios';
import { config } from 'dotenv';
import fs from 'fs';

// Загружаем переменные окружения
config();

// Instagram API конфигурация
const INSTAGRAM_TOKEN = process.env.INSTAGRAM_TOKEN;
const INSTAGRAM_BUSINESS_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

// Изображения и текст
const IMAGE_1 = 'https://v3.fal.media/files/rabbit/TOLFCrYadFmSqJ5WwwYE-.png';
const IMAGE_2 = 'https://v3.fal.media/files/lion/W-HNg-Ax1vlVUVAXoNAva.png';
const CAPTION = 'Тестовая карусель для Instagram #тест #instagram #replit';

// Увеличенные задержки (в миллисекундах)
const CONTAINER_DELAY = 5000;  // 5 секунд
const CAROUSEL_DELAY = 10000;  // 10 секунд

// Функция для логирования
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync('instagram-carousel-complete.log', logMessage + '\n');
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
    log(`ID контейнеров изображений: ${containerIds.join(', ')}`);
    
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

// Получение постоянной ссылки
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
    log('=== ЗАПУСК ПУБЛИКАЦИИ КАРУСЕЛИ В INSTAGRAM ===');
    
    // Проверка настроек
    if (!INSTAGRAM_TOKEN || !INSTAGRAM_BUSINESS_ACCOUNT_ID) {
      log('❌ Ошибка: Отсутствуют настройки Instagram API');
      return;
    }
    
    log(`Instagram Business Account ID: ${INSTAGRAM_BUSINESS_ACCOUNT_ID}`);
    log(`Изображение 1: ${IMAGE_1}`);
    log(`Изображение 2: ${IMAGE_2}`);
    
    // 1. Создание контейнера для первого изображения
    log(`Шаг 1: Создание контейнера для изображения 1`);
    const containerId1 = await createImageContainer(IMAGE_1);
    if (!containerId1) {
      log('❌ Ошибка: Не удалось создать контейнер для первого изображения');
      return;
    }
    
    // Задержка перед следующим запросом
    log(`Ожидание ${CONTAINER_DELAY/1000} секунд перед созданием следующего контейнера...`);
    await delay(CONTAINER_DELAY);
    
    // 2. Создание контейнера для второго изображения
    log(`Шаг 2: Создание контейнера для изображения 2`);
    const containerId2 = await createImageContainer(IMAGE_2);
    if (!containerId2) {
      log('❌ Ошибка: Не удалось создать контейнер для второго изображения');
      return;
    }
    
    const containerIds = [containerId1, containerId2];
    log(`Созданы контейнеры для всех изображений: ${containerIds.join(', ')}`);
    
    // Задержка перед созданием карусели
    log(`Ожидание ${CAROUSEL_DELAY/1000} секунд перед созданием контейнера карусели...`);
    await delay(CAROUSEL_DELAY);
    
    // 3. Создание контейнера карусели
    log(`Шаг 3: Создание контейнера карусели`);
    const carouselContainerId = await createCarouselContainer(containerIds, CAPTION);
    if (!carouselContainerId) {
      log('❌ Ошибка: Не удалось создать контейнер карусели');
      return;
    }
    
    // Задержка перед публикацией
    log(`Ожидание ${CAROUSEL_DELAY/1000} секунд перед публикацией карусели...`);
    await delay(CAROUSEL_DELAY);
    
    // 4. Публикация карусели
    log(`Шаг 4: Публикация карусели`);
    const postId = await publishCarousel(carouselContainerId);
    if (!postId) {
      log('❌ Ошибка: Не удалось опубликовать карусель');
      return;
    }
    
    // 5. Получение ссылки
    log(`Шаг 5: Получение постоянной ссылки на публикацию`);
    const permalink = await getPermalink(postId);
    
    // 6. Вывод результатов
    if (permalink) {
      log(`=== ✅ УСПЕХ! КАРУСЕЛЬ ОПУБЛИКОВАНА В INSTAGRAM ===`);
      log(`ID публикации: ${postId}`);
      log(`URL публикации: ${permalink}`);
    } else {
      log(`=== ℹ️ КАРУСЕЛЬ ОПУБЛИКОВАНА, НО БЕЗ ССЫЛКИ ===`);
      log(`ID публикации: ${postId}`);
      log(`Необходимо вручную проверить аккаунт Instagram`);
    }
    
  } catch (error) {
    log(`❌ КРИТИЧЕСКАЯ ОШИБКА: ${error.message}`);
    if (error.stack) {
      log(`Стек вызовов: ${error.stack}`);
    }
  } finally {
    log('=== ЗАВЕРШЕНИЕ СКРИПТА ПУБЛИКАЦИИ КАРУСЕЛИ ===');
  }
}

// Запуск публикации
postInstagramCarousel();
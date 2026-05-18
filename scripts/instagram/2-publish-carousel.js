/**
 * Шаг 2: Публикация карусели Instagram
 * (Использует контейнеры, созданные на предыдущем шаге)
 */

import axios from 'axios';
import { config } from 'dotenv';
import fs from 'fs';

// Загружаем переменные окружения
config();

// ID контейнеров, полученные на предыдущем шаге
const CONTAINER_ID_1 = '18058824209155400';
const CONTAINER_ID_2 = '17855242740372879';

// Instagram API конфигурация
const INSTAGRAM_TOKEN = process.env.INSTAGRAM_TOKEN;
const INSTAGRAM_BUSINESS_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
const CAPTION = 'Тестовая карусель для Instagram #тест #instagram #replit';

// Функция для логирования
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync('instagram-carousel-publish.log', logMessage + '\n');
}

// Задержка
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Создание карусельного контейнера
async function createCarouselContainer(containerIds, caption) {
  try {
    log(`Создание контейнера карусели с ID изображений: ${containerIds.join(', ')}`);
    
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

// Получение permalink публикации
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
async function createAndPublishCarousel() {
  try {
    log('Запуск публикации карусели в Instagram (Шаг 2)');
    
    // Проверка доступности контейнеров
    if (!CONTAINER_ID_1 || !CONTAINER_ID_2) {
      log('❌ Ошибка: Не указаны ID контейнеров. Проверьте результаты предыдущего шага.');
      return;
    }
    
    const containerIds = [CONTAINER_ID_1, CONTAINER_ID_2];
    log(`Используем контейнеры: ${containerIds.join(', ')}`);
    
    // 1. Создание контейнера карусели
    const carouselContainerId = await createCarouselContainer(containerIds, CAPTION);
    if (!carouselContainerId) {
      log('❌ Ошибка: Не удалось создать контейнер карусели');
      return;
    }
    
    // Задержка перед публикацией
    log('Ожидание 3 секунды перед публикацией...');
    await delay(3000);
    
    // 2. Публикация карусели
    const postId = await publishCarousel(carouselContainerId);
    if (!postId) {
      log('❌ Ошибка: Не удалось опубликовать карусель');
      return;
    }
    
    // 3. Получение ссылки на публикацию
    const permalink = await getPermalink(postId);
    
    // 4. Вывод итогов
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
createAndPublishCarousel();
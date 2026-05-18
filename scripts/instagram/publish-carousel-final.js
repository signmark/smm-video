/**
 * Финальный шаг публикации карусели в Instagram
 * Использует уже созданные контейнеры и карусельный контейнер
 */

import axios from 'axios';
import { config } from 'dotenv';
import fs from 'fs';

// Загружаем переменные окружения
config();

// Instagram API конфигурация
const INSTAGRAM_TOKEN = process.env.INSTAGRAM_TOKEN;
const INSTAGRAM_BUSINESS_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

// Важно: создаем новый карусельный контейнер, т.к. предыдущие могли устареть
const CONTAINER_1_ID = '17961766307770960';  // ID из предыдущего шага
const CONTAINER_2_ID = '18080645899732268';  // ID из предыдущего шага

// Логирование
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync('instagram-carousel-final.log', logMessage + '\n');
}

// Задержка
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Создание карусельного контейнера
async function createCarouselContainer() {
  try {
    log(`Создание нового контейнера карусели с изображениями: ${CONTAINER_1_ID}, ${CONTAINER_2_ID}`);
    
    const response = await axios({
      method: 'post',
      url: `https://graph.facebook.com/v16.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/media`,
      data: {
        access_token: INSTAGRAM_TOKEN,
        media_type: 'CAROUSEL',
        children: `${CONTAINER_1_ID},${CONTAINER_2_ID}`,
        caption: 'Тестовая карусель для Instagram #тест #instagram #replit'
      }
    });
    
    if (response.data && response.data.id) {
      const containerId = response.data.id;
      log(`Контейнер карусели создан успешно, ID: ${containerId}`);
      return containerId;
    } else {
      log(`Ошибка: Ответ API не содержит ID контейнера`);
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
async function publishCarousel(containerId) {
  try {
    log(`Публикация карусели, ID контейнера: ${containerId}`);
    
    const response = await axios({
      method: 'post',
      url: `https://graph.facebook.com/v16.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/media_publish`,
      data: {
        access_token: INSTAGRAM_TOKEN,
        creation_id: containerId
      }
    });
    
    if (response.data && response.data.id) {
      const postId = response.data.id;
      log(`Карусель опубликована успешно, ID публикации: ${postId}`);
      return postId;
    } else {
      log(`Ошибка: Ответ API не содержит ID публикации`);
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

// Получение ссылки на публикацию
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
      log(`Не удалось получить постоянную ссылку`);
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
async function finalPublishCarousel() {
  try {
    log('=== ФИНАЛЬНЫЙ ЭТАП ПУБЛИКАЦИИ КАРУСЕЛИ В INSTAGRAM ===');
    
    // 1. Создаем новый карусельный контейнер
    const carouselContainerId = await createCarouselContainer();
    if (!carouselContainerId) {
      log('❌ Ошибка: Не удалось создать контейнер карусели');
      return;
    }
    
    // Пауза перед публикацией
    log('Ожидание 10 секунд перед публикацией...');
    await delay(10000);
    
    // 2. Публикуем карусель
    const postId = await publishCarousel(carouselContainerId);
    if (!postId) {
      log('❌ Ошибка: Не удалось опубликовать карусель');
      return;
    }
    
    // 3. Получаем постоянную ссылку
    const permalink = await getPermalink(postId);
    
    // 4. Итоговый результат
    log('=== РЕЗУЛЬТАТ ПУБЛИКАЦИИ ===');
    if (permalink) {
      log(`✅ УСПЕХ! Карусель опубликована в Instagram`);
      log(`ID публикации: ${postId}`);
      log(`Ссылка на публикацию: ${permalink}`);
    } else {
      log(`✅ Карусель опубликована, но не удалось получить ссылку`);
      log(`ID публикации: ${postId}`);
    }
    
  } catch (error) {
    log(`❌ Критическая ошибка: ${error.message}`);
    if (error.stack) {
      log(`Стек вызовов: ${error.stack}`);
    }
  } finally {
    log('=== ЗАВЕРШЕНИЕ СКРИПТА ===');
  }
}

// Запуск публикации
finalPublishCarousel();
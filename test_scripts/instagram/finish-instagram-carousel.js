/**
 * Завершение публикации карусели Instagram
 * Использует уже созданные контейнеры и публикует их
 */

import axios from 'axios';
import { config } from 'dotenv';
import fs from 'fs';

// Загружаем переменные окружения
config();

// Instagram API конфигурация
const INSTAGRAM_TOKEN = process.env.INSTAGRAM_TOKEN;
const INSTAGRAM_BUSINESS_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

// ID контейнеров, полученные на предыдущем шаге
const CONTAINER_1_ID = '17961766307770960'; // ID первого контейнера
let CONTAINER_2_ID = ''; // ID второго контейнера получим в процессе

// Подпись к карусели
const CAPTION = 'Тестовая карусель для Instagram #тест #instagram';

// Функция для логирования
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync('instagram-carousel-finish.log', logMessage + '\n');
}

// Задержка между запросами
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Создаем второй контейнер, если он не был создан
async function createSecondContainer() {
  const imageUrl = 'https://v3.fal.media/files/lion/W-HNg-Ax1vlVUVAXoNAva.png';
  
  log(`Создание второго контейнера для изображения: ${imageUrl}`);
  
  try {
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
      CONTAINER_2_ID = response.data.id;
      log(`Второй контейнер создан успешно, ID: ${CONTAINER_2_ID}`);
      return true;
    } else {
      log('Ошибка: Ответ API не содержит ID контейнера');
      return false;
    }
  } catch (error) {
    log(`Ошибка при создании второго контейнера: ${error.message}`);
    if (error.response) {
      log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    return false;
  }
}

// Создаем контейнер карусели
async function createCarouselContainer() {
  log(`Создание контейнера карусели с двумя изображениями`);
  log(`ID контейнеров: ${CONTAINER_1_ID}, ${CONTAINER_2_ID}`);
  
  try {
    const containerIds = [CONTAINER_1_ID, CONTAINER_2_ID];
    
    const response = await axios({
      method: 'post',
      url: `https://graph.facebook.com/v16.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/media`,
      data: {
        access_token: INSTAGRAM_TOKEN,
        media_type: 'CAROUSEL',
        children: containerIds.join(','),
        caption: CAPTION
      }
    });
    
    if (response.data && response.data.id) {
      const carouselContainerId = response.data.id;
      log(`Контейнер карусели создан успешно, ID: ${carouselContainerId}`);
      return carouselContainerId;
    } else {
      log('Ошибка: Ответ API не содержит ID контейнера карусели');
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

// Публикуем карусель
async function publishCarousel(carouselContainerId) {
  log(`Публикация карусели, контейнер ID: ${carouselContainerId}`);
  
  try {
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
      log('Ошибка: Ответ API не содержит ID публикации');
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

// Получаем постоянную ссылку на публикацию
async function getPermalink(postId) {
  log(`Получение постоянной ссылки для публикации: ${postId}`);
  
  try {
    const response = await axios.get(
      `https://graph.facebook.com/v16.0/${postId}?fields=permalink&access_token=${INSTAGRAM_TOKEN}`
    );
    
    if (response.data && response.data.permalink) {
      const permalink = response.data.permalink;
      log(`Постоянная ссылка на публикацию: ${permalink}`);
      return permalink;
    } else {
      log('Не удалось получить постоянную ссылку');
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

// Публикуем карусель
async function finishCarouselPublication() {
  try {
    log('=== ЗАВЕРШЕНИЕ ПУБЛИКАЦИИ КАРУСЕЛИ В INSTAGRAM ===');
    
    // Если второй контейнер не был создан, создаем его
    if (!CONTAINER_2_ID) {
      const success = await createSecondContainer();
      if (!success) {
        log('❌ Не удалось создать второй контейнер. Отмена публикации.');
        return;
      }
      
      // Пауза перед созданием карусели
      log('Пауза 5 секунд перед созданием карусели...');
      await delay(5000);
    }
    
    // Создаем контейнер карусели
    const carouselContainerId = await createCarouselContainer();
    if (!carouselContainerId) {
      log('❌ Не удалось создать контейнер карусели. Отмена публикации.');
      return;
    }
    
    // Пауза перед публикацией
    log('Пауза 10 секунд перед публикацией...');
    await delay(10000);
    
    // Публикуем карусель
    const postId = await publishCarousel(carouselContainerId);
    if (!postId) {
      log('❌ Не удалось опубликовать карусель.');
      return;
    }
    
    // Получаем постоянную ссылку
    const permalink = await getPermalink(postId);
    
    // Выводим результат
    log('=== ИТОГ ПУБЛИКАЦИИ ===');
    if (permalink) {
      log(`✅ Карусель успешно опубликована!`);
      log(`ID публикации: ${postId}`);
      log(`Ссылка на публикацию: ${permalink}`);
    } else {
      log(`✅ Карусель опубликована, но не удалось получить ссылку.`);
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

// Запускаем публикацию
finishCarouselPublication();
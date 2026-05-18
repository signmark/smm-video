/**
 * Скрипт для публикации карусели Instagram с использованием среды окружения
 */

import axios from 'axios';
import { config } from 'dotenv';
import fs from 'fs';

// Загружаем переменные окружения
config();

// Instagram API конфигурация
const INSTAGRAM_TOKEN = process.env.INSTAGRAM_TOKEN;
const INSTAGRAM_BUSINESS_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

// Изображения и подпись
const IMAGE_URLS = [
  'https://v3.fal.media/files/rabbit/TOLFCrYadFmSqJ5WwwYE-.png',
  'https://v3.fal.media/files/lion/W-HNg-Ax1vlVUVAXoNAva.png'
];
const CAPTION = 'Тестовая карусель для Instagram #тест #instagram';

// Функция для логирования
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync('instagram-carousel-post.log', logMessage + '\n');
}

// Задержка между запросами
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Публикуем карусель
async function postCarousel() {
  try {
    log('Запуск публикации карусели в Instagram');
    
    // Проверяем наличие нужных настроек
    if (!INSTAGRAM_TOKEN || !INSTAGRAM_BUSINESS_ACCOUNT_ID) {
      log('Ошибка: Отсутствуют настройки Instagram API в .env файле');
      log('Проверьте наличие INSTAGRAM_TOKEN и INSTAGRAM_BUSINESS_ACCOUNT_ID');
      return;
    }
    
    log(`Используем Instagram Business Account ID: ${INSTAGRAM_BUSINESS_ACCOUNT_ID}`);
    log(`Изображения для публикации: ${IMAGE_URLS.length} шт.`);
    
    // 1. Создаем контейнеры для всех изображений
    const containerIds = [];
    for (let i = 0; i < IMAGE_URLS.length; i++) {
      log(`Создание контейнера для изображения ${i+1}: ${IMAGE_URLS[i]}`);
      
      try {
        const response = await axios({
          method: 'post',
          url: `https://graph.facebook.com/v16.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/media`,
          data: {
            access_token: INSTAGRAM_TOKEN,
            image_url: IMAGE_URLS[i],
            is_carousel_item: true
          }
        });
        
        if (response.data && response.data.id) {
          log(`Контейнер ${i+1} создан успешно, ID: ${response.data.id}`);
          containerIds.push(response.data.id);
        } else {
          throw new Error('Ответ API не содержит ID контейнера');
        }
      } catch (error) {
        log(`Ошибка при создании контейнера ${i+1}: ${error.message}`);
        if (error.response) {
          log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
        }
        return;
      }
      
      // Делаем паузу между созданием контейнеров
      log('Пауза 5 секунд перед следующей операцией...');
      await delay(5000);
    }
    
    log(`Успешно созданы контейнеры для всех изображений: ${containerIds.join(', ')}`);
    
    // 2. Создаем контейнер карусели
    log('Создание контейнера карусели...');
    let carouselContainerId;
    
    try {
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
        carouselContainerId = response.data.id;
        log(`Контейнер карусели создан успешно, ID: ${carouselContainerId}`);
      } else {
        throw new Error('Ответ API не содержит ID контейнера карусели');
      }
    } catch (error) {
      log(`Ошибка при создании контейнера карусели: ${error.message}`);
      if (error.response) {
        log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
      }
      return;
    }
    
    // Делаем паузу перед публикацией
    log('Пауза 10 секунд перед публикацией...');
    await delay(10000);
    
    // 3. Публикуем карусель
    log(`Публикация карусели, контейнер ID: ${carouselContainerId}`);
    let postId;
    
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
        postId = response.data.id;
        log(`Карусель опубликована успешно, ID публикации: ${postId}`);
      } else {
        throw new Error('Ответ API не содержит ID публикации');
      }
    } catch (error) {
      log(`Ошибка при публикации карусели: ${error.message}`);
      if (error.response) {
        log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
      }
      return;
    }
    
    // 4. Получаем постоянную ссылку на публикацию
    log(`Получение постоянной ссылки для публикации ID: ${postId}`);
    
    try {
      const response = await axios.get(
        `https://graph.facebook.com/v16.0/${postId}?fields=permalink&access_token=${INSTAGRAM_TOKEN}`
      );
      
      if (response.data && response.data.permalink) {
        const permalink = response.data.permalink;
        log(`Постоянная ссылка на публикацию: ${permalink}`);
        
        log('=== ИТОГ ПУБЛИКАЦИИ ===');
        log(`✅ Карусель успешно опубликована!`);
        log(`ID публикации: ${postId}`);
        log(`Ссылка на публикацию: ${permalink}`);
      } else {
        log('Публикация успешна, но не удалось получить постоянную ссылку');
      }
    } catch (error) {
      log(`Публикация выполнена, но ошибка при получении ссылки: ${error.message}`);
      if (error.response) {
        log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
      }
    }
    
  } catch (error) {
    log(`Критическая ошибка: ${error.message}`);
    if (error.stack) {
      log(`Стек вызовов: ${error.stack}`);
    }
  } finally {
    log('Завершение скрипта публикации карусели');
  }
}

// Запускаем публикацию
postCarousel();
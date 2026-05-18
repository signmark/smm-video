/**
 * Публикация уже созданного карусельного контейнера в Instagram
 */

import axios from 'axios';
import { config } from 'dotenv';
import fs from 'fs';

// Загружаем переменные окружения
config();

// Instagram API конфигурация
const INSTAGRAM_TOKEN = process.env.INSTAGRAM_TOKEN;
const INSTAGRAM_BUSINESS_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

// ID контейнера карусели из предыдущего шага
const CAROUSEL_CONTAINER_ID = '18007665818568359';

// Функция для логирования
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync('instagram-carousel-publish.log', logMessage + '\n');
}

// Публикация карусели
async function publishCarousel() {
  try {
    log('=== ПУБЛИКАЦИЯ КАРУСЕЛЬНОГО КОНТЕЙНЕРА В INSTAGRAM ===');
    log(`Использую контейнер карусели с ID: ${CAROUSEL_CONTAINER_ID}`);
    
    const response = await axios({
      method: 'post',
      url: `https://graph.facebook.com/v16.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/media_publish`,
      data: {
        access_token: INSTAGRAM_TOKEN,
        creation_id: CAROUSEL_CONTAINER_ID
      }
    });
    
    if (response.data && response.data.id) {
      const postId = response.data.id;
      log(`✅ Карусель опубликована успешно, ID публикации: ${postId}`);
      
      // Получаем постоянную ссылку
      try {
        const permalinkResponse = await axios.get(
          `https://graph.facebook.com/v16.0/${postId}?fields=permalink&access_token=${INSTAGRAM_TOKEN}`
        );
        
        if (permalinkResponse.data && permalinkResponse.data.permalink) {
          const permalink = permalinkResponse.data.permalink;
          log(`✅ Постоянная ссылка на публикацию: ${permalink}`);
        } else {
          log(`⚠️ Карусель опубликована, но не удалось получить ссылку`);
        }
      } catch (permalinkError) {
        log(`⚠️ Карусель опубликована, но ошибка при получении ссылки: ${permalinkError.message}`);
      }
      
      return true;
    } else {
      log(`❌ Ошибка: Ответ API не содержит ID публикации`);
      log(`Ответ API: ${JSON.stringify(response.data)}`);
      return false;
    }
  } catch (error) {
    log(`❌ Ошибка при публикации карусели: ${error.message}`);
    if (error.response) {
      log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    return false;
  } finally {
    log('=== ЗАВЕРШЕНИЕ СКРИПТА ПУБЛИКАЦИИ ===');
  }
}

// Запускаем публикацию
publishCarousel();
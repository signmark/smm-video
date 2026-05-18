#!/usr/bin/env node

/**
 * Тестовый скрипт для проверки публикации видео через webhook Facebook v3
 * Скрипт тестирует прямую отправку видео в Facebook через webhooks
 * 
 * Запуск: node test-facebook-video-webhook.mjs
 */

import fetch from 'node-fetch';
import { URLSearchParams } from 'url';
import dotenv from 'dotenv';

// Загружаем переменные окружения из .env файла
dotenv.config();

// Логирование с поддержкой даты/времени
function log(message) {
  const now = new Date();
  console.log(`[${now.toISOString()}] ${message}`);
}

/**
 * Тест POST запроса для публикации видео в Facebook
 */
async function testFacebookVideoWebhook() {
  try {
    log('Начало теста публикации видео в Facebook через webhook v3');
    
    // URL вебхука для публикации в Facebook
    const webhookUrl = 'http://localhost:5000/api/facebook-webhook-v3';
    
    // ID тестового контента с видео
    // ВАЖНО: Убедитесь, что контент существует и содержит video_url
    const contentId = 'b35f34b6-a6e6-4dba-ba97-6e151c82d1e1'; 
    
    log(`Отправка запроса с contentId: ${contentId}`);
    
    // Выполняем POST запрос
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ contentId })
    });
    
    // Получаем ответ
    const data = await response.json();
    log(`Статус ответа: ${response.status}`);
    log(`Тело ответа: ${JSON.stringify(data, null, 2)}`);
    
    if (response.ok) {
      log('✅ Тест успешно пройден: Видео опубликовано в Facebook');
      if (data.permalink) {
        log(`🔗 Ссылка на опубликованное видео: ${data.permalink}`);
      }
    } else {
      log('❌ Тест не пройден: Ошибка публикации видео');
    }
    
  } catch (error) {
    log(`❌ Ошибка при выполнении теста: ${error.message}`);
    if (error.response) {
      try {
        const errorBody = await error.response.text();
        log(`Детали ошибки: ${errorBody}`);
      } catch (e) {
        log('Не удалось получить детали ошибки');
      }
    }
  }
}

// Запускаем тест
testFacebookVideoWebhook();
#!/usr/bin/env node

/**
 * Скрипт для прямого тестирования загрузки видео на Facebook
 * Использует прямой метод Facebook Graph API для загрузки видео
 * 
 * Запуск: node test-facebook-video-upload-direct.mjs
 */

import fetch from 'node-fetch';
import { URLSearchParams } from 'url';
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

// Логирование с временной меткой
function log(message) {
  const now = new Date();
  console.log(`[${now.toISOString()}] ${message}`);
}

/**
 * Тестирует прямую загрузку видео на Facebook
 */
async function testVideoUpload() {
  try {
    log('Начало теста прямой загрузки видео в Facebook');
    
    // Получаем параметры из переменных окружения или используем значения по умолчанию
    const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
    const pageId = process.env.FACEBOOK_PAGE_ID || '2120362494678794';
    const videoUrl = 'https://buran-media.s3.beget.tech/dc14d8d2-0704-4dac-afb5-0ff82a8fd40d.mp4';
    
    log(`Используемые параметры:
- Page ID: ${pageId}
- Токен: ${accessToken.substring(0, 15)}...
- URL видео: ${videoUrl}`);
    
    // Версия Facebook Graph API
    const apiVersion = 'v19.0';
    
    // Формируем URL для запроса
    const endpointUrl = `https://graph.facebook.com/${apiVersion}/${pageId}/videos`;
    
    // Подготавливаем данные для запроса
    const params = new URLSearchParams();
    params.append('file_url', videoUrl);
    params.append('description', 'Тестовое видео, загруженное напрямую через Facebook Graph API');
    params.append('title', 'Тестовое видео для API Facebook');
    params.append('access_token', accessToken);
    
    log(`Отправка запроса на ${endpointUrl}`);
    
    // Отправляем запрос
    const response = await fetch(endpointUrl, {
      method: 'POST',
      body: params
    });
    
    const data = await response.json();
    log(`Статус ответа: ${response.status}`);
    log(`Ответ: ${JSON.stringify(data, null, 2)}`);
    
    if (response.ok && data.id) {
      log(`✅ Тест успешно пройден: видео загружено, ID: ${data.id}`);
      
      // Формируем ссылку на видео
      const videoPostUrl = `https://facebook.com/${pageId}/videos/${data.id}`;
      log(`🔗 Ссылка на видео: ${videoPostUrl}`);
      
      // Проверяем статус публикации
      log('Ожидаем публикацию видео (может занять некоторое время)...');
      log('Рекомендуется проверить статус публикации вручную по ссылке выше.');
    } else {
      log(`❌ Тест не пройден: ${data.error?.message || 'Неизвестная ошибка'}`);
    }
  } catch (error) {
    log(`❌ Ошибка при выполнении теста: ${error.message}`);
  }
}

// Запускаем тест
testVideoUpload();

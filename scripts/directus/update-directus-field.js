/**
 * Скрипт для регистрации поля additional_media через прямой запрос к Directus API
 * 
 * Использует учетные данные из окружения, которые уже настроены.
 * 
 * Запуск: node update-directus-field.js
 */

import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// Получаем настройки из .env
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
const ADMIN_EMAIL = process.env.DIRECTUS_ADMIN_EMAIL || 'lbrspb@gmail.com';
const ADMIN_PASSWORD = process.env.DIRECTUS_ADMIN_PASSWORD || 'QtpZ3dh7';

/**
 * Логирование с поддержкой вывода в консоль и в файл
 */
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  
  // Добавляем запись в файл лога
  fs.appendFileSync('update-directus-field.log', logMessage + '\n');
}

/**
 * Основная функция создания поля
 */
async function createField() {
  try {
    log('Начинаем процесс создания поля additional_media в Directus');
    
    // Авторизуемся в Directus
    log(`Авторизация с почтой ${ADMIN_EMAIL} в ${DIRECTUS_URL}`);
    const authResponse = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    
    const token = authResponse.data.data.access_token;
    log(`Авторизация успешна: получен токен длиной ${token.length} символов`);
    
    // Формируем данные для создания поля
    const fieldData = {
      collection: 'campaign_content',
      field: 'additional_media',
      type: 'json',
      schema: {
        is_nullable: true
      },
      meta: {
        interface: 'list',
        special: ['json'],
        options: {
          template: '{{url}} ({{type}})',
          fields: [
            {
              field: 'url',
              type: 'string',
              name: 'URL'
            },
            {
              field: 'type',
              type: 'string',
              name: 'Тип медиа',
              options: {
                choices: [
                  { value: 'image', text: 'Изображение' },
                  { value: 'video', text: 'Видео' }
                ]
              }
            },
            {
              field: 'title',
              type: 'string',
              name: 'Заголовок'
            },
            {
              field: 'description',
              type: 'text',
              name: 'Описание'
            }
          ]
        },
        display: 'formatted-json-value',
        note: 'Универсальное поле для хранения медиа-файлов (изображения, видео) с метаданными'
      }
    };
    
    // Отправляем запрос на создание поля
    log('Отправляем запрос на создание поля...');
    const response = await axios.post(
      `${DIRECTUS_URL}/fields/campaign_content`,
      fieldData,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    log('Поле additional_media успешно создано!');
    log(`Ответ API: ${JSON.stringify(response.data)}`);
    
  } catch (error) {
    log(`ОШИБКА: ${error.message}`);
    
    if (error.response) {
      log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
  }
}

// Запускаем создание поля
log('Запускаем скрипт создания поля additional_media');
createField();
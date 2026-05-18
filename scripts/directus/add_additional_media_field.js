/**
 * Скрипт для добавления поля additional_media в коллекцию campaign_content в Directus
 * Данный скрипт добавляет поддержку универсального хранения медиафайлов (изображения и видео)
 */

import axios from 'axios';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Настройки подключения
const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
const adminEmail = process.env.DIRECTUS_ADMIN_EMAIL || 'lbrspb@gmail.com';
const adminPassword = process.env.DIRECTUS_ADMIN_PASSWORD || 'QtpZ3dh7';
const adminToken = process.env.DIRECTUS_ADMIN_TOKEN || 'zQJK4b84qrQeuTYS2-x9QqpEyDutJGsb';

/**
 * Логирование с поддержкой записи в файл
 * @param {string} message Сообщение для логирования
 */
function log(message) {
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] ${message}`;
  console.log(formattedMessage);
  
  // Добавляем запись в лог-файл
  fs.appendFileSync('add_additional_media_field.log', formattedMessage + '\n');
}

/**
 * Основная функция для добавления поля additional_media
 */
async function addAdditionalMediaField() {
  try {
    log('Начало процесса добавления поля additional_media');
    
    // Используем токен администратора из env
    log('Использование административного токена из переменных окружения...');
    // Уже определен в настройках выше: const adminToken = process.env.DIRECTUS_ADMIN_TOKEN || 'zQJK4b84qrQeuTYS2-x9QqpEyDutJGsb';
    log('Административный токен получен успешно');
    
    // Проверяем наличие поля в схеме
    try {
      log('Проверка наличия поля additional_media в схеме...');
      const fieldsResponse = await axios.get(
        `${directusUrl}/fields/campaign_content/additional_media`,
        {
          headers: {
            Authorization: `Bearer ${adminToken}`
          }
        }
      );
      
      if (fieldsResponse.status === 200) {
        log('Поле additional_media уже существует. Завершение работы скрипта.');
        return;
      }
    } catch (error) {
      // Поле не найдено - это нормально, продолжаем
      if (error.response && error.response.status === 404) {
        log('Поле additional_media не найдено в схеме. Продолжаем процесс добавления...');
      } else {
        // Другая ошибка - выбрасываем дальше
        throw error;
      }
    }
    
    // Добавляем поле через SQL-запрос
    log('Начало добавления поля через API Directus...');
    
    // 1. Создаем новое поле
    const fieldData = {
      field: 'additional_media',
      type: 'json',
      schema: {
        name: 'additional_media',
        table: 'campaign_content',
        data_type: 'json',
        default_value: null,
        max_length: null,
        is_nullable: true
      },
      meta: {
        collection: 'campaign_content',
        field: 'additional_media',
        special: ['json'],
        interface: 'list',
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
              choices: [
                {
                  text: 'Изображение',
                  value: 'image'
                },
                {
                  text: 'Видео',
                  value: 'video'
                }
              ]
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
        readonly: false,
        hidden: false,
        width: 'full',
        note: 'Универсальное поле для хранения различных типов медиа (изображения, видео) с метаданными',
        required: false
      }
    };
    
    // Создаем поле через API
    await axios.post(
      `${directusUrl}/fields/campaign_content`,
      fieldData,
      {
        headers: {
          Authorization: `Bearer ${adminToken}`
        }
      }
    );
    
    log('Поле additional_media успешно добавлено в схему через API Directus');
    
    // Дополнительно добавляем поле в базу через SQL напрямую,
    // если API не обновит схему базы данных
    try {
      await addFieldViaSQL(adminToken);
    } catch (sqlError) {
      log(`Ошибка при добавлении поля через SQL: ${sqlError.message}`);
      log('Продолжаем работу, т.к. поле может быть уже создано через API');
    }
    
    log('Процесс добавления поля additional_media успешно завершен');
    
  } catch (error) {
    log(`Ошибка при добавлении поля additional_media: ${error.message}`);
    if (error.response) {
      log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    process.exit(1);
  }
}

/**
 * Добавляет поле через прямой SQL-запрос
 * @param {string} adminToken Административный токен доступа
 */
async function addFieldViaSQL(adminToken) {
  log('Начало добавления поля через прямой SQL-запрос...');
  
  // SQL-запрос для добавления столбца
  const sql = `
    -- Добавление поля additional_media типа JSON в таблицу campaign_content
    ALTER TABLE campaign_content 
    ADD COLUMN IF NOT EXISTS additional_media json DEFAULT NULL;
    
    -- Добавление комментария к полю
    COMMENT ON COLUMN campaign_content.additional_media IS 'Универсальное поле для хранения различных типов медиа (изображения, видео) с метаданными';
  `;
  
  // Выполнение SQL-запроса через Directus API
  const response = await axios.post(
    `${directusUrl}/utils/run-query`,
    { query: sql },
    {
      headers: {
        Authorization: `Bearer ${adminToken}`
      }
    }
  );
  
  log(`SQL-запрос выполнен. Ответ: ${JSON.stringify(response.data)}`);
  log('Поле additional_media успешно добавлено в таблицу через SQL');
}

// Запуск основной функции
addAdditionalMediaField().catch(err => {
  log(`Необработанная ошибка: ${err.message}`);
  process.exit(1);
});
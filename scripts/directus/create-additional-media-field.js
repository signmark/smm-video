// Скрипт для регистрации поля additional_media через Directus API
// Использует существующие токены из кэша приложения

import axios from 'axios';

const DIRECTUS_URL = 'https://directus.nplanner.ru';
const ADMIN_TOKEN = 'zQJK4b84qrQeuTYS2-x9QqpEyDutJGsb'; // Токен из env

async function createField() {
  console.log('Начинаем создание поля additional_media в коллекции campaign_content');

  try {
    // Создаем новое поле через API
    const fieldData = {
      collection: 'campaign_content',
      field: 'additional_media',
      type: 'json',
      schema: {
        is_nullable: true,
        default_value: null
      },
      meta: {
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
        display: 'formatted-json-value'
      }
    };

    const response = await axios.post(
      `${DIRECTUS_URL}/fields/campaign_content`,
      fieldData,
      {
        headers: {
          'Authorization': `Bearer ${ADMIN_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Поле успешно создано через API');
    console.log(response.data);
    
  } catch (error) {
    console.error('Ошибка при создании поля:', error.message);
    if (error.response) {
      console.error('Детали ошибки:', JSON.stringify(error.response.data));
    }
  }
}

// Запускаем функцию
createField();
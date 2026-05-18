/**
 * Скрипт для регистрации поля additional_images в Directus (упрощенная версия)
 */

import axios from 'axios';
import { config } from 'dotenv';
config();

// Настройки подключения к Directus
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
const ADMIN_EMAIL = process.env.DIRECTUS_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.DIRECTUS_ADMIN_PASSWORD;

async function registerAdditionalImagesField() {
  console.log('Регистрация поля additional_images в Directus...');
  
  // Получение токена администратора
  let adminToken;
  try {
    const authResponse = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    adminToken = authResponse.data.data.access_token;
    console.log('Успешная аутентификация администратора');
  } catch (error) {
    console.error('Ошибка аутентификации:', error.response?.data || error.message);
    return;
  }

  try {
    // Использование стандартного API Directus для регистрации поля
    const fieldData = {
      collection: 'campaign_content',
      field: 'additional_images',
      type: 'json',
      schema: {
        name: 'additional_images',
        comment: 'Массив URL-адресов дополнительных изображений',
        default_value: '[]'
      },
      meta: {
        interface: 'list',
        special: ['cast-json'],
        display: 'related-values',
        options: {
          template: '{{value}}',
          fields: [
            {
              field: 'value',
              name: 'URL изображения',
              type: 'string',
              meta: {
                interface: 'input',
                width: 'full'
              }
            }
          ]
        },
        width: 'full',
        group: 'content',
        translation: {
          'ru-RU': 'Дополнительные изображения',
          'en-US': 'Additional Images'
        }
      }
    };
    
    console.log('Запрос на регистрацию поля отправлен');

    // Сначала попробуем получить существующее поле (если оно есть)
    try {
      await axios.get(
        `${DIRECTUS_URL}/fields/campaign_content/additional_images`,
        {
          headers: {
            Authorization: `Bearer ${adminToken}`,
          },
        }
      );
      
      // Если поле существует, обновляем его
      console.log('Поле существует, обновляем его...');
      const response = await axios.patch(
        `${DIRECTUS_URL}/fields/campaign_content/additional_images`,
        fieldData,
        {
          headers: {
            Authorization: `Bearer ${adminToken}`,
          },
        }
      );
      
      if (response.status === 200) {
        console.log('Поле успешно обновлено в Directus');
        return true;
      } else {
        console.error('Ошибка обновления поля:', response.data);
        return false;
      }
    } catch (error) {
      // Если поле не найдено, создаем его
      if (error.response && error.response.status === 404) {
        console.log('Поле не найдено, создаем новое...');
        const createResponse = await axios.post(
          `${DIRECTUS_URL}/fields/campaign_content`,
          fieldData,
          {
            headers: {
              Authorization: `Bearer ${adminToken}`,
            },
          }
        );
        
        if (createResponse.status === 200 || createResponse.status === 201) {
          console.log('Поле успешно создано в Directus');
          return true;
        } else {
          console.error('Ошибка создания поля:', createResponse.data);
          return false;
        }
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('Ошибка при работе с API Directus:', error.response?.data || error.message);
    return false;
  }
}

// Запуск скрипта
registerAdditionalImagesField()
  .then((result) => {
    if (result) {
      console.log('Скрипт успешно выполнен');
    } else {
      console.error('Скрипт завершился с ошибкой');
    }
  })
  .catch(error => {
    console.error('Критическая ошибка выполнения скрипта:', error);
  });
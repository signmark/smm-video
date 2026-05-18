/**
 * Маршрут для создания поля additional_media в коллекции campaign_content
 * Добавляется к существующим маршрутам приложения
 */

import express from 'express';
import { Request, Response } from 'express';
import axios from 'axios';
import { directusAuthManager } from '../services/directus-auth-manager';
import { log } from '../utils/logger';

// Создаем маршрут для административных операций
export const createFieldsRoute = express.Router();

createFieldsRoute.post('/create-additional-media-field', async (req: Request, res: Response) => {
  try {
    log('Запуск процесса создания поля additional_media в campaign_content');
    
    // Получаем административный токен из системы кэширования токенов
    const adminId = process.env.DIRECTUS_ADMIN_USER_ID || '53921f16-f51d-4591-80b9-8caa4fde4d13';
    const adminToken = await directusAuthManager.getAuthToken(adminId);

    if (!adminToken) {
      log('Не удалось получить административный токен для создания поля');
      return res.status(401).json({ 
        success: false, 
        error: 'Отсутствует авторизация администратора' 
      });
    }

    log(`Получен административный токен: ${adminToken.substring(0, 10)}...`);

    // Проверяем наличие поля additional_media в схеме
    try {
      const directusUrl = process.env.DIRECTUS_URL;
      const checkResponse = await axios.get(
        `${directusUrl}/fields/campaign_content/additional_media`,
        {
          headers: {
            Authorization: `Bearer ${adminToken}`
          }
        }
      );

      if (checkResponse.status === 200) {
        log('Поле additional_media уже существует в схеме');
        return res.json({ 
          success: true, 
          message: 'Поле additional_media уже существует в системе',
          field: checkResponse.data.data
        });
      }
    } catch (checkError: any) {
      if (checkError.response && checkError.response.status === 404) {
        log('Поле не найдено, продолжаем процесс создания');
      } else {
        log(`Ошибка при проверке поля: ${checkError.message}`);
        if (checkError.response) {
          log(`Детали ошибки: ${JSON.stringify(checkError.response.data)}`);
        }
        return res.status(500).json({ 
          success: false, 
          error: 'Ошибка проверки поля',
          details: checkError.message 
        });
      }
    }

    // Создаем новое поле через API
    const directusUrl = process.env.DIRECTUS_URL;
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

    const createResponse = await axios.post(
      `${directusUrl}/fields/campaign_content`,
      fieldData,
      {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    log('Поле успешно создано через API');
    log(`Ответ API: ${JSON.stringify(createResponse.data)}`);

    res.json({ 
      success: true, 
      message: 'Поле additional_media успешно создано',
      field: createResponse.data.data
    });
  } catch (error: any) {
    log(`Ошибка при создании поля additional_media: ${error.message}`);
    
    if (error.response) {
      log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Не удалось создать поле',
      details: error.message,
      responseData: error.response?.data
    });
  }
});
import { Express, Request, Response } from "express";
import axios from "axios";
import { apiKeyService } from './services/api-keys';
import { falAiClient } from './services/fal-ai-client';
import { log } from "./utils/logger";

export function registerFalAiTestRoutes(app: Express) {
  // Маршрут для проверки API ключа FAL.AI (простая версия)
  app.get('/api/test-fal-ai', async (req: Request, res: Response) => {
    try {
      // Получаем userId из запроса
      const authHeader = req.headers['authorization'];
      let userId = null;
      let token = null;
      
      // Если есть авторизация, получаем userId из токена
      if (authHeader) {
        token = authHeader.replace('Bearer ', '');
        try {
          // Декодируем токен напрямую
          const tokenParts = token.split('.');
          if (tokenParts.length !== 3) {
            throw new Error('Invalid token format');
          }
          
          const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
          const userResponse = { 
            data: { 
              data: { 
                id: payload.id, 
                email: payload.email || 'unknown@email.com' 
              } 
            } 
          };
          
          /*const userResponse = await axios.get('${process.env.DIRECTUS_URL}/users/me', {
            headers: { Authorization: `Bearer ${token}` }
          });*/
          userId = userResponse?.data?.data?.id;
        } catch (error) {
          console.error("Ошибка при получении информации о пользователе:", error);
        }
      }
      
      // Получаем API ключ из сервиса ключей
      const apiKey = await apiKeyService.getApiKey(userId || '53921f16-f51d-4591-80b9-8caa4fde4d13', 'fal_ai', token || undefined);
      
      if (!apiKey) {
        return res.status(404).json({
          success: false,
          error: "API ключ FAL.AI не найден. Пожалуйста, добавьте его в настройки."
        });
      }
      
      log(`Тестирование API ключа FAL.AI: ${apiKey.substring(0, 10)}...`);
      
      // Правильно форматируем ключ - сначала удаляем префикс "Key " если он есть
      // И очищаем от возможных пробелов, переносов строк и других лишних символов
      let rawKey = apiKey.startsWith('Key ') ? apiKey.substring(4) : apiKey;
      rawKey = rawKey.trim(); // Удаляем лишние пробелы в начале и конце
      
      // Разбиваем ключ на части для проверки
      const keyParts = rawKey.split(':');
      
      // Затем проверяем форматирование самого ключа
      log(`Проверка формата ключа: длина=${rawKey.length}, содержит двоеточие=${rawKey.includes(':')}`);
      log(`Части ключа: ID(${keyParts[0].length} символов), SECRET(${keyParts.length > 1 ? keyParts[1].length : 0} символов)`);
      
      // Для всех вариантов форматирования ключа, которые мы хотим проверить
      const keyFormats = [
        { format: rawKey, description: "Без префикса 'Key'" },
        { format: `Key ${rawKey}`, description: "С префиксом 'Key'" },
        // Новый формат: Только UUID часть (FAL.AI может использовать только ID для авторизации)
        { format: keyParts[0], description: "Только UUID часть" },
        // Формат с Basic Auth
        { format: `Basic ${Buffer.from(rawKey).toString('base64')}`, description: "Basic Auth" },
        // Формат с Bearer
        { format: `Bearer ${rawKey}`, description: "Bearer" }
      ];
      
      // Проверяем каждый формат
      for (const { format, description } of keyFormats) {
        try {
          log(`Пробуем запрос с форматом ключа: ${description}`);
          const response = await axios.post('https://queue.fal.run/fal-ai/fast-sdxl', {
            prompt: "Test image", // Минимальный запрос
            width: 512,
            height: 512
          }, {
            headers: {
              Authorization: format,
              'Content-Type': 'application/json'
            }
          });
          
          // Если запрос успешен, возвращаем положительный результат
          if (response.data) {
            log(`Успешно! Формат "${description}" работает корректно`);
            return res.json({
              success: true,
              message: `API ключ FAL.AI работает корректно (${description})`,
              key_format: description,
              status: "active"
            });
          }
        } catch (error) {
          log(`Формат "${description}" не сработал: ${error.message}`);
          // Добавляем больше деталей для диагностики
          const errorDetails = error.response 
            ? {
                status: error.response.status,
                data: error.response.data
              } 
            : {
                message: error.message
              };
          log(`Детали ошибки: ${JSON.stringify(errorDetails)}`);
        }
      }
      
      // Если ни один из форматов не сработал, возвращаем ошибку
      return res.status(400).json({
        success: false,
        error: "Не удалось авторизоваться с текущим ключом FAL.AI",
        details: {
          tested_formats: keyFormats.map(f => f.description),
          key_info: {
            length: rawKey.length,
            has_colon: rawKey.includes(':'),
            id_length: keyParts[0].length,
            secret_length: keyParts.length > 1 ? keyParts[1].length : 0
          }
        },
        message: "Рекомендуется получить новый ключ API в панели управления FAL.AI"
      });
      
      // Этот код не должен выполниться, так как ранее уже должен быть возвращен ответ
      
    } catch (error: any) {
      console.error("Ошибка при тестировании API ключа FAL.AI:", error.message);
      
      // Извлекаем детали ошибки для диагностики
      const errorDetails = error.response 
        ? {
            status: error.response.status,
            data: error.response.data
          } 
        : {
            message: error.message
          };
      
      return res.status(500).json({
        success: false,
        error: "Ошибка при тестировании API ключа FAL.AI",
        details: errorDetails,
        message: error.message
      });
    }
  });
}
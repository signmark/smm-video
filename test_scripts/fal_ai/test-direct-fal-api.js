/**
 * Прямой тест API FAL.AI для понимания формата ответа
 */

import { fal } from '@fal-ai/client';
import { config } from 'dotenv';

// Инициализируем dotenv
config();

async function testDirectFalApi() {
  try {
    // Получаем API ключ из .env
    const apiKey = process.env.FAL_AI_API_KEY;
    if (!apiKey) {
      throw new Error('FAL_AI_API_KEY не найден в .env файле');
    }

    // Настраиваем клиент FAL.AI
    fal.config({
      credentials: apiKey
    });

    console.log('Тестирование прямого API FAL.AI...');
    
    // Тестируем rundiffusion-fal/juggernaut-flux/lightning
    const modelId = 'rundiffusion-fal/juggernaut-flux/lightning';
    
    console.log(`Отправка запроса к модели ${modelId}...`);
    
    // Параметры генерации
    const input = {
      prompt: "A beautiful fantasy landscape with mountains, forest and a castle, high quality, detailed, 4k",
      negative_prompt: "blurry, low quality, distorted, ugly, unrealistic",
      image_width: 1024,
      image_height: 1024,
      num_images: 1
    };
    
    console.log('Запрос с параметрами:', JSON.stringify(input, null, 2));
    
    // Прямой вызов API
    const result = await fal.subscribe(modelId, {
      input,
      onQueueUpdate: (update) => {
        console.log(`Статус: ${update.status}`);
        
        if (update.status === "IN_PROGRESS" && update.logs && Array.isArray(update.logs)) {
          console.log('Логи генерации:');
          update.logs.map((log) => log.message).forEach(message => {
            console.log(`[fal-ai-model] ${message}`);
          });
        }
      }
    });
    
    // Выводим полный ответ для анализа
    console.log('Полный ответ API:');
    console.log(JSON.stringify(result, null, 2));
    
    // Извлекаем URL изображений из ответа
    console.log('Поиск URL изображений в ответе API...');
    
    // Рекурсивная функция для поиска URL изображений
    const findImageUrls = (obj, path = '') => {
      const urls = [];
      
      if (!obj || typeof obj !== 'object') return urls;
      
      for (const [key, value] of Object.entries(obj)) {
        const currentPath = path ? `${path}.${key}` : key;
        
        // Проверяем, является ли значение URL изображения
        if (typeof value === 'string' && (
            value.includes('.jpg') || 
            value.includes('.png') || 
            value.includes('.webp') || 
            value.includes('fal.media') ||
            value.includes('cdn.')
        )) {
          console.log(`Найден URL в ${currentPath}: ${value}`);
          urls.push(value);
        } 
        // Для content_url (документация FAL.AI Flux API)
        else if (key === 'content_url' && typeof value === 'string') {
          console.log(`Найден content_url: ${value}`);
          urls.push(value);
        }
        // Для массива images
        else if (key === 'images' && Array.isArray(value)) {
          console.log(`Найден массив из ${value.length} изображений в поле images`);
          value.forEach((img, i) => {
            if (typeof img === 'string') {
              console.log(`images[${i}]: ${img}`);
              urls.push(img);
            } else if (img && img.url && typeof img.url === 'string') {
              console.log(`images[${i}].url: ${img.url}`);
              urls.push(img.url);
            }
          });
        }
        // Для вложенных объектов
        else if (value && typeof value === 'object') {
          urls.push(...findImageUrls(value, currentPath));
        }
      }
      
      return urls;
    };
    
    const imageUrls = findImageUrls(result);
    
    if (imageUrls.length > 0) {
      console.log(`✅ Найдено ${imageUrls.length} URL изображений`);
      imageUrls.forEach((url, index) => {
        console.log(`[${index + 1}] ${url}`);
      });
    } else {
      console.log('❌ URL изображений не найдены в ответе API');
    }
    
  } catch (error) {
    console.error('❌ Ошибка при тестировании API:');
    console.error(`Сообщение: ${error.message}`);
    
    if (error.response) {
      console.error(`Статус ответа: ${error.response.status}`);
      console.error('Данные ответа:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Запускаем тест
testDirectFalApi();
/**
 * Тестовый скрипт для генерации и демонстрации изображений с разными моделями FAL.AI
 */

import axios from 'axios';
import { config } from 'dotenv';
import fs from 'fs';

// Инициализируем dotenv
config();

// Функция для сохранения URL изображений в файл
async function saveImageUrls(modelName, urls) {
  if (!urls || urls.length === 0) {
    console.log(`Нет изображений для сохранения (${modelName})`);
    return;
  }
  
  try {
    const data = {
      model: modelName,
      timestamp: new Date().toISOString(),
      urls: urls
    };
    
    // Создаем или добавляем в файл
    fs.writeFileSync(`${modelName.replace(/\//g, '-')}.json`, JSON.stringify(data, null, 2));
    console.log(`Сохранены URL изображений для модели ${modelName}`);
  } catch (error) {
    console.error(`Ошибка при сохранении URL: ${error.message}`);
  }
}

// Функция для тестирования модели
async function testModel(modelName, prompt, negativePrompt = "") {
  try {
    console.log(`\n---\nТестирование модели: ${modelName}\n---`);
    
    // Получаем API ключ
    const apiKey = process.env.FAL_AI_API_KEY;
    if (!apiKey) {
      throw new Error('FAL_AI_API_KEY не найден в .env файле');
    }
    
    // Подготавливаем запрос
    const testRequest = {
      prompt: prompt,
      negativePrompt: negativePrompt || "blurry, low quality, distorted, ugly, unrealistic",
      model: modelName,
      width: 1024,
      height: 1024,
      token: apiKey
    };
    
    // Создаем редактированную версию для логов (скрываем API ключ)
    const redactedRequest = {
      ...testRequest,
      token: apiKey ? "****" + apiKey.substring(apiKey.length - 6) : null
    };
    
    console.log(`Параметры: ${JSON.stringify(redactedRequest, null, 2)}`);
    
    // Отправляем запрос
    const response = await axios.post(
      'http://localhost:5000/api/fal-ai-images',
      testRequest,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`Статус: ${response.status}`);
    
    // Выводим полный ответ для анализа
    console.log('Полный ответ API:');
    console.log(JSON.stringify(response.data, null, 2));
    
    // Если мы получили изображения
    if (response.data && response.data.success === true && response.data.images && Array.isArray(response.data.images) && response.data.images.length > 0) {
      console.log('✅ Успешно получены изображения:');
      
      response.data.images.forEach((url, index) => {
        console.log(`  [${index + 1}] ${url}`);
      });
      
      await saveImageUrls(modelName, response.data.images);
      return response.data.images;
    } else {
      console.error('❌ Ответ не содержит URLs изображений в ожидаемом формате');
      
      // Показываем структуру ответа для отладки
      if (response.data && typeof response.data === 'object') {
        console.log('Структура ответа API:');
        console.log(`Ключи в корне ответа: ${Object.keys(response.data).join(', ')}`);
        
        if (response.data.success !== undefined) {
          console.log(`Флаг success: ${response.data.success}`);
        }
        
        if (response.data.error) {
          console.log(`Ошибка API: ${response.data.error}`);
        }
          
        // Рекурсивная функция для поиска URL изображений в объекте
        const findImageUrls = (obj, path = '') => {
          let urls = [];
          
          if (!obj || typeof obj !== 'object') return urls;
          
          for (const [key, value] of Object.entries(obj)) {
            const currentPath = path ? `${path}.${key}` : key;
            
            if (typeof value === 'string' && (
                value.includes('.jpg') || 
                value.includes('.png') || 
                value.includes('.webp') ||
                value.includes('fal.media') ||
                value.includes('cdn.')
            )) {
              console.log(`  Найден URL в ${currentPath}: ${value}`);
              urls.push(value);
            } else if (typeof value === 'object' && value !== null) {
              urls = [...urls, ...findImageUrls(value, currentPath)];
            }
          }
          
          return urls;
        };
        
        const foundUrls = findImageUrls(response.data);
        if (foundUrls.length > 0) {
          console.log(`✅ Найдено ${foundUrls.length} URL изображений в ответе`);
          await saveImageUrls(modelName, foundUrls);
          return foundUrls;
        }
      }
      
      return [];
    }
    
  } catch (error) {
    console.error(`❌ Ошибка: ${error.message}`);
    
    if (error.response) {
      console.error(`Статус: ${error.response.status}`);
      console.error(`Данные: ${JSON.stringify(error.response.data, null, 2).substring(0, 200)}...`);
    }
    return [];
  }
}

// Основная функция для тестирования всех моделей
async function testAllModels() {
  // Тест 1: rundiffusion-fal/juggernaut-flux/lightning (Средняя качество)
  await testModel(
    "rundiffusion-fal/juggernaut-flux/lightning", 
    "A beautiful fantasy landscape with mountains, forest and a castle, high quality, detailed, 4k"
  );
  
  // Тест 2: rundiffusion-fal/juggernaut-flux-lora (Топ качество)
  await testModel(
    "rundiffusion-fal/juggernaut-flux-lora", 
    "A cinematic shot of a futuristic cityscape at sunset, photorealistic, 8k, highly detailed"
  );
  
  // Тест 3: fal-ai/flux-lora (Аналог)
  await testModel(
    "fal-ai/flux-lora", 
    "A professional portrait photograph of a business person in a modern office, photorealistic, sharp details, perfect lighting"
  );
}

// Запускаем тестирование всех моделей
testAllModels();
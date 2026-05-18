/**
 * Тестовый скрипт для проверки работы FAL.AI API с моделью rundiffusion-fal/juggernaut-flux/lightning
 * 
 * Использование: 
 * node test-fal-juggernaut-lightning.js
 */

import axios from 'axios';
import { config } from 'dotenv';

// Инициализируем dotenv
config();

async function testJuggernautLightning() {
  try {
    console.log('Тестирование API генерации изображений FAL.AI с моделью rundiffusion-fal/juggernaut-flux/lightning...');
    
    // Используем API-ключ из .env файла
    const apiKey = process.env.FAL_AI_API_KEY;
    if (!apiKey) {
      throw new Error('FAL_AI_API_KEY не найден в .env файле');
    }
    
    // Подготавливаем тестовые параметры для модели
    const testRequest = {
      prompt: "A beautiful fantasy landscape with mountains, forest and a castle, high quality, detailed, 4k",
      negativePrompt: "blurry, low quality, distorted, ugly",
      model: "rundiffusion-fal/juggernaut-flux/lightning", // Используем прямой путь к модели
      width: 1024,
      height: 1024,
      token: apiKey
    };
    
    // Создаем редактированную версию для логов (скрываем API ключ)
    const redactedRequest = {
      ...testRequest,
      token: apiKey ? "****" + apiKey.substring(apiKey.length - 6) : null
    };
    
    console.log(`Параметры запроса: ${JSON.stringify(redactedRequest, null, 2)}`);
    
    // Отправляем запрос через наш универсальный FAL.AI сервис
    const response = await axios.post(
      'http://localhost:5000/api/fal-ai-images',
      testRequest,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`Статус ответа: ${response.status}`);
    
    // Если мы получили ответ с изображениями
    if (response.data && response.data.images && response.data.images.length > 0) {
      console.log('✅ Успешно получили изображения:');
      response.data.images.forEach((url, index) => {
        console.log(`  Изображение ${index + 1}: ${url}`);
      });
    } else {
      console.error('❌ Ответ не содержит URLs изображений:', JSON.stringify(response.data));
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
testJuggernautLightning();
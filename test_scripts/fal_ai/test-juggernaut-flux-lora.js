/**
 * Тестовый скрипт для проверки генерации изображений с использованием модели Juggernaut Flux Lora
 * Использует улучшенную обработку API ключа и результат должен быть лучшего качества
 */

import axios from 'axios';
import * as fs from 'fs/promises';
import path from 'path';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';

// Инициализация dotenv
config();

async function testJuggernautFluxLora() {
  console.log('Начинаем тест генерации изображений с моделью Juggernaut Flux Lora...');
  
  const prompt = 'A serene landscape with mountains and a lake, photorealistic';
  
  try {
    // Проверяем, есть ли переменная окружения с API ключом
    const apiKey = process.env.FAL_AI_API_KEY;
    
    if (!apiKey) {
      console.error('Ошибка: FAL_AI_API_KEY не найден в переменных окружения');
      return;
    }
    
    console.log(`Используем API ключ: ${apiKey.substring(0, 5)}...`);
    
    // Делаем запрос к нашему API для генерации изображений
    const response = await axios.post('http://localhost:5000/api/fal-ai-images', {
      prompt,
      model: 'rundiffusion-fal/juggernaut-flux-lora',
      width: 1024,
      height: 1024,
      numImages: 1
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    console.log('Получен ответ от API:');
    console.log('Статус:', response.status);
    console.log('Данные:', JSON.stringify(response.data, null, 2));
    
    if (response.data && response.data.images && response.data.images.length > 0) {
      console.log(`Получено ${response.data.images.length} изображений:`);
      
      // Выводим URL'ы изображений
      response.data.images.forEach((url, index) => {
        console.log(`Изображение ${index + 1}: ${url}`);
      });
      
      // Сохраняем результаты в файл для последующего анализа
      await fs.writeFile('juggernaut-flux-lora-results.json', JSON.stringify(response.data, null, 2));
      console.log('Результаты сохранены в файл juggernaut-flux-lora-results.json');
      
      console.log('Тест успешно завершен!');
    } else {
      console.error('В ответе отсутствуют URL изображений');
    }
  } catch (error) {
    console.error('Ошибка при выполнении запроса:');
    console.error(error.message);
    
    if (error.response) {
      console.error('Статус ошибки:', error.response.status);
      console.error('Данные ошибки:', error.response.data);
    }
  }
}

// Запускаем тест
testJuggernautFluxLora();

// Для поддержки ES модулей
export { testJuggernautFluxLora };
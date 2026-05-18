/**
 * Подробный тест для проверки формата ответа API и структуры данных
 */

import axios from 'axios';
import { config } from 'dotenv';

// Инициализируем dotenv для доступа к переменным окружения
config();

async function testApiResponse() {
  try {
    // Получаем API ключ из .env
    const apiKey = process.env.FAL_AI_API_KEY;
    if (!apiKey) {
      throw new Error('FAL_AI_API_KEY не найден в .env файле');
    }

    // Тестируем разные модели
    const models = [
      'rundiffusion-fal/juggernaut-flux/lightning',  // Главная модель для тестирования
      'fal-ai/flux-lora',                            // Альтернативная модель
      'schnell'                                      // Базовая модель по умолчанию
    ];

    console.log('=== Начинаем тестирование API и формата ответа ===\n');

    for (const model of models) {
      console.log(`\n--- Тестирование модели: ${model} ---\n`);
      
      // Создаем тестовый запрос
      const testRequest = {
        prompt: "A beautiful fantasy landscape with mountains, forest and a castle, high quality, detailed, 4k",
        negativePrompt: "blurry, low quality, distorted, ugly, unrealistic",
        model: model,
        width: 1024,
        height: 1024,
        token: apiKey
      };
      
      // Создаем редактированную версию для логов (скрываем API ключ)
      const redactedRequest = {
        ...testRequest,
        token: apiKey ? "****" + apiKey.substring(apiKey.length - 6) : null
      };
      
      console.log(`Отправка запроса на API: /api/fal-ai-images`);
      console.log(`Параметры: ${JSON.stringify(redactedRequest, null, 2)}`);
      
      // Выполняем запрос к API
      const response = await axios.post(
        'http://localhost:5000/api/fal-ai-images',
        testRequest,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log(`Статус ответа: ${response.status} ${response.statusText}`);
      
      // Получаем и выводим структуру ответа
      console.log(`\nСтруктура ответа API:`);
      
      if (response.data) {
        console.log(`Корневой объект содержит следующие ключи: ${Object.keys(response.data).join(', ')}`);
        
        // Проверяем наличие поля success
        if ('success' in response.data) {
          console.log(`Поле success: ${response.data.success}`);
        }
        
        // Проверяем ожидаемое поле images
        if (response.data.images) {
          if (Array.isArray(response.data.images)) {
            console.log(`Поле images - массив с ${response.data.images.length} элементами`);
            
            // Проверяем тип элементов
            if (response.data.images.length > 0) {
              const firstItem = response.data.images[0];
              console.log(`Тип первого элемента: ${typeof firstItem}`);
              
              if (typeof firstItem === 'string') {
                console.log(`Пример URL: ${firstItem.substring(0, 100)}...`);
              } else if (typeof firstItem === 'object') {
                console.log(`Ключи элемента: ${Object.keys(firstItem).join(', ')}`);
                
                // Проверяем, есть ли поле url в объекте
                if (firstItem.url) {
                  console.log(`Поле url: ${firstItem.url.substring(0, 100)}...`);
                }
              }
            }
          } else {
            console.log(`Поле images - не массив, а ${typeof response.data.images}`);
          }
        } else {
          console.log(`Поле images отсутствует в ответе`);
          
          // Проверяем, возможно изображения в другом поле
          const possibleFields = ['data', 'result', 'output', 'urls'];
          
          for (const field of possibleFields) {
            if (response.data[field]) {
              console.log(`Найдено поле ${field}: ${typeof response.data[field]}`);
              
              if (typeof response.data[field] === 'object') {
                console.log(`Ключи поля ${field}: ${Object.keys(response.data[field]).join(', ')}`);
                
                // Проверка на наличие изображений
                if (response.data[field].images) {
                  console.log(`Найдено поле ${field}.images: ${typeof response.data[field].images}`);
                  
                  if (Array.isArray(response.data[field].images)) {
                    console.log(`${field}.images содержит ${response.data[field].images.length} элементов`);
                    
                    if (response.data[field].images.length > 0) {
                      const img = response.data[field].images[0];
                      
                      if (typeof img === 'string') {
                        console.log(`URL: ${img.substring(0, 100)}...`);
                      } else if (typeof img === 'object') {
                        console.log(`Ключи изображения: ${Object.keys(img).join(', ')}`);
                        
                        if (img.url) {
                          console.log(`URL: ${img.url.substring(0, 100)}...`);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } else {
        console.log('Ответ не содержит данных (пустой ответ)');
      }
      
      // Выводим полный ответ для анализа
      console.log('\nПолный ответ API:');
      console.log(JSON.stringify(response.data, null, 2));
    }
    
    console.log('\n=== Тестирование API завершено ===');
    
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
testApiResponse();
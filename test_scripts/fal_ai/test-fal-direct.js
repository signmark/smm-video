/**
 * Тестовый скрипт для прямой работы с FAL.AI API через официальную библиотеку
 * Запуск: node test-fal-direct.js
 */

// Импортируем официальную библиотеку (в ES модульном формате)
import { fal } from '@fal-ai/client';

// Загружаем переменные окружения
import dotenv from 'dotenv';
dotenv.config();

async function testFalAi() {
  try {
    console.log('Начинаем тест генерации изображения с FAL.AI...');
    
    // Получаем API ключ
    const apiKey = process.env.FAL_AI_API_KEY;
    
    if (!apiKey) {
      console.error('Ошибка: FAL_AI_API_KEY не найден в переменных окружения');
      return;
    }
    
    console.log('API ключ найден:', apiKey.substring(0, 5) + '...');
    
    // Настраиваем клиент FAL.AI
    fal.config({
      credentials: apiKey,
      // Используем прокси для обхода проблем с DNS
      proxyUrl: 'https://hub.fal.ai'
    });
    
    console.log('Клиент настроен, отправляем запрос...');
    
    // ID модели для тестирования
    const modelId = 'fal-ai/fast-sdxl';
    
    // Параметры запроса
    const input = {
      prompt: 'A beautiful landscape with mountains and a lake, photorealistic',
      negative_prompt: 'blurry, distorted',
      width: 1024,
      height: 1024,
      num_images: 1
    };
    
    console.log(`Запрос к модели ${modelId} с параметрами:`, input);
    
    // Отправляем запрос
    console.log('Ожидаем ответ...');
    const result = await fal.subscribe(modelId, {
      input,
      logs: true,
      onQueueUpdate: (update) => {
        console.log(`Статус: ${update.status}`);
        if (update.logs) {
          console.log('Логи:', update.logs);
        }
      }
    });
    
    console.log('Получен ответ:', JSON.stringify(result).substring(0, 500) + '...');
    
    // Выводим результат
    if (result.output && result.output.images && result.output.images.length > 0) {
      console.log('Сгенерированы изображения:');
      result.output.images.forEach((img, i) => {
        console.log(`Изображение ${i+1}:`, img);
      });
    } else if (result.output && result.output.image) {
      console.log('Сгенерировано изображение:', result.output.image);
    } else {
      console.log('Структура ответа отличается от ожидаемой:', result);
    }
    
    console.log('Тест завершен успешно!');
  } catch (error) {
    console.error('Ошибка при тестировании FAL.AI:', error.message);
    if (error.response) {
      console.error('Детали ошибки:', error.response.data || error.response);
    }
  }
}

// Запускаем тест
testFalAi();
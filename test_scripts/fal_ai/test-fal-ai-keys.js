/**
 * Тестовый скрипт для проверки работы FAL.AI API с разными ключами
 * 
 * Использование: 
 * node test-fal-ai-keys.js ваш_ключ_api
 * 
 * Если ключ не указан в командной строке, скрипт будет использовать ключ из переменной окружения FAL_AI_API_KEY
 */

// Импортируем библиотеку
import * as fal from '@fal-ai/serverless-client';

// Получаем ключ API из командной строки или из переменной окружения
let apiKey = process.argv[2] || process.env.FAL_AI_API_KEY;

// Функция для проверки API с различными вариантами форматирования ключа
async function testFalApi() {
  console.log('\n=== Тестирование FAL.AI API ===\n');
  
  if (!apiKey) {
    console.error('Ошибка: API ключ не указан. Укажите его как аргумент командной строки или в переменной FAL_AI_API_KEY');
    process.exit(1);
  }
  
  // Проверяем формат ключа и добавляем префикс, если необходимо
  if (!apiKey.startsWith('Key ')) {
    console.log(`Добавляем префикс 'Key ' к API ключу`);
    apiKey = `Key ${apiKey}`;
  } else {
    console.log(`API ключ уже содержит префикс 'Key '`);
  }
  
  // Маскируем ключ для логов
  const maskedKey = `${apiKey.substring(0, 8)}...`;
  console.log(`Используемый API ключ (маскирован): ${maskedKey}`);
  
  try {
    // Настраиваем клиент FAL.AI с ключом
    fal.config({
      credentials: apiKey,
      proxyUrl: "https://hub.fal.ai" // Использование прокси для обхода проблем с DNS
    });
    
    console.log('\nПытаемся получить доступные модели...');
    
    // Попытка выполнить простой запрос для проверки работы API
    const result = await fal.subscribe("fal-ai/schnell", {
      input: {
        prompt: "A cute cat with blue eyes",
        negative_prompt: "",
        num_images: 1,
        width: 512,
        height: 512
      },
      logs: true,
      onQueueUpdate: (update) => {
        console.log(`Статус: ${update.status}`);
      }
    });
    
    console.log('\nУспешно получен ответ от API!');
    console.log(`Тип ответа: ${typeof result}`);
    
    if (result && result.output && result.output.images) {
      console.log(`Количество полученных изображений: ${result.output.images.length}`);
      console.log(`URL первого изображения: ${result.output.images[0]}`);
    } else {
      console.log('Структура ответа:', JSON.stringify(result).substring(0, 300) + '...');
    }
    
    console.log('\n✅ Тест прошел успешно! API ключ работает корректно.');
    return true;
  } catch (error) {
    console.error('\n❌ Ошибка при тестировании API:');
    console.error(`Сообщение ошибки: ${error.message}`);
    
    if (error.response) {
      console.error(`Статус ошибки: ${error.response.status}`);
      console.error('Данные ответа:', error.response.data ? 
        JSON.stringify(error.response.data).substring(0, 300) : 'Нет данных');
    }
    
    console.error('\nВозможные причины проблемы:');
    console.error('1. Неверный API ключ');
    console.error('2. Истек срок действия API ключа');
    console.error('3. Недостаточно привилегий для доступа к API');
    console.error('4. Проблемы с соединением с сервером FAL.AI');
    
    console.error('\nРекомендации:');
    console.error('- Проверьте правильность API ключа');
    console.error('- Получите новый API ключ на странице https://fal.ai/dashboard/keys');
    console.error('- Убедитесь, что у ключа есть необходимые разрешения');
    
    return false;
  }
}

// Запускаем тест
testFalApi()
  .then(success => {
    if (!success) {
      process.exit(1);
    }
  })
  .catch(err => {
    console.error('Неожиданная ошибка:', err);
    process.exit(1);
  });
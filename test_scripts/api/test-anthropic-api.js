/**
 * Скрипт для тестирования доступа к Anthropic Claude API
 * 
 * Запуск: node test-anthropic-api.js ANTHROPIC_API_KEY
 * Пример: node test-anthropic-api.js "sk-ant-api03..."
 */

const https = require('https');

// Получаем API ключ из аргументов командной строки
const apiKey = process.argv[2];

if (!apiKey) {
  console.error('❌ Ошибка: API ключ не указан');
  console.log('Использование: node test-anthropic-api.js API_KEY');
  console.log('Пример: node test-anthropic-api.js "sk-ant-api03..."');
  process.exit(1);
}

console.log('🔑 API ключ получен из аргументов командной строки');
console.log(`👀 Первые 8 символов ключа: ${apiKey.substring(0, 8)}...`);

// Функция для форматирования вывода
function logStep(message) {
  console.log(`\n📋 ${message}`);
}

// Простой промпт для тестирования
const prompt = "Напиши краткое приветствие по-русски";

// Вызов API
logStep('Настройка запроса к Anthropic Claude API...');

// Указываем модель - claude-3-7-sonnet-20250219 (самая новая версия)
const model = 'claude-3-7-sonnet-20250219';

// Конфигурация запроса для Anthropic API
const requestData = JSON.stringify({
  model: model,
  max_tokens: 100,
  messages: [
    {
      role: 'user',
      content: prompt
    }
  ]
});

// Опции запроса
const options = {
  hostname: 'api.anthropic.com',
  path: '/v1/messages',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'Content-Length': requestData.length
  }
};

logStep('Отправка запроса к Anthropic Claude API...');

// Отправляем запрос
const req = https.request(options, (res) => {
  console.log(`\n🌐 Статус ответа: ${res.statusCode}`);
  
  let responseData = '';
  
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    // Проверяем статус ответа
    if (res.statusCode === 200) {
      try {
        const parsedData = JSON.parse(responseData);
        
        // Выводим информацию об успешном запросе
        console.log('\n✅ Запрос успешно выполнен:');
        console.log(`📌 Модель: ${parsedData.model}`);
        
        // Извлекаем текст из ответа
        const responseText = parsedData.content[0].text;
        console.log('\n📝 Ответ API:');
        console.log('------------------------');
        console.log(responseText);
        console.log('------------------------');
        
        console.log('\n🎉 Тест успешно пройден! API ключ Claude работает корректно.');
      } catch (error) {
        console.error('\n❌ Ошибка при парсинге ответа:', error.message);
        console.log('Исходный ответ:', responseData);
      }
    } else {
      // Обработка ошибок API
      console.error('\n❌ Ошибка API:');
      try {
        const errorData = JSON.parse(responseData);
        console.error(`Код ошибки: ${res.statusCode}`);
        console.error(`Тип ошибки: ${errorData.error?.type || 'Неизвестно'}`);
        console.error(`Сообщение: ${errorData.error?.message || 'Нет сообщения'}`);
        
        // Более понятная интерпретация некоторых ошибок
        if (res.statusCode === 400) {
          console.error('\n📢 Возможная причина: Неверный формат запроса или параметры.');
        } else if (res.statusCode === 401) {
          console.error('\n📢 Возможная причина: Недействительный API ключ. Проверьте правильность ключа API или получите новый в консоли Anthropic.');
        } else if (res.statusCode === 403) {
          console.error('\n📢 Возможная причина: Отказано в доступе. API ключ может быть отключен или у него нет доступа к этой модели.');
        } else if (res.statusCode === 429) {
          console.error('\n📢 Возможная причина: Превышен лимит запросов. Попробуйте повторить запрос позже.');
        } else if (res.statusCode >= 500) {
          console.error('\n📢 Возможная причина: Внутренняя ошибка сервера Anthropic. Попробуйте повторить запрос позже.');
        }
      } catch (e) {
        console.error('Неизвестная ошибка, исходный ответ:', responseData);
      }
    }
  });
});

req.on('error', (error) => {
  console.error('\n❌ Ошибка сети:', error.message);
  console.error('\n📢 Возможная причина: Проблемы с подключением к интернету или API недоступен.');
});

// Отправляем данные
req.write(requestData);
req.end();

logStep('Запрос отправлен, ожидаем ответ...');
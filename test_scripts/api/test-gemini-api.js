/**
 * Скрипт для тестирования доступа к Gemini API
 * 
 * Запуск: node test-gemini-api.js GEMINI_API_KEY
 * Пример: node test-gemini-api.js "AIza..."
 */

const https = require('https');

// Получаем API ключ из аргументов командной строки
const apiKey = process.argv[2];

if (!apiKey) {
  console.error('❌ Ошибка: API ключ не указан');
  console.log('Использование: node test-gemini-api.js API_KEY');
  console.log('Пример: node test-gemini-api.js "AIza..."');
  process.exit(1);
}

console.log('🔑 API ключ получен из аргументов командной строки');
console.log(`👀 Первые 4 символа ключа: ${apiKey.substring(0, 4)}...`);

// Функция для форматирования вывода
function logStep(message) {
  console.log(`\n📋 ${message}`);
}

// Простой промпт для тестирования
const prompt = "Напиши краткое приветствие по-русски";

// Вызов API
logStep('Настройка запроса к Gemini API...');

// Конфигурация запроса для модели gemini-1.5-flash (обновленная модель)
const requestBody = {
  contents: [
    {
      parts: [
        {
          text: prompt
        }
      ]
    }
  ],
  generationConfig: {
    temperature: 0.7,
    maxOutputTokens: 100
  }
};

const requestData = JSON.stringify(requestBody);

// Проверка корректности JSON
try {
  // Проверяем, что JSON корректен
  JSON.parse(requestData);
  console.log('\n✅ JSON-запрос корректно сформирован');
} catch (e) {
  console.error('\n❌ Ошибка в формате JSON:', e.message);
  process.exit(1);
}

// Опции запроса - используем gemini-1.5-flash, текущую модель используемую в проекте
const options = {
  hostname: 'generativelanguage.googleapis.com',
  path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(requestData)
  }
};

logStep('Отправка запроса к Gemini API...');
console.log('URL:', `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey.substring(0, 4)}...`);
console.log('Тело запроса:', JSON.stringify(requestBody, null, 2));

// Отправляем запрос
const req = https.request(options, (res) => {
  console.log(`\n🌐 Статус ответа: ${res.statusCode}`);
  
  let responseData = '';
  
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    console.log('\n📊 Сырой ответ API:', responseData);
    
    // Проверяем статус ответа
    if (res.statusCode === 200) {
      try {
        const parsedData = JSON.parse(responseData);
        
        // Выводим информацию об успешном запросе
        console.log('\n✅ Запрос успешно выполнен:');
        console.log('📌 Модель: gemini-1.5-flash');
        
        // Извлекаем текст из ответа
        const responseText = parsedData.candidates[0].content.parts[0].text;
        console.log('\n📝 Ответ API:');
        console.log('------------------------');
        console.log(responseText);
        console.log('------------------------');
        
        console.log('\n🎉 Тест успешно пройден! API ключ Gemini работает корректно.');
      } catch (error) {
        console.error('\n❌ Ошибка при парсинге ответа:', error.message);
        console.log('Исходный ответ:', responseData);
      }
    } else {
      // Обработка ошибок API
      console.error('\n❌ Ошибка API:');
      try {
        // Пытаемся распарсить ответ как JSON
        if (responseData && responseData.trim()) {
          const errorData = JSON.parse(responseData);
          if (errorData.error) {
            console.error(`Код ошибки: ${errorData.error.code || 'Неизвестно'}`);
            console.error(`Сообщение: ${errorData.error.message || 'Нет сообщения'}`);
            
            // Проверка конкретной ошибки из-за региона
            if (errorData.error.message && errorData.error.message.includes('User location is not supported')) {
              console.error('\n📢 ОШИБКА РЕГИОНА: Ваш регион не поддерживается Gemini API.');
              console.error('Подробности: https://ai.google.dev/available_regions');
              console.error('Решения:');
              console.error('1. Используйте VPN для доступа через поддерживаемый регион (США, ЕС)');
              console.error('2. Переместите приложение на сервер в поддерживаемом регионе');
              console.error('3. Используйте альтернативные API (Claude от Anthropic)');
            }
          } else {
            console.error('Ответ API:', errorData);
          }
        } else {
          console.error(`Пустой ответ с кодом: ${res.statusCode}`);
        }
        
        // Более понятная интерпретация некоторых ошибок
        if (res.statusCode === 400) {
          console.error('\n📢 Возможная причина: Неверный формат запроса или параметры.');
        } else if (res.statusCode === 401) {
          console.error('\n📢 Возможная причина: Недействительный API ключ. Проверьте правильность ключа API.');
        } else if (res.statusCode === 403) {
          console.error('\n📢 Возможная причина: Отказано в доступе. API ключ может быть отключен или у него нет доступа к этому API.');
        } else if (res.statusCode === 429) {
          console.error('\n📢 Возможная причина: Превышен лимит запросов. Попробуйте повторить запрос позже.');
        } else if (res.statusCode >= 500) {
          console.error('\n📢 Возможная причина: Внутренняя ошибка сервера Gemini API. Попробуйте повторить запрос позже.');
        }
      } catch (e) {
        console.error('\n❌ Ошибка при анализе ответа API:', e.message);
        console.error('Исходный ответ:', responseData);
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
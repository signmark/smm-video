/**
 * Скрипт для тестирования доступа к Gemini API с проверкой географических ограничений
 * 
 * Запуск: node test-gemini-location.js GEMINI_API_KEY
 * Пример: node test-gemini-location.js "AIza..."
 */

const https = require('https');

// Получаем API ключ из аргументов командной строки
const apiKey = process.argv[2];

if (!apiKey) {
  console.error('❌ Ошибка: API ключ не указан');
  console.log('Использование: node test-gemini-location.js API_KEY');
  console.log('Пример: node test-gemini-location.js "AIza..."');
  process.exit(1);
}

console.log('🔑 API ключ получен из аргументов командной строки');
console.log(`👀 Первые 4 символа ключа: ${apiKey.substring(0, 4)}...`);

// Получение информации о текущем IP-адресе сервера
async function getServerLocation() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'ipinfo.io',
      path: '/json',
      method: 'GET'
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const ipInfo = JSON.parse(data);
            resolve(ipInfo);
          } catch (err) {
            reject('Не удалось получить информацию о местоположении сервера');
          }
        } else {
          reject(`Ошибка при получении информации о местоположении: ${res.statusCode}`);
        }
      });
    });
    
    req.on('error', (error) => {
      reject(`Ошибка сети при проверке IP: ${error.message}`);
    });
    
    req.end();
  });
}

// Тестирование Gemini API с учетом возможного ограничения по локации
async function testGeminiAccess() {
  console.log('\n📋 Получение информации о местоположении сервера...');
  
  try {
    // 1. Сначала получаем информацию о местоположении сервера
    const locationInfo = await getServerLocation();
    console.log(`\n📍 Информация о сервере:
  IP: ${locationInfo.ip}
  Страна: ${locationInfo.country}
  Регион: ${locationInfo.region}
  Город: ${locationInfo.city}
  Провайдер: ${locationInfo.org}`);
    
    // 2. Проверяем, находится ли сервер в поддерживаемом регионе
    console.log('\n📋 Проверка поддержки API Gemini для текущего местоположения...');
    
    // Список стран, где Gemini API точно работает (неполный)
    const supportedCountries = ['US', 'CA', 'GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'NO', 'DK', 'FI', 'IE', 'AU', 'NZ', 'JP', 'KR', 'SG'];
    
    if (!supportedCountries.includes(locationInfo.country)) {
      console.log(`\n⚠️ Предупреждение: ваш сервер находится в регионе (${locationInfo.country}), который может не поддерживаться Gemini API.`);
      console.log('Google ограничивает доступ к Gemini API в некоторых странах и регионах.');
    }
    
    // 3. Тестируем доступ к API
    console.log('\n📋 Отправка тестового запроса к Gemini API...');
    
    // Запрос к API - используем модель gemini-1.5-flash как в проекте
    return new Promise((resolve, reject) => {
      const requestBody = {
        contents: [
          {
            parts: [
              {
                text: "Напиши привет по-русски"
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 50
        }
      };
      
      const requestData = JSON.stringify(requestBody);
      
      console.log('\n📊 Тело запроса:', JSON.stringify(requestBody, null, 2));
      
      const options = {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestData)
        }
      };
      
      console.log('\n🔗 URL запроса:', `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey.substring(0, 4)}...`);
      
      const req = https.request(options, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          console.log(`\n🌐 Статус ответа: ${res.statusCode}`);
          console.log('\n📊 Сырой ответ API:', responseData);
          
          if (res.statusCode === 200) {
            try {
              const parsedData = JSON.parse(responseData);
              resolve({
                success: true,
                data: parsedData
              });
            } catch (e) {
              reject(`Ошибка при обработке успешного ответа: ${e.message}`);
            }
          } else {
            try {
              let errorData;
              try {
                errorData = JSON.parse(responseData);
              } catch {
                errorData = { raw: responseData };
              }
              
              resolve({
                success: false,
                status: res.statusCode,
                error: errorData
              });
            } catch (e) {
              reject(`Ошибка при обработке ответа с ошибкой: ${e.message}, данные: ${responseData}`);
            }
          }
        });
      });
      
      req.on('error', (error) => {
        reject(`Ошибка сети: ${error.message}`);
      });
      
      req.write(requestData);
      req.end();
    });
  } catch (error) {
    console.error(`\n❌ Ошибка: ${error}`);
    return { success: false, error: String(error) };
  }
}

// Анализ результатов и вывод рекомендаций
async function main() {
  try {
    const testResult = await testGeminiAccess();
    
    if (testResult.success) {
      console.log('\n✅ Тест успешно пройден! API ключ Gemini работает корректно в вашем регионе.');
      
      // Извлекаем текст из ответа
      const responseText = testResult.data.candidates[0].content.parts[0].text;
      console.log('\n📝 Ответ API:');
      console.log('------------------------');
      console.log(responseText);
      console.log('------------------------');
      
      console.log('\n🎉 API ключ Gemini работает корректно с вашим сервером!');
    } else {
      console.log('\n❌ Ошибка при тестировании API:');
      
      // Проверяем конкретную ошибку региона
      const errorMessage = JSON.stringify(testResult.error);
      if (errorMessage.includes('User location is not supported')) {
        console.log('\n🚫 ПОДТВЕРЖДЕНО: Ваш регион не поддерживается Gemini API.');
        console.log('\n📢 Рекомендации:');
        console.log('1️⃣ Используйте VPN для доступа через поддерживаемый регион (США, ЕС)');
        console.log('2️⃣ Разместите приложение на сервере в поддерживаемом регионе');
        console.log('3️⃣ Используйте альтернативный API (Claude от Anthropic или другие модели)');
        console.log('\n👉 Подробнее: https://ai.google.dev/available_regions');
      } else if (testResult.status === 404) {
        console.log('\n🚫 Ошибка 404: Модель не найдена.');
        console.log('Возможно, имя модели изменилось или недоступно. Проверьте актуальные названия моделей в документации Google API.');
      } else if (testResult.status === 400) {
        console.log('\n🚫 Ошибка 400: Некорректный запрос.');
        console.log('Причина:', testResult.error?.error?.message || 'Неизвестна');
      } else if (testResult.status === 401) {
        console.log('\n🚫 Ошибка 401: Недействительный API ключ.');
        console.log('Проверьте правильность ключа или получите новый ключ.');
      } else if (testResult.status === 403) {
        console.log('\n🚫 Ошибка 403: Отказано в доступе.');
        console.log('Ключ API может быть ограничен или отключен.');
      } else if (testResult.status === 429) {
        console.log('\n🚫 Ошибка 429: Превышен лимит запросов.');
        console.log('Попробуйте повторить запрос позже.');
      } else {
        console.log(`\n🚫 Ошибка ${testResult.status || 'неизвестная'}:`);
        console.log('Подробности:', JSON.stringify(testResult.error, null, 2));
      }
    }
  } catch (error) {
    console.error(`\n❌ Критическая ошибка: ${error}`);
  }
}

// Запуск теста
main();
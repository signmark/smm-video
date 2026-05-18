/**
 * Скрипт для тестирования доступа к Claude API от Anthropic
 * 
 * Запуск: node test-anthropic-api.mjs ANTHROPIC_API_KEY
 * Пример: node test-anthropic-api.mjs "sk-ant-..."
 */

import https from 'https';

// Получаем API ключ из аргументов командной строки
const apiKey = process.argv[2];

if (!apiKey) {
  console.error('❌ Ошибка: API ключ не указан');
  console.log('Использование: node test-anthropic-api.mjs ANTHROPIC_API_KEY');
  console.log('Пример: node test-anthropic-api.mjs "sk-ant-..."');
  process.exit(1);
}

console.log('🔑 API ключ получен из аргументов командной строки');
console.log(`👀 Первые 8 символов ключа: ${apiKey.substring(0, 8)}...`);

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

// Тестирование API Claude с учетом возможного ограничения по локации
async function testClaudeAccess() {
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
    console.log('\n📋 Проверка поддержки API Claude для текущего местоположения...');
    
    // В отличие от Gemini, Claude имеет меньше географических ограничений,
    // но всё равно проверим на всякий случай
    const potentiallyRestrictedCountries = ['RU', 'BY', 'IR', 'KP', 'SY', 'CU'];
    
    if (potentiallyRestrictedCountries.includes(locationInfo.country)) {
      console.log(`\n⚠️ Предупреждение: ваш сервер находится в регионе (${locationInfo.country}), который может иметь ограничения для западных API.`);
    } else {
      console.log(`\n✅ Ваш сервер находится в регионе (${locationInfo.country}), который вероятно поддерживается Claude API.`);
    }
    
    // 3. Тестируем доступ к API
    console.log('\n📋 Отправка тестового запроса к Claude API...');
    
    // Настраиваем запрос к Claude API - используем newest модель claude-3-7-sonnet-20250219
    const requestBody = {
      model: "claude-3-7-sonnet-20250219",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: "Напиши краткое приветствие по-русски"
        }
      ]
    };
    
    const requestData = JSON.stringify(requestBody);
    
    console.log('\n📊 Тело запроса:', JSON.stringify(requestBody, null, 2));
    
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(requestData)
      }
    };
    
    console.log('\n🔗 URL запроса: https://api.anthropic.com/v1/messages');
    
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          console.log(`\n🌐 Статус ответа: ${res.statusCode}`);
          
          if (res.statusCode === 200) {
            try {
              const parsedData = JSON.parse(responseData);
              resolve({
                success: true,
                data: parsedData
              });
            } catch (e) {
              console.log('\n📊 Сырой ответ API:', responseData);
              reject(`Ошибка при обработке успешного ответа: ${e.message}`);
            }
          } else {
            console.log('\n📊 Сырой ответ API:', responseData);
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
              reject(`Ошибка при обработке ответа с ошибкой: ${e.message}`);
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
    const testResult = await testClaudeAccess();
    
    if (testResult.success) {
      console.log('\n✅ Тест успешно пройден! API ключ Claude работает корректно в вашем регионе.');
      
      // Извлекаем текст из ответа
      const responseText = testResult.data.content[0].text;
      console.log('\n📝 Ответ API:');
      console.log('------------------------');
      console.log(responseText);
      console.log('------------------------');
      
      console.log('\n🎉 API ключ Claude работает корректно с вашим сервером!');
      console.log('🔄 Рекомендация: Используйте этот API в качестве основного, пока Gemini API недоступен в вашем регионе.');
    } else {
      console.log('\n❌ Ошибка при тестировании API:');
      
      if (testResult.status === 401) {
        console.log('\n🚫 Ошибка 401: Недействительный API ключ.');
        console.log('Проверьте правильность ключа или получите новый ключ.');
      } else if (testResult.status === 403) {
        console.log('\n🚫 Ошибка 403: Отказано в доступе.');
        console.log('Ключ API может быть ограничен или отключен.');
      } else if (testResult.status === 429) {
        console.log('\n🚫 Ошибка 429: Превышен лимит запросов.');
        console.log('Попробуйте повторить запрос позже.');
      } else if (testResult.status === 400) {
        console.log('\n🚫 Ошибка 400: Некорректный запрос.');
        console.log('Причина:', testResult.error?.error?.message || 'Неизвестна');
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
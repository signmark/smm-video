/**
 * Скрипт для тестирования доступа к Gemini API через прокси
 * 
 * Запуск: node scripts/test-gemini-proxy.js YOUR_API_KEY
 */

const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Получаем API ключ Gemini из аргументов командной строки или из переменной окружения
const apiKey = process.argv[2] || process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error('⛔ Ошибка: API ключ Gemini не указан');
  console.log('Использование: node scripts/test-gemini-proxy.js API_KEY');
  console.log('Или установите переменную окружения GEMINI_API_KEY');
  process.exit(1);
}

// URL прокси-сервера
const proxyUrl = 'socks5://127.0.0.1:1080';

// Создаем экземпляр прокси-агента
const proxyAgent = new HttpsProxyAgent(proxyUrl);

// Простой промпт для тестирования
const prompt = 'Напиши краткое приветствие по-русски';

// Функция для выполнения тестового запроса
async function testGeminiAPI() {
  console.log('↻ Тестирование доступа к Gemini API через прокси...');
  console.log(`ℹ️ Используемый прокси: ${proxyUrl}`);
  
  // Конфигурация запроса
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
      maxOutputTokens: 50
    }
  };
  
  const requestData = JSON.stringify(requestBody);
  
  // Опции запроса
  const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': requestData.length
    },
    agent: proxyAgent
  };
  
  return new Promise((resolve, reject) => {
    console.log('ℹ️ Отправка запроса к Gemini API...');
    
    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        console.log(`↻ Получен ответ со статусом: ${res.statusCode}`);
        
        if (res.statusCode === 200) {
          try {
            const data = JSON.parse(responseData);
            console.log('✅ Тест успешно пройден!');
            console.log('ℹ️ Ответ от API:');
            console.log(data.candidates[0].content.parts[0].text);
            resolve(true);
          } catch (e) {
            console.error('❌ Ошибка при обработке ответа:', e.message);
            reject(e);
          }
        } else {
          console.error('❌ Ошибка API:', res.statusCode);
          console.error('ℹ️ Ответ:', responseData);
          resolve(false);
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('❌ Ошибка сети:', error.message);
      
      if (error.message.includes('ECONNREFUSED') && error.message.includes('127.0.0.1:1080')) {
        console.error('❌ Не удалось подключиться к локальному прокси-серверу.');
        console.error('ℹ️ Убедитесь, что Xray/V2Ray запущен и прослушивает порт 1080.');
      }
      
      reject(error);
    });
    
    req.write(requestData);
    req.end();
  });
}

// Запускаем тест
testGeminiAPI()
  .then(() => console.log('▶️ Тестирование завершено'))
  .catch(error => console.error('❌ Критическая ошибка:', error.message));

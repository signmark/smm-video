const https = require('https');
const { SocksProxyAgent } = require('socks-proxy-agent');

// Проверка наличия API ключа
if (process.argv.length < 3) {
  console.error('Ошибка: Необходимо указать API ключ Gemini в качестве аргумента');
  console.error('Пример: node test-gemini-proxy.js YOUR_API_KEY');
  process.exit(1);
}

// Получаем API ключ из аргументов командной строки
const apiKey = process.argv[2];

// Прокси настройки
const PROXY_HOST = '131.108.17.21';
const PROXY_PORT = 9271;
const PROXY_USERNAME = 'vf8Fe7';
const PROXY_PASSWORD = 'yk5xt2';

// Создаем прокси-агент для SOCKS
const proxyUrl = `socks5://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;

const proxyAgent = new SocksProxyAgent(proxyUrl);

// Простой промпт для тестирования
const prompt = 'Напиши краткое приветствие по-русски';

// Функция для выполнения тестового запроса
async function testGeminiAPI() {
  console.log('↻ Тестирование доступа к Gemini API через прокси...');
  console.log(`ℹ️ Используемый прокси: ${proxyUrl}`);
  
  // Конфигурация запроса - предельно простая версия
  const requestBody = {
    "contents": [
      {
        "parts": [
          {
            "text": "Hello, how are you?"
          }
        ]
      }
    ]
  };
  
  const requestData = JSON.stringify(requestBody);
  
  // Опции запроса
  // Используем прокси для запроса
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

/**
 * Базовый скрипт для проверки доступа к Gemini API
 */

const https = require('https');

// Получаем API ключ Gemini из переменной окружения
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error('⛔ Ошибка: API ключ Gemini не найден в переменных окружения');
  process.exit(1);
}

// Функция для выполнения запроса к Gemini API
async function testGeminiAPI() {
  console.log('↻ Тестирование доступа к Gemini API...');
  
  // Создаем простой JSON с промптом
  const jsonData = JSON.stringify({
    "contents": [
      {
        "parts": [
          { "text": "Напиши краткое приветствие" }
        ]
      }
    ],
    "generationConfig": {
      "temperature": 0.7,
      "maxOutputTokens": 50
    }
  });
  
  console.log('ℹ️ Отправляемый JSON:');
  console.log(jsonData);
  
  // Опции запроса
  const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': jsonData.length
    }
  };
  
  return new Promise((resolve, reject) => {
    console.log('ℹ️ Отправка запроса...');
    
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
            console.error('ℹ️ Ответ:', responseData);
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
    
    req.write(jsonData);
    req.end();
  });
}

// Запускаем тест
testGeminiAPI()
  .then(() => console.log('▶️ Тестирование завершено'))
  .catch(error => console.error('❌ Критическая ошибка:', error.message));

/**
 * Тестовый скрипт для проверки работы Gemini API через SOCKS5 прокси
 */

const { SocksProxyAgent } = require('socks-proxy-agent');
const fetch = require('node-fetch');

// Настройки коммерческого прокси
const PROXY_HOST = '131.108.17.21';
const PROXY_PORT = 9271;
const PROXY_USERNAME = 'vf8Fe7';
const PROXY_PASSWORD = 'yk5xt2';

// Формируем URL прокси с учетными данными
const PROXY_URL = `socks5://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;

// Создаем прокси-агент
const agent = new SocksProxyAgent(PROXY_URL);

// Скрываем пароль из лога (для безопасности)
const safeProxyUrl = PROXY_URL.replace(/:[^:@]*@/, ':***@');
console.log(`Инициализирован SOCKS5 прокси: ${safeProxyUrl}`);

async function testGeminiAPI() {
  // Получите API ключ Gemini из переменных окружения или укажите его напрямую
  const apiKey = process.env.GEMINI_API_KEY || process.argv[2];
  
  if (!apiKey) {
    console.error('Ошибка: API ключ Gemini не указан. Укажите его в качестве аргумента или в переменной окружения GEMINI_API_KEY');
    process.exit(1);
  }
  
  try {
    console.log('Отправка тестового запроса к Gemini API через SOCKS5 прокси...');
    
    // URL для запроса к Gemini API
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    // Тестовый промпт
    const requestData = {
      contents: [
        {
          parts: [
            {
              text: "Hello, world! This is a test message via SOCKS5 proxy."
            }
          ]
        }
      ]
    };
    
    // Опции запроса
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData),
      agent: agent // Используем прокси-агент для запроса
    };
    
    // Выполняем запрос
    console.log(`Отправка запроса на: ${url.replace(/key=[^&]+/, 'key=****')}`);
    const response = await fetch(url, options);
    
    // Проверяем ответ
    const status = response.status;
    console.log(`Получен ответ со статусом: ${status}`);
    
    if (status === 200) {
      const data = await response.json();
      console.log('Запрос успешно выполнен. Ответ:');
      console.log(JSON.stringify(data, null, 2));
      console.log('
Проверка успешна! SOCKS5 прокси работает корректно с Gemini API.');
    } else {
      const errorText = await response.text();
      console.error(`Ошибка при запросе к Gemini API: ${status}`);
      console.error(errorText);
    }
  } catch (error) {
    console.error('Ошибка при тестировании Gemini API через прокси:', error);
    process.exit(1);
  }
}

// Запускаем тест
testGeminiAPI();

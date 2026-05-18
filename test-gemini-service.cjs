/**
 * Тестовый скрипт для проверки работы сервиса Gemini через SOCKS5 прокси
 * Запуск: node test-gemini-service.js
 */

require('dotenv').config();

// Подключаем модуль прокси сначала, т.к. он используется в gemini.ts
const SocksProxyAgent = require('socks-proxy-agent').SocksProxyAgent;

// Создаем мок для модуля gemini-proxy, чтобы не импортировать TypeScript файл
const PROXY_HOST = '131.108.17.21';
const PROXY_PORT = 9271;
const PROXY_USERNAME = 'vf8Fe7';
const PROXY_PASSWORD = 'yk5xt2';
const PROXY_URL = `socks5://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;

const proxyAgent = new SocksProxyAgent(PROXY_URL);

// Используем SDK напрямую для теста
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Проверка наличия API ключа
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ Ошибка: GEMINI_API_KEY не найден в переменных окружения');
  console.error('Для запуска теста добавьте GEMINI_API_KEY в .env файл или передайте его как переменную окружения');
  process.exit(1);
}

// Переопределяем global.fetch для использования прокси
const originalFetch = global.fetch;
global.fetch = async (url, init) => {
  try {
    // Определяем, идет ли запрос к Gemini API
    if (url.includes('generativelanguage.googleapis.com')) {
      console.log(`[прокси] Проксирование запроса к Gemini API: ${url.substring(0, 100)}...`);
      
      // Добавляем прокси-агент к опциям запроса
      const proxyOptions = {
        ...init,
        agent: proxyAgent
      };
      
      // Используем динамический импорт для node-fetch, т.к. он является ES Module
      const nodeFetch = await import('node-fetch');
      return await nodeFetch.default(url, proxyOptions);
    }
    
    // Для других запросов используем обычный fetch
    return originalFetch(url, init);
  } catch (error) {
    console.error(`[прокси] Ошибка в проксированном fetch: ${error.message}`);
    throw error;
  }
};

async function testGeminiService() {
  console.log('↻ Тестирование сервиса Gemini через SOCKS5 прокси...');
  console.log(`ℹ️ Используемый прокси: ${PROXY_URL}`);
  
  try {
    // Создаем экземпляр Google Generative AI с API ключом
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    console.log('↻ Проверка валидности API ключа...');
    
    // Простой запрос для проверки ключа с современной моделью
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent('Hello, world!');
    
    if (result) {
      console.log('✅ API ключ валиден!  Получен ответ от Gemini API.');
      
      // Тестирование улучшения текста
      console.log('↻ Тестирование улучшения текста...');
      
      const userPrompt = `Сделай этот текст более интересным и профессиональным.

Важно: 
1. Ответ должен содержать ТОЛЬКО улучшенный текст, без объяснений и кодовых блоков.
2. Не заключай ответ в кавычки, теги code или markdown-разметку.
3. Ответ должен начинаться сразу с первой буквы улучшенного текста.

Вот текст для улучшения:

Привет, как дела? Это тестовое сообщение для проверки работы сервиса Gemini.`;
      
      const textResult = await model.generateContent(userPrompt);
      const improvedText = textResult.response.text();
      
      console.log('✅ Улучшенный текст получен:');
      console.log(improvedText);
      
      console.log('▶️ Тестирование успешно завершено!');
    } else {
      console.error('❌ API ключ недействителен или возникла ошибка при проверке');
    }
  } catch (error) {
    console.error('❌ Ошибка при тестировании сервиса Gemini:');
    console.error(error.message);
  }
}

// Запуск теста
testGeminiService().catch(error => {
  console.error('❌ Критическая ошибка при выполнении теста:');
  console.error(error);
});

import fetch from 'node-fetch';
import { SocksProxyAgent } from 'socks-proxy-agent';

// API ключ (можно указать как аргумент командной строки)
const apiKey = process.argv[2] || process.env.GEMINI_API_KEY;

// Настройки канадского прокси
const proxyHost = '138.219.123.68';
const proxyPort = 9710;
const proxyUsername = 'PGjuJV';
const proxyPassword = 'cwZmJ3';

// Формируем URL прокси
const proxyUrl = `socks5://${proxyUsername}:${proxyPassword}@${proxyHost}:${proxyPort}`;

// Создаем прокси-агент
const agent = new SocksProxyAgent(proxyUrl);

async function testGeminiAPI() {
  try {
    console.log('Тестирование Gemini API через канадский SOCKS прокси');
    console.log(`Используемый прокси: ${proxyUrl.replace(proxyPassword, '***')}`);
    
    // Формируем URL для запроса к API Gemini (обратите внимание: v1 вместо v1beta)
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    // Формируем тело запроса
    const requestData = {
      contents: [
        {
          parts: [
            {
              text: "Привет, это тестовое сообщение. Пожалуйста, ответь на русском языке."
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 1024
      }
    };
    
    console.log('Отправка запроса к Gemini API...');
    
    // Отправляем запрос
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData),
      agent
    });
    
    // Получаем статус ответа
    const status = response.status;
    console.log(`Получен ответ со статусом: ${status}`);
    
    // Получаем тело ответа
    const data = await response.json();
    
    if (status === 200) {
      // Обрабатываем успешный ответ
      if (data.candidates && data.candidates.length > 0 && 
          data.candidates[0].content && 
          data.candidates[0].content.parts && 
          data.candidates[0].content.parts.length > 0) {
        
        const resultText = data.candidates[0].content.parts[0].text;
        console.log('\nУспешный ответ от Gemini API:');
        console.log('-----------------------------------');
        console.log(resultText);
        console.log('-----------------------------------');
        console.log('\nПодключение через канадский прокси РАБОТАЕТ! ✅');
      } else {
        console.log('Неожиданный формат ответа:', JSON.stringify(data, null, 2));
      }
    } else {
      // Обрабатываем ошибку
      console.error('Ошибка при запросе к API:', JSON.stringify(data, null, 2));
      
      if (data.error && data.error.message.includes('User location is not supported')) {
        console.error('\nОШИБКА РЕГИОНАЛЬНЫХ ОГРАНИЧЕНИЙ! Прокси не работает или определяется реальное местоположение. ❌');
      } else if (data.error && data.error.message.includes('not found for API version')) {
        console.error('\nНЕВЕРНАЯ ВЕРСИЯ API! Проверьте версию API в URL (v1 или v1beta). ❌');
      }
    }
  } catch (error) {
    console.error('Ошибка при тестировании API:', error);
    console.error('\nНЕ УДАЛОСЬ ПОДКЛЮЧИТЬСЯ К API! Проверьте соединение с интернетом и прокси. ❌');
  }
}

// Запускаем тест
testGeminiAPI();
/**
 * Тестовый скрипт для проверки подключения к Gemini API напрямую и через прокси
 * 
 * Запуск: node test-gemini-connection.js ВАША_API_КЛЮЧ
 */

import fetch from 'node-fetch';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

// Получаем API ключ из аргументов командной строки
const apiKey = process.argv[2];
if (!apiKey) {
  console.error('Пожалуйста, укажите API ключ Gemini в качестве аргумента');
  console.error('Пример: node test-gemini-connection.js ВАША_API_КЛЮЧ');
  process.exit(1);
}

// Настройки прокси
const socksProxy = {
  host: '138.219.123.68',
  port: 9710,
  username: 'PGjuJV',
  password: 'cwZmJ3'
};

// Функция для тестирования прямого подключения
async function testDirectConnection() {
  console.log('\n=== Тестирование прямого подключения к Gemini API ===');
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.0-pro:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "Hello, this is a test message"
              }
            ]
          }
        ]
      })
    });

    const status = response.status;
    console.log(`Статус ответа: ${status}`);
    
    if (status === 200) {
      const data = await response.json();
      console.log('Ответ от API:');
      console.log(JSON.stringify(data, null, 2).substring(0, 300) + '...');
      console.log('\n✅ Прямое подключение работает успешно');
      return true;
    } else {
      const text = await response.text();
      console.log(`Ошибка: ${text}`);
      console.log('\n❌ Прямое подключение не работает');
      return false;
    }
  } catch (error) {
    console.error(`Ошибка при прямом подключении: ${error.message}`);
    console.log('\n❌ Прямое подключение не работает');
    return false;
  }
}

// Функция для тестирования подключения через SOCKS прокси
async function testSocksProxyConnection() {
  console.log('\n=== Тестирование подключения через SOCKS прокси ===');
  try {
    // Формируем URL прокси
    const proxyUrl = `socks5://${socksProxy.username}:${socksProxy.password}@${socksProxy.host}:${socksProxy.port}`;
    console.log(`Используемый прокси: ${proxyUrl.replace(/:[^:@]*@/, ':***@')}`);
    
    // Создаем агент прокси
    const agent = new SocksProxyAgent(proxyUrl);
    
    // Запрос к API через прокси
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.0-pro:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "Hello, this is a test message through proxy"
              }
            ]
          }
        ]
      }),
      agent
    });

    const status = response.status;
    console.log(`Статус ответа через SOCKS прокси: ${status}`);
    
    if (status === 200) {
      const data = await response.json();
      console.log('Ответ от API через SOCKS прокси:');
      console.log(JSON.stringify(data, null, 2).substring(0, 300) + '...');
      console.log('\n✅ Подключение через SOCKS прокси работает успешно');
      return true;
    } else {
      const text = await response.text();
      console.log(`Ошибка при подключении через SOCKS прокси: ${text}`);
      console.log('\n❌ Подключение через SOCKS прокси не работает');
      return false;
    }
  } catch (error) {
    console.error(`Ошибка при подключении через SOCKS прокси: ${error.message}`);
    console.log('\n❌ Подключение через SOCKS прокси не работает');
    return false;
  }
}

// Функция для проверки доступности прокси
async function testProxyAvailability() {
  console.log('\n=== Проверка доступности прокси-сервера ===');
  try {
    // Получаем свой IP без прокси
    console.log('Получение вашего IP без прокси...');
    const ipResponse = await fetch('https://api.ipify.org?format=json');
    const ipData = await ipResponse.json();
    console.log(`Ваш IP без прокси: ${ipData.ip}`);
    
    // Получаем IP через прокси
    console.log('Получение IP через SOCKS прокси...');
    const proxyUrl = `socks5://${socksProxy.username}:${socksProxy.password}@${socksProxy.host}:${socksProxy.port}`;
    const agent = new SocksProxyAgent(proxyUrl);
    
    try {
      const proxyIpResponse = await fetch('https://api.ipify.org?format=json', { agent });
      const proxyIpData = await proxyIpResponse.json();
      console.log(`IP через SOCKS прокси: ${proxyIpData.ip}`);
      
      if (ipData.ip !== proxyIpData.ip) {
        console.log('\n✅ SOCKS прокси работает правильно (IP отличается)');
        return true;
      } else {
        console.log('\n⚠️ SOCKS прокси подключился, но IP не изменился');
        return true;
      }
    } catch (proxyError) {
      console.error(`Ошибка при подключении через SOCKS прокси: ${proxyError.message}`);
      console.log('\n❌ SOCKS прокси недоступен');
      return false;
    }
  } catch (error) {
    console.error(`Ошибка при проверке прокси: ${error.message}`);
    console.log('\n❌ Проверка прокси не удалась');
    return false;
  }
}

// Функция для тестирования различных моделей Gemini
async function testDifferentModels() {
  const models = [
    'gemini-1.0-pro',
    'gemini-1.5-pro',
    'gemini-1.5-flash'
  ];
  
  console.log('\n=== Тестирование различных моделей Gemini ===');
  
  for (const model of models) {
    console.log(`\nТестирование модели: ${model}`);
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: "Hello, this is a test message for model testing"
                }
              ]
            }
          ]
        })
      });

      const status = response.status;
      console.log(`Статус ответа для модели ${model}: ${status}`);
      
      if (status === 200) {
        console.log(`✅ Модель ${model} доступна`);
      } else {
        const text = await response.text();
        console.log(`❌ Модель ${model} недоступна: ${text}`);
      }
    } catch (error) {
      console.error(`❌ Ошибка при тестировании модели ${model}: ${error.message}`);
    }
  }
}

// Основная функция для запуска всех тестов
async function runAllTests() {
  console.log('🔍 Начало тестирования подключения к Gemini API');
  console.log('='.repeat(60));
  
  // Проверяем доступность прокси
  const proxyAvailable = await testProxyAvailability();
  console.log('='.repeat(60));
  
  // Тестируем прямое подключение
  const directWorks = await testDirectConnection();
  console.log('='.repeat(60));
  
  // Тестируем подключение через прокси, если он доступен
  let proxyWorks = false;
  if (proxyAvailable) {
    proxyWorks = await testSocksProxyConnection();
    console.log('='.repeat(60));
  }
  
  // Тестируем разные модели Gemini
  await testDifferentModels();
  console.log('='.repeat(60));
  
  // Выводим итоговый результат
  console.log('\n📋 ИТОГИ ТЕСТИРОВАНИЯ:');
  console.log(`Прокси доступен: ${proxyAvailable ? '✅' : '❌'}`);
  console.log(`Прямое подключение работает: ${directWorks ? '✅' : '❌'}`);
  
  if (proxyAvailable) {
    console.log(`Подключение через прокси работает: ${proxyWorks ? '✅' : '❌'}`);
  }
  
  console.log('\n📝 РЕКОМЕНДАЦИИ:');
  if (directWorks) {
    console.log('✓ Используйте прямое подключение к Gemini API, оно работает');
  } else if (proxyWorks) {
    console.log('✓ Используйте подключение через SOCKS прокси, оно работает');
  } else {
    console.log('✗ Ни прямое подключение, ни прокси не работают.');
    console.log('  Попробуйте получить новый API ключ или использовать VPN.');
  }
}

// Запускаем все тесты
runAllTests().catch(error => {
  console.error('Произошла непредвиденная ошибка:', error);
  console.error(error.stack);
});
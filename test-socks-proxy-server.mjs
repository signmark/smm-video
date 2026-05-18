/**
 * Тестовый скрипт для проверки работы SOCKS5 прокси на сервере
 * 
 * Запуск: node test-socks-proxy-server.mjs [API_KEY]
 */

import { SocksProxyAgent } from 'socks-proxy-agent';
import fetch from 'node-fetch';
import { argv } from 'process';

// Настройки прокси
const PROXY_HOST = '131.108.17.21';
const PROXY_PORT = 9271;
const PROXY_USERNAME = 'vf8Fe7';
const PROXY_PASSWORD = 'yk5xt2';

// Создаем агента для прокси
const socksAgent = new SocksProxyAgent({
  hostname: PROXY_HOST,
  port: PROXY_PORT,
  userId: PROXY_USERNAME,
  password: PROXY_PASSWORD,
  type: 5  // SOCKS5
});

console.log(`Настройка SOCKS5 прокси: ${PROXY_HOST}:${PROXY_PORT}`);

// Функция для проверки IP-адреса
async function checkIpWithProxy() {
  try {
    console.log('Выполняем запрос через прокси...');
    const response = await fetch('https://api.ipify.org?format=json', { 
      agent: socksAgent,
      timeout: 10000 
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('Успешный ответ через прокси!');
      console.log(`Ваш IP через прокси: ${data.ip}`);
      return true;
    } else {
      console.error(`Ошибка при запросе через прокси: ${response.status} ${response.statusText}`);
      return false;
    }
  } catch (error) {
    console.error('Ошибка при использовании прокси:', error.message);
    return false;
  }
}

// Проверка без прокси для сравнения
async function checkIpWithoutProxy() {
  try {
    console.log('Выполняем запрос без прокси...');
    const response = await fetch('https://api.ipify.org?format=json', { 
      timeout: 10000 
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('Успешный ответ без прокси!');
      console.log(`Ваш реальный IP: ${data.ip}`);
      return true;
    } else {
      console.error(`Ошибка при запросе без прокси: ${response.status} ${response.statusText}`);
      return false;
    }
  } catch (error) {
    console.error('Ошибка при запросе без прокси:', error.message);
    return false;
  }
}

// Тест доступа к Gemini API через прокси
async function testGeminiWithProxy(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [
      {
        parts: [
          { text: "Hello, who are you?" }
        ]
      }
    ]
  };
  
  try {
    console.log('Тестирование Gemini API через прокси...');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      agent: socksAgent,
      timeout: 15000
    });
    
    const status = response.status;
    console.log(`Статус ответа от Gemini API: ${status}`);
    
    const text = await response.text();
    console.log(`Ответ от Gemini API: ${text.substring(0, 300)}...`);
    
    return status === 200;
  } catch (error) {
    console.error('Ошибка при тестировании Gemini API через прокси:', error.message);
    return false;
  }
}

// Тест доступа к Gemini API без прокси
async function testGeminiWithoutProxy(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [
      {
        parts: [
          { text: "Hello, who are you?" }
        ]
      }
    ]
  };
  
  try {
    console.log('Тестирование Gemini API без прокси...');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      timeout: 15000
    });
    
    const status = response.status;
    console.log(`Статус ответа от Gemini API: ${status}`);
    
    const text = await response.text();
    console.log(`Ответ от Gemini API: ${text.substring(0, 300)}...`);
    
    return status === 200;
  } catch (error) {
    console.error('Ошибка при тестировании Gemini API без прокси:', error.message);
    return false;
  }
}

// Запуск тестов
async function runTests() {
  console.log('=== ТЕСТИРОВАНИЕ SOCKS5 ПРОКСИ ===');
  
  // Проверяем IP без прокси
  const normalIpCheck = await checkIpWithoutProxy();
  console.log('-'.repeat(50));
  
  // Проверяем IP через прокси
  const proxyIpCheck = await checkIpWithProxy();
  console.log('-'.repeat(50));
  
  // Проверяем Gemini API с и без прокси, если API ключ предоставлен
  const apiKey = argv[2];
  let geminiCheckWithProxy = false;
  let geminiCheckWithoutProxy = false;
  
  if (apiKey) {
    // Сначала тест без прокси для сравнения
    geminiCheckWithoutProxy = await testGeminiWithoutProxy(apiKey);
    console.log('-'.repeat(50));
    
    // Затем тест через прокси
    geminiCheckWithProxy = await testGeminiWithProxy(apiKey);
    console.log('-'.repeat(50));
    
    console.log('РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ:');
    console.log(`Запрос без прокси: ${normalIpCheck ? 'УСПЕШНО' : 'ОШИБКА'}`);
    console.log(`Запрос через прокси: ${proxyIpCheck ? 'УСПЕШНО' : 'ОШИБКА'}`);
    console.log(`Запрос к Gemini API без прокси: ${geminiCheckWithoutProxy ? 'УСПЕШНО' : 'ОШИБКА'}`);
    console.log(`Запрос к Gemini API с прокси: ${geminiCheckWithProxy ? 'УСПЕШНО' : 'ОШИБКА'}`);
  } else {
    console.log('РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ:');
    console.log(`Запрос без прокси: ${normalIpCheck ? 'УСПЕШНО' : 'ОШИБКА'}`);
    console.log(`Запрос через прокси: ${proxyIpCheck ? 'УСПЕШНО' : 'ОШИБКА'}`);
    console.log('API ключ не предоставлен, тест Gemini API пропущен.');
    console.log('Для тестирования Gemini API запустите:');
    console.log('node test-socks-proxy-server.mjs YOUR_API_KEY');
  }
}

runTests().catch(console.error);

/**
 * Тестовый скрипт для проверки различных вариантов URL webhook n8n для Instagram
 * 
 * Скрипт проверяет несколько возможных форматов URL для webhook n8n
 * и выводит результаты каждого вызова для анализа.
 * 
 * Запуск: node instagram-webhook-test.js
 */

import fetch from 'node-fetch';
const contentId = '4a2cc734-199b-4723-919f-88c5028cd464'; // тестовый ID контента

/**
 * Форматирует и выводит результат запроса
 * @param {string} url URL, который был проверен
 * @param {object} result Результат запроса
 */
function logResult(url, result) {
  console.log(`\n=== Тест URL: ${url} ===`);
  console.log('Статус:', result.status || 'Ошибка');
  console.log('Данные:', JSON.stringify(result.data || {}, null, 2));
  console.log('================================================\n');
}

/**
 * Проверяет указанный URL webhook
 * @param {string} url URL для проверки
 * @returns {Promise<object>} Результат проверки
 */
async function testWebhook(url) {
  try {
    console.log(`Отправка запроса на ${url}...`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ contentId }),
    });
    
    const data = await response.json();
    
    return {
      status: response.status,
      data,
    };
  } catch (error) {
    console.error(`Ошибка при проверке ${url}:`, error.message);
    return {
      status: 'error',
      data: { error: error.message },
    };
  }
}

/**
 * Запускает все тесты последовательно
 */
async function runTests() {
  console.log('=== НАЧАЛО ТЕСТИРОВАНИЯ WEBHOOK ДЛЯ INSTAGRAM ===');
  
  // Массив URL для проверки
  const urlsToTest = [
    'https://n8n.nplanner.ru/webhook/publish-instagram',
    'https://n8n.nplanner.ru/webhook/instagram',
    'https://n8n.nplanner.ru/webhook-test/instagram',
    'https://n8n.nplanner.ru/webhook-test/publish-instagram',
    'http://localhost:5000/api/webhook/instagram', // Локальный API
  ];
  
  // Проверяем каждый URL
  for (const url of urlsToTest) {
    const result = await testWebhook(url);
    logResult(url, result);
  }
  
  console.log('=== ТЕСТИРОВАНИЕ ЗАВЕРШЕНО ===');
}

// Запускаем тесты
runTests().catch(error => {
  console.error('Критическая ошибка при выполнении тестов:', error);
});
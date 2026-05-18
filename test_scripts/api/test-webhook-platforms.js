/**
 * Скрипт для тестирования вызова n8n webhooks для разных платформ
 * Этот скрипт симулирует вызовы, которые делает планировщик публикаций
 */

import axios from 'axios';

// ID контента для тестирования
const contentId = '2bdf5216-867c-41fb-98c3-ad6db36165cb';

// Список платформ для тестирования
const platforms = ['vk', 'instagram', 'telegram'];

// Функция для логирования
function log(message) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${timestamp} - ${message}`);
}

// Функция для тестирования webhook
async function testWebhook(platform) {
  try {
    log(`Тестирование webhook для платформы ${platform}...`);
    
    // Маппинг платформ на webhook URLs
    const webhookMap = {
      'telegram': 'publish-telegram',
      'vk': 'publish-vk',
      'instagram': 'publish-instagram',
      'facebook': 'publish-facebook'
    };
    
    const webhookName = webhookMap[platform.toLowerCase()];
    if (!webhookName) {
      log(`⚠️ Платформа ${platform} не имеет соответствующего webhook`);
      return;
    }
    
    // Формируем URL для webhook
    const baseUrl = 'https://n8n.nplanner.ru/webhook';
    const baseUrlWithoutTrailingSlash = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const webhookUrl = `${baseUrlWithoutTrailingSlash}/${webhookName}`;
    
    log(`URL для webhook: ${webhookUrl}`);
    
    // Отправляем запрос
    const response = await axios.post(webhookUrl, { contentId });
    
    log(`✅ Успешный ответ от webhook для ${platform}:`);
    log(JSON.stringify(response.data, null, 2));
    
    return response.data;
  } catch (error) {
    log(`❌ Ошибка при вызове webhook для ${platform}:`);
    
    if (error.response) {
      // Ошибка с ответом от сервера
      log(`Статус: ${error.response.status}`);
      log(`Данные: ${JSON.stringify(error.response.data, null, 2)}`);
    } else if (error.request) {
      // Ошибка без ответа от сервера
      log(`Ошибка запроса: ${error.message}`);
    } else {
      // Ошибка при настройке запроса
      log(`Ошибка: ${error.message}`);
    }
    
    return null;
  }
}

// Основная функция для запуска тестов
async function runTests() {
  log('Начало тестирования webhooks для всех платформ...');
  
  for (const platform of platforms) {
    await testWebhook(platform);
    // Пауза между запросами
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  log('Тестирование завершено');
}

// Запускаем тесты
runTests().catch(error => {
  log(`Необработанная ошибка: ${error.message}`);
});
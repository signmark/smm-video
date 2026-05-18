/**
 * Тестовый скрипт для проверки получения и использования username канала
 * при публикации в Telegram
 * 
 * Запустите: node telegram-check-username.js
 */

// Используем axios для HTTP-запросов
import axios from 'axios';

// Конфигурация
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '7529101043:AAG298h0iubyeKPuZ-WRtEFbNEnEyqy_XJU';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-1002302366310';

// Функция для вывода информации в консоль
function log(message) {
  console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}

/**
 * Получает информацию о чате в Telegram
 * @param {string} chatId ID чата
 * @returns {Promise<object|null>} Информация о чате
 */
async function getChatInfo(chatId) {
  try {
    log(`Запрос информации о чате: ${chatId}`);
    const baseUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
    
    const response = await axios.post(`${baseUrl}/getChat`, {
      chat_id: chatId
    }, {
      timeout: 10000,
      validateStatus: () => true
    });
    
    if (response.data && response.data.ok === true && response.data.result) {
      log(`Успешно получена информация о чате: ${JSON.stringify(response.data.result)}`);
      return response.data.result;
    } else {
      log(`Ошибка API Telegram при получении информации о чате: ${JSON.stringify(response.data || 'Нет данных в ответе')}`);
      return null;
    }
  } catch (error) {
    log(`Исключение при запросе информации о чате: ${error.message}`);
    return null;
  }
}

/**
 * Генерирует URL для сообщения в Telegram
 * @param {string} chatId ID чата Telegram
 * @param {string|number} messageId ID сообщения
 * @param {string} username Username чата (если известен)
 * @returns {string} URL сообщения
 */
function formatTelegramUrl(chatId, messageId, username) {
  log(`Форматирование Telegram URL: chatId=${chatId}, messageId=${messageId || 'не указан'}, username=${username || 'не указан'}`);
  
  // Если ID сообщения не указан, вернем базовый URL Telegram
  if (!messageId) {
    if (username) {
      return `https://t.me/${username}`;
    }
    if (chatId.startsWith('@')) {
      return `https://t.me/${chatId.substring(1)}`;
    }
    return 'https://t.me';
  }
  
  // Если известен username чата, используем его для URL
  if (username) {
    const url = `https://t.me/${username}/${messageId}`;
    log(`Сформирован URL для канала с известным username: ${url}`);
    return url;
  }
  
  // Обработка случая с username (@channel)
  if (chatId.startsWith('@')) {
    const username = chatId.substring(1);
    const url = `https://t.me/${username}/${messageId}`;
    log(`Сформирован URL для канала с username: ${url}`);
    return url;
  }
  
  // Обработка случая с супергруппой/каналом (-100...)
  if (chatId.startsWith('-100')) {
    // Для публичных супергрупп/каналов удаляем префикс -100
    const channelId = chatId.substring(4);
    const url = `https://t.me/${channelId}/${messageId}`;
    log(`Сформирован URL для супергруппы/канала: ${url}`);
    return url;
  }
  
  // Обработка обычных групп (начинаются с -)
  if (chatId.startsWith('-')) {
    // Для обычной группы без username форматируем URL по стандарту
    const groupId = chatId.substring(1); // Убираем только минус
    const url = `https://t.me/c/${groupId}/${messageId}`;
    log(`Сформирован URL для обычной группы: ${url}`);
    return url;
  }
  
  // Личные чаты или боты (числовой ID без минуса)
  const url = `https://t.me/c/${chatId}/${messageId}`;
  log(`Сформирован URL для личного чата/бота: ${url}`);
  return url;
}

/**
 * Отправляет тестовое сообщение в канал и формирует URL
 */
async function testMessageUrlGeneration() {
  try {
    // Получаем информацию о чате
    const chatInfo = await getChatInfo(TELEGRAM_CHAT_ID);
    
    // Извлекаем username из ответа API (если есть)
    const username = chatInfo && chatInfo.username ? chatInfo.username : null;
    
    if (username) {
      log(`Получен username чата: ${username}`);
    } else {
      log(`У чата нет публичного username`);
    }
    
    // Отправляем тестовое сообщение
    const baseUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
    const response = await axios.post(`${baseUrl}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: `Тестовое сообщение для проверки URL генерации. Время: ${new Date().toLocaleString()}`,
      parse_mode: 'HTML'
    });
    
    if (response.data && response.data.ok) {
      const messageId = response.data.result.message_id;
      log(`Сообщение успешно отправлено, ID: ${messageId}`);
      
      // Генерируем URL с использованием username, если он доступен
      const url = formatTelegramUrl(TELEGRAM_CHAT_ID, messageId, username);
      log(`ИТОГОВЫЙ URL: ${url}`);
      
      return {
        success: true,
        messageId,
        url
      };
    } else {
      log(`Ошибка при отправке сообщения: ${JSON.stringify(response.data)}`);
      return { success: false };
    }
  } catch (error) {
    log(`Исключение при тестировании генерации URL: ${error.message}`);
    return { success: false };
  }
}

/**
 * Основная функция
 */
async function main() {
  log('Запуск тестирования генерации URL для Telegram');
  
  const result = await testMessageUrlGeneration();
  
  if (result.success) {
    log(`✅ Тестирование успешно завершено`);
    log(`📝 ID сообщения: ${result.messageId}`);
    log(`🔗 URL сообщения: ${result.url}`);
  } else {
    log(`❌ Тестирование завершилось с ошибкой`);
  }
}

// Запускаем скрипт
main().catch(error => {
  log(`❌ Критическая ошибка: ${error.message}`);
});
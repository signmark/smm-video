/**
 * Скрипт для прямой отправки сообщения в Telegram и проверки корректности URL
 * Используется для выявления проблем с отсутствием message_id в URL
 */

import axios from 'axios';

const API_TOKEN = "7529101043:AAG298h0iubyeKPuZ-WRtEFbNEnEyqy_XJU"; // Тестовый токен
const CHAT_ID = "-1002302366310"; // Тестовый чат

// Функция для логирования с меткой времени
function log(message) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] ${message}`);
}

/**
 * Отправляет сообщение напрямую через API Telegram
 */
async function sendDirectTelegramMessage() {
  try {
    log('🚀 Отправка сообщения напрямую через API Telegram...');
    
    const text = "Тестовое сообщение для проверки формирования URL";
    const url = `https://api.telegram.org/bot${API_TOKEN}/sendMessage`;
    
    // Отправляем запрос в API Telegram
    const response = await axios.post(url, {
      chat_id: CHAT_ID,
      text: text
    });
    
    if (response.data && response.data.ok) {
      log('✅ Сообщение успешно отправлено!');
      
      const messageId = response.data.result.message_id;
      log(`📋 ID сообщения: ${messageId}`);
      
      // Формируем URL вручную для проверки
      const username = "ya_delayu_moschno"; // Известное имя канала
      const manualUrl = `https://t.me/${username}/${messageId}`;
      log(`📋 Сформированный URL: ${manualUrl}`);
      
      return { success: true, messageId, url: manualUrl };
    } else {
      log(`❌ Ошибка при отправке сообщения: ${JSON.stringify(response.data)}`);
      return { success: false, error: response.data };
    }
  } catch (error) {
    log(`❌ Исключение при отправке сообщения: ${error.message}`);
    if (error.response) {
      log(`Ответ сервера: ${JSON.stringify(error.response.data)}`);
    }
    return { success: false, error: error.message };
  }
}

/**
 * Проверяет формирование URL через API проекта
 */
async function checkProjectUrlFormatting(messageId) {
  try {
    log('🔍 Проверка формирования URL через API проекта...');
    
    // Вызываем API проекта для форматирования URL
    const response = await axios.get('http://localhost:5000/api/test/telegram-url', {
      params: {
        chatId: CHAT_ID,
        messageId
      }
    });
    
    if (response.data.success) {
      const url = response.data.data.url;
      log(`📋 URL через API проекта: ${url}`);
      
      if (url.includes('/' + messageId)) {
        log('✅ URL содержит message_id!');
      } else {
        log('❌ КРИТИЧЕСКАЯ ОШИБКА: URL не содержит message_id!');
      }
      
      return { success: true, url };
    } else {
      log(`❌ Ошибка при форматировании URL: ${response.data.error || 'Неизвестная ошибка'}`);
      return { success: false, error: response.data.error };
    }
  } catch (error) {
    log(`❌ Исключение при форматировании URL: ${error.message}`);
    if (error.response) {
      log(`Ответ сервера: ${JSON.stringify(error.response.data)}`);
    }
    return { success: false, error: error.message };
  }
}

/**
 * Запускает все проверки
 */
async function runTests() {
  log('🔍 Запуск проверки формирования URL для Telegram...');
  
  // Отправляем сообщение напрямую
  const directResult = await sendDirectTelegramMessage();
  
  if (directResult.success && directResult.messageId) {
    // Проверяем формирование URL через API проекта
    await checkProjectUrlFormatting(directResult.messageId);
  }
  
  log('🏁 Тестирование завершено!');
}

// Запускаем тесты
runTests()
  .catch(error => {
    log(`\n❌ Глобальная ошибка: ${error.message}`);
    process.exit(1);
  });
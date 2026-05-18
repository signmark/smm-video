/**
 * Скрипт для тестирования публикации в Telegram
 * Позволяет проверить настройки API и форматирование контента
 */

import axios from 'axios';

/**
 * Функция для вывода информации в консоль с временной меткой
 * @param {string} message Сообщение для вывода
 */
function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

/**
 * Тестирование отправки текстового сообщения в Telegram
 * @param {string} token Токен API Telegram бота
 * @param {string} chatId ID чата/канала
 * @returns {Promise<object>} Результат отправки
 */
async function testTextMessage(token, chatId) {
  log(`Тест отправки текстового сообщения в чат ${chatId}`);
  const baseUrl = `https://api.telegram.org/bot${token}`;
  
  try {
    // Подготавливаем текст с разными форматами
    const text = `
      *Тестовое сообщение* от скрипта проверки
      _Курсивный текст_
      **Жирный текст**
      [Ссылка на проект](https://smm.omemo.tech)
      
      Текст с <b>HTML-тегами</b> и <i>форматированием</i>
      
      Длинное предложение для проверки работы переносов и различных способов оформления текста в Telegram API.
    `;
    
    const response = await axios.post(`${baseUrl}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: false
    });
    
    log(`Сообщение успешно отправлено! Message ID: ${response.data?.result?.message_id}`);
    return {
      success: true,
      data: response.data,
      messageId: response.data?.result?.message_id
    };
  } catch (error) {
    log(`Ошибка при отправке текстового сообщения: ${error.message}`);
    
    if (error.response) {
      log(`Данные ответа: ${JSON.stringify(error.response.data)}`);
    }
    
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}

/**
 * Тестирование отправки изображения с подписью в Telegram
 * @param {string} token Токен API Telegram бота
 * @param {string} chatId ID чата/канала
 * @returns {Promise<object>} Результат отправки
 */
async function testImageWithCaption(token, chatId) {
  log(`Тест отправки изображения с подписью в чат ${chatId}`);
  const baseUrl = `https://api.telegram.org/bot${token}`;
  
  try {
    // Используем тестовое изображение из интернета
    const imageUrl = 'https://placehold.co/600x400/png';
    const caption = 'Тестовая подпись к изображению с <b>HTML-форматированием</b>';
    
    const response = await axios.post(`${baseUrl}/sendPhoto`, {
      chat_id: chatId,
      photo: imageUrl,
      caption: caption,
      parse_mode: 'HTML'
    });
    
    log(`Изображение успешно отправлено! Message ID: ${response.data?.result?.message_id}`);
    return {
      success: true,
      data: response.data,
      messageId: response.data?.result?.message_id
    };
  } catch (error) {
    log(`Ошибка при отправке изображения: ${error.message}`);
    
    if (error.response) {
      log(`Данные ответа: ${JSON.stringify(error.response.data)}`);
    }
    
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}

/**
 * Тестирование отправки группы изображений в Telegram
 * @param {string} token Токен API Telegram бота
 * @param {string} chatId ID чата/канала
 * @returns {Promise<object>} Результат отправки
 */
async function testMediaGroup(token, chatId) {
  log(`Тест отправки группы изображений в чат ${chatId}`);
  const baseUrl = `https://api.telegram.org/bot${token}`;
  
  try {
    // Тестовые изображения
    const media = [
      {
        type: 'photo',
        media: 'https://placehold.co/600x400/orange/white/png',
        caption: 'Первое изображение с подписью и <b>форматированием</b>',
        parse_mode: 'HTML'
      },
      {
        type: 'photo',
        media: 'https://placehold.co/600x400/blue/white/png'
      },
      {
        type: 'photo',
        media: 'https://placehold.co/600x400/green/white/png'
      }
    ];
    
    const response = await axios.post(`${baseUrl}/sendMediaGroup`, {
      chat_id: chatId,
      media: media
    });
    
    log(`Группа изображений успешно отправлена! Количество: ${response.data?.result?.length || 0}`);
    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    log(`Ошибка при отправке группы изображений: ${error.message}`);
    
    if (error.response) {
      log(`Данные ответа: ${JSON.stringify(error.response.data)}`);
    }
    
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}

/**
 * Получение информации о чате через API Telegram
 * @param {string} token Токен API Telegram бота
 * @param {string} chatId ID чата/канала
 * @returns {Promise<object>} Информация о чате
 */
async function getChatInfo(token, chatId) {
  log(`Получение информации о чате ${chatId}`);
  const baseUrl = `https://api.telegram.org/bot${token}`;
  
  try {
    const response = await axios.get(`${baseUrl}/getChat`, {
      params: {
        chat_id: chatId
      }
    });
    
    log(`Информация о чате получена: ${JSON.stringify(response.data)}`);
    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    log(`Ошибка при получении информации о чате: ${error.message}`);
    
    if (error.response) {
      log(`Данные ответа: ${JSON.stringify(error.response.data)}`);
    }
    
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}

/**
 * Запуск всех тестов публикации в Telegram
 */
async function runAllTests() {
  // Замените на реальные значения
  const token = 'YOUR_BOT_TOKEN';
  const chatId = 'YOUR_CHAT_ID';
  
  log('Начало тестирования Telegram API');
  
  try {
    // Проверка информации о чате
    const chatInfo = await getChatInfo(token, chatId);
    log(`Результат проверки чата: ${chatInfo.success ? 'УСПЕШНО' : 'ОШИБКА'}`);
    
    // Тестирование отправки текста
    const textResult = await testTextMessage(token, chatId);
    log(`Результат отправки текста: ${textResult.success ? 'УСПЕШНО' : 'ОШИБКА'}`);
    
    // Тестирование отправки изображения
    const imageResult = await testImageWithCaption(token, chatId);
    log(`Результат отправки изображения: ${imageResult.success ? 'УСПЕШНО' : 'ОШИБКА'}`);
    
    // Тестирование отправки группы изображений
    const mediaGroupResult = await testMediaGroup(token, chatId);
    log(`Результат отправки группы изображений: ${mediaGroupResult.success ? 'УСПЕШНО' : 'ОШИБКА'}`);
    
    // Вывод общего результата
    log('\nОБЩИЙ РЕЗУЛЬТАТ ТЕСТИРОВАНИЯ:');
    log(`- Проверка чата: ${chatInfo.success ? 'УСПЕШНО ✓' : 'ОШИБКА ✗'}`);
    log(`- Отправка текста: ${textResult.success ? 'УСПЕШНО ✓' : 'ОШИБКА ✗'}`);
    log(`- Отправка изображения: ${imageResult.success ? 'УСПЕШНО ✓' : 'ОШИБКА ✗'}`);
    log(`- Отправка группы изображений: ${mediaGroupResult.success ? 'УСПЕШНО ✓' : 'ОШИБКА ✗'}`);
  } catch (error) {
    log(`Необработанная ошибка при тестировании: ${error.message}`);
  }
  
  log('Тестирование завершено');
}

// Запустить все тесты
runAllTests().catch(error => {
  log(`Критическая ошибка при запуске тестов: ${error.message}`);
});
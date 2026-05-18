/**
 * Скрипт для тестирования реальной реализации формирования URL сообщений в Telegram
 * ВАЖНО: Проверяется корректность реальной реализации с обязательным message_id
 */

import axios from 'axios';

// Функция для логирования с временной меткой
function log(message) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] ${message}`);
}

/**
 * Тест 1: Отправка только текстового сообщения в Telegram
 * Проверяет корректное формирование URL и включение messageId
 */
async function testTextOnlyMessage() {
  try {
    log('🧪 ТЕСТ 1: Отправка только текстового сообщения');
    
    // Создаем контент для тестирования
    const testContent = {
      id: 'test-id-1',
      title: '<b>Тестовый заголовок</b>',
      content: 'Тестовое сообщение',
      contentType: 'text',
      imageUrl: '', // Пустая строка для текстового сообщения
      additionalImages: [], // Пустой массив дополнительных изображений
      status: 'draft',
      userId: 'test-user',
      campaignId: '46868c44-c6a4-4bed-accf-9ad07bba790e',
      socialPlatforms: ['telegram'],
      createdAt: new Date(),
      hashtags: [],
      links: [],
      metadata: {}
    };

    // Используем test API, который обращается к реальной реализации в проекте
    const response = await axios.post('http://localhost:5000/api/test/telegram-post', {
      content: testContent,
      chatId: '-1002302366310'
    });

    if (response.data.success) {
      log('✅ Текстовое сообщение успешно отправлено через реальную реализацию!');
      
      // Проверяем наличие messageId в ответе
      if (response.data.messageId) {
        log(`🔍 ID сообщения: ${response.data.messageId}`);
      } else {
        log('❌ ОШИБКА: messageId отсутствует в ответе API!');
        return { success: false, error: 'messageId отсутствует в ответе API' };
      }
      
      // Проверяем наличие postUrl в ответе
      if (response.data.postUrl) {
        log(`🔍 URL сообщения: ${response.data.postUrl}`);
        
        // Дополнительно проверяем, что URL содержит message_id
        if (!response.data.postUrl.includes('/' + response.data.messageId)) {
          log('❌ КРИТИЧЕСКАЯ ОШИБКА: URL не содержит message_id!');
          return { success: false, error: 'URL не содержит message_id' };
        }
        
        log('✅ URL корректно сформирован и содержит message_id');
      } else {
        log('❌ ОШИБКА: postUrl отсутствует в ответе API!');
        return { success: false, error: 'postUrl отсутствует в ответе API' };
      }
      
      return { success: true, data: response.data };
    } else {
      log(`❌ Ошибка при отправке текстового сообщения: ${response.data.error || 'Неизвестная ошибка'}`);
      return { success: false, error: response.data.error || 'Неизвестная ошибка' };
    }
  } catch (error) {
    log(`❌ Исключение при выполнении теста: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Тест 2: Отправка HTML-форматированного текста
 * Проверяет корректное форматирование HTML и формирование URL с messageId
 */
async function testHtmlFormattedMessage() {
  try {
    log('🧪 ТЕСТ 2: Отправка HTML-форматированного текста');
    
    // Создаем контент с HTML-форматированием
    const testContent = {
      id: 'test-id-2',
      title: 'Тестовый HTML',
      content: '<b>Жирный текст</b>, <i>курсив</i> и <u>подчеркнутый</u> текст должны быть корректно отформатированы.',
      contentType: 'text',
      imageUrl: '',
      additionalImages: [],
      status: 'draft',
      userId: 'test-user',
      campaignId: '46868c44-c6a4-4bed-accf-9ad07bba790e',
      socialPlatforms: ['telegram'],
      createdAt: new Date(),
      hashtags: [],
      links: [],
      metadata: {}
    };

    // Используем test API, который обращается к реальной реализации
    const response = await axios.post('http://localhost:5000/api/test/telegram-post', {
      content: testContent,
      chatId: '-1002302366310'
    });

    if (response.data.success) {
      log('✅ HTML-форматированное сообщение успешно отправлено!');
      
      // Проверяем наличие messageId в ответе
      if (response.data.messageId) {
        log(`🔍 ID сообщения: ${response.data.messageId}`);
      } else {
        log('❌ ОШИБКА: messageId отсутствует в ответе API!');
        return { success: false, error: 'messageId отсутствует в ответе API' };
      }
      
      // Проверяем наличие postUrl в ответе
      if (response.data.postUrl) {
        log(`🔍 URL сообщения: ${response.data.postUrl}`);
        
        // Дополнительно проверяем, что URL содержит message_id
        if (!response.data.postUrl.includes('/' + response.data.messageId)) {
          log('❌ КРИТИЧЕСКАЯ ОШИБКА: URL не содержит message_id!');
          return { success: false, error: 'URL не содержит message_id' };
        }
        
        log('✅ URL корректно сформирован и содержит message_id');
      } else {
        log('❌ ОШИБКА: postUrl отсутствует в ответе API!');
        return { success: false, error: 'postUrl отсутствует в ответе API' };
      }
      
      return { success: true, data: response.data };
    } else {
      log(`❌ Ошибка при отправке HTML-форматированного сообщения: ${response.data.error || 'Неизвестная ошибка'}`);
      return { success: false, error: response.data.error || 'Неизвестная ошибка' };
    }
  } catch (error) {
    log(`❌ Исключение при выполнении теста: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Тест 3: Проверка прямой функции форматирования URL через API
 */
async function testUrlFormatting() {
  try {
    log('🧪 ТЕСТ 3: Проверка прямого форматирования URL');
    
    const chatId = '-1002302366310';
    const messageId = '1234'; // Тестовый ID сообщения
    
    // Обращаемся к специальному тестовому маршруту для форматирования URL
    const response = await axios.get('http://localhost:5000/api/test/telegram-url', {
      params: {
        chatId,
        messageId
      }
    });

    if (response.data.success) {
      log('✅ Функция форматирования URL успешно выполнена!');
      
      const formattedUrl = response.data.data.url;
      log(`🔍 Сформированный URL: ${formattedUrl}`);
      
      // Проверяем, что URL содержит messageId
      if (!formattedUrl.includes('/' + messageId)) {
        log('❌ КРИТИЧЕСКАЯ ОШИБКА: URL не содержит message_id!');
        return { success: false, error: 'URL не содержит message_id' };
      }
      
      log('✅ URL корректно сформирован и содержит message_id');
      return { success: true, data: response.data };
    } else {
      log(`❌ Ошибка при форматировании URL: ${response.data.error || 'Неизвестная ошибка'}`);
      return { success: false, error: response.data.error || 'Неизвестная ошибка' };
    }
  } catch (error) {
    log(`❌ Исключение при выполнении теста: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Запускаем все тесты последовательно
async function runAllTests() {
  log('🚀 Запуск комплексного тестирования реальной реализации формирования URL в Telegram');
  
  // Тест 1: Отправка только текста
  const test1Result = await testTextOnlyMessage();
  log(`\nРезультат теста 1: ${test1Result.success ? '✅ УСПЕШНО' : '❌ НЕУСПЕШНО'}`);
  if (!test1Result.success) {
    log(`Ошибка: ${test1Result.error}`);
  }
  
  // Тест 2: Отправка HTML-форматированного текста
  const test2Result = await testHtmlFormattedMessage();
  log(`\nРезультат теста 2: ${test2Result.success ? '✅ УСПЕШНО' : '❌ НЕУСПЕШНО'}`);
  if (!test2Result.success) {
    log(`Ошибка: ${test2Result.error}`);
  }
  
  // Тест 3: Проверка прямого форматирования URL
  const test3Result = await testUrlFormatting();
  log(`\nРезультат теста 3: ${test3Result.success ? '✅ УСПЕШНО' : '❌ НЕУСПЕШНО'}`);
  if (!test3Result.success) {
    log(`Ошибка: ${test3Result.error}`);
  }
  
  // Итоговый результат
  const allSuccess = test1Result.success && test2Result.success && test3Result.success;
  log(`\n=== ИТОГОВЫЙ РЕЗУЛЬТАТ ТЕСТИРОВАНИЯ: ${allSuccess ? '✅ ВСЕ ТЕСТЫ УСПЕШНЫ' : '❌ ЕСТЬ ОШИБКИ'} ===`);
  
  return allSuccess;
}

// Запускаем тестирование
runAllTests()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    log(`\nНепредвиденная ошибка при выполнении тестов: ${error}`);
    process.exit(1);
  });
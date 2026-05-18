/**
 * Скрипт для проверки проблемы с URL, который может формироваться без message_id
 * Запуск: node test-telegram-url-problem.js
 */

import axios from 'axios';

// Функция для логирования
function log(message) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] ${message}`);
}

/**
 * Проверяет интеграцию нашего кода в реальных условиях проекта
 */
async function testProjectIntegration() {
  try {
    // Формируем тестовый контент для публикации
    const testContent = {
      id: `test-integration-${Date.now()}`,
      title: 'Тестирование проблемы с URL в реальном проекте',
      content: 'Это тестовое сообщение для проверки интеграции в проекте. Проверяем корректное формирование URL с message_id.',
      contentType: 'text',
      imageUrl: null,
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

    log('📋 Тестирование интеграции в проекте...');

    // Публикуем через API тестового маршрута
    const response = await axios.post('http://localhost:5000/api/test/telegram-post', {
      content: testContent,
      chatId: '-1002302366310'
    });

    if (response.data.success) {
      log('✅ Сообщение успешно отправлено!');
      
      if (response.data.messageId) {
        log(`✅ MessageId получен: ${response.data.messageId}`);
      } else {
        log('❌ ОШИБКА: MessageId отсутствует в ответе!');
      }
      
      if (response.data.postUrl) {
        log(`📋 URL сообщения: ${response.data.postUrl}`);
        
        // Проверяем, содержит ли URL message_id
        if (response.data.messageId && response.data.postUrl.includes('/' + response.data.messageId)) {
          log('✅ URL корректно содержит message_id!');
        } else {
          log('❌ КРИТИЧЕСКАЯ ОШИБКА: URL не содержит message_id!');
          log(`🔍 Проверка совпадения: URL=${response.data.postUrl}, messageId=${response.data.messageId}`);
        }
      } else {
        log('❌ ОШИБКА: PostUrl отсутствует в ответе!');
      }
      
      // Проверяем структуру данных в ответе
      log('\n📋 Структура ответа:');
      console.dir(response.data, { depth: 3 });
      
      return response.data;
    } else {
      log(`❌ Ошибка при отправке сообщения: ${response.data.error || 'Неизвестная ошибка'}`);
      return response.data;
    }
  } catch (error) {
    log(`❌ Исключение при выполнении теста: ${error.message}`);
    if (error.response) {
      log(`Ошибка сервера: ${JSON.stringify(error.response.data)}`);
    }
    return { success: false, error: error.message };
  }
}

/**
 * Проверяет работу метода генерации URL напрямую через API
 */
async function testUrlGeneration() {
  try {
    log('\n📋 Тестирование генерации URL напрямую...');
    
    // Генерируем URL с известными параметрами
    const chatId = '-1002302366310';
    const messageId = '12345'; // Тестовый ID сообщения
    
    const response = await axios.get('http://localhost:5000/api/test/telegram-url', {
      params: {
        chatId,
        messageId
      }
    });
    
    if (response.data.success) {
      log('✅ URL успешно сгенерирован!');
      
      const url = response.data.data.url;
      log(`📋 Сгенерированный URL: ${url}`);
      
      if (url.includes('/' + messageId)) {
        log('✅ URL корректно содержит message_id!');
      } else {
        log('❌ КРИТИЧЕСКАЯ ОШИБКА: URL не содержит message_id!');
      }
      
      return response.data;
    } else {
      log(`❌ Ошибка при генерации URL: ${response.data.error || 'Неизвестная ошибка'}`);
      return response.data;
    }
  } catch (error) {
    log(`❌ Исключение при выполнении теста генерации URL: ${error.message}`);
    if (error.response) {
      log(`Ошибка сервера: ${JSON.stringify(error.response.data)}`);
    }
    return { success: false, error: error.message };
  }
}

// Запускаем все тесты
async function runAllTests() {
  log('🔍 Запуск тестов для проверки проблемы с URL Telegram...');
  
  // Тест 1: Проверка интеграции в проекте
  await testProjectIntegration();
  
  // Тест 2: Проверка генерации URL напрямую
  await testUrlGeneration();
  
  log('\n🏁 Тестирование завершено!');
}

// Запускаем тестирование
runAllTests()
  .catch(error => {
    log(`\n❌ Глобальная ошибка: ${error.message}`);
    process.exit(1);
  });
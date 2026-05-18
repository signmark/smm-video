/**
 * Тест для проверки корректности URL при отправке ТОЛЬКО текста в Telegram
 * Этот тест фокусируется на выявлении проблемы с формированием URL при отправке текстовых сообщений
 */

import axios from 'axios';

const API_TOKEN = "7529101043:AAG298h0iubyeKPuZ-WRtEFbNEnEyqy_XJU"; // Тестовый токен
const CHAT_ID = "-1002302366310"; // Тестовый чат

// Функция для логирования
function log(message) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] ${message}`);
}

/**
 * Тестирует отправку только текстового сообщения через API проекта
 */
async function testSendTextMessage() {
  try {
    log('📋 Тестирование отправки ТОЛЬКО текстового сообщения через API...');
    
    // Формируем тестовый контент
    const testContent = {
      id: `test-text-only-${Date.now()}`,
      title: 'Тест только текстового сообщения',
      content: 'Это тестовое сообщение для проверки корректности формирования URL при отправке только текста без изображений.',
      contentType: 'text',
      imageUrl: null, // Намеренно отсутствуют изображения
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
    
    // Вызываем тестовый API
    log('📤 Отправка запроса...');
    const response = await axios.post('http://localhost:5000/api/test/telegram-post', {
      content: testContent,
      chatId: CHAT_ID
    });
    
    log('📌 Получен ответ от API:');
    console.dir(response.data, { depth: 3 });
    
    // Анализируем результат
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

      // Запрашиваем внутреннее состояние контента из базы данных
      log('\n📋 Проверяем, как данные сохранены в базе...');
      // Используем другой тестовый API для получения полной информации о последней публикации
      const dbStateResponse = await axios.get('http://localhost:5000/api/test/last-telegram-publication');
      
      if (dbStateResponse.data && dbStateResponse.data.success) {
        log('📋 Данные из базы:');
        console.dir(dbStateResponse.data.data, { depth: 3 });
        
        const publications = dbStateResponse.data.data;
        if (publications.telegram) {
          log(`📋 URL в базе данных: ${publications.telegram.postUrl || 'отсутствует'}`);
          
          if (publications.telegram.messageId) {
            log(`📋 MessageId в базе данных: ${publications.telegram.messageId}`);
            
            if (publications.telegram.postUrl && publications.telegram.postUrl.includes('/' + publications.telegram.messageId)) {
              log('✅ URL в базе данных корректно содержит message_id!');
            } else {
              log('❌ КРИТИЧЕСКАЯ ОШИБКА В БД: URL не содержит message_id!');
            }
          } else {
            log('❌ ОШИБКА В БД: MessageId отсутствует!');
          }
        } else {
          log('❌ ОШИБКА: Нет информации о публикации в Telegram!');
        }
      } else {
        log('❌ ОШИБКА: Не удалось получить данные о последней публикации из базы!');
      }
    } else {
      log(`❌ Ошибка при отправке сообщения: ${response.data.error || 'Неизвестная ошибка'}`);
    }
    
    return response.data;
  } catch (error) {
    log(`❌ Исключение при выполнении теста: ${error.message}`);
    if (error.response) {
      log(`Ошибка сервера: ${JSON.stringify(error.response.data)}`);
    }
    return { success: false, error: error.message };
  }
}

// Запускаем тест
log('🚀 Запуск теста для проверки URL в текстовом сообщении...');
testSendTextMessage()
  .then(() => log('🏁 Тестирование завершено!'))
  .catch(error => {
    log(`\n❌ Глобальная ошибка: ${error.message}`);
    process.exit(1);
  });
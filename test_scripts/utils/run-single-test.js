/**
 * Запуск только одного конкретного теста для проверки незакрытых тегов
 */
import axios from 'axios';
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

// API URL по умолчанию
const API_URL = process.env.API_URL || 'http://localhost:5000';

// Настройки для Telegram из переменных окружения
const settings = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || 'REVOKED_TELEGRAM_TOKEN_USE_ENV',
    chatId: process.env.TELEGRAM_CHAT_ID || '-1002302366310'
  }
};

// Тестовый кейс для незакрытых тегов
const testCase = {
  name: '3. Незакрытые теги',
  description: 'Проверка автоматического закрытия незакрытых HTML-тегов',
  text: `<b>Незакрытый тег жирного

<i>Незакрытый тег курсива

<u>Незакрытый тег подчеркивания

<s>Незакрытый тег зачеркивания

<code>Незакрытый тег кода

Обычный текст после незакрытых тегов

Текст для проверки правильного закрытия тегов в порядке <b>LIFO <i>(Last In, First Out) <u>как реализовано</u></i></b> в fixUnclosedTags`
};

/**
 * Публикует тестовое сообщение через API приложения
 * @returns {Promise<object>} Результат публикации
 */
async function runTest() {
  try {
    console.log(`\n----- Тестовый кейс: ${testCase.name} -----`);
    console.log(`Описание: ${testCase.description}`);
    
    // Добавляем информацию о тесте в начало сообщения
    const testHeader = `🧪 <b>ТЕСТ НЕЗАКРЫТЫХ ТЕГОВ</b>: ${testCase.name}\n\n`;
    const testContent = testHeader + testCase.text;
    
    // Делаем запрос к API для отправки сообщения
    console.log(`Отправка сообщения через API...`);
    const response = await axios.post(`${API_URL}/api/test/telegram-post`, {
      text: testContent,
      chatId: settings.telegram.chatId,
      token: settings.telegram.token
    });
    
    // Обрабатываем ответ
    console.log("Ответ от сервера:", JSON.stringify(response.data, null, 2));
    
    if (response.data && response.data.success) {
      const result = response.data.data;
      console.log(`✅ УСПЕХ: Тест пройден успешно!`);
      
      if (result.postUrl) {
        console.log(`🔗 URL сообщения: ${result.postUrl}`);
      }
      
      if (result.messageId) {
        console.log(`📝 ID сообщения: ${result.messageId}`);
      }
      
      return { 
        success: true, 
        messageId: result.messageId,
        postUrl: result.postUrl 
      };
    } else {
      console.log(`❌ ОШИБКА: Тест не пройден!`);
      
      if (response.data && response.data.error) {
        console.log(`Описание ошибки: ${response.data.error}`);
      }
      
      return { 
        success: false, 
        error: response.data?.error || 'Неизвестная ошибка' 
      };
    }
  } catch (error) {
    console.error(`❌ ОШИБКА при выполнении теста:`, error.message);
    
    if (error.response) {
      console.error('Ответ сервера:', error.response.status);
      console.error('Данные ответа:', JSON.stringify(error.response.data, null, 2));
    }
    
    return { 
      success: false, 
      error: error.message 
    };
  }
}

// Запускаем тест
console.log('======================================================');
console.log('🧪 ЗАПУСК ТЕСТА НЕЗАКРЫТЫХ HTML-ТЕГОВ В TELEGRAM');
console.log('======================================================\n');

runTest().then(result => {
  console.log('\n======================================================');
  if (result.success) {
    console.log('✅ ТЕСТ ПРОЙДЕН УСПЕШНО!');
  } else {
    console.log(`❌ ТЕСТ НЕ ПРОЙДЕН: ${result.error}`);
  }
  console.log('======================================================');
}).catch(error => {
  console.error('Критическая ошибка при выполнении теста:', error);
  process.exit(1);
});
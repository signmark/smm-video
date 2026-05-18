/**
 * Скрипт для проверки API публикации в Instagram и Telegram
 * Выполняет реальные запросы через API приложения, проверяя работоспособность
 * обоих маршрутов с реальными токенами
 * 
 * Запуск: node test-instagram-telegram-api.js
 */

const axios = require('axios');

// Настройки для тестирования
const CONFIG = {
  // URL API
  apiUrl: 'http://localhost:5000',
  // Настройки Instagram
  instagram: {
    token: 'EAA520SFRtvcBO9Y7LhiiZBqwsqdZCP9JClMUoJZCvjsSc8qs9aheLdWefOqrZBLQhe5T0ZBerS6mZAZAP6D4i8Ln5UBfiIyVEif1LrzcAzG6JNrhW2DJeEzObpp9Mzoh8tDZA9I0HigkLnFZCaJVZCQcGDAkZBRxwnVimZBdbvokeg19i5RuGTbfuFs9UC9R',
    businessAccountId: '17841422577074562',
    // Тестовые изображения
    testImages: {
      food: 'https://i.imgur.com/HbNJQyD.jpg',
      nature: 'https://i.imgur.com/KNJnIR9.jpg',
      technology: 'https://i.imgur.com/9LRwEJS.jpg'
    }
  },
  // Настройки Telegram
  telegram: {
    token: '7529101043:AAG298h0iubyeKPuZ-WRtEFbNEnEyqy_XJU',
    chatId: '-1002302366310'
  }
};

// Функция для задержки выполнения
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Тестирует маршрут API для публикации в Instagram
 */
async function testInstagramPost() {
  console.log(`\n📱 ТЕСТ INSTAGRAM API`);
  
  const testCase = {
    text: `Тестовая публикация в Instagram 📲\n\nПроверка работы API с реальной отправкой данных.\n\nВремя теста: ${new Date().toLocaleString()}`,
    imageUrl: CONFIG.instagram.testImages.nature
  };
  
  console.log(`📝 Текст публикации: ${testCase.text.substring(0, 50)}...`);
  console.log(`🖼️ Изображение: ${testCase.imageUrl.substring(0, 30)}...`);

  try {
    console.log(`⏳ Отправка запроса в API...`);
    
    // Формируем запрос
    const requestData = {
      text: testCase.text,
      token: CONFIG.instagram.token,
      businessAccountId: CONFIG.instagram.businessAccountId,
      imageUrl: testCase.imageUrl
    };
    
    console.log(`📤 POST ${CONFIG.apiUrl}/api/test/instagram-post`);
    
    // Отправляем запрос
    const response = await axios.post(
      `${CONFIG.apiUrl}/api/test/instagram-post`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );
    
    // Анализируем ответ
    console.log(`📥 Статус ответа: ${response.status}`);
    console.log(`📥 Content-Type: ${response.headers['content-type']}`);
    
    if (response.data && typeof response.data === 'object') {
      console.log(`✅ Получен JSON-ответ`);
      
      if (response.data.success) {
        console.log(`✅ УСПЕХ! Публикация успешно отправлена.`);
        console.log(`🔗 URL публикации: ${response.data.postUrl || 'Недоступен'}`);
        return { success: true, data: response.data };
      } else {
        console.log(`❌ ОШИБКА: ${response.data.error || 'Неизвестная ошибка'}`);
        return { success: false, error: response.data.error };
      }
    } else {
      console.log(`⚠️ Получен не JSON-ответ:`, response.data);
      return { success: false, error: 'Некорректный формат ответа' };
    }
  } catch (error) {
    console.error(`❌ ОШИБКА запроса: ${error.message}`);
    if (error.response) {
      console.error(`Данные ответа:`, error.response.data);
    }
    return { success: false, error: error.message };
  }
}

/**
 * Тестирует маршрут API для публикации в Telegram
 */
async function testTelegramPost() {
  console.log(`\n📱 ТЕСТ TELEGRAM API`);
  
  const testCase = {
    text: `<b>Тестовая публикация в Telegram</b> 📲\n\nПроверка работы API с <i>реальной отправкой</i> данных.\n\nВремя теста: <code>${new Date().toLocaleString()}</code>`,
  };
  
  console.log(`📝 Текст публикации: ${testCase.text.substring(0, 50)}...`);

  try {
    console.log(`⏳ Отправка запроса в API...`);
    
    // Формируем запрос
    const requestData = {
      text: testCase.text,
      token: CONFIG.telegram.token,
      chatId: CONFIG.telegram.chatId
    };
    
    console.log(`📤 POST ${CONFIG.apiUrl}/api/test/telegram-post`);
    
    // Отправляем запрос
    const response = await axios.post(
      `${CONFIG.apiUrl}/api/test/telegram-post`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );
    
    // Анализируем ответ
    console.log(`📥 Статус ответа: ${response.status}`);
    console.log(`📥 Content-Type: ${response.headers['content-type']}`);
    
    if (response.data && typeof response.data === 'object') {
      console.log(`✅ Получен JSON-ответ`);
      
      if (response.data.success) {
        console.log(`✅ УСПЕХ! Сообщение успешно отправлено.`);
        console.log(`🔗 URL сообщения: ${response.data.postUrl || 'Недоступен'}`);
        return { success: true, data: response.data };
      } else {
        console.log(`❌ ОШИБКА: ${response.data.error || 'Неизвестная ошибка'}`);
        return { success: false, error: response.data.error };
      }
    } else {
      console.log(`⚠️ Получен не JSON-ответ:`, response.data);
      return { success: false, error: 'Некорректный формат ответа' };
    }
  } catch (error) {
    console.error(`❌ ОШИБКА запроса: ${error.message}`);
    if (error.response) {
      console.error(`Данные ответа:`, error.response.data);
    }
    return { success: false, error: error.message };
  }
}

/**
 * Запускает все тесты
 */
async function runAllTests() {
  console.log(`🚀 Начало тестирования API публикации в соцсети\n`);
  
  // Проверяем доступность API перед запуском тестов
  try {
    const pingResponse = await axios.get(`${CONFIG.apiUrl}/api`);
    console.log(`✅ API доступен`);
  } catch (error) {
    console.error(`❌ Ошибка доступа к API: ${error.message}`);
    console.log(`❗ Перед запуском убедитесь, что сервер запущен и доступен по адресу ${CONFIG.apiUrl}`);
    return;
  }
  
  // Тест Telegram API
  console.log(`\n🔄 Запуск теста Telegram API...`);
  const telegramResult = await testTelegramPost();
  
  // Пауза между тестами
  console.log(`\n⏱️ Пауза между тестами...`);
  await sleep(3000);
  
  // Тест Instagram API
  console.log(`\n🔄 Запуск теста Instagram API...`);
  const instagramResult = await testInstagramPost();
  
  // Сводка результатов
  console.log(`\n📊 РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ:`);
  console.log(`Telegram API: ${telegramResult.success ? '✅ УСПЕХ' : '❌ ОШИБКА'}`);
  console.log(`Instagram API: ${instagramResult.success ? '✅ УСПЕХ' : '❌ ОШИБКА'}`);
  
  if (!telegramResult.success) {
    console.log(`⚠️ Ошибка Telegram API: ${telegramResult.error}`);
  }
  
  if (!instagramResult.success) {
    console.log(`⚠️ Ошибка Instagram API: ${instagramResult.error}`);
  }
}

// Запускаем тесты
runAllTests().catch(err => {
  console.error(`❌ Критическая ошибка: ${err.message}`);
});
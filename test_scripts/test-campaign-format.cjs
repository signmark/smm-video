/**
 * Тест отправки форматированного текста в Telegram с использованием настроек кампании
 * Проверяет корректность отображения HTML-форматирования через API приложения
 * 
 * Запуск: node test-campaign-format.cjs
 */

const axios = require('axios');
require('dotenv').config();

// ID тестовой кампании (питание)
const CAMPAIGN_ID = "46868c44-c6a4-4bed-accf-9ad07bba790e";

// Данные для тестирования форматирования
const testCases = [
  {
    name: "Базовое форматирование",
    text: "<b>Жирный текст</b>\n<i>Курсивный текст</i>\n<u>Подчеркнутый текст</u>\n<s>Зачеркнутый текст</s>\n<code>Моноширинный текст для кода</code>\n<a href='https://example.com'>Ссылка на сайт</a>",
  },
  {
    name: "Комбинированное форматирование",
    text: "Комбинированное форматирование:\n<b><i>Жирный курсив</i></b>\n<b><u>Жирный подчеркнутый</u></b>\n<i><s>Курсивный зачеркнутый</s></i>",
  },
  {
    name: "Форматирование со скриншота",
    text: "<b>Подсознание наизнанку</b>\n<b>Жирный текст</b>\n<i>Курсивный текст</i>\n<u>Подчеркнутый текст</u>\n<s>Зачеркнутый текст</s>\n<code>Моноширинный текст для кода</code>\n<a href='https://example.com'>Ссылка на сайт</a>\n\nКомбинированное форматирование:\n<b><i>Жирный курсив</i></b>\n<b><u>Жирный подчеркнутый</u></b>\n<i><s>Курсивный зачеркнутый</s></i>\n\n<b>Заголовок статьи</b>\n\n<i>Описание и важные детали об этой интересной статье. Могут быть разные аспекты, которые нужно выделить.</i>\n\nОсновной текст статьи, несколько абзацев обычного текста.\nВ котором могут быть <b>выделенные части</b> и <i>важные моменты</i>.\n\n<a href='https://t.me/your_channel'>Наш канал</a>\n\n👍 1",
  },
  {
    name: "Незакрытые теги (должны автоматически закрываться)",
    text: "<b>Жирный текст <i>курсив <u>подчеркнутый",
  }
];

/**
 * Получает токен авторизации для Directus
 * @returns {Promise<string>} Токен авторизации
 */
async function getDirectusToken() {
  try {
    // Аутентификация в Directus
    const authResponse = await axios.post(`${process.env.DIRECTUS_URL}/auth/login`, {
      email: process.env.DIRECTUS_ADMIN_EMAIL,
      password: process.env.DIRECTUS_ADMIN_PASSWORD
    });
    
    return authResponse.data.data.access_token;
  } catch (error) {
    console.error('Ошибка при получении токена Directus:', error.message);
    throw error;
  }
}

/**
 * Создает тестовый контент для публикации
 * @param {string} title Заголовок
 * @param {string} text Содержимое
 * @returns {Promise<object>} Созданный контент
 */
async function createTestContent(title, text) {
  try {
    const token = await getDirectusToken();
    
    // Создаем тестовый контент в кампании
    const content = {
      title: title,
      text: text,
      campaign_id: CAMPAIGN_ID,
      social_platforms: ["telegram"]
    };
    
    const response = await axios.post(`${process.env.DIRECTUS_URL}/items/campaign_content`, 
      content,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data.data;
  } catch (error) {
    console.error('Ошибка при создании тестового контента:', error.message);
    if (error.response) {
      console.error('Ответ API:', error.response.data);
    }
    throw error;
  }
}

/**
 * Публикует контент через API нашего приложения
 */
async function publishContent(contentId) {
  try {
    const response = await axios.post(`http://localhost:3000/api/content/${contentId}/publish`, {
      platforms: ['telegram']
    });
    
    return response.data;
  } catch (error) {
    console.error('Ошибка при публикации контента:', error.message);
    if (error.response) {
      console.error('Ответ API:', error.response.data);
    }
    throw error;
  }
}

/**
 * Запускает тесты форматирования для Telegram
 */
async function runTests() {
  console.log('=== ТЕСТИРОВАНИЕ HTML-ФОРМАТИРОВАНИЯ В TELEGRAM ЧЕРЕЗ НАСТРОЙКИ КАМПАНИИ ===\n');
  
  let successful = 0;
  let failed = 0;
  
  for (let i = 0; i < testCases.length; i++) {
    const test = testCases[i];
    console.log(`\n[ТЕСТ ${i + 1}] ${test.name}`);
    console.log(`Текст: ${test.text.substring(0, 100)}${test.text.length > 100 ? '...' : ''}`);
    
    try {
      // Создаем тестовый контент
      const title = `Тест форматирования #${i + 1}: ${test.name}`;
      const content = await createTestContent(title, test.text);
      console.log(`✓ Контент создан с ID: ${content.id}`);
      
      // Публикуем контент
      const publishResult = await publishContent(content.id);
      console.log(`✓ Результат публикации: ${JSON.stringify(publishResult)}`);
      
      if (publishResult.success) {
        console.log(`✓ ТЕСТ ${i + 1} ПРОЙДЕН!`);
        if (publishResult.postUrl) {
          console.log(`  URL сообщения: ${publishResult.postUrl}`);
        }
        successful++;
      } else {
        console.log(`✗ ТЕСТ ${i + 1} ПРОВАЛЕН: ${publishResult.error || 'Неизвестная ошибка'}`);
        failed++;
      }
    } catch (error) {
      console.error(`✗ ТЕСТ ${i + 1} ПРОВАЛЕН с ошибкой: ${error.message}`);
      failed++;
    }
    
    // Пауза между запросами
    if (i < testCases.length - 1) {
      console.log('Ожидание 3 секунды перед следующим тестом...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  console.log('\n=== РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ ===');
  console.log(`✓ Успешно: ${successful}`);
  console.log(`✗ Провалено: ${failed}`);
  console.log(`Всего тестов: ${testCases.length}`);
}

// Запускаем тесты
console.log('Запуск тестирования HTML-форматирования...');
runTests().catch(error => {
  console.error('Критическая ошибка при выполнении тестов:', error);
});
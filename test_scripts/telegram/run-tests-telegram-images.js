/**
 * Комплексные тесты для проверки отправки изображений с HTML-форматированными подписями в Telegram
 * Скрипт выполняет набор тестов для проверки работы с изображениями и HTML-тегами в подписях
 * При каждом запуске публикует реальные изображения в канал для визуальной проверки
 * 
 * Запуск: node run-tests-telegram-images.js
 */
import axios from 'axios';
import { config } from 'dotenv';
import { storage } from './server/storage.js';

// Загружаем переменные окружения
config();

// API URL по умолчанию
const API_URL = process.env.API_URL || 'http://localhost:5000';

// ID кампании из переменных окружения
const CAMPAIGN_ID = process.env.CAMPAIGN_ID || '46868c44-c6a4-4bed-accf-9ad07bba790e';

// Хранилище для настроек, полученных из кампании
let settings = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || null,
    chatId: process.env.TELEGRAM_CHAT_ID || null
  }
};

// Тестовые изображения для проверки
const testImages = [
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836', // Еда
  'https://images.unsplash.com/photo-1512621776951-a57141f2eefd', // Овощи
  'https://images.unsplash.com/photo-1498837167922-ddd27525d352', // Фрукты
  'https://images.unsplash.com/photo-1494390248081-4e521a5940db', // Зелень
  'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327'  // Десерт
];

// Тестовые кейсы для разных сценариев отправки изображений
const testCases = [
  {
    name: '1. Одно изображение с HTML-форматированной подписью',
    description: 'Проверка отправки одного изображения с базовым HTML-форматированием в подписи',
    images: [testImages[0]],
    caption: `<b>Тестовое изображение с подписью</b>

<i>Проверка форматирования текста</i>

• <u>Пункт 1</u>
• <b>Пункт 2</b>
• <i>Пункт 3</i>

#тест #изображение #форматирование`
  },
  {
    name: '2. Одно изображение с незакрытыми HTML-тегами в подписи',
    description: 'Проверка исправления незакрытых тегов в подписи к изображению',
    images: [testImages[1]],
    caption: `<b>Заголовок с <i>вложенным форматированием

<u>Незакрытый тег подчеркивания

• <b>Жирный пункт списка
• <i>Курсивный пункт

#тест #незакрытые #теги`
  },
  {
    name: '3. Группа изображений с HTML-форматированной подписью',
    description: 'Проверка отправки нескольких изображений с HTML-форматированием в подписи',
    images: [testImages[2], testImages[3], testImages[4]],
    caption: `<b>Группа тестовых изображений</b>

<i>Проверка отправки нескольких изображений с подписью</i>

• <u>Первое изображение</u>
• <b>Второе изображение</b>
• <i>Третье изображение</i>

<a href="https://example.com">Ссылка в подписи</a>

#тест #группа #изображения`
  },
  {
    name: '4. Группа изображений с незакрытыми HTML-тегами в подписи',
    description: 'Проверка исправления незакрытых тегов в подписи к группе изображений',
    images: [testImages[0], testImages[1]],
    caption: `<b>Группа с незакрытыми <i>тегами в подписи

<u>Список с незакрытыми тегами:
• <b>Первый пункт с <i>вложенным форматированием
• <u>Второй пункт

#тест #группа #незакрытые #теги`
  },
  {
    name: '5. Длинная подпись с HTML-форматированием',
    description: 'Проверка обработки длинной подписи с HTML-тегами',
    images: [testImages[2]],
    caption: `<b>Изображение с длинной подписью</b>

<i>Эта подпись содержит много текста для проверки обработки длинных подписей с форматированием.</i>

${`<u>Повторяющийся текст с подчеркиванием. </u>`.repeat(20)}

<b>Список пунктов:</b>
• Пункт 1 с <i>курсивом</i>
• Пункт 2 с <b>жирным</b>
• Пункт 3 с <u>подчеркиванием</u>
• Пункт 4 с <s>зачеркиванием</s>
• Пункт 5 с <code>моноширинным текстом</code>

${`<b>Еще повторяющийся текст. </b>`.repeat(10)}

#тест #длинная #подпись`
  },
  {
    name: '6. Маркдаун в подписи к изображению',
    description: 'Проверка конвертации Markdown в HTML в подписи к изображению',
    images: [testImages[3]],
    caption: `**Жирный текст из markdown**

*Курсивный текст из markdown*

__Подчеркнутый текст из markdown__

~~Зачеркнутый текст из markdown~~

\`Моноширинный текст из markdown\`

**Жирный с *вложенным курсивом* из markdown**

#тест #markdown #изображение`
  }
];

/**
 * Получает настройки из кампании
 * @returns {Promise<void>}
 */
async function loadSettings() {
  try {
    console.log(`Получение настроек из кампании ${CAMPAIGN_ID}...`);
    
    // Получаем кампанию
    const campaign = await storage.getCampaign(CAMPAIGN_ID);
    
    if (!campaign) {
      throw new Error(`Кампания с ID ${CAMPAIGN_ID} не найдена`);
    }
    
    if (!campaign.socialMediaSettings || !campaign.socialMediaSettings.telegram) {
      throw new Error(`Настройки Telegram не найдены в кампании ${CAMPAIGN_ID}`);
    }
    
    const telegramSettings = campaign.socialMediaSettings.telegram;
    
    if (!telegramSettings.token || !telegramSettings.chatId) {
      throw new Error(`Неполные настройки Telegram в кампании ${CAMPAIGN_ID}`);
    }
    
    // Сохраняем настройки
    settings.telegram.token = telegramSettings.token;
    settings.telegram.chatId = telegramSettings.chatId;
    
    console.log('✅ Настройки Telegram успешно загружены');
    console.log(`Канал: ${settings.telegram.chatId}`);
    console.log(`Токен: ${settings.telegram.token.substring(0, 10)}...`);
    
    return true;
  } catch (error) {
    console.error(`❌ Ошибка при загрузке настроек: ${error.message}`);
    
    // Попробуем использовать тестовые настройки из окружения
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      console.log('⚠️ Используем настройки из переменных окружения');
      settings.telegram.token = process.env.TELEGRAM_BOT_TOKEN;
      settings.telegram.chatId = process.env.TELEGRAM_CHAT_ID;
      return true;
    }
    
    // Если не удалось загрузить настройки из кампании и нет переменных окружения,
    // используем жестко заданные значения
    console.log('⚠️ Используем жестко заданные настройки');
    settings.telegram.token = 'REVOKED_TELEGRAM_TOKEN_USE_ENV';
    settings.telegram.chatId = '-1002302366310';
    return true;
  }
}

/**
 * Публикует тестовое изображение через API приложения
 * @param {object} testCase Тестовый случай
 * @param {number} index Индекс теста
 * @returns {Promise<object>} Результат публикации
 */
async function runTest(testCase, index) {
  try {
    console.log(`\n----- Тест ${index+1}/${testCases.length}: ${testCase.name} -----`);
    console.log(`Описание: ${testCase.description}`);
    console.log(`Количество изображений: ${testCase.images.length}`);
    
    // Добавляем информацию о тесте в начало подписи
    const testHeader = `🧪 <b>ТЕСТ ИЗОБРАЖЕНИЙ #${index+1}</b>: ${testCase.name}\n\n`;
    const testCaption = testHeader + testCase.caption;
    
    // Создаем тело запроса
    const requestBody = {
      text: testCaption,
      chatId: settings.telegram.chatId,
      token: settings.telegram.token,
      imageUrl: testCase.images[0],
      additionalImages: testCase.images.slice(1)
    };
    
    // Делаем запрос к API для отправки сообщения
    console.log(`Отправка изображений через API...`);
    const response = await axios.post(`${API_URL}/api/test/telegram-post`, requestBody);
    
    // Обрабатываем ответ
    if (response.data && response.data.success) {
      const result = response.data.data;
      console.log(`✅ УСПЕХ: Тест #${index+1} пройден успешно!`);
      
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
      console.log(`❌ ОШИБКА: Тест #${index+1} не пройден!`);
      
      if (response.data && response.data.error) {
        console.log(`Описание ошибки: ${response.data.error}`);
      }
      
      console.log(JSON.stringify(response.data, null, 2));
      
      return { 
        success: false, 
        error: response.data?.error || 'Неизвестная ошибка' 
      };
    }
  } catch (error) {
    console.error(`❌ ОШИБКА при выполнении теста #${index+1}:`, error.message);
    
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

/**
 * Запускает все тесты и выводит общий результат
 */
async function runAllTests() {
  console.log('======================================================');
  console.log('🧪 ЗАПУСК ТЕСТОВ ОТПРАВКИ ИЗОБРАЖЕНИЙ В TELEGRAM');
  console.log('======================================================\n');
  
  // Загружаем настройки
  await loadSettings();
  
  // Результаты тестов
  const results = [];
  
  // Запускаем тесты поочередно
  for (let i = 0; i < testCases.length; i++) {
    const result = await runTest(testCases[i], i);
    results.push(result);
    
    // Пауза между тестами, чтобы не превысить лимиты API Telegram
    if (i < testCases.length - 1) {
      console.log('⏳ Пауза 3 секунды перед следующим тестом...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  // Выводим общий результат
  console.log('\n======================================================');
  console.log('📊 СВОДКА РЕЗУЛЬТАТОВ ТЕСТОВ:');
  console.log('======================================================');
  
  // Подсчитываем количество успешных и неуспешных тестов
  const successCount = results.filter(r => r.success).length;
  
  // Выводим результаты для каждого теста
  for (let i = 0; i < testCases.length; i++) {
    const status = results[i].success ? '✅ УСПЕХ' : '❌ ОШИБКА';
    console.log(`${status}: Тест #${i+1} - ${testCases[i].name}`);
    
    if (!results[i].success && results[i].error) {
      console.log(`   Причина: ${results[i].error}`);
    }
    
    if (results[i].postUrl) {
      console.log(`   URL: ${results[i].postUrl}`);
    }
  }
  
  // Итоговый результат
  console.log('\n======================================================');
  console.log(`ИТОГО: ${successCount}/${testCases.length} тестов успешно`);
  
  if (successCount === testCases.length) {
    console.log('✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО!');
  } else {
    console.log(`❌ ${testCases.length - successCount} ТЕСТОВ НЕ ПРОЙДЕНО!`);
  }
  console.log('======================================================');
}

// Запускаем все тесты
runAllTests().catch(error => {
  console.error('Критическая ошибка при выполнении тестов:', error);
  process.exit(1);
});
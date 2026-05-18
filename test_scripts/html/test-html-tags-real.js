/**
 * Скрипт для проверки обработки HTML-тегов через реальный код TelegramService
 * Использует настройки Telegram из Directus для кампании "Правильное питание"
 * 
 * Запуск: node test-html-tags-real.js
 */
// Требуется обычный импорт без расширения '.js'
const { DirectusAuthManager } = require('./server/services/directus-auth-manager');
const { TelegramService } = require('./server/services/social/telegram-service');
const axios = require('axios');
const { config } = require('dotenv');

config();

// ID кампании "Правильное питание"
const CAMPAIGN_ID = '46868c44-c6a4-4bed-accf-9ad07bba790e';

// Адрес Directus
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://smm-manager.directus.app';

// Учетные данные Directus
const DIRECTUS_EMAIL = process.env.DIRECTUS_ADMIN_EMAIL || 'lbrspb@gmail.com';
const DIRECTUS_PASSWORD = process.env.DIRECTUS_ADMIN_PASSWORD || 'zxczxc123';

// Текст с незакрытыми HTML-тегами для теста
const TEST_HTML = `<b>Заголовок с незакрытым тегом

<i>Подзаголовок с курсивом тоже незакрытый

<u>Важный текст без закрытия

Этот тест проверяет работу метода fixUnclosedTags в TelegramService.
Должны закрыться все теги: b, i, u.`;

/**
 * Получает настройки Telegram из кампании в Directus
 */
async function getCampaignSettings(campaignId) {
  try {
    console.log(`Получение настроек для кампании ${campaignId}...`);
    
    // Авторизуемся в Directus
    const authResponse = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: DIRECTUS_EMAIL,
      password: DIRECTUS_PASSWORD
    });
    
    if (!authResponse.data || !authResponse.data.data || !authResponse.data.data.access_token) {
      throw new Error('Ошибка авторизации в Directus: токен не получен');
    }
    
    const token = authResponse.data.data.access_token;
    console.log('Успешная авторизация в Directus');
    
    // Получаем данные кампании
    const campaignResponse = await axios.get(`${DIRECTUS_URL}/items/campaigns/${campaignId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!campaignResponse.data || !campaignResponse.data.data) {
      throw new Error(`Кампания ${campaignId} не найдена`);
    }
    
    const campaign = campaignResponse.data.data;
    console.log(`Получены данные кампании: ${campaign.name}`);
    
    // Извлекаем настройки
    if (!campaign.settings || !campaign.settings.telegram) {
      throw new Error('Настройки Telegram не найдены в кампании');
    }
    
    const telegramSettings = campaign.settings.telegram;
    console.log(`Настройки Telegram: token=${telegramSettings.token ? 'задан' : 'отсутствует'}, chatId=${telegramSettings.chatId || 'отсутствует'}`);
    
    return telegramSettings;
  } catch (error) {
    console.error('Ошибка при получении настроек кампании:', error.message);
    return null;
  }
}

/**
 * Основная функция теста
 */
async function testHtmlTagsFixing() {
  console.log('\n=== Тест обработки незакрытых HTML-тегов в TelegramService ===\n');
  
  try {
    // Получаем настройки Telegram из Directus
    const telegramSettings = await getCampaignSettings(CAMPAIGN_ID);
    
    if (!telegramSettings || !telegramSettings.token || !telegramSettings.chatId) {
      throw new Error('Не удалось получить настройки Telegram из Directus');
    }
    
    // Создаем экземпляр AuthManager
    const authManager = new DirectusAuthManager();
    
    // Создаем экземпляр TelegramService
    const telegramService = new TelegramService(authManager);
    
    // Выводим тестовый текст
    console.log('\nТестовый текст с незакрытыми тегами:');
    console.log('-----------------------------------------------');
    console.log(TEST_HTML);
    console.log('-----------------------------------------------\n');
    
    // Создаем тестовый контент
    const testContent = {
      id: 'test-html-tags',
      title: 'Тест незакрытых тегов',
      text: TEST_HTML,
      content: TEST_HTML,
      status: 'draft',
      campaign_id: CAMPAIGN_ID,
      social_platforms: ['telegram'],
      metadata: {}
    };
    
    console.log('Отправка текста с незакрытыми тегами в Telegram...');
    
    // Публикуем контент в Telegram
    const result = await telegramService.publishToTelegram(testContent, {
      token: telegramSettings.token,
      chatId: telegramSettings.chatId
    });
    
    console.log('\nРезультат публикации:');
    console.log(JSON.stringify(result, null, 2));
    
    if (result.status === 'published') {
      console.log('\n✅ УСПЕХ: Сообщение успешно отправлено и опубликовано в Telegram!');
      console.log(`URL сообщения: ${result.url}`);
    } else {
      console.log(`\n❌ ОШИБКА: Не удалось опубликовать сообщение. Статус: ${result.status}`);
      if (result.error) {
        console.log(`Описание ошибки: ${result.error}`);
      }
    }
    
  } catch (error) {
    console.error('\n❌ ОШИБКА при выполнении теста:', error.message);
    if (error.response) {
      console.error('Ответ сервера:', error.response.status, JSON.stringify(error.response.data));
    }
  }
}

// Запускаем тест
testHtmlTagsFixing();
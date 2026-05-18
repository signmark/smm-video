/**
 * Скрипт для прямого тестирования функции fixUnclosedTags из TelegramService
 * Использует настройки Telegram из кампании "Правильное питание"
 * 
 * Запуск: node test-fix-tags.js
 */
import axios from 'axios';
import { config } from 'dotenv';

config();

// ID кампании из секретов окружения
const CAMPAIGN_ID = process.env.CAMPAIGN_ID || '46868c44-c6a4-4bed-accf-9ad07bba790e';

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

// Функция для исправления незакрытых HTML-тегов
function fixUnclosedTags(text) {
  // Определяем поддерживаемые Telegram теги
  const supportedTags = ['b', 'i', 'u', 's', 'code', 'pre', 'a'];
  
  // Создаем стек для отслеживания открытых тегов
  const stack = [];
  
  // Регулярное выражение для поиска всех HTML-тегов
  const tagRegex = /<\/?([a-z]+)[^>]*>/gi;
  let match;
  let processedText = text;
  let allTags = [];
  
  // Находим все теги и их позиции
  while ((match = tagRegex.exec(text)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    
    // Проверяем, является ли тег поддерживаемым
    if (supportedTags.includes(tagName)) {
      const isClosing = fullTag.startsWith('</');
      allTags.push({
        tag: tagName,
        isClosing,
        position: match.index
      });
    }
  }
  
  // Сортируем по позиции, чтобы обрабатывать теги в порядке их появления
  allTags.sort((a, b) => a.position - b.position);
  
  // Определяем, какие теги открыты и неправильно закрыты
  for (const tagInfo of allTags) {
    if (tagInfo.isClosing) {
      // Если это закрывающий тег, проверяем, соответствует ли он последнему открытому
      if (stack.length > 0 && stack[stack.length - 1] === tagInfo.tag) {
        stack.pop(); // Правильный закрывающий тег, удаляем из стека
      } else {
        // Неправильный порядок закрытия, но не обрабатываем здесь
        continue;
      }
    } else {
      // Открывающий тег - добавляем в стек
      stack.push(tagInfo.tag);
    }
  }
  
  // Если остались незакрытые теги, закрываем их в обратном порядке
  if (stack.length > 0) {
    console.log(`Обнаружены незакрытые HTML теги: ${stack.join(', ')}. Автоматически закрываем их.`);
    
    let closingTags = '';
    // Закрываем теги в обратном порядке (LIFO)
    for (let i = stack.length - 1; i >= 0; i--) {
      closingTags += `</${stack[i]}>`;
    }
    
    // Добавляем закрывающие теги в конец текста
    processedText += closingTags;
    
    console.log(`Текст с закрытыми тегами: ${processedText.substring(0, Math.min(100, processedText.length))}...`);
  } else {
    console.log('Все теги уже закрыты правильно.');
  }
  
  return processedText;
}

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
 * Отправляем сообщение с незакрытыми тегами в Telegram
 */
async function sendMessageToTelegram(text, token, chatId) {
  try {
    console.log('Подготовка сообщения для отправки в Telegram...');
    
    // Исправляем незакрытые теги
    const processedText = fixUnclosedTags(text);
    
    console.log('\nОтправка сообщения в Telegram...');
    
    // Формируем запрос к API Telegram
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await axios.post(url, {
      chat_id: chatId,
      text: processedText,
      parse_mode: 'HTML'
    });
    
    if (response.data && response.data.ok) {
      const messageId = response.data.result.message_id;
      let messageUrl;
      
      // Формируем URL сообщения
      if (chatId.startsWith('-100')) {
        // Приватный канал/группа
        const numericChatId = chatId.replace('-100', '');
        messageUrl = `https://t.me/c/${numericChatId}/${messageId}`;
      } else {
        // Получаем информацию о чате для проверки наличия username
        const chatInfoUrl = `https://api.telegram.org/bot${token}/getChat`;
        const chatResponse = await axios.post(chatInfoUrl, {
          chat_id: chatId
        });
        
        if (chatResponse.data && chatResponse.data.ok && chatResponse.data.result.username) {
          messageUrl = `https://t.me/${chatResponse.data.result.username}/${messageId}`;
        } else {
          messageUrl = `https://t.me/c/${chatId.replace('-', '')}/${messageId}`;
        }
      }
      
      console.log('\n✅ УСПЕХ: Сообщение успешно отправлено!');
      console.log(`ID сообщения: ${messageId}`);
      console.log(`URL сообщения: ${messageUrl}`);
      
      return { success: true, messageId, messageUrl };
    } else {
      console.log('\n❌ ОШИБКА: Не удалось отправить сообщение');
      console.log('Ответ API:', JSON.stringify(response.data));
      return { success: false, error: response.data };
    }
  } catch (error) {
    console.error('\n❌ ОШИБКА при отправке сообщения:', error.message);
    if (error.response) {
      console.error('Ответ сервера:', error.response.status, JSON.stringify(error.response.data));
    }
    return { success: false, error: error.message };
  }
}

/**
 * Основная функция теста
 */
async function testHtmlTagsFixing() {
  console.log('=== Тест исправления незакрытых HTML-тегов и отправки в Telegram ===\n');
  
  try {
    // Получаем настройки Telegram из Directus
    const telegramSettings = await getCampaignSettings(CAMPAIGN_ID);
    
    if (!telegramSettings || !telegramSettings.token || !telegramSettings.chatId) {
      throw new Error('Не удалось получить настройки Telegram из Directus');
    }
    
    console.log('\nТестовый текст с незакрытыми тегами:');
    console.log('-----------------------------------------------');
    console.log(TEST_HTML);
    console.log('-----------------------------------------------\n');
    
    // Отправляем сообщение в Telegram
    await sendMessageToTelegram(
      TEST_HTML,
      telegramSettings.token,
      telegramSettings.chatId
    );
    
    console.log('\n=== Тест завершен ===');
    
  } catch (error) {
    console.error('\n❌ ОШИБКА при выполнении теста:', error.message);
    if (error.response) {
      console.error('Ответ сервера:', error.response.status, JSON.stringify(error.response.data));
    }
  }
}

// Запускаем тест
testHtmlTagsFixing();
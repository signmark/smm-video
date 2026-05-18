/**
 * Тестовый скрипт для проверки исправления незакрытых HTML-тегов в Telegram
 * Запустите: node telegram-html-fix-test.cjs
 */

const axios = require('axios');

// Токен и chatId из настроек кампании
const token = '7529101043:AAG298h0iubyeKPuZ-WRtEFbNEnEyqy_XJU';
const chatId = '-1002302366310';

// Текст с незакрытыми HTML тегами
const unclosedText = `Тест исправленного форматирования HTML в Telegram:

<b>Жирный текст
<i>Жирный и курсивный текст
<u>Жирный, курсивный и подчеркнутый текст

<code>Моноширинный текст
<a href='https://replit.com'>Ссылка`;

/**
 * Исправляет незакрытые HTML-теги в тексте
 * @param {string} text Текст с HTML-разметкой
 * @returns {string} Текст с исправленными незакрытыми тегами
 */
function fixUnclosedTags(text) {
  // Определяем поддерживаемые Telegram теги
  const supportedTags = ['b', 'i', 'u', 's', 'code', 'pre', 'a'];
  
  // Создаем стек для отслеживания открытых тегов
  const stack = [];
  
  // Регулярное выражение для поиска всех HTML-тегов
  const tagRegex = /<\/?([a-z]+)[^>]*>/gi;
  let match;
  let processedText = text;
  const allTags = [];
  
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
    
    console.log(`Текст с закрытыми тегами: ${processedText}`);
  } else {
    console.log('Все теги уже закрыты правильно.');
  }
  
  return processedText;
}

/**
 * Отправляет текст в Telegram с HTML форматированием
 * @param {string} text Текст для отправки
 * @returns {Promise<void>}
 */
async function sendToTelegram(text) {
  try {
    console.log('Отправка исправленного текста в Telegram...');
    
    const response = await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );
    
    if (response.data && response.data.ok) {
      console.log('Сообщение успешно отправлено!');
      console.log(`Message ID: ${response.data.result.message_id}`);
      
      // Получаем информацию о чате для формирования URL
      const getChat = await axios.post(
        `https://api.telegram.org/bot${token}/getChat`,
        { chat_id: chatId },
        { headers: { 'Content-Type': 'application/json' } }
      );
      
      // Формируем URL для сообщения
      let messageUrl;
      if (getChat.data && getChat.data.ok) {
        if (getChat.data.result.username) {
          // Для публичных каналов
          messageUrl = `https://t.me/${getChat.data.result.username}/${response.data.result.message_id}`;
          console.log(`Канал публичный с username: ${getChat.data.result.username}`);
        } else {
          // Для приватных каналов
          const formattedChatId = chatId.startsWith('-100') ? chatId.substring(4) : chatId;
          messageUrl = `https://t.me/c/${formattedChatId}/${response.data.result.message_id}`;
          console.log(`Канал приватный (без username)`);
        }
        console.log(`URL сообщения: ${messageUrl}`);
      } else {
        console.log('Не удалось получить информацию о чате');
      }
    } else {
      console.error('Ошибка при отправке:', response.data);
    }
  } catch (error) {
    console.error('Ошибка:', error.message);
    if (error.response) {
      console.error('Ответ API:', error.response.data);
    }
  }
}

/**
 * Основная функция запуска теста
 */
async function runTest() {
  console.log('=== Тест исправления незакрытых HTML-тегов в Telegram ===');
  console.log('\nИсходный текст с незакрытыми тегами:');
  console.log(unclosedText);
  console.log('\n--- Исправление тегов ---');
  
  // Исправляем текст
  const fixedText = fixUnclosedTags(unclosedText);
  
  console.log('\n=== Отправка исправленного текста в Telegram ===');
  await sendToTelegram(fixedText);
  
  console.log('\n=== Тест завершен ===');
}

// Запускаем тест
runTest().catch(error => {
  console.error('Произошла ошибка при выполнении теста:', error);
});
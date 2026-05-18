/**
 * Тестовый скрипт для проверки исправления незакрытых HTML-тегов в Telegram
 * Запустите: node telegram-html-fix-test.mjs
 */

import axios from 'axios';

// Настройки Telegram
const telegramToken = '7529101043:AAG298h0iubyeKPuZ-WRtEFbNEnEyqy_XJU';
const chatId = '-1002302366310';

// Примеры текстов с незакрытыми тегами
const textWithUnclosedTags = `
<b>Жирный текст без закрытия
<i>Курсивный текст
<u>Подчеркнутый текст</u>
Этот текст должен был быть курсивным, но тег не закрыт
`;

// Более сложный пример с многоуровневыми вложенными тегами
const complexNestedTags = `
<b>Жирный <i>текст с <u>вложенным подчеркиванием
и курсивом. Этот тег жирного шрифта не закрыт.

<b>Второй жирный текст с <i>курсивом.
<code>Моноширинный текст в курсиве</i> но не закрыт код.

Внешняя конструкция <b>где внутри есть <i>курсив</i>.
`;

/**
 * Исправляет незакрытые HTML-теги в тексте
 * @param {string} text Текст с HTML-разметкой
 * @returns {string} Текст с исправленными незакрытыми тегами
 */
function fixUnclosedTags(text) {
  // Стек для отслеживания открытых тегов
  const tagStack = [];
  
  // Регулярное выражение для поиска открывающих и закрывающих тегов
  const tagRegex = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
  
  // Находим все теги в тексте
  let match;
  let lastIndex = 0;
  let result = '';
  
  while ((match = tagRegex.exec(text)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const isClosingTag = fullTag.startsWith('</');
    
    // Добавляем текст до текущего тега
    result += text.substring(lastIndex, match.index);
    lastIndex = match.index + fullTag.length;
    
    if (isClosingTag) {
      // Если это закрывающий тег, проверяем, соответствует ли он последнему открытому тегу
      if (tagStack.length > 0) {
        const lastOpenTag = tagStack[tagStack.length - 1];
        if (lastOpenTag === tagName) {
          // Тег правильно закрыт, удаляем его из стека
          tagStack.pop();
          result += fullTag;
        } else {
          // Закрывающий тег не соответствует последнему открытому
          // Добавляем закрывающие теги для всех открытых тегов до соответствующего
          let found = false;
          for (let i = tagStack.length - 1; i >= 0; i--) {
            if (tagStack[i] === tagName) {
              found = true;
              // Закрываем все промежуточные теги
              for (let j = tagStack.length - 1; j >= i; j--) {
                result += `</${tagStack[j]}>`;
                tagStack.pop();
              }
              break;
            }
          }
          
          if (!found) {
            // Если соответствующий открывающий тег не найден, игнорируем закрывающий тег
            console.log(`Игнорирую закрывающий тег </${tagName}>, для которого нет открывающего`);
          } else {
            // Добавляем текущий закрывающий тег
            result += fullTag;
          }
        }
      } else {
        // Если стек пуст, значит это закрывающий тег без открывающего
        console.log(`Игнорирую закрывающий тег </${tagName}>, для которого нет открывающего`);
      }
    } else {
      // Открывающий тег, добавляем в стек
      tagStack.push(tagName);
      result += fullTag;
    }
  }
  
  // Добавляем оставшийся текст
  result += text.substring(lastIndex);
  
  // Закрываем все оставшиеся открытые теги в обратном порядке (LIFO)
  for (let i = tagStack.length - 1; i >= 0; i--) {
    result += `</${tagStack[i]}>`;
  }
  
  return result;
}

/**
 * Отправляет текст в Telegram с HTML форматированием
 * @param {string} text Текст для отправки
 * @param {string} description Описание теста
 * @returns {Promise<void>}
 */
async function sendToTelegram(text, description) {
  try {
    const fixedText = fixUnclosedTags(text);
    
    console.log(`\n--- Тест: ${description} ---`);
    console.log('Оригинальный текст:');
    console.log(text);
    console.log('\nИсправленный текст:');
    console.log(fixedText);
    
    // Используем точно такой же формат запроса, как в TelegramService
    const response = await axios.post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      chat_id: chatId,
      text: fixedText,
      parse_mode: 'HTML',
      protect_content: false,
      disable_notification: false
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    
    if (response.data && response.data.ok) {
      console.log('\n✅ Сообщение успешно отправлено!');
      console.log(`ID сообщения: ${response.data.result.message_id}`);
      
      // Получаем URL сообщения
      try {
        const chatInfo = await axios.post(
          `https://api.telegram.org/bot${telegramToken}/getChat`,
          { chat_id: chatId },
          { headers: { 'Content-Type': 'application/json' } }
        );
        
        if (chatInfo.data.ok) {
          let messageUrl;
          if (chatInfo.data.result.username) {
            messageUrl = `https://t.me/${chatInfo.data.result.username}/${response.data.result.message_id}`;
            console.log(`Публичный канал: ${chatInfo.data.result.username}`);
          } else {
            const formattedChatId = chatId.startsWith('-100') ? chatId.substring(4) : chatId;
            messageUrl = `https://t.me/c/${formattedChatId}/${response.data.result.message_id}`;
            console.log('Приватный канал');
          }
          console.log(`URL сообщения: ${messageUrl}`);
        }
      } catch (error) {
        console.error('Ошибка при получении URL сообщения:', error);
      }
    } else {
      console.error('\n❌ Ошибка при отправке:', response.data);
    }
  } catch (error) {
    console.error('\n❌ Ошибка при отправке:', error);
    if (error.response) {
      console.error('Данные ошибки:', error.response.data);
    }
  }
}

/**
 * Основная функция запуска теста
 */
async function runTest() {
  console.log('=== Тестирование функции исправления незакрытых HTML тегов для Telegram ===\n');
  
  // Запускаем тесты с разными примерами
  await sendToTelegram(textWithUnclosedTags, 'Простой пример с незакрытыми тегами');
  await sendToTelegram(complexNestedTags, 'Сложный пример с вложенными тегами');
  
  console.log('\n=== Тестирование завершено ===');
}

// Запускаем тест
runTest().catch(console.error);
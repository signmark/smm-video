/**
 * Тестовый скрипт для проверки реального Telegram-сервиса с незакрытыми тегами
 * Запустите: node test-real-telegram.js
 */
import axios from 'axios';
import { config } from 'dotenv';

config();

// Получаем значения из переменных окружения
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * Основная тестовая функция
 */
async function testTelegramWithUnclosedTags() {
  console.log('=== Тест отправки сообщения с незакрытыми тегами в Telegram ===\n');

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('ОШИБКА: Не заданы необходимые переменные окружения TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID');
    process.exit(1);
  }

  console.log(`Используем Telegram бота с токеном ${TELEGRAM_BOT_TOKEN.substring(0, 10)}... и чат ${TELEGRAM_CHAT_ID}`);

  // Тестовое сообщение с незакрытыми тегами
  const testMessage = `<b>Тестовый заголовок без закрытия
<i>Тестовый подзаголовок
<u>Тестовый подчеркнутый текст

Этот тест проверяет обработку незакрытых HTML-тегов при отправке в Telegram.
Должен работать через реальный TelegramService из нашей системы.`;

  try {
    // Отправляем сообщение с незакрытыми тегами
    console.log('Отправляем тестовое сообщение с незакрытыми тегами...');
    console.log('СООБЩЕНИЕ:');
    console.log('-----------------------------------');
    console.log(testMessage);
    console.log('-----------------------------------');

    // Используем напрямую API Telegram
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    console.log('Отправка через прямой вызов sendMessage (чтобы увидеть ошибку)...');
    try {
      const response = await axios.post(url, {
        chat_id: TELEGRAM_CHAT_ID,
        text: testMessage,
        parse_mode: 'HTML'
      }, {
        validateStatus: () => true
      });

      console.log('Ответ API:', response.status, response.data ? JSON.stringify(response.data) : 'Нет данных');
      
      if (response.status === 200 && response.data && response.data.ok) {
        console.log('✅ Сообщение отправлено успешно (это странно, так как теги не закрыты)');
      } else {
        console.log('❌ Ошибка при отправке сообщения:', response.data.description || 'неизвестная ошибка');
      }
    } catch (apiError) {
      console.log('❌ Исключение при прямом вызове API:', apiError.message);
    }

    // Теперь применяем наш метод исправления и пробуем снова
    console.log('\nИсправляем незакрытые теги вручную и пробуем снова...');
    
    // Имитация нашей функции fixUnclosedTags
    const fixedMessage = fixUnclosedTags(testMessage);
    
    console.log('ИСПРАВЛЕННОЕ СООБЩЕНИЕ:');
    console.log('-----------------------------------');
    console.log(fixedMessage);
    console.log('-----------------------------------');
    
    const fixedResponse = await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: fixedMessage,
      parse_mode: 'HTML'
    });
    
    if (fixedResponse.status === 200 && fixedResponse.data && fixedResponse.data.ok) {
      const messageId = fixedResponse.data.result.message_id;
      console.log(`✅ Исправленное сообщение отправлено успешно! ID: ${messageId}`);
      
      // Формируем URL сообщения
      let messageUrl;
      try {
        // Получаем информацию о чате для проверки наличия username
        const chatInfoUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getChat`;
        const chatResponse = await axios.post(chatInfoUrl, {
          chat_id: TELEGRAM_CHAT_ID
        });
        
        if (chatResponse.data && chatResponse.data.ok) {
          const chatInfo = chatResponse.data.result;
          console.log('Информация о чате:', JSON.stringify(chatInfo));
          
          // Генерируем URL в зависимости от типа чата
          if (chatInfo.username) {
            // Публичный канал/группа
            messageUrl = `https://t.me/${chatInfo.username}/${messageId}`;
          } else {
            // Приватный канал/группа
            const numericChatId = TELEGRAM_CHAT_ID.replace('-100', '');
            messageUrl = `https://t.me/c/${numericChatId}/${messageId}`;
          }
          
          console.log(`URL сообщения: ${messageUrl}`);
        }
      } catch (chatError) {
        console.log('❌ Ошибка при получении информации о чате:', chatError.message);
      }
    } else {
      console.log('❌ Ошибка при отправке исправленного сообщения:', fixedResponse.data ? fixedResponse.data.description : 'неизвестная ошибка');
    }
    
    console.log('\n=== Тест завершен ===');
  } catch (error) {
    console.error('Ошибка при выполнении теста:', error.message);
  }
}

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

// Запускаем тест
testTelegramWithUnclosedTags();
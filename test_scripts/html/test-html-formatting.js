/**
 * Тест для проверки правильного форматирования HTML в Telegram
 * Запуск: node test-html-formatting.js
 */

const axios = require('axios');
require('dotenv').config();

// Данные для тестирования HTML форматирования
const testCases = [
  {
    name: "Базовые теги форматирования",
    text: "<b>Жирный текст</b> и <i>курсив</i> <u>подчеркнутый</u> <s>зачеркнутый</s>",
    expectedRendering: true
  },
  {
    name: "Вложенные теги",
    text: "<b>Жирный текст с <i>курсивом</i> внутри</b>",
    expectedRendering: true
  },
  {
    name: "Гиперссылки",
    text: "Посетите <a href='https://example.com'>наш сайт</a> для получения дополнительной информации",
    expectedRendering: true
  },
  {
    name: "Незакрытые теги (должны автоматически закрываться)",
    text: "<b>Жирный текст <i>курсив <u>подчеркнутый",
    expectedRendering: true
  },
  {
    name: "Списки с эмодзи",
    text: "• 🍎 Яблоки\n• 🍌 Бананы\n• 🍇 Виноград",
    expectedRendering: true
  },
  {
    name: "Экранирование HTML-символов",
    text: "Символы < > & должны отображаться корректно",
    expectedRendering: true
  },
  {
    name: "Фильтр неприемлемого контента",
    text: "Нормальный текст без ругательств и оскорблений",
    expectedRendering: true
  }
];

// Функция для отправки текста
async function sendMessage(text) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.error("ERROR: Необходимо задать переменные окружения TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID");
    process.exit(1);
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  // Вызываем наш API-метод для отправки сообщения через сервис приложения
  try {
    const response = await axios.post('http://localhost:3000/api/test/telegram-post', {
      text: text,
      token: token,
      chatId: chatId
    });
    
    console.log(`✅ Успешная отправка, message_id: ${response.data?.messageId || 'N/A'}`);
    return {
      success: true,
      messageId: response.data?.messageId,
      postUrl: response.data?.postUrl
    };
  } catch (error) {
    console.error(`❌ Ошибка при отправке: ${error.message}`);
    if (error.response) {
      console.error(`Статус ошибки: ${error.response.status}`);
      console.error(`Данные ошибки: ${JSON.stringify(error.response.data)}`);
    }
    return {
      success: false,
      error: error.message
    };
  }
}

// Функция для исправления нежелательного контента
function sanitizeText(text) {
  // Фильтрация нежелательной лексики
  const unwantedWords = ['дичь', 'пездула', 'умри', 'нахуй'];
  let sanitized = text;
  
  unwantedWords.forEach(word => {
    // Заменяем на звездочки
    const stars = '*'.repeat(word.length);
    sanitized = sanitized.replace(new RegExp(word, 'gi'), stars);
  });
  
  return sanitized;
}

// Функция для запуска всех тестов
async function runTests() {
  console.log("=== НАЧАЛО ТЕСТИРОВАНИЯ HTML-ФОРМАТИРОВАНИЯ В TELEGRAM ===\n");
  
  let successful = 0;
  let failed = 0;
  
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`\n[ТЕСТ ${i+1}] ${testCase.name}`);
    console.log(`Текст: ${testCase.text}`);
    
    // Проверяем и исправляем нежелательный контент
    const sanitizedText = sanitizeText(testCase.text);
    if (sanitizedText !== testCase.text) {
      console.log(`⚠️ Текст был отфильтрован: ${sanitizedText}`);
    }
    
    // Отправляем сообщение
    const result = await sendMessage(sanitizedText);
    
    if (result.success) {
      console.log(`✅ ТЕСТ ${i+1} ПРОЙДЕН!`);
      console.log(`Ссылка на сообщение: ${result.postUrl || 'N/A'}`);
      successful++;
    } else {
      console.log(`❌ ТЕСТ ${i+1} ПРОВАЛЕН: ${result.error}`);
      failed++;
    }
    
    // Пауза между тестами, чтобы избежать ограничений Telegram API
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  
  console.log("\n=== РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ ===");
  console.log(`✅ Успешно: ${successful}`);
  console.log(`❌ Провалено: ${failed}`);
  console.log(`Всего тестов: ${testCases.length}`);
}

// Запуск тестов
runTests().catch(error => {
  console.error('Ошибка при выполнении тестов:', error);
  process.exit(1);
});
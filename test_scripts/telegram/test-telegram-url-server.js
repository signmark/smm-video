/**
 * Тест форматирования URL для Telegram на стороне сервера
 */

const formatUrl = (chatId, messageId) => {
  if (!chatId || !messageId) {
    console.log('⚠️ chatId или messageId не указаны');
    return null;
  }
  
  // Определяем базовый URL
  let baseUrl = '';
  
  // Если это username (начинается с @), удаляем @ и не добавляем /c/
  if (chatId.startsWith('@')) {
    baseUrl = `https://t.me/${chatId.substring(1)}`;
  }
  // Для числовых ID проверяем, нужен ли префикс /c/
  else {
    // Проверяем, является ли chatId полным числовым идентификатором канала
    const isFullNumericId = chatId.startsWith('-100');
    
    if (isFullNumericId) {
      const channelId = chatId.substring(4); // Убираем префикс -100
      baseUrl = `https://t.me/c/${channelId}`;
    } else if (chatId.startsWith('-')) {
      const channelId = chatId.substring(1); // Убираем префикс -
      baseUrl = `https://t.me/c/${channelId}`;
    } else {
      baseUrl = `https://t.me/${chatId}`;
    }
  }
  
  // Создаем полный URL с ID сообщения
  return `${baseUrl}/${messageId}`;
};

console.log('🔍 Тест серверной функции форматирования URL Telegram');
const chatId = '-1002302366310';
const messageId = '12345';
console.log(`📋 chatId: ${chatId}, messageId: ${messageId}`);

const url = formatUrl(chatId, messageId);
console.log('📋 Сформированный URL: ' + url);
console.log('✅ Тест успешно завершен!');
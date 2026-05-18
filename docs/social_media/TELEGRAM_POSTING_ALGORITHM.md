# Алгоритм публикации в Telegram

## Требования к URL публикаций

Важнейшим элементом публикации в Telegram является формирование корректного URL для доступа к опубликованному сообщению. Согласно требованиям программного обеспечения SMM Manager, **все URL публикаций в Telegram должны содержать Message ID**, полученный после успешной публикации.

## Форматы URL

URL публикаций в Telegram могут иметь следующие форматы:

1. **Публичные каналы или чаты с username**:
   ```
   https://t.me/USERNAME/MESSAGE_ID
   ```
   Пример: `https://t.me/example_channel/1234`

2. **Каналы или супергруппы с числовым ID**:
   ```
   https://t.me/c/CHANNEL_ID/MESSAGE_ID
   ```
   Где CHANNEL_ID - это числовой ID канала без префикса `-100`
   Пример: `https://t.me/c/1234567890/42`

3. **Группы с обычным числовым ID**:
   ```
   https://t.me/c/GROUP_ID/MESSAGE_ID
   ```
   Где GROUP_ID - это числовой ID группы без минуса
   Пример: `https://t.me/c/987654321/123`

4. **Личные чаты**:
   ```
   https://t.me/c/CHAT_ID/MESSAGE_ID
   ```
   Пример: `https://t.me/c/123456789/789`

## Метод generatePostUrl / formatTelegramUrl

Функция для формирования URL должна обязательно включать проверку на наличие messageId. 
URL без messageId считается невалидным и не соответствующим требованиям системы.

### Пример реализации:

```typescript
/**
 * Генерирует URL для поста в Telegram
 * ВАЖНО: messageId является ОБЯЗАТЕЛЬНЫМ параметром!
 * URL без messageId считается некорректным и не допускается!
 *
 * @param chatId ID чата Telegram
 * @param formattedChatId Форматированный ID чата для API
 * @param messageId ID сообщения (обязательный параметр)
 * @returns Полный URL для поста в Telegram
 * @throws Error если messageId не указан или пуст
 */
private generatePostUrl(chatId: string, formattedChatId: string, messageId: number | string): string {
  // Проверка наличия messageId
  if (!messageId) {
    throw new Error('messageId является обязательным параметром для формирования URL Telegram');
  }
  
  // Форматирование URL в зависимости от типа chatId
  if (chatId.startsWith('@')) {
    // Для username каналов
    return `https://t.me/${chatId.substring(1)}/${messageId}`;
  } else if (chatId.startsWith('-100')) {
    // Для каналов и супергрупп
    return `https://t.me/c/${chatId.substring(4)}/${messageId}`;
  } else if (chatId.startsWith('-')) {
    // Для обычных групп
    return `https://t.me/c/${chatId.substring(1)}/${messageId}`;
  } else {
    // Для личных чатов
    return `https://t.me/c/${chatId}/${messageId}`;
  }
}
```

## Порядок действий при публикации

1. Отправить сообщение через Telegram Bot API
2. Получить messageId из ответа API
3. Сформировать URL с использованием полученного messageId
4. Сохранить URL и обновить статус публикации

## Обработка ошибок

В случае, если messageId не получен в ответе API, необходимо:
1. Зафиксировать ошибку в логах
2. Установить статус публикации как "failed"
3. Вернуть ошибку с описанием проблемы

URL публикации не может быть сформирован без messageId и не должен быть сохранен в системе в таком виде.
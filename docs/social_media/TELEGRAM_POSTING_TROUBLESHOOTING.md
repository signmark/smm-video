# Решение проблем при публикации в Telegram

## Обзор проблем

При публикации контента в Telegram могут возникать различные ошибки, связанные с форматированием текста, обработкой изображений, а также с ограничениями API Telegram.

## Общие проблемы и их решения

### 1. Ошибка "Bad Request: message caption is too long"

#### Симптомы:
```
Ошибка при публикации в Telegram: Request failed with status code 400
Данные ответа при ошибке: {"ok":false,"error_code":400,"description":"Bad Request: message caption is too long"}
```

#### Причина:
Telegram имеет строгие ограничения на длину подписи (caption) к медиа:
- Максимальная длина подписи: **1024 символа**
- При превышении этого лимита возникает ошибка

#### Решение:
1. В файле `server/services/social/social-publishing-with-imgur.ts` (или fixed-file.ts) проверьте метод отправки изображений:
   ```typescript
   private async sendImagesToTelegram(chatId: string, token: string, images: string[], baseUrl: string): Promise<any> {
     // ...
     // Для подписи к изображениям должен быть лимит в 1024 символа:
     const maxCaptionLength = 1024;
     const caption = text.length > maxCaptionLength ? 
       text.substring(0, maxCaptionLength - 3) + '...' : 
       text;
     // ...
   }
   ```

2. При отправке большого текста с изображениями разделите отправку на две части:
   - Сначала отправьте текст с помощью `sendMessage`
   - Затем отправьте изображения без подписи или с короткой подписью с помощью `sendPhoto`/`sendMediaGroup`

### 2. Ошибка "Can't parse entities: Can't find end of the entity..."

#### Симптомы:
```
Ошибка при отправке HTML-форматированного текста: код 400, Can't parse entities: Can't find end of the entity starting at byte offset 123
```

#### Причина:
Неправильное или неполное HTML-форматирование в тексте:
- Незакрытые HTML-теги
- Неподдерживаемые HTML-теги
- Некорректная вложенность тегов

#### Решение:
1. Проверьте функцию `formatTextForTelegram` в классе `SocialPublishingWithImgurService`:
   ```typescript
   private formatTextForTelegram(content: string): string {
     // Проверка на наличие незакрытых тегов и корректное форматирование
     // ...
   }
   ```

2. Добавьте дополнительные проверки HTML-разметки перед отправкой:
   ```typescript
   // Проверка на баланс открывающих и закрывающих тегов
   const openTags = (formattedText.match(/<([a-z]+)[^>]*>/gi) || []);
   const closeTags = (formattedText.match(/<\/([a-z]+)>/gi) || []);
   
   if (openTags.length !== closeTags.length) {
     // Исправление незакрытых тегов или удаление HTML-разметки
   }
   ```

3. При возникновении ошибок с HTML-тегами предусмотрите отправку текста без форматирования как запасной вариант:
   ```typescript
   if (errorDescription.includes('Can\'t parse entities')) {
     // Удаляем все HTML-теги и отправляем обычный текст
     const plainText = text.replace(/<[^>]*>/g, '');
     // ...
   }
   ```

### 3. Ошибка отсутствия настроек Telegram

#### Симптомы:
```
Ошибка публикации в Telegram: отсутствуют настройки кампании. Token: отсутствует, ChatID: отсутствует
```

#### Причина:
Отсутствуют или некорректно заданы параметры подключения к Telegram API:
- Токен бота (token)
- ID чата или канала (chatId)

#### Решение:
1. Проверьте наличие и корректность настроек в базе данных:
   ```sql
   SELECT * FROM social_media_settings 
   WHERE campaign_id = 'YOUR_CAMPAIGN_ID' AND 
   (telegram_token IS NULL OR telegram_chat_id IS NULL);
   ```

2. Добавьте в интерфейсе приложения валидацию полей настроек Telegram:
   - Проверка формата токена (должен содержать `:`)
   - Проверка формата chatId (должен быть числом или начинаться с `@`)

3. В коде проверяйте настройки перед публикацией:
   ```typescript
   if (!telegramSettings || !telegramSettings.token || !telegramSettings.chatId) {
     return {
       platform: 'telegram',
       status: 'failed',
       publishedAt: null,
       error: 'Отсутствуют настройки для Telegram (токен или ID чата)'
     };
   }
   ```

### 4. Проблемы с форматированием ID чата

#### Симптомы:
Ошибки вида:
```
Bad Request: chat not found
```

#### Причина:
Неправильный формат ID чата:
- Для супергрупп и каналов ID должен начинаться с `-100`
- Для приватных групп ID должен начинаться с `-`
- Для каналов с именем пользователя нужно использовать `@username`

#### Решение:
1. В коде правильно форматируйте ID чата:
   ```typescript
   let formattedChatId = chatId;
   
   // Если это имя пользователя без @, добавляем @
   if (!formattedChatId.startsWith('@') && !formattedChatId.match(/^-?\d+$/)) {
     formattedChatId = `@${formattedChatId}`;
   }
   // Для числовых ID групп/каналов проверяем формат
   else if (!formattedChatId.startsWith('-100') && formattedChatId.startsWith('-')) {
     formattedChatId = `-100${formattedChatId.substring(1)}`;
   }
   // Для ID каналов без префикса
   else if (!isNaN(Number(formattedChatId)) && formattedChatId.length >= 10) {
     formattedChatId = `-100${formattedChatId}`;
   }
   ```

2. Добавьте дополнительную проверку существования чата через API:
   ```typescript
   try {
     const chatInfoResponse = await axios.get(`https://api.telegram.org/bot${token}/getChat`, {
       params: { chat_id: formattedChatId }
     });
     
     if (chatInfoResponse.status === 200) {
       // Чат найден
       log(`Найден чат: ${JSON.stringify(chatInfoResponse.data.result)}`);
     }
   } catch (error) {
     // Чат не найден или ошибка доступа
     log(`Ошибка проверки чата: ${error.message}`);
   }
   ```

## Логирование для диагностики

Для улучшения диагностики проблем добавьте детальное логирование всех этапов публикации:

```typescript
// Перед публикацией
log(`Начало публикации в Telegram для контента ID: ${content.id}`, 'social-publishing');
log(`Параметры публикации: токен=${token.substring(0, 6)}..., chatId=${chatId}`, 'social-publishing');

// При форматировании текста
log(`Исходный текст (${content.content.length} символов): ${content.content.substring(0, 50)}...`, 'social-publishing');
log(`Отформатированный текст (${formattedText.length} символов): ${formattedText.substring(0, 50)}...`, 'social-publishing');

// При отправке запросов к API
log(`Отправка запроса к API Telegram: ${endpoint}`, 'social-publishing');
log(`Тело запроса: ${JSON.stringify(messageBody)}`, 'social-publishing');

// При получении ответа
log(`Ответ API Telegram: ${JSON.stringify(response.data)}`, 'social-publishing');
```

## Тестирование публикации

Для проверки корректности публикации в Telegram без изменения основного кода, создайте тестовый скрипт:

```typescript
// test-telegram-post.ts
import axios from 'axios';

async function testTelegramPost() {
  const token = 'YOUR_BOT_TOKEN';
  const chatId = 'YOUR_CHAT_ID';
  const baseUrl = `https://api.telegram.org/bot${token}`;
  
  // Тест 1: Отправка простого текстового сообщения
  try {
    const textResponse = await axios.post(`${baseUrl}/sendMessage`, {
      chat_id: chatId,
      text: 'Тестовое сообщение от скрипта проверки'
    });
    console.log('Результат отправки текста:', textResponse.data);
  } catch (error) {
    console.error('Ошибка отправки текста:', error.response?.data || error.message);
  }
  
  // Тест 2: Отправка изображения с подписью
  try {
    const imageResponse = await axios.post(`${baseUrl}/sendPhoto`, {
      chat_id: chatId,
      photo: 'https://example.com/image.jpg',
      caption: 'Тестовая подпись к изображению'
    });
    console.log('Результат отправки изображения:', imageResponse.data);
  } catch (error) {
    console.error('Ошибка отправки изображения:', error.response?.data || error.message);
  }
}

testTelegramPost().catch(console.error);
```

## Рекомендации по настройке API Telegram

1. **Создание бота:**
   - Используйте BotFather (@BotFather) в Telegram для создания нового бота
   - Получите токен API и сохраните его в настройках приложения

2. **Доступ к каналу/группе:**
   - Добавьте бота как администратора канала/группы
   - Убедитесь, что у бота есть разрешения на публикацию сообщений

3. **Получение правильного ID канала/группы:**
   - Для публичных каналов/групп: используйте формат `@username`
   - Для приватных каналов/групп: получите числовой ID через API или используя бота @jsondumpbot

4. **Проверка прав доступа:**
   - Периодически проверяйте, что бот остается администратором канала
   - Тестируйте публикацию через API перед использованием в основном приложении
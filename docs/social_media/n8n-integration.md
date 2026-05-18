# Интеграция с n8n для автоматизации процессов

Данная документация описывает интеграцию системы SMM Manager с платформой n8n для автоматизации процессов сбора трендов и публикации контента.

## Обзор интеграции

n8n используется для двух основных процессов:
1. **Сбор трендов** - автоматический сбор информации на основе ключевых слов
2. **Публикация контента** - автоматизированная публикация в социальные сети

## Webhook URL

Основные URL для интеграции:
- **Сбор трендов:** `https://n8n.nplanner.ru/webhook/df4257a3-deb1-4c73-82ea-44deead48939`
- **Публикация:** `https://n8n.nplanner.ru/webhook/0b4d5ad4-00bf-420a-b107-5f09a9ae913c`

## Аутентификация в n8n webhook

Для доступа к n8n webhook необходимо добавить заголовок авторизации:

```
X-N8N-Authorization: API_KEY
```

Где API_KEY следует получить у администратора системы и хранить в переменных окружения.

## Процесс сбора трендов

### Формат запроса для сбора трендов:

```json
{
  "campaignId": "uuid-123",
  "keywords": ["ключевое слово 1", "ключевое слово 2"],
  "userId": "user-id"
}
```

### Формат ответа от n8n:

```json
{
  "success": true,
  "jobId": "job-123",
  "message": "Trend collection started"
}
```

### Процесс работы:

1. Приложение отправляет список ключевых слов на webhook
2. n8n запускает workflow для сбора трендов по каждому ключевому слову
3. Собранные тренды отправляются обратно через webhook `/api/trends/webhook`
4. Данные сохраняются в базе данных в таблице `campaign_trend_topics`

## Процесс публикации контента

### Формат запроса для публикации:

```json
{
  "contentId": "uuid-123",
  "campaignId": "uuid-456",
  "platforms": ["instagram", "telegram", "vk", "facebook"],
  "credentials": {
    "instagram": {
      "accessToken": "token-from-social-media-settings"
    },
    "telegram": {
      "token": "bot-token",
      "chatId": "chat-id"
    }
  },
  "content": {
    "instagram": {
      "caption": "Текст для Instagram...",
      "hashtags": ["тег1", "тег2"],
      "imageUrl": "https://example.com/image.jpg"
    },
    "telegram": {
      "caption": "Текст для Telegram...",
      "buttons": [{"text": "Подробнее", "url": "https://example.com"}]
    }
  },
  "scheduleTime": "2023-01-01T12:00:00Z"
}
```

### Формат ответа:

```json
{
  "success": true,
  "results": {
    "instagram": {
      "status": "published",
      "postId": "post-123",
      "postUrl": "https://instagram.com/p/123/"
    },
    "telegram": {
      "status": "published",
      "postId": "message-123"
    }
  }
}
```

### Обработка ошибок:

```json
{
  "success": false,
  "errors": {
    "instagram": {
      "message": "Invalid credentials",
      "code": 401
    }
  },
  "results": {
    "telegram": {
      "status": "published",
      "postId": "message-123"
    }
  }
}
```

## Обработка ошибок и повторные попытки

1. При временной недоступности n8n, система должна:
   - Логировать ошибку
   - Делать до 3 повторных попыток с экспоненциальной задержкой
   - Уведомлять пользователя через UI о проблеме
   
2. При ошибках публикации:
   - Обновлять статус публикации на `failed`
   - Сохранять информацию об ошибке в поле `error`
   - Предоставлять опцию повторной попытки в UI

## Диагностика проблем с подключением

Для диагностики проблем с подключением можно использовать:

```bash
# Проверка доступности сервера n8n
curl -I https://n8n.nplanner.ru

# Тестовый запрос к webhook
curl -X POST https://n8n.nplanner.ru/webhook/df4257a3-deb1-4c73-82ea-44deead48939 \
  -H "Content-Type: application/json" \
  -H "X-N8N-Authorization: API_KEY" \
  -d '{"test": true}'
```

## Важные примечания

- В случае недоступности n8n webhook, система должна продолжать функционировать, предоставляя базовый функционал
- Интеграции с социальными сетями требуют различных типов авторизации:
  - Instagram: OAuth token с соответствующими правами
  - Facebook: Page access token
  - Telegram: Bot token + chat ID
  - VK: Access token с правами на публикацию
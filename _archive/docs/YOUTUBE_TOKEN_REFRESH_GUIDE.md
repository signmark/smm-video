# YouTube Token Refresh N8N Workflow

## Описание
N8N workflow для автоматического обновления YouTube OAuth токенов по refresh токену. Workflow принимает запрос с refresh токеном, обращается к Google OAuth API, получает новый access токен и обновляет настройки кампании в Directus.

## Установка Workflow

1. Импортируйте файл `scripts/youtube/youtube-token-refresh-workflow.json` в N8N
2. Активируйте workflow
3. Настройте переменные окружения в N8N:
   - `YOUTUBE_CLIENT_ID` - Google OAuth Client ID
   - `YOUTUBE_CLIENT_SECRET` - Google OAuth Client Secret  
   - `DIRECTUS_URL` - URL Directus сервера
   - `DIRECTUS_TOKEN` - Admin токен Directus

## Webhook URL
```
POST https://n8n.roboflow.tech/webhook/youtube-refresh-token
```

## Формат запроса

### Обязательные поля
```json
{
  "refresh_token": "1//04...",
  "campaign_id": "46868c44-c6a4-4bed-accf-9ad07bba790e"
}
```

### Полный формат запроса
```json
{
  "client_id": "your-client-id",
  "client_secret": "your-client-secret", 
  "refresh_token": "1//04...",
  "campaign_id": "46868c44-c6a4-4bed-accf-9ad07bba790e",
  "directus_url": "https://directus.roboflow.tech",
  "directus_token": "admin-token",
  "current_settings": {
    "youtube": {
      "api_key": "existing-key",
      "channel_id": "existing-channel",
      "access_token": "old-token",
      "refresh_token": "refresh-token"
    }
  }
}
```

## Ответы Webhook

### Успешное обновление
```json
{
  "success": true,
  "message": "YouTube tokens updated successfully",
  "access_token": "ya29.a0...",
  "expires_in": 3599,
  "token_type": "Bearer"
}
```

### Ошибка обновления
```json
{
  "success": false,
  "error": "Token refresh failed",
  "details": {
    "error": "invalid_grant",
    "error_description": "Token has been expired or revoked."
  }
}
```

## Логика Workflow

1. **Webhook Start** - Принимает POST запрос на `/webhook/youtube-refresh-token`
2. **Debug Log** - Логирует входящие данные для отладки
3. **Google OAuth Token Refresh** - Отправляет запрос к Google OAuth API
4. **Check Token Success** - Проверяет успешность получения нового токена
5. **Update Campaign Tokens** - Обновляет токены в настройках кампании в Directus
6. **Success/Error Response** - Возвращает результат

## Автоматическое использование

### Интеграция в планировщик
```javascript
// В publish-scheduler.ts
async function refreshYouTubeToken(campaignId, refreshToken) {
  const response = await axios.post(`${process.env.N8N_URL}/webhook/youtube-refresh-token`, {
    refresh_token: refreshToken,
    campaign_id: campaignId
  });
  
  return response.data;
}

// Проверка перед публикацией
if (isTokenExpired(youtubeSettings.token_expires_at)) {
  await refreshYouTubeToken(campaignId, youtubeSettings.refresh_token);
}
```

### Планируемое обновление
Создайте дополнительный workflow для автоматического обновления токенов каждые 30 минут:

```json
{
  "nodes": [
    {
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.cron",
      "parameters": {
        "cronExpression": "*/30 * * * *"
      }
    },
    {
      "name": "Get Campaigns",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "url": "{{ $env.DIRECTUS_URL }}/items/user_campaigns",
        "headers": {
          "Authorization": "Bearer {{ $env.DIRECTUS_TOKEN }}"
        }
      }
    }
  ]
}
```

## Тестирование

Используйте скрипт `test-youtube-token-refresh.js`:

```bash
node test-youtube-token-refresh.js
```

Скрипт проверит:
- Доступность webhook
- Обработку тестовых данных
- Поиск реальных refresh токенов в кампаниях
- Обновление токенов с реальными данными

## Обработка ошибок

### Частые ошибки
1. **invalid_grant** - Refresh токен истек или отозван
2. **invalid_client** - Неверные client_id/client_secret
3. **400 Bad Request** - Неверный формат запроса

### Решения
1. Перепройти OAuth авторизацию для получения нового refresh токена
2. Проверить настройки Google Cloud Console
3. Проверить формат отправляемых данных

## Безопасность

- Refresh токены хранятся в зашифрованном виде в Directus
- Client secret передается через переменные окружения N8N
- Access токены автоматически истекают через 1 час
- Логи не содержат чувствительных данных (токены маскируются)

## Мониторинг

Workflow логирует следующие события:
- Входящие запросы (с маскированными токенами)
- Ответы Google OAuth API
- Обновления кампаний в Directus
- Ошибки и исключения

Проверяйте логи N8N для диагностики проблем с обновлением токенов.

---

## PostgreSQL Version (Рекомендуется)

Для более эффективной работы создана версия с прямым доступом к PostgreSQL базе данных.

### Файлы PostgreSQL версии
- `scripts/youtube/youtube-token-refresh-postgres.json` - Manual webhook
- `scripts/youtube/youtube-auto-refresh-postgres.json` - Automatic refresh

### Преимущества PostgreSQL версии
- **Прямой доступ к БД** - Быстрее чем Directus API
- **Автоматическое получение credentials** - Из таблицы `global_api_keys`
- **Улучшенная обработка ошибок** - Детальное логирование
- **Умное определение кампаний** - Автоматический поиск токенов требующих обновления

### Настройка PostgreSQL версии

1. **Импорт workflows**
   ```bash
   # Импортируйте в N8N:
   scripts/youtube/youtube-token-refresh-postgres.json
   scripts/youtube/youtube-auto-refresh-postgres.json
   ```

2. **Настройка PostgreSQL credentials в N8N**
   - Создайте PostgreSQL credential в N8N
   - ID: `lO4gl1E2I2lsrRce` (или обновите в workflow)

3. **Заполнение таблицы global_api_keys**
   ```sql
   INSERT INTO global_api_keys (service_name, api_key, api_secret) 
   VALUES ('YouTube', 'ваш_client_id', 'ваш_client_secret')
   ON CONFLICT (service_name) DO UPDATE SET 
     api_key = EXCLUDED.api_key,
     api_secret = EXCLUDED.api_secret;
   ```

### Упрощенный формат запроса (PostgreSQL)
```json
{
  "refresh_token": "1//04Axxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "campaign_id": "46868c44-c6a4-4bed-accf-9ad07bba790e"
}
```

### Автоматическое обновление (PostgreSQL)
- Запуск каждые 2 часа
- Автоматический поиск кампаний с YouTube интеграцией  
- Проверка токенов истекающих в течение часа
- Пакетное обновление всех найденных токенов

### Различия с Directus версией
| Функция | Directus API | PostgreSQL |
|---------|--------------|------------|
| Скорость | Медленно | Быстро |
| Credentials | Переменные окружения | База данных |
| Обработка ошибок | Базовая | Расширенная |
| Автодетект кампаний | Нет | Есть |

### Webhook URL (PostgreSQL)
```
POST https://your-n8n-domain/webhook/youtube-refresh-token
```

### Мониторинг PostgreSQL версии
- Логи показывают обработанные кампании
- Детальная информация об истечении токенов
- Статистика успешных/неудачных обновлений

PostgreSQL версия рекомендуется для production использования.
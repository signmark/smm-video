# Telegram Sessions Database Setup

## Обзор

Коллекция `telegram_sessions` предназначена для постоянного хранения сессий Telegram бота в Directus. Это позволяет:

- ✅ **Сохранять авторизацию** пользователей между перезапусками бота
- ✅ **Автоматически обновлять токены** через DirectusAuthManager
- ✅ **Восстанавливать сессии** после сбоев сервера
- ✅ **Хранить дополнительные данные** сессии (настройки, состояние)

## Создание коллекции в Directus

### Вариант 1: Через веб-интерфейс Directus

1. Откройте Directus Admin Panel
2. Перейдите в **Settings** → **Data Model**
3. Нажмите **Create Collection**
4. Настройте коллекцию:
   - **Collection Name**: `telegram_sessions`
   - **Icon**: `send` (иконка Telegram)
   - **Note**: "Telegram bot sessions storage"
   - **Display Template**: `{{chat_id}} - {{email}}`

5. Добавьте следующие поля:

| Field Name | Type | Interface | Options | Notes |
|------------|------|-----------|---------|-------|
| `id` | Integer | Input | Primary Key, Auto Increment | Авто ID |
| `chat_id` | Big Integer | Input | **Required**, **Unique** | Telegram chat ID |
| `user_id` | String | Input | | Directus user ID |
| `token` | Text | Input (Hash) | | Access token |
| `refresh_token` | Text | Input (Hash) | | Refresh token |
| `email` | String | Input | | User email |
| `first_name` | String | Input | | User first name |
| `last_name` | String | Input | | User last name |
| `session_data` | JSON | Code (JSON) | | Additional session data |
| `token_expires_at` | Timestamp | DateTime | | Token expiration time |
| `last_activity` | Timestamp | DateTime | | Last user activity |
| `created_at` | Timestamp | DateTime | Special: Date Created, Read-only | Session creation time |
| `updated_at` | Timestamp | DateTime | Special: Date Updated, Read-only | Last update time |

### Вариант 2: Через SQL (PostgreSQL)

Если у вас есть прямой доступ к PostgreSQL базе Directus, выполните:

```sql
-- Создание таблицы
CREATE TABLE telegram_sessions (
  id SERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL UNIQUE,
  user_id VARCHAR(255),
  token TEXT,
  refresh_token TEXT,
  email VARCHAR(255),
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  session_data JSONB,
  token_expires_at TIMESTAMP,
  last_activity TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Создание индексов для быстрого поиска
CREATE INDEX idx_telegram_sessions_chat_id ON telegram_sessions(chat_id);
CREATE INDEX idx_telegram_sessions_user_id ON telegram_sessions(user_id);
CREATE INDEX idx_telegram_sessions_last_activity ON telegram_sessions(last_activity);

-- Комментарии
COMMENT ON TABLE telegram_sessions IS 'Telegram bot sessions storage';
COMMENT ON COLUMN telegram_sessions.chat_id IS 'Telegram chat ID (unique)';
COMMENT ON COLUMN telegram_sessions.user_id IS 'Directus user ID';
COMMENT ON COLUMN telegram_sessions.token IS 'Access token';
COMMENT ON COLUMN telegram_sessions.refresh_token IS 'Refresh token';
COMMENT ON COLUMN telegram_sessions.session_data IS 'Additional session data (JSON)';
```

После создания таблицы вручную:
1. Перейдите в Directus Admin Panel
2. Обновите страницу (F5)
3. Коллекция появится в списке
4. Настройте права доступа для системного пользователя бота

## Настройка прав доступа

Убедитесь, что у системного пользователя (или Public role) есть права:

- ✅ **Create** - создание новых сессий
- ✅ **Read** - чтение сессий
- ✅ **Update** - обновление токенов
- ✅ **Delete** - удаление при logout

## Автоматическая очистка

Сервис автоматически удаляет сессии старше 30 дней без активности через метод `cleanupOldSessions()`.

Для автоматизации можно настроить cron job:

```javascript
// Пример: очистка раз в сутки
setInterval(async () => {
  await telegramSessionStorage.cleanupOldSessions();
}, 24 * 60 * 60 * 1000);
```

## Проверка работы

После создания коллекции перезапустите бот:

```bash
npm run dev
```

В логах должно появиться:
```
✅ Коллекция telegram_sessions доступна
```

Если коллекция недоступна:
```
⚠️  Коллекция telegram_sessions недоступна.
    Создайте коллекцию вручную в Directus для постоянного хранения сессий.
    Бот продолжит работу с временными сессиями в памяти.
```

## Мониторинг сессий

Для просмотра активных сессий в Directus:

1. Откройте коллекцию `telegram_sessions`
2. Отфильтруйте по `token` IS NOT NULL
3. Отсортируйте по `last_activity` DESC

## Технические детали

### Автосохранение сессий

Сессии автоматически сохраняются в БД в следующих случаях:

1. **При авторизации** - сразу после успешного login
2. **При выходе** - сессия удаляется из БД
3. **Периодически** - каждые 5 минут (фоновая синхронизация)

### Восстановление сессий

При запросе от пользователя бот:

1. Проверяет наличие сессии в памяти
2. Если нет - загружает из БД
3. Восстанавливает все данные (token, email, userId, и т.д.)

### Интеграция с DirectusAuthManager

- Токены автоматически обновляются через `directusAuthManager.refreshTokens()`
- Новые токены сохраняются в БД через `updateToken()`
- Поддерживается автопродление сессии как на веб-сайте

## Миграция существующих сессий

Если у вас уже есть активные пользователи бота, они должны:

1. Выполнить `/logout`
2. Выполнить `/login` заново

Их сессии будут сохранены в новую БД.

## Безопасность

- ✅ Токены хранятся в БД (рекомендуется шифрование на уровне БД)
- ✅ `session_data` использует JSONB для безопасного хранения
- ✅ Автоматическая очистка устаревших сессий
- ✅ Уникальный chat_id предотвращает дубликаты

## Troubleshooting

### Ошибка "Collection not found"

1. Проверьте название коллекции: `telegram_sessions`
2. Убедитесь, что коллекция видна в Directus Admin
3. Проверьте права доступа для системного пользователя

### Сессии не сохраняются

1. Проверьте логи на ошибки при сохранении
2. Убедитесь, что у пользователя есть права на создание/обновление
3. Проверьте подключение к Directus

### Сессии не восстанавливаются после перезапуска

1. Убедитесь, что коллекция доступна (проверьте стартовые логи)
2. Проверьте наличие записей в БД
3. Убедитесь, что `chat_id` совпадает

## Дополнительная информация

См. также:
- `server/services/telegram-session-storage.ts` - реализация сервиса
- `server/telegram-bot/index.ts` - интеграция в бота
- `server/telegram-bot/bot-launcher.ts` - проверка при запуске

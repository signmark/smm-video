# Защита от дублирования публикаций при работе нескольких серверов

## Проблема
При работе 2+ серверов с одной базой Directus возникают race conditions:
- Два сервера одновременно берут один контент для публикации
- Происходит дублирование постов в соцсетях
- Нарушается целостность данных

## Текущие механизмы защиты

### 1. Проверка статусов платформ
```javascript
// Проверка перед публикацией
const platformsData = content.social_platforms;
if (platformsData[platform]?.status === 'published') {
  log(`Платформа ${platform} уже опубликована для контента ${contentId}`);
  return; // Пропускаем
}
```

### 2. Atomic операции в Directus
- Обновление статуса через PATCH запросы
- Directus обеспечивает атомарность на уровне БД

### 3. Временные метки и проверки
```javascript
// Проверка времени публикации
if (content.published_at && new Date(content.published_at) > new Date(content.scheduled_at)) {
  log(`Контент ${contentId} уже опубликован`);
  continue;
}
```

## Рекомендуемые решения

### 1. Система блокировок (Реализована)
```javascript
// Перед публикацией
const lockAcquired = await publicationLockManager.acquireLock(contentId, platform);
if (!lockAcquired) {
  log(`Контент ${contentId} заблокирован другим сервером`);
  continue;
}

try {
  // Публикация
  await publishToPlatform(content, platform);
  await publicationLockManager.releaseLock(contentId, platform, 'completed');
} catch (error) {
  await publicationLockManager.releaseLock(contentId, platform, 'failed');
}
```

### 2. Уникальные идентификаторы серверов
```javascript
const serverId = `server_${process.env.REPL_ID || 'local'}_${Date.now()}`;
```

### 3. Очистка просроченных блокировок
```javascript
// Автоматическая очистка каждые 5 минут
setInterval(() => {
  publicationLockManager.cleanupExpiredLocks();
}, 5 * 60 * 1000);
```

## Структура таблицы блокировок

```sql
CREATE TABLE publication_locks (
    id VARCHAR(255) PRIMARY KEY,
    content_id UUID NOT NULL,
    server_id VARCHAR(255) NOT NULL,
    platform VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    
    UNIQUE KEY unique_active_lock (content_id, platform, status) 
    WHERE status = 'active'
);
```

## Алгоритм работы

### Шаг 1: Попытка блокировки
1. Сервер проверяет активные блокировки для `content_id + platform`
2. Если блокировка существует → пропускает публикацию
3. Если блокировки нет → создает новую блокировку

### Шаг 2: Публикация
1. Выполняет публикацию в соцсеть
2. Обновляет статус в Directus
3. Освобождает блокировку со статусом `completed`

### Шаг 3: Обработка ошибок
1. При ошибке освобождает блокировку со статусом `failed`
2. Просроченные блокировки (>5 минут) автоматически очищаются

## Мониторинг

### Логирование
```javascript
log(`Создана блокировка ${lockId} для контента ${contentId} на платформе ${platform}`, 'lock-manager');
log(`Контент ${contentId} уже заблокирован сервером ${existingLocks[0].server_id}`, 'lock-manager');
```

### Проверка активных блокировок
```sql
SELECT * FROM publication_locks 
WHERE status = 'active' 
AND expires_at > NOW();
```

## Преимущества решения

1. **Предотвращение дублирования** - только один сервер может публиковать контент
2. **Отказоустойчивость** - просроченные блокировки автоматически очищаются
3. **Прозрачность** - полное логирование всех операций
4. **Масштабируемость** - работает с любым количеством серверов

## Ограничения

1. Требует создания дополнительной таблицы в Directus
2. Небольшое увеличение времени публикации (~100ms на проверку блокировки)
3. Зависимость от часовых поясов серверов (использует UTC)

## Backup механизмы

Если система блокировок недоступна, работают резервные проверки:
1. Проверка статуса платформы в `social_platforms`
2. Сравнение времени `published_at` vs `scheduled_at`
3. Проверка наличия `postId` в данных платформы
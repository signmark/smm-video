# Instagram Stories API - Creation ID Requirements

## Проблема: "(#100) The parameter creation_id is required"

### Анализ ошибки Instagram API

Instagram Stories API требует двухэтапный процесс:

1. **Создание медиа контейнера** (`POST /{page-id}/media`)
   - Создает контейнер с `creation_id`
   - Загружает медиафайл
   - Возвращает `id` контейнера

2. **Публикация контента** (`POST /{creation-id}/publish`)  
   - Использует `creation_id` из первого шага
   - Публикует контент в Stories

### Правильный flow для Instagram Stories:

```javascript
// Шаг 1: Создание контейнера
POST https://graph.facebook.com/v18.0/{page-id}/media
{
  "video_url": "https://example.com/video.mp4",
  "media_type": "VIDEO",
  "published": false  // Не публиковать сразу
}
// Ответ: { "id": "creation_id_123" }

// Шаг 2: Публикация в Stories
POST https://graph.facebook.com/v18.0/{page-id}/media
{
  "creation_id": "creation_id_123",
  "published": true
}
```

### Что нужно исправить в N8N workflow:

1. **N8N должен реализовать двухэтапный процесс**
2. **Первый узел**: создание медиа контейнера
3. **Второй узел**: публикация с creation_id
4. **Обработка ошибок** на каждом этапе

### Альтернативное решение - прямая публикация:

```javascript
POST https://graph.facebook.com/v18.0/{page-id}/media  
{
  "video_url": "https://example.com/video.mp4",
  "media_type": "VIDEO", 
  "published": true  // Публиковать сразу
}
```

### Рекомендации для нашей системы:

1. Убедиться что N8N workflow правильно настроен для Instagram Stories
2. Проверить токены доступа Instagram
3. Возможно нужен отдельный workflow специально для Stories
4. Рассмотреть fallback на обычные посты если Stories не работают
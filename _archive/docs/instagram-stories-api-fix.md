# Instagram Stories API - Правильное решение

## Проблема в N8N workflow

Текущий workflow использует:
```
POST /v18.0/{account-id}/media_publish
{
  "creation_id": "123456"
}
```

## Правильное решение для Instagram Stories

Instagram Stories требует другой подход:

### Вариант 1: Прямая публикация (рекомендуется)
```
POST /v18.0/{account-id}/media
{
  "video_url": "https://example.com/video.mp4",
  "media_type": "STORIES",
  "published": true,
  "access_token": "token"
}
```

### Вариант 2: Двухэтапный процесс для Stories
```
// Шаг 1: Создание контейнера
POST /v18.0/{account-id}/media
{
  "video_url": "https://example.com/video.mp4", 
  "media_type": "STORIES",
  "published": false,
  "access_token": "token"
}

// Шаг 2: Публикация Stories (НЕ media_publish!)
POST /v18.0/{creation-id}
{
  "published": true,
  "access_token": "token"
}
```

## Ключевые отличия от обычных постов:

1. **media_type должен быть "STORIES"** (не "VIDEO")
2. **Для публикации используется POST /{creation-id}** (не /media_publish)
3. **access_token нужен в каждом запросе**

## Исправления для N8N workflow:

1. В "Create Story Container" изменить:
   - `media_type: "STORIES"` вместо "VIDEO"
   
2. В "Publish Story" изменить:
   - URL: `/{creation-id}` вместо `/{account-id}/media_publish`
   - Body: `{"published": true}` вместо `{"creation_id": "..."}`
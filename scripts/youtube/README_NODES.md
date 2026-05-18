# N8N Nodes для YouTube интеграции

## Описание нод

### 1. Fetch Content Data
**Тип:** HTTP Request  
**Назначение:** Загружает полные данные контента из Directus

**Параметры:**
- URL: `{DIRECTUS_URL}/items/campaign_content/{contentId}`
- Авторизация: Bearer token (DIRECTUS_TOKEN)
- Поля: `id,title,content,keywords,video_url,image_url,additional_images,video_thumbnail,campaign_id,content_type,scheduled_date,social_platforms,status,created_at,updated_at`

**Вход:** `{ contentId: "uuid" }`
**Выход:** Полные данные контента

### 2. Fetch Campaign Settings  
**Тип:** HTTP Request
**Назначение:** Загружает настройки кампании включая social_media_settings

**Параметры:**
- URL: `{DIRECTUS_URL}/items/user_campaigns/{campaign_id}`
- Авторизация: Bearer token (DIRECTUS_TOKEN)  
- Поля: `id,name,description,social_media_settings,global_api_keys,user_id,status,created_at`

**Вход:** campaign_id из предыдущей ноды
**Выход:** Настройки кампании с токенами всех платформ

### 3. Complete Data Preparation
**Тип:** Code/Function
**Назначение:** Обрабатывает и подготавливает все данные для YouTube API

**Обработка:**
- Извлекает YouTube токены из social_media_settings
- Формирует title, description, tags для YouTube
- Определяет URL обложки (video_thumbnail → additional_images[0] → image_url)
- Создает метаданные в формате YouTube API
- Валидирует наличие всех необходимых данных

**Выход:**
```json
{
  "contentId": "uuid",
  "campaignId": "uuid", 
  "videoUrl": "https://...",
  "thumbnailUrl": "https://...",
  "youtubeAccessToken": "ya29...",
  "youtubeRefreshToken": "1//...",
  "youtubeChannelId": "UC...",
  "youtubeMetadata": "{\"snippet\":{...},\"status\":{...}}",
  "title": "Заголовок видео",
  "description": "Описание видео",
  "tags": ["тег1", "тег2"]
}
```

## Использование в workflow

1. **Webhook получает:** `{ contentId: "uuid", platform: "youtube" }`
2. **Fetch Content Data** загружает данные контента
3. **Fetch Campaign Settings** загружает настройки кампании  
4. **Complete Data Preparation** обрабатывает все данные
5. Дальше используются подготовленные данные для загрузки видео и обложки

## Преимущества

- ✅ Один запрос загружает ВСЕ данные контента
- ✅ Автоматическое определение обложки из разных полей
- ✅ Валидация данных перед отправкой в YouTube
- ✅ Подготовленные метаданные в формате YouTube API
- ✅ Обработка keywords как массива или строки
- ✅ Полная информация о токенах и настройках
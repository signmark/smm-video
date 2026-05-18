# YouTube N8N Workflow Setup Guide

## Описание

Этот N8N workflow автоматизирует публикацию видео в YouTube через API. Workflow получает webhook от планировщика и публикует видео с автоматическим обновлением статусов в Directus.

## Возможности

✅ **Автоматическая загрузка видео** - скачивает видео по URL и загружает в YouTube  
✅ **Полная поддержка метаданных** - заголовок, описание, теги из контента  
✅ **Обработка миниатюр** - поддержка обложек видео  
✅ **Умная обработка ошибок** - определяет quota_exceeded и другие ошибки  
✅ **Автоматическое обновление статусов** - обновляет Directus с результатами  
✅ **OAuth2 авторизация** - использует access_token и refresh_token  

## Установка

### 1. Импорт workflow в N8N

1. Скопируйте содержимое файла `youtube-posting.json`
2. В N8N перейдите в раздел **Workflows**
3. Нажмите **Import from JSON**
4. Вставьте JSON и импортируйте

### 2. Настройка токенов

Замените `DIRECTUS_TOKEN_PLACEHOLDER` на актуальный токен:

1. Откройте workflow в редакторе
2. Найдите все узлы с `DIRECTUS_TOKEN_PLACEHOLDER`
3. Замените на реальный токен Directus

**Узлы для обновления:**
- Get Content Data
- Get Campaign Settings  
- Update Success Status
- Update Error Status

### 3. Настройка URL Directus

Обновите URL в узлах, если используете другой Directus:
- `https://directus.roboflow.tech/` → ваш URL

### 4. Активация webhook

1. Сохраните workflow
2. Активируйте его
3. Webhook URL будет: `https://n8n.nplanner.ru/webhook/publish-youtube`

## Архитектура workflow

### Этапы выполнения:

1. **Валидация входных данных**
   - Проверка contentId и platform
   
2. **Получение данных**
   - Загрузка данных контента из Directus
   - Загрузка настроек кампании с токенами YouTube
   
3. **Валидация YouTube данных**
   - Проверка наличия videoUrl
   - Проверка настроек YouTube OAuth
   
4. **Подготовка данных**
   - Формирование метаданных видео
   - Обработка тегов и описания
   
5. **Загрузка видео**
   - Скачивание видео файла
   - Загрузка в YouTube через API
   
6. **Обработка результатов**
   - Успех: сохранение postUrl и videoId
   - Ошибка: сохранение error и status
   
7. **Обновление Directus**
   - PATCH запрос с обновлением socialPlatforms
   - Возврат результата планировщику

## Формат данных

### Входные данные (webhook):
```json
{
  "contentId": "ea5a4482-8885-408e-9495-bca8293b7f85",
  "platform": "youtube"
}
```

### Выходные данные (success):
```json
{
  "success": true,
  "platform": "youtube", 
  "status": "published",
  "postUrl": "https://www.youtube.com/watch?v=VIDEO_ID",
  "videoId": "VIDEO_ID",
  "message": "Видео успешно опубликовано на YouTube"
}
```

### Выходные данные (error):
```json
{
  "success": false,
  "platform": "youtube",
  "status": "quota_exceeded", 
  "error": "Превышена квота YouTube API. Попробуйте позже.",
  "message": "Ошибка публикации на YouTube: ..."
}
```

## Обработка ошибок

### Квота YouTube API
Workflow автоматически определяет превышение квоты и устанавливает статус `quota_exceeded`.

### Отсутствие данных
Валидация проверяет:
- Наличие videoUrl в контенте
- Настройки YouTube OAuth в кампании
- Валидность access_token

### Ошибки загрузки
Все ошибки YouTube API логируются и передаются в Directus с детальным описанием.

## Требования к данным

### Контент (campaign_content):
- `videoUrl` - прямая ссылка на видео файл
- `title` - заголовок видео 
- `content` - описание видео
- `keywords` - теги (массив или строка)
- `videoThumbnail` или `additional_images[0]` - миниатюра

### Настройки кампании (social_media_settings.youtube):
- `access_token` - OAuth2 токен доступа
- `refresh_token` - OAuth2 токен обновления  
- `channel_id` - ID YouTube канала
- `apiKey` - YouTube API ключ

## Интеграция с планировщиком

Планировщик отправляет webhook при готовности контента к публикации:

```javascript
const webhookUrl = "https://n8n.nplanner.ru/webhook/publish-youtube";
const response = await axios.post(webhookUrl, {
  contentId: "ea5a4482-8885-408e-9495-bca8293b7f85",
  platform: "youtube"
});
```

## Мониторинг

### Логи N8N
Все этапы выполнения логируются в N8N с детальной информацией.

### Статусы в Directus
- `pending` → `published` (успех)
- `pending` → `failed` (ошибка)
- `pending` → `quota_exceeded` (превышена квота)

### Webhook ответы
Планировщик получает детальную информацию о результате публикации.

## Безопасность

- Все токены передаются через Authorization headers
- OAuth2 токены обновляются автоматически при необходимости
- Входные данные валидируются на каждом этапе

## Производительность

- Параллельная обработка не требуется (один видео файл)
- Таймауты настроены для больших видео файлов
- Автоматическая очистка временных файлов

Этот workflow обеспечивает надёжную и полностью автоматизированную публикацию видео в YouTube с полной интеграцией в экосистему SMM Manager.
# Руководство по интеграции видео-загрузок и универсальных медиа-полей

## Обзор архитектуры

В системе реализована универсальная архитектура для работы с медиа-контентом (изображения и видео) 
с учетом требований различных социальных платформ.

### Ключевые компоненты

1. **Поле `additional_media`** - универсальное JSON-поле в Directus для хранения медиа-файлов различных типов
2. **VideoUploader** - компонент для загрузки видео-файлов и работы с URL видео
3. **AdditionalMediaUploader** - универсальный компонент для управления набором медиа-файлов разных типов

## Структура данных

Поле `additional_media` имеет следующую структуру:

```typescript
interface MediaItem {
  url: string;
  type: 'image' | 'video';
  title?: string;
  description?: string;
}
```

## Проблемы и решения

### 1. Проблема авторизации при загрузке видео

**Проблема**: При загрузке видео через VideoUploader компонент сервер возвращал ошибку 401 (Unauthorized).

**Решение**:
- Добавить заголовок авторизации с токеном из localStorage к запросам загрузки видео
- Исправлено название переменной токена с `authToken` на `auth_token` для соответствия формату хранения в системе

```typescript
// До исправления
const token = localStorage.getItem('authToken');

// После исправления
const token = localStorage.getItem('auth_token');

// Добавление токена в заголовок запроса
const response = await axios.post('/api/beget-s3-video/upload', formData, {
  headers: {
    'Content-Type': 'multipart/form-data',
    'Authorization': token ? `Bearer ${token}` : ''
  }
});
```

### 2. Проблема обработки ответа API при загрузке

**Проблема**: Формат ответа от API сервера и ожидаемого компонентом формата различались:
- Компонент ожидал поле `url` в ответе 
- Сервер возвращал поле `videoUrl`

**Решение**: Улучшить код обработки для поддержки обоих вариантов ответа.

```typescript
// До исправления
if (response.data && response.data.success && response.data.url) {
  const videoUrl = response.data.url;
}

// После исправления
if (response.data && response.data.success && (response.data.url || response.data.videoUrl)) {
  const videoUrl = response.data.url || response.data.videoUrl;
}
```

### 3. Интеграция универсального загрузчика медиа

**Добавление компонента AdditionalMediaUploader в форму редактирования контента**:

```tsx
{/* Универсальное поле additional_media */}
<div className="mt-6 space-y-2 border-t pt-4">
  <div className="flex items-center justify-between">
    <Label htmlFor="additionalMedia">Универсальные медиа-файлы</Label>
    <Badge variant="outline" className="text-xs">Новое</Badge>
  </div>
  <AdditionalMediaUploader
    media={currentContent.additionalMedia || []}
    onChange={(media) => setCurrentContentSafe({...currentContent, additionalMedia: media})}
    label="Изображения и видео"
  />
  <p className="text-xs text-muted-foreground">
    Добавьте дополнительные изображения и видео для публикации в социальных сетях
  </p>
</div>
```

## Рекомендации и лучшие практики

1. **Стратегия обработки видео**: 
   - Использовать прямые URL к видео, где это возможно
   - Загружать в Beget S3 только когда это необходимо для платформ, которые не поддерживают прямые URL

2. **Обратная совместимость**:
   - Поддерживать устаревшие поля `additionalImages` и `additionalVideos` для обратной совместимости
   - Приоритизировать данные из нового универсального поля `additionalMedia`

3. **Безопасность**:
   - Токен авторизации следует получать из localStorage по ключу `auth_token`
   - Для всех защищенных API-эндпоинтов необходимо передавать заголовок `Authorization: Bearer <token>`

## Обработка ошибок и отладка

1. При проблемах с загрузкой видео проверять консоль браузера на наличие:
   - Ошибок CORS
   - Ошибок авторизации (код 401)
   - Ошибок формата запроса

2. Для тестирования загрузки видео можно использовать небольшие тестовые файлы (до 10MB).

## Интеграция с социальными платформами

1. Telegram поддерживает прямые видео-URL и видео-файлы, загруженные в Beget S3.
2. VK предпочитает работу через свой API загрузки для видео-файлов.
3. Instagram требует предварительной загрузки видео через Facebook Graph API.
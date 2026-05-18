# Инструкция по восстановлению критически важных функций

## 1. ИСПРАВЛЕНИЕ СОХРАНЕНИЯ ПРОМПТОВ ДЛЯ ИЗОБРАЖЕНИЙ

### Проблема
Промпты для изображений и ключевые слова не сохраняются при создании контента через генератор контент-планов.

### Файл: `server/routes.ts`

Найти endpoint `/api/campaign-content` (POST) и добавить поле `prompt`:

```javascript
app.post('/api/campaign-content', async (req, res) => {
  try {
    const { 
      content, 
      imageUrl, 
      videoUrl, 
      keywords, 
      hashtags,
      prompt,  // ← ДОБАВИТЬ ЭТО ПОЛЕ
      contentType,
      status,
      scheduledDate,
      selectedPlatforms,
      videoThumbnail,
      additionalImages,
      additionalVideos,
      metadata
    } = req.body;

    // В объекте для сохранения в Directus тоже добавить prompt:
    const campaignContentData = {
      content,
      image_url: imageUrl,
      video_url: videoUrl,
      keywords: Array.isArray(keywords) ? keywords : [],
      hashtags: Array.isArray(hashtags) ? hashtags : [],
      prompt,  // ← И ЗДЕСЬ ТОЖЕ
      content_type: contentType,
      status: status || 'draft',
      scheduled_date: scheduledDate,
      social_platforms: selectedPlatforms,
      video_thumbnail: videoThumbnail,
      additional_images: additionalImages || [],
      additional_videos: additionalVideos || [],
      metadata: metadata || {},
      campaign_id: campaignId,
      user_id: userId
    };
```

### Тестирование
После изменения проверить что промпты сохраняются в базу данных при создании контента.

## 2. ОЧИСТКА UI КАРТОЧЕК КОНТЕНТА

### Проблема
Лишние иконки загромождают интерфейс карточек контента.

### Файл: `client/src/pages/content/index.tsx`

#### Удалить кнопку Calendar (планирование):
Найти и удалить этот блок кода:
```javascript
<Button 
  variant="black" 
  size="sm"
  className="h-7 w-7 p-0"
  onClick={(e) => {
    e.stopPropagation();
    setCurrentContentSafe(content);
    setIsScheduleDialogOpen(true);
  }}
>
  <Calendar className="h-3.5 w-3.5" />
</Button>
```

#### Удалить кнопку Share (адаптация):
Найти и удалить этот блок кода:
```javascript
<Button 
  variant="black" 
  size="sm"
  className="h-7 w-7 p-0"
  onClick={(e) => {
    e.stopPropagation();
    setCurrentContentSafe(content);
    setIsAdaptDialogOpen(true);
  }}
>
  <Share className="h-3.5 w-3.5" />
</Button>
```

#### Обновить alt-текст кнопки публикации:
Найти кнопку с зеленой иконкой SendHorizontal и изменить:
```javascript
// БЫЛО:
title="Опубликовать сейчас"

// ДОЛЖНО БЫТЬ:
title="Опубликовать сейчас или запланировать публикацию"
```

### Результат
После изменений карточки контента должны содержать только:
- Кнопку редактирования (карандаш)
- Кнопку публикации (зеленая стрелка)
- Кнопку удаления (корзина)

## 3. ПРОВЕРКА РАБОТОСПОСОБНОСТИ

### После восстановления проверить:

1. **Сохранение промптов:**
   - Создать контент через генератор контент-планов
   - Проверить что поле `prompt` сохраняется в базе данных
   - Убедиться что ключевые слова тоже сохраняются

2. **Очищенный UI:**
   - Проверить что на карточках контента нет иконок Calendar и Share
   - Проверить что alt-текст кнопки публикации правильный
   - Убедиться что основные функции работают

3. **НЕ восстанавливать:**
   - НЕ добавлять пункт "Stories Canvas" в меню
   - НЕ возвращать удаленные иконки

## 4. ВАЖНЫЕ ДЕТАЛИ

- Изменения касаются только сохранения данных и UI
- Stories редактор остается доступен через контент типа "Instagram Stories"
- Все основные функции публикации сохраняются
- Изменения улучшают UX без потери функциональности

## 5. ПОРЯДОК ВОССТАНОВЛЕНИЯ

1. Сначала исправить `server/routes.ts` (сохранение промптов)
2. Затем очистить UI в `client/src/pages/content/index.tsx`
3. Протестировать обе функции
4. Обновить документацию replit.md

Эти изменения критически важны для пользователя и должны быть восстановлены в первую очередь.
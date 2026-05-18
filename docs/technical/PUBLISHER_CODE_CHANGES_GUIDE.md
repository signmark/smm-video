# Руководство по изменениям в коде планировщика публикаций

## Внесенные изменения

В ходе доработки планировщика публикаций были внесены следующие изменения:

### 1. Обработка платформ со статусом "scheduled"

**Файл**: `server/services/publish-scheduler.ts`  
**Метод**: `checkScheduledContent()`

```javascript
// Было:
// Сначала проверяем, есть ли платформы в статусе pending - это наивысший приоритет
for (const [platform, platformData] of Object.entries(content.socialPlatforms)) {
  // Если платформа выбрана и статус pending - публикуем НЕМЕДЛЕННО
  if (platformData?.selected === true && platformData?.status === 'pending') {
    logMessages.push(`${platform}: статус pending - ГОТОВ К НЕМЕДЛЕННОЙ ПУБЛИКАЦИИ`);
    anyPlatformPending = true;
    // Не прерываем цикл, чтобы увидеть все платформы в pending
  }
}
```

```javascript
// Стало:
// Сначала проверяем, есть ли платформы в статусе pending или scheduled - это наивысший приоритет
for (const [platform, platformData] of Object.entries(content.socialPlatforms)) {
  // Если платформа выбрана и статус pending - публикуем НЕМЕДЛЕННО
  if (platformData?.selected === true && platformData?.status === 'pending') {
    logMessages.push(`${platform}: статус pending - ГОТОВ К НЕМЕДЛЕННОЙ ПУБЛИКАЦИИ`);
    anyPlatformPending = true;
  }
  // Если платформа выбрана и статус scheduled - также готова к публикации
  if (platformData?.selected === true && platformData?.status === 'scheduled') {
    logMessages.push(`${platform}: статус scheduled - ГОТОВ К ЗАПЛАНИРОВАННОЙ ПУБЛИКАЦИИ`);
    anyPlatformPending = true;
  }
}
```

### 2. Изменение условий обновления статуса контента

**Файл**: `server/services/publish-scheduler.ts`  
**Метод**: `checkAndUpdateContentStatuses()`

```javascript
// Было:
// Проверяем условия для обновления статуса
const allSelectedPublishedOrFailed = selectedPlatforms.length === (publishedPlatforms.length + failedPlatforms.length);
const atLeastOnePublished = publishedPlatforms.length > 0;

// Обновляем статус только если все выбранные платформы достигли финального статуса (published или failed)
// И при этом хотя бы одна платформа была успешно опубликована
if (allSelectedPublishedOrFailed && atLeastOnePublished) {
  log(`Контент ${item.id}: опубликовано ${publishedPlatforms.length}/${selectedPlatforms.length} платформ, ожидает публикации: ${pendingPlatforms.length}`, 'scheduler');
  log(`Обновление основного статуса контента ${item.id} на "published" после публикации во всех платформах или в отсутствии запланированных платформ`, 'scheduler');
```

```javascript
// Стало:
// Проверяем условия для обновления статуса
// Обновляем статус ТОЛЬКО если ВСЕ выбранные платформы имеют статус published
// Статус error игнорируем и не меняем основной статус контента
const allSelectedPublished = selectedPlatforms.length === publishedPlatforms.length && selectedPlatforms.length > 0;

// Если есть ошибки в публикации, логируем их
if (failedPlatforms.length > 0) {
  log(`Контент ${item.id}: обнаружены платформы с ошибками (${failedPlatforms.length} платформ: ${failedPlatforms.join(', ')})`, 'scheduler');
  log(`Статус контента ${item.id} НЕ будет изменен из-за наличия ошибок публикации`, 'scheduler');
}

// Обновляем статус ТОЛЬКО если все выбранные платформы опубликованы (все имеют статус published)
if (allSelectedPublished) {
  log(`Контент ${item.id}: все платформы опубликованы (${publishedPlatforms.length}/${selectedPlatforms.length})`, 'scheduler');
  log(`Обновление основного статуса контента ${item.id} на "published", так как все выбранные платформы опубликованы`, 'scheduler');
```

### 3. Дополнительная проверка контента с полностью опубликованными платформами (исправление TG+IG проблемы)

**Файл**: `server/services/publish-scheduler.ts`  
**Метод**: `checkScheduledContent()`

```javascript
// Добавлено в мае 2025:
// Специальный запрос для фикса проблемы с TG+IG
// Ищем контент со статусом 'scheduled', но у которого есть платформы
// Дополнительный запрос для контента с published платформами
log('Дополнительный запрос по контенту со статусом scheduled и платформами', 'scheduler');
const allPlatformsResponse = await axios.get(`${directusUrl}/items/campaign_content`, {
  headers,
  params: {
    filter: JSON.stringify({
      status: {
        _eq: 'scheduled'
      },
      social_platforms: {
        _nnull: true
      }
    }),
    limit: 100 // Получаем больше записей для лучшего охвата
  }
});

// Добавлена проверка, фильтрующая только контент со всеми опубликованными платформами
if (allPlatformsResponse?.data?.data) {
  // Фильтруем только те, у которых все платформы опубликованы
  const allPublishedItems = allPlatformsResponse.data.data.filter((item: any) => {
    // ... код проверки
    
    // Проверяем, что все платформы уже опубликованы
    const allPlatforms = Object.keys(platforms);
    const publishedPlatforms = [];
        
    let hasTelegram = false;
    let hasInstagram = false;
    let telegramPublished = false;
    let instagramPublished = false;
        
    // Проверяем каждую платформу
    for (const platform of allPlatforms) {
      const data = platforms[platform] || {};
      const status = data.status;
        
      // Проверка комбинации TG+IG
      if (platform === 'telegram') {
        hasTelegram = true;
        telegramPublished = (status === 'published');
      } else if (platform === 'instagram') {
        hasInstagram = true;
        instagramPublished = (status === 'published');
      }
        
      // Собираем все опубликованные платформы
      if (status === 'published') {
        publishedPlatforms.push(platform);
      }
    }
        
    // Проверяем условия
    const allPublished = allPlatforms.length > 0 && allPlatforms.length === publishedPlatforms.length;
    const isTgIgCombo = hasTelegram && hasInstagram && allPlatforms.length === 2 && 
                   telegramPublished && instagramPublished;
        
    return allPublished || isTgIgCombo;
  });
}
```

```javascript
// Обработка найденного контента напрямую обновляет статус без перепубликации:
if (allPublishedItems.length > 0) {
  log(`Найдено ${allPublishedItems.length} контентов со всеми опубликованными платформами, но статус все еще scheduled`, 'scheduler');
      
  // Обрабатываем обнаруженные контенты напрямую, только обновляя статус - без повторной публикации
  for (const item of allPublishedItems) {
    try {
      log(`Обновление статуса контента ${item.id} с 'запланирован' на 'опубликован'`, 'scheduler');
      
      // запрос на обновление статуса
      await axios.patch(`${directusUrl}/items/campaign_content/${item.id}`, {
        status: 'published',
        published_at: new Date().toISOString()
      }, { headers });
      
      log(`Успешно обновлен статус контента ${item.id} на 'published'`, 'scheduler');
    } catch (error) {
      log(`Ошибка при обновлении статуса контента ${item.id}: ${error instanceof Error ? error.message : 'Unknown error'}`, 'scheduler');
    }
  }
  
  // Не добавляем в общий список, чтобы избежать двойной публикации
  // allItems = allItems.concat(allPublishedItems);
}
```

## Ключевые моменты изменений

1. **Новое условие обновления статуса**:
   - Раньше: статус менялся, если все платформы достигли "published" или "failed", и хотя бы одна была "published"
   - Теперь: статус меняется **только** если все выбранные платформы имеют статус "published"

2. **Обработка ошибок публикации**:
   - Раньше: платформы с ошибками ("failed") считались завершенными
   - Теперь: при наличии ошибок ("failed") статус контента не меняется

3. **Обработка статуса "scheduled"**:
   - Раньше: платформы со статусом "scheduled" не обрабатывались специально
   - Теперь: платформы со статусом "scheduled" обрабатываются как готовые к публикации

4. **Исправление проблемы с TG+IG комбинацией**:
   - Раньше: контент с комбинацией TG+IG мог оставаться в статусе "scheduled" даже после публикации во все платформы
   - Теперь: добавлена специальная проверка для контента со статусом "scheduled", который имеет все опубликованные платформы
   - Специфический обработчик для комбинации TG+IG просто обновляет статус контента без повторной публикации

5. **Предотвращение дублирования постов**:
   - Проблема: при выполнении обновления статуса через общий список могли дублироваться посты
   - Решение: выполняется только PATCH запрос для обновления статуса контента без добавления в очередь публикации

## Интервалы проверки

Частота проверок изменена с 60 секунд на 20 секунд, что позволяет более оперативно обрабатывать публикации и обновлять статусы контента. Это особенно важно для быстрой реакции на изменение статусов платформ.

## Что нужно проверить после внедрения

1. Правильность обработки платформ со статусом "scheduled"
2. Корректность обновления статуса контента (только когда все платформы "published")
3. Правильность обработки ошибок публикации (статус контента не меняется)
4. Наличие и информативность логов по каждому действию системы
5. Корректное поведение для комбинации TG+IG - должно обновляться на "published" и не дублировать посты
6. Обработка всех платформ в поле social_platforms независимо от флага "selected"
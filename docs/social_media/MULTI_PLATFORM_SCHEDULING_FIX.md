# Исправление мультиплатформенного шедулинга

## Выявленные проблемы

1. **Критическая проблема #1: Преждевременное обновление статуса**
   - Система меняла общий статус контента на "published" когда публикация проходила хотя бы в ОДНУ из платформ (вместо ВСЕХ)
   - Из-за этого планировщик не продолжал публикации в остальные платформы
   
2. **Критическая проблема #2: Потеря данных о платформах**
   - При последовательной публикации в разные платформы данные уже опубликованных платформ могли перезаписываться

## Внесенные исправления

### 1. Исправление в `server/services/publish-scheduler.ts`

Первое исправление касается проверки статуса платформ в блоке `checkScheduledContent`. Изменен алгоритм определения статуса публикации:

**БЫЛО:**
```javascript
// Проверяем, есть ли хотя бы одна платформа со статусом published
const anyPublished = Object.values(socialPlatforms).some(
  (platform: any) => platform && platform.status === 'published'
);

if (anyPublished) {
  log(`ПРОВЕРКА В БД: Контент ID ${content.id} "${content.title}" уже имеет опубликованный статус в соцсетях, пропускаем`, 'scheduler');
  // Обновляем общий статус на published
  log(`Обновление общего статуса на published для контента ${content.id}`, 'scheduler');
  
  await axios.patch(
    `${directusUrl}/items/campaign_content/${content.id}`,
    { 
      status: 'published',
      published_at: new Date().toISOString()
    },
    { headers: { 'Authorization': `Bearer ${authToken}` } }
  );
  continue;
}
```

**СТАЛО:**
```javascript
// ИСПРАВЛЕНИЕ: Проверяем ВСЕ ли платформы имеют статус published
const allPlatforms = Object.keys(socialPlatforms);
const publishedPlatforms = Object.entries(socialPlatforms)
  .filter(([_, data]: [string, any]) => data && data.status === 'published')
  .map(([platform]) => platform);

// ИСПРАВЛЕНИЕ: Обновляем статус только когда ВСЕ платформы опубликованы
if (publishedPlatforms.length > 0 && publishedPlatforms.length === allPlatforms.length) {
  log(`ПРОВЕРКА В БД: Контент ID ${content.id} "${content.title}" опубликован ВО ВСЕХ (${publishedPlatforms.length}/${allPlatforms.length}) соцсетях, обновляем статус`, 'scheduler');
  // Обновляем общий статус на published
  log(`Обновление общего статуса на published для контента ${content.id}`, 'scheduler');
  
  await axios.patch(
    `${directusUrl}/items/campaign_content/${content.id}`,
    { 
      status: 'published',
      published_at: new Date().toISOString()
    },
    { headers: { 'Authorization': `Bearer ${authToken}` } }
  );
  continue;
} else if (publishedPlatforms.length > 0) {
  // Если опубликованы НЕ ВСЕ платформы - продолжаем публикацию остальных
  log(`ПРОВЕРКА В БД: Контент ID ${content.id} "${content.title}" опубликован только в ${publishedPlatforms.length}/${allPlatforms.length} соцсетях, продолжаем публикацию`, 'scheduler');
}
```

### 2. Аналогичное исправление в методе `publishContent`

Изменена логика блокировки публикации по проверке статуса:

**БЫЛО:**
```javascript
// Проверяем статус в социальных платформах
if (content.socialPlatforms && typeof content.socialPlatforms === 'object') {
  // Если хотя бы одна платформа имеет статус published, считаем контент опубликованным
  const anyPublished = Object.values(content.socialPlatforms).some(
    (platform: any) => platform && platform.status === 'published'
  );
  
  if (anyPublished) {
    log(`БЛОКИРОВКА: Контент ${content.id} уже имеет опубликованный статус в некоторых соцсетях, публикация остановлена`, 'scheduler');
    
    // Обновляем основной статус на published, если он ещё не установлен
    if (content.status !== 'published') {
      await storage.updateCampaignContent(content.id, {
        status: 'published'
      });
      log(`Обновлен глобальный статус контента ${content.id} на "published"`, 'scheduler');
    }
    
    return;
  }
}
```

**СТАЛО:**
```javascript
// Проверяем статус в социальных платформах
if (content.socialPlatforms && typeof content.socialPlatforms === 'object') {
  // ИСПРАВЛЕНИЕ: Проверяем все платформы на статус published
  const allPlatforms = Object.keys(content.socialPlatforms);
  const publishedPlatforms = Object.entries(content.socialPlatforms)
    .filter(([_, data]: [string, any]) => data && data.status === 'published')
    .map(([platform]) => platform);
  
  // Информирование о статусе публикации
  log(`Проверка статуса платформ: опубликовано ${publishedPlatforms.length} из ${allPlatforms.length}`, 'scheduler');
  
  // ИСПРАВЛЕНИЕ: Обновляем статус только если ВСЕ платформы опубликованы
  if (publishedPlatforms.length > 0 && publishedPlatforms.length === allPlatforms.length) {
    log(`БЛОКИРОВКА: Контент ${content.id} опубликован ВО ВСЕХ (${publishedPlatforms.length}/${allPlatforms.length}) соцсетях`, 'scheduler');
    
    // Обновляем основной статус на published, если он ещё не установлен
    if (content.status !== 'published') {
      await storage.updateCampaignContent(content.id, {
        status: 'published'
      });
      log(`Обновлен глобальный статус контента ${content.id} на "published"`, 'scheduler');
    }
    
    return;
  } else if (publishedPlatforms.length > 0) {
    // Если опубликованы не все платформы, выводим информацию и НЕ ПРЕРЫВАЕМ публикацию
    log(`ИНФО: Контент ${content.id} опубликован только в НЕКОТОРЫХ (${publishedPlatforms.length}/${allPlatforms.length}) соцсетях, продолжаем публикацию остальных`, 'scheduler');
  }
}
```

### 3. Проверка метода `updatePublicationStatus` в `BaseSocialService`

После анализа кода обнаружено, что метод `updatePublicationStatus` в `BaseSocialService` уже содержит правильную логику сохранения данных всех платформ. Он использует следующий подход:

```javascript
// Создаем новый объект, чтобы избежать мутаций
const mergedPlatforms = { ...currentPlatforms };

// Обновляем только данные для указанной платформы
mergedPlatforms[platform] = platformUpdateData;

// КРИТИЧЕСКАЯ ПРОВЕРКА: убедимся, что мы НЕ потеряли ни одну платформу
const updatedPlatforms = Object.keys(mergedPlatforms);

// ... проверка и восстановление потерянных платформ
if (existingPlatforms.length > updatedPlatforms.length) {
  // Восстанавливаем потерянные платформы
  for (const lostPlatform of existingPlatforms) {
    if (!mergedPlatforms[lostPlatform]) {
      mergedPlatforms[lostPlatform] = currentPlatforms[lostPlatform];
    }
  }
}
```

## Результаты тестирования

Проведено тестирование, которое подтвердило корректность внесенных изменений:

1. **Сценарий с публикацией в несколько платформ с разным временем:**
   - Публикация в Telegram была успешно выполнена в заданное время
   - Данные о публикации в Telegram сохранились при последующих операциях  
   - Публикация в ВКонтакте была успешно выполнена в своё заданное время
   - Статус общего контента изменился на "published" только после успешной публикации во все платформы

2. **Сохранность данных платформ:**
   - При публикации в ВКонтакте данные о публикации в Telegram не были утеряны
   - Каждая платформа сохраняет свои специфические данные (postId, postUrl и т.д.)

## Заключение

Внесенные изменения исправляют критические проблемы в работе планировщика публикаций:

1. Система теперь корректно определяет, нужно ли менять общий статус контента на "published" - только когда ВСЕ выбранные платформы опубликованы
2. Устранена проблема с преждевременным выходом из процесса публикации
3. Данные всех платформ корректно сохраняются (не перезаписываются при обновлении статуса отдельной платформы)

## Примечание

Instagram API требует отдельного исправления, но эта проблема не связана с логикой планировщика, а касается интеграции с Instagram API.
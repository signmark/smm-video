# Код изменений для миграции на n8n webhooks

## 1. Изменения в client/src/pages/content/index.tsx

Оригинальный код (строка 549):

```typescript
// Отправляем запрос на публикацию в социальные сети
return await apiRequest(`/api/content/${id}/publish-social`, { 
  method: 'POST',
  data: {
    // Передаем массив ключей платформ, а не объект
    platforms: Object.keys(socialPlatformsData)
  }
});
```

Код после изменений:

```typescript
// Определяем, какие платформы выбраны
const selectedPlatforms = Object.keys(socialPlatformsData);

// Массив для хранения результатов публикации
const publicationResults = [];

// Публикуем на каждую платформу отдельно через webhook
for (const platform of selectedPlatforms) {
  try {
    let webhookUrl = '';
    
    // Выбираем соответствующий webhook URL для каждой платформы
    if (platform === 'telegram') {
      webhookUrl = 'https://n8n.nplanner.ru/webhook/publish-telegram';
    } else if (platform === 'vk') {
      webhookUrl = 'https://n8n.nplanner.ru/webhook/publish-vk';
    } else {
      // Для других платформ пока используем старый API
      continue;
    }
    
    console.log(`🚀 Публикация на ${platform} через webhook: ${webhookUrl}`);
    
    // Отправка через fetch с таймаутом
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        contentId: id
      })
    });
    
    const result = await response.json();
    console.log(`✅ Результат публикации на ${platform}:`, result);
    publicationResults.push({ platform, result });
  } catch (error) {
    console.error(`❌ Ошибка публикации на ${platform}:`, error);
    publicationResults.push({ 
      platform, 
      error: error instanceof Error ? error.message : 'Неизвестная ошибка' 
    });
  }
}

return publicationResults;
```

## 2. Шаги для внедрения изменений

1. Замените указанный выше код в файле `client/src/pages/content/index.tsx`
2. Проверьте, что файлы `server/api/telegram-webhook-direct.ts` и `server/api/vk-webhook-direct.ts` содержат правильные маршруты
3. Обновите `server/routes.ts` для правильной регистрации webhook маршрутов
4. Протестируйте публикацию контента

## 3. Требования к n8n workflows

- Все workflows должны обрабатывать входящие webhook запросы с параметром `contentId`
- Workflows должны самостоятельно получать данные контента из Directus API
- В случае ошибки workflows должны возвращать объект с полем `error`
- При успехе должен возвращаться объект с полями `success` и `url` (ссылка на публикацию)

## 4. Примечания по совместимости

Данные изменения не обеспечивают обратную совместимость с предыдущей версией API. Все клиенты должны быть обновлены для использования новых webhook endpoints.
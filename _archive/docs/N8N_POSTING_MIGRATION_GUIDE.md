# Миграция на полный постинг через N8N

## Шаг 1: Сброс проекта к стабильному коммиту

```bash
# Сохранить текущие изменения (если нужно)
git stash

# Сбросить к коммиту aa323e94ac1ced06342c910f4759ddeab2f9157f
git reset --hard aa323e94ac1ced06342c910f4759ddeab2f9157f

# Принудительно обновить удаленный репозиторий (ОСТОРОЖНО!)
git push --force-with-lease
```

## Шаг 2: Архитектура N8N постинга

### Принцип работы:
1. **Планировщик** отправляет только `contentId` и `platform` в N8N webhook
2. **N8N** получает данные контента и кампании из Directus
3. **N8N** обрабатывает контент и публикует в соцсети
4. **N8N** обновляет статус публикации в Directus
5. **N8N** возвращает результат планировщику

### Преимущества:
- Единообразная архитектура для всех платформ
- Централизованная обработка ошибок в N8N
- Простое масштабирование
- Легкая отладка и мониторинг

## Шаг 3: Модификация планировщика

### 3.1 Максимальное упрощение publish-scheduler.ts

Планировщик только отправляет webhooks в N8N. Получает только статус 200:

```typescript
// server/services/publish-scheduler.ts

async function publishToSocialMedia(contentId: string, platform: string): Promise<boolean> {
  const webhookUrl = `${process.env.N8N_URL}/webhook/publish-${platform}`;
  
  try {
    console.log(`[scheduler] Отправка ${platform}: contentId=${contentId}`);
    
    const response = await axios.post(webhookUrl, {
      contentId,
      platform
    }, { timeout: 10000 });

    if (response.status === 200) {
      console.log(`✅ N8N принял задачу ${platform}: contentId=${contentId}`);
      return true;
    }
    return false;
    
  } catch (error) {
    console.error(`❌ Ошибка webhook ${platform}:`, error.message);
    return false;
  }
}

// Публикация с показом тоста после отправки всех webhooks
async function publishContent(contentId: string, selectedPlatforms: string[]): Promise<{success: boolean, message: string}> {
  const results = [];
  
  for (const platform of selectedPlatforms) {
    const success = await publishToSocialMedia(contentId, platform);
    results.push({platform, success});
  }
  
  const successCount = results.filter(r => r.success).length;
  const totalCount = results.length;
  
  if (successCount === totalCount) {
    return {
      success: true, 
      message: `Контент отправлен в N8N для публикации на ${totalCount} платформах`
    };
  } else if (successCount > 0) {
    return {
      success: true,
      message: `Контент отправлен в N8N для ${successCount} из ${totalCount} платформ`
    };
  } else {
    return {
      success: false,
      message: 'Ошибка отправки во все платформы'
    };
  }
}

// Планировщик работает только с запланированным контентом
async function processScheduledContent() {
  const scheduledContent = await getScheduledContent();
  
  for (const content of scheduledContent) {
    const platforms = getReadyPlatforms(content);
    
    for (const platform of platforms) {
      await publishToSocialMedia(content.id, platform);
    }
  }
}
```

### 3.2 Удаление прямых сервисов соцсетей

Удалить папку `server/services/social/` с файлами:
- `facebook-service.ts`
- `vk-service.ts` 
- `telegram-service.ts`
- `instagram-service.ts`

### 3.3 Очистка routes.ts

Удалить все эндпоинты прямого постинга в соцсети, оставить только:
- Валидацию токенов
- Управление настройками кампаний
- Основные API методы

## Шаг 4: N8N Workflows

### 4.1 Структура workflow для каждой платформы

Каждый workflow включает:

1. **Webhook Trigger** - получение `contentId` и `platform`
2. **Directus Content Node** - получение данных контента
3. **Directus Campaign Node** - получение настроек кампании
4. **Content Processing** - обработка HTML, изображений
5. **Platform API Node** - публикация в соцсеть
6. **Directus Update Nodes** - обновление статусов платформы и контента
7. **Error Handling** - обработка ошибок с записью в Directus

### Обновление статусов в N8N

N8N полностью управляет статусами:
- При успешной публикации: обновляет `social_platforms[platform]` на `published` с `postUrl`
- При ошибке: обновляет `social_platforms[platform]` на `error` с деталями
- Проверяет все платформы контента и обновляет общий `status` контента
- Если все платформы опубликованы: `status = "published"`
- Если есть ошибки: `status = "error"` или `status = "partial"`

### Webhook URLs

N8N webhooks для каждой платформы:
- Facebook: `https://n8n.roboflow.tech/webhook/publish-facebook`
- VK: `https://n8n.roboflow.tech/webhook/publish-vk`
- Telegram: `https://n8n.roboflow.tech/webhook/publish-telegram`
- Instagram: `https://n8n.roboflow.tech/webhook/publish-instagram`

## Шаг 5: Переменные окружения

### 5.1 Обновление .env

```env
# Основные URL
DIRECTUS_URL=https://directus.roboflow.tech
N8N_URL=https://n8n.roboflow.tech

# N8N Webhook URLs (автоматически формируются)
# https://n8n.roboflow.tech/webhook/publish-facebook
# https://n8n.roboflow.tech/webhook/publish-vk  
# https://n8n.roboflow.tech/webhook/publish-telegram
# https://n8n.roboflow.tech/webhook/publish-instagram
```

### 5.2 Удаление прямых API ключей

Удалить из .env все прямые ключи соцсетей:
- ~~FACEBOOK_ACCESS_TOKEN~~
- ~~VK_ACCESS_TOKEN~~ 
- ~~TELEGRAM_BOT_TOKEN~~
- ~~INSTAGRAM_ACCESS_TOKEN~~

Все токены хранятся в Directus в настройках кампаний.

## Шаг 6: Настройка N8N

### 6.1 Credentials в N8N

Создать credential для Directus:
- **Name**: `directus-main`
- **URL**: `https://directus.roboflow.tech`
- **Token**: Админский токен Directus

### 6.2 Импорт workflows

1. Скачать workflow файлы из проекта
2. В N8N: Settings → Import from file
3. Импортировать каждый workflow
4. Настроить Directus credentials
5. Активировать workflows

## Шаг 7: Тестирование

### 7.1 Проверка каждой платформы

```bash
# Тест Facebook
curl -X POST https://n8n.roboflow.tech/webhook/publish-facebook \
  -H "Content-Type: application/json" \
  -d '{"contentId": "test-id", "platform": "facebook"}'

# Тест VK
curl -X POST https://n8n.roboflow.tech/webhook/publish-vk \
  -H "Content-Type: application/json" \
  -d '{"contentId": "test-id", "platform": "vk"}'
```

### 7.2 Мониторинг

- Логи N8N для отладки
- Логи планировщика для статусов
- Проверка обновлений в Directus

## Шаг 8: Преимущества новой архитектуры

✅ **Единообразность**: Все платформы работают одинаково
✅ **Централизация**: Вся логика постинга в N8N
✅ **Масштабируемость**: Легко добавлять новые платформы
✅ **Отладка**: Визуальная отладка в N8N
✅ **Мониторинг**: Встроенные метрики N8N
✅ **Надежность**: Retry механизмы N8N
✅ **Безопасность**: API ключи только в N8N/Directus

## Шаг 9: API эндпоинт для мгновенной публикации

Добавить в `server/routes.ts` эндпоинт для публикации с тостом:

```typescript
// Мгновенная публикация контента через N8N
app.post('/api/content/:contentId/publish', async (req, res) => {
  try {
    const { contentId } = req.params;
    const { platforms } = req.body; // массив выбранных платформ
    
    const result = await publishContent(contentId, platforms);
    
    res.json(result);
  } catch (error) {
    console.error('Ошибка публикации:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера при публикации'
    });
  }
});
```

Использование во фронтенде:

```typescript
// Вызов публикации с показом тоста
const publishNow = async (contentId: string, selectedPlatforms: string[]) => {
  try {
    const response = await fetch(`/api/content/${contentId}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platforms: selectedPlatforms })
    });
    
    const result = await response.json();
    
    if (result.success) {
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
  } catch (error) {
    toast.error('Ошибка при отправке в N8N');
  }
};
```

## Шаг 10: Полное удаление старого кода

После сброса к коммиту aa323e94ac1ced06342c910f4759ddeab2f9157f удалить:

```bash
# Удалить прямые сервисы соцсетей
rm -rf server/services/social/

# Удалить маршруты прямого постинга  
# В server/routes.ts убрать все /api/social/* эндпоинты

# Упростить планировщик до webhook-only логики
# В server/services/publish-scheduler.ts оставить только отправку в N8N
```

## Результат

Архитектура после миграции:
- **Планировщик**: Только отправка webhooks в N8N
- **N8N**: Публикация + обновление статусов  
- **Directus**: Хранение данных + настроек
- **Статусы**: Полностью управляются N8N

Преимущества:
- Единообразная обработка всех платформ
- Централизованная логика публикации  
- Визуальная отладка workflow в N8N
- Простое добавление новых платформ
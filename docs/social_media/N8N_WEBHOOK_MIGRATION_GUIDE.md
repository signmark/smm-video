# Руководство по миграции на n8n webhooks

## Общая информация

В текущей версии SMM Manager происходит переход с прямых API вызовов на систему webhook-ов через n8n для публикации контента в социальных сетях. Это упрощает процесс публикации и повышает надежность системы.

## Основные изменения

Вместо того, чтобы передавать все данные для публикации через API, мы переходим на упрощенную модель, где необходимо только передать ID контента (contentId) в n8n webhook, а вся логика по получению контента, настроек и публикации происходит на стороне n8n workflows.

## Адреса webhook endpoints

### Ключевые URL для интеграции:

- **Telegram**: `https://n8n.nplanner.ru/webhook/publish-telegram`
- **ВКонтакте**: `https://n8n.nplanner.ru/webhook/publish-vk`

## Инструкция по миграции

### 1. Обновление кода фронтенда

#### Изменение SocialPublishingPanel.tsx

Откройте `client/src/components/SocialPublishingPanel.tsx` и замените API вызовы на webhook вызовы:

```typescript
// БЫЛО:
return await apiRequest(`/api/content/${id}/publish-social`, { 
  method: 'POST',
  data: {
    platforms: Object.keys(socialPlatformsData)
  }
});

// СТАЛО:
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

#### Изменение content/index.tsx

Найдите функцию публикации в `client/src/pages/content/index.tsx` и также обновите её:

```typescript
// Найдите эту строку (примерно линия 549)
return await apiRequest(`/api/content/${id}/publish-social`, { 
  method: 'POST',
  data: {
    platforms: Object.keys(socialPlatformsData)
  }
});

// И замените её на код для использования webhooks, как показано выше
```

### 2. Проверка серверных маршрутов

Убедитесь, что серверные маршруты для webhook настроены правильно:

```typescript
// Маршруты webhook в server/routes.ts
app.use('/api/webhook/publish-telegram', telegramWebhookRoutes);
app.use('/api/webhook/publish-vk', vkWebhookRoutes);
```

### 3. Настройка маршрутов webhook на сервере

Создайте или обновите файлы webhook маршрутов:

#### server/api/telegram-webhook-direct.ts
```typescript
import { Router } from 'express';
import fetch from 'node-fetch';
import log from '../utils/logger';

const router = Router();

// Маршрут для прямой публикации в Telegram через n8n webhook
router.post('/', async (req, res) => {
  try {
    const { contentId } = req.body;
    
    if (!contentId) {
      return res.status(400).json({ error: 'Не указан ID контента' });
    }
    
    // URL до webhook n8n для публикации в Telegram
    const webhookUrl = 'https://n8n.nplanner.ru/webhook/publish-telegram';
    
    log.info(`[Telegram Webhook] Отправка запроса на публикацию контента ${contentId} в Telegram`);
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ contentId }),
    });
    
    const result = await response.json();
    
    log.info(`[Telegram Webhook] Ответ от webhook: ${JSON.stringify(result)}`);
    
    return res.json(result);
  } catch (error) {
    log.error(`[Telegram Webhook] Ошибка: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
    return res.status(500).json({ error: 'Ошибка при публикации в Telegram' });
  }
});

export default router;
```

#### server/api/vk-webhook-direct.ts
```typescript
import { Router } from 'express';
import fetch from 'node-fetch';
import log from '../utils/logger';

const router = Router();

// Маршрут для прямой публикации в ВКонтакте через n8n webhook
router.post('/', async (req, res) => {
  try {
    const { contentId } = req.body;
    
    if (!contentId) {
      return res.status(400).json({ error: 'Не указан ID контента' });
    }
    
    // URL до webhook n8n для публикации в ВКонтакте
    const webhookUrl = 'https://n8n.nplanner.ru/webhook/publish-vk';
    
    log.info(`[VK Webhook] Отправка запроса на публикацию контента ${contentId} в ВКонтакте`);
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ contentId }),
    });
    
    const result = await response.json();
    
    log.info(`[VK Webhook] Ответ от webhook: ${JSON.stringify(result)}`);
    
    return res.json(result);
  } catch (error) {
    log.error(`[VK Webhook] Ошибка: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
    return res.status(500).json({ error: 'Ошибка при публикации в ВКонтакте' });
  }
});

export default router;
```

### 4. Тестирование миграции

После внесения всех изменений, проведите следующие тесты:

1. Авторизуйтесь в системе.
2. Перейдите к существующему контенту или создайте новый.
3. Нажмите на кнопку публикации и выберите Telegram или ВКонтакте.
4. Проверьте логи консоли на наличие успешного ответа от webhook.
5. Проверьте фактическую публикацию в выбранной социальной сети.

### 5. Диагностика ошибок

Если возникают проблемы:

1. **Проверьте URL:** убедитесь, что URL адреса webhook настроены правильно.
2. **Проверьте параметры:** в теле запроса должен передаваться параметр `contentId` (не `content_id` или другой формат).
3. **Проверьте заголовки:** убедитесь, что в запросах установлены правильные заголовки `'Content-Type': 'application/json'`.
4. **Логи n8n:** проверьте логи n8n на наличие ошибок обработки webhook.
5. **CORS:** если возникают проблемы с CORS, настройте соответствующие заголовки на сервере.

## Преимущества использования webhook

1. **Упрощение API:** клиентский код теперь отправляет только ID контента.
2. **Разделение ответственности:** логика публикации полностью перенесена в n8n workflows.
3. **Масштабируемость:** легко добавлять новые социальные платформы без изменения клиентского кода.
4. **Надежность:** n8n предоставляет механизмы повторных попыток и логирования ошибок.
5. **Мониторинг:** через интерфейс n8n можно отслеживать выполнение workflow и диагностировать проблемы.

## Дополнительные ресурсы

- [Официальная документация n8n по webhooks](https://docs.n8n.io/workflows/executions/webhooks/)
- [Документация по API публикации в Telegram](https://core.telegram.org/bots/api#senddocument)
- [Документация по API публикации в ВКонтакте](https://dev.vk.com/method/wall.post)

## Контакты для поддержки

При возникновении проблем с интеграцией webhooks обращайтесь к администратору n8n системы или создайте issue в репозитории проекта.
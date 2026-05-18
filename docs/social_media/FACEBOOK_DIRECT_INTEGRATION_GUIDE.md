# Прямая интеграция с Facebook API

## Обзор

Этот документ описывает реализацию прямой интеграции с Facebook Graph API для публикации контента без использования n8n. Это решение было создано из-за ограничений n8n при работе с Facebook API и для обеспечения более стабильной публикации.

## Версии реализации

В проекте есть несколько версий интеграции с Facebook:

1. **facebook-webhook-v2.ts** - Первая версия прямой интеграции, использующая directusCrud
2. **facebook-webhook-v3.ts** - Улучшенная версия с более надежной аутентификацией и обработкой ошибок
3. **facebook-webhook-direct-test.ts** - Упрощенная тестовая версия для прямой публикации в Facebook без использования Directus

## Основные изменения в facebook-webhook-v3.ts

Новая реализация решает следующие проблемы:

1. **Надежная авторизация в Directus** - Используется прямой запрос к Directus API для авторизации, а не зависимость от directusCrud
2. **Прямые запросы к API** - Используются прямые HTTPS запросы вместо абстракций, что упрощает отладку
3. **Улучшенное логирование** - Подробное логирование каждого шага и деталей ошибок
4. **Резервные стратегии** - При ошибке с публикацией изображения/карусели, пробуется публикация текстового поста
5. **Обновление статуса** - Надежное обновление статуса публикации в Directus

## Процесс публикации

### Получение авторизации для Directus

```typescript
// Получаем токен администратора для работы с Directus
// Либо из существующих сессий
const sessions = directusAuthManager.getAllActiveSessions();
if (sessions.length > 0) {
  adminToken = sessions[0].token;
}
// Либо через прямую авторизацию
const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
const loginResponse = await axios.post(`${directusUrl}/auth/login`, {
  email: adminEmail,
  password: adminPassword
});
```

### Получение данных контента

```typescript
// Запрос к Directus API для получения контента
const contentResponse = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
  headers: {
    'Authorization': `Bearer ${adminToken}`
  }
});
```

### Получение настроек публикации

Настройки Facebook (токен пользователя и ID страницы) извлекаются из:
1. `campaign.settings.facebook` (основное место)
2. `campaign.social_media_settings.facebook` (альтернативное место)
3. Переменных окружения (запасной вариант)

### Публикация в Facebook

В зависимости от типа контента, используется одна из трех стратегий:

1. **Публикация карусели**:
   ```typescript
   const carouselResult = await publishCarousel(
     apiVersion, pageId, pageAccessToken, message, 
     imageUrl, additionalImages, content.title || 'Новый альбом'
   );
   ```

2. **Публикация с одним изображением**:
   ```typescript
   const imageResult = await publishImagePost(
     apiVersion, pageId, pageAccessToken, message, imageUrl
   );
   ```

3. **Публикация текстового поста**:
   ```typescript
   const textResult = await publishTextPost(
     apiVersion, pageId, pageAccessToken, message
   );
   ```

### Обновление статуса

После успешной публикации обновляется статус в Directus:

```typescript
// Обновляем статус Facebook
socialPlatforms.facebook = {
  ...(socialPlatforms.facebook || {}),
  status: 'published',
  publishedAt: new Date().toISOString(),
  permalink: permalink || ''
};

// Обновляем контент в Directus
await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
  social_platforms: socialPlatforms
}, {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
```

## Требуемые права для Facebook

Для работы интеграции токен Facebook должен иметь следующие права:
- pages_manage_posts
- pages_read_engagement

## Тестирование

Для тестирования интеграции создан скрипт `test-facebook-webhook-v3.mjs`, который отправляет запрос на публикацию существующего контента.

```bash
node test-facebook-webhook-v3.mjs
```

## Проблемы и решения

1. **Проблема с Directus аутентификацией** - Решена через прямые запросы к API и кеширование токенов
2. **Обработка ошибок API Facebook** - Добавлена расширенная обработка ошибок и запасные стратегии публикации
3. **Типы контента** - Поддержка различных типов контента (текст, изображение, карусель)
# Руководство по авторизации в SMM Manager

## КРИТИЧЕСКИ ВАЖНО: Всегда использовать пользовательские токены

### Принципы авторизации:
1. **НИКОГДА не использовать админские токены** из переменных окружения (DIRECTUS_ADMIN_TOKEN) для пользовательских запросов
2. **ВСЕГДА использовать directusAuthManager** для получения пользовательских токенов
3. **ВСЕГДА использовать токен пользователя** для всех запросов к Directus API от имени пользователя

### Правильная реализация получения токена:
```typescript
// ✅ ПРАВИЛЬНО - использовать directusAuthManager
const userToken = await directusAuthManager.getValidToken(userId);

// ❌ НЕПРАВИЛЬНО - использовать админский токен
const adminToken = process.env.DIRECTUS_ADMIN_TOKEN;
```

### Правильная реализация API запросов:
```typescript
// ✅ ПРАВИЛЬНО - использовать пользовательский токен
const response = await directusApi.get(`/items/campaigns/${campaignId}`, {
  headers: {
    'Authorization': `Bearer ${userToken}`,
    'Content-Type': 'application/json'
  }
});

// ❌ НЕПРАВИЛЬНО - использовать админский токен
const response = await directusApi.get(`/items/campaigns/${campaignId}`, {
  headers: {
    'Authorization': `Bearer ${process.env.DIRECTUS_ADMIN_TOKEN}`,
    'Content-Type': 'application/json'
  }
});
```

### Структура проекта - Авторизация:
- `directusAuthManager` - основной менеджер авторизации пользователей
- `directusApiManager` - устаревший менеджер, использовать только для обратной совместимости
- `directusCrud` - сервис для CRUD операций с Directus

### Типичные ошибки:
1. Использование админских токенов для пользовательских данных
2. Неправильное получение токена из directusAuthManager
3. Игнорирование проверки прав доступа пользователя

### Тестовые данные:
- Пользователь: lbrspb@gmail.com
- ID пользователя: 53921f16-f51d-4591-80b9-8caa4fde4d13
- Тестовая кампания: NPlanner.ru (https://nplanner.ru/)
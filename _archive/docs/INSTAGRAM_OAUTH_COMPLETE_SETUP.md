# Instagram OAuth Complete Setup Guide

## Обзор системы

Комплексная система авторизации Instagram через Facebook OAuth API с интеграцией N8N для обработки токенов и автоматического сохранения данных в базу.

## Архитектура решения

### Компоненты системы:

1. **Frontend Wizard** (`InstagramSetupWizardComplete.tsx`)
   - 4-шаговый пошаговый мастер настройки
   - Подробные инструкции по созданию Facebook приложения
   - Автоматический запуск OAuth flow
   - Интеграция с callback обработкой

2. **Backend OAuth Handler** (`instagram-oauth.ts`)
   - Создание authorization URL с proper scopes
   - Обмен кода на краткосрочный токен
   - Конвертация в долгосрочный токен (60 дней)
   - Получение информации о Instagram аккаунтах
   - Отправка данных в N8N webhook

3. **Callback Page** (`instagram-callback.tsx`)
   - Обработка OAuth ответа от Facebook
   - Отображение статуса авторизации
   - Показ найденных Instagram аккаунтов
   - Автоматическое закрытие окна

4. **N8N Workflow** (`instagram-oauth-workflow.json`)
   - Получение OAuth данных от backend
   - Сохранение в базу данных Directus
   - Возврат подтверждения об успешной обработке

## Установка и настройка

### 1. Frontend Integration

Wizard уже интегрирован в `SocialMediaSettings.tsx`:

```typescript
// Используется InstagramSetupWizardComplete в секции Instagram
<InstagramSetupWizard 
  campaignId={campaignId}
  instagramSettings={formData.instagram}
  onSettingsUpdate={handleInstagramUpdate}
/>
```

### 2. Backend Routes

Маршруты OAuth зарегистрированы в `server/index.ts`:

```javascript
// Instagram OAuth маршруты
const instagramOAuthRoutes = (await import('./routes/instagram-oauth')).default;
app.use('/api', instagramOAuthRoutes);
```

Доступные endpoints:
- `POST /api/instagram/auth/start` - Запуск OAuth flow
- `GET /api/instagram/auth/callback` - Обработка OAuth response
- `GET /api/instagram/auth/status/:state` - Проверка статуса сессии

### 3. Client Routes

Callback route добавлен в `App.tsx`:

```typescript
// OAuth callbacks
<Route path="/instagram-callback" component={InstagramCallback} />
```

### 4. N8N Workflow Setup

1. Импортируйте workflow из `scripts/instagram/instagram-oauth-workflow.json`
2. Настройте Directus credentials в N8N
3. Активируйте workflow
4. Убедитесь что webhook доступен: `https://n8n.roboflow.space/webhook/instagram-auth`

### 5. Database Schema

Создайте коллекцию `instagram_oauth_tokens` в Directus:

```sql
CREATE TABLE instagram_oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id VARCHAR(255) NOT NULL,
  instagram_id VARCHAR(255) NOT NULL,
  username VARCHAR(255),
  settings JSONB,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Использование системы

### Для пользователей:

1. Перейдите в настройки кампании → Социальные сети → Instagram
2. Откройте "Instagram API Setup Wizard"
3. Следуйте 4-шаговым инструкциям:
   - **Шаг 1**: Создание Facebook страницы и привязка Instagram
   - **Шаг 2**: Создание Facebook приложения
   - **Шаг 3**: Ввод App ID и App Secret
   - **Шаг 4**: OAuth авторизация и получение токенов

### Facebook App Configuration:

Требуемые настройки в Facebook Developers Console:

1. **App Type**: Business или Other
2. **Products**: Instagram Basic Display API
3. **Redirect URIs** (в настройках Facebook Login → Settings → Valid OAuth Redirect URIs): 
   - `https://smm.omemo.tech/facebook-callback`
   - `https://smm.omemo.tech/instagram-callback`
   
   ⚠️ **Важно:** Добавьте ОБА URL в настройки приложения!

⚠️ **ВАЖНО: Meta обновили интерфейс!** 

Разрешения теперь нужно добавлять вручную через Business Manager:
- Откройте https://business.facebook.com/
- Перейдите в настройки вашего приложения
- Вручную добавьте следующие права:

4. **Permissions** (добавлять вручную в Business Manager):
   - `ads_management`
   - `instagram_basic`
   - `instagram_manage_insights`
   - `instagram_content_publish`
   - `pages_read_engagement`
   - `pages_manage_posts`

## Тестирование

Используйте тестовый скрипт:

```bash
node test-instagram-oauth.js
```

Скрипт проверяет:
- Запуск OAuth flow
- Проверку статуса сессии
- N8N webhook обработку
- OAuth callback functionality

## Безопасность

### OAuth Flow Protection:
- Используется secure `state` parameter для защиты от CSRF
- Краткосрочные токены автоматически конвертируются в долгосрочные
- Все sensitive данные передаются через HTTPS
- Session data очищается после использования

### Token Management:
- Long-lived токены действуют 60 дней
- Автоматическое обновление токенов (планируется)
- Безопасное хранение в Directus с JSONB полями
- App Secret никогда не передается на frontend

## Архитектурные преимущества

1. **Модульность**: Каждый компонент независим и легко тестируется
2. **Scalability**: N8N обработка позволяет легко добавлять новую логику
3. **User Experience**: Пошаговый wizard упрощает сложный процесс настройки
4. **Error Handling**: Comprehensive error handling на всех уровнях
5. **Maintainability**: Четкое разделение между frontend, backend и workflow логикой

## Диагностика проблем

### Частые ошибки:

1. **"Invalid redirect URI"**
   - Проверьте настройки redirect URI в Facebook app
   - Убедитесь что домен совпадает с текущим

2. **"App ID not found"**
   - Проверьте правильность App ID в form
   - Убедитесь что приложение активно в Facebook

3. **"No Instagram accounts found"**
   - Instagram аккаунт должен быть Business аккаунтом
   - Instagram должен быть привязан к Facebook странице
   - У пользователя должен быть доступ к странице

4. **"N8N webhook error"**
   - Проверьте активность workflow в N8N
   - Убедитесь в правильности webhook URL
   - Проверьте Directus credentials в N8N

### Логирование:

Система использует comprehensive логирование:
- Frontend: Browser console для OAuth flow
- Backend: Server logs для API calls
- N8N: Workflow execution logs
- Directus: Database operation logs

## Планы развития

1. **Automatic Token Refresh**: Автоматическое обновление токенов до истечения
2. **Multiple Account Support**: Поддержка нескольких Instagram аккаунтов
3. **Advanced Error Recovery**: Retry механизмы для failed OAuth attempts  
4. **Analytics Integration**: Отслеживание успешности OAuth flows
5. **Admin Dashboard**: Управление OAuth токенами через admin интерфейс

## Заключение

Система предоставляет полноценное решение для Instagram OAuth авторизации с user-friendly интерфейсом и надежной backend обработкой. Готова к production использованию после настройки N8N workflow и создания необходимых database таблиц.
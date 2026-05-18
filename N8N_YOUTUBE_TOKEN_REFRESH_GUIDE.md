# YouTube Token Refresh в N8N - Полная инструкция

## Обзор

Этот документ описывает, как настроить автоматическое обновление YouTube OAuth токенов в N8N. YouTube access tokens истекают каждый час, поэтому нужен механизм их автоматического обновления через refresh token.

## 1. Создание Workflow для обновления токенов

### Название workflow: `YouTube Token Refresh`

### Узлы workflow:

#### 1.1 Webhook Trigger (Узел: Webhook)
- **URL**: `/webhook/youtube-refresh-token`
- **HTTP Method**: POST
- **Response**: Immediately
- **Options**: Return JSON response

**Входные данные:**
```json
{
  "campaignId": "46868c44-c6a4-4bed-accf-9ad07bba790e",
  "refreshToken": "1//05vtpMD2L6mM6CgYIARAAGAUSNwF-L9IrMdMT8CFmdeuT7SUk-5WqAOwC_nvu2h-2WxrwPfXcYZUvCT7rO-6p921etz8tbdwE0dU"
}
```

#### 1.2 HTTP Request (Узел: HTTP Request - Google OAuth)
- **URL**: `https://oauth2.googleapis.com/token`
- **Method**: POST
- **Body Type**: Form-Data
- **Body**:
  ```
  grant_type: refresh_token
  refresh_token: {{ $json.refreshToken }}
  client_id: {{ $env.GOOGLE_CLIENT_ID }}
  client_secret: {{ $env.GOOGLE_CLIENT_SECRET }}
  ```

#### 1.3 Function (Узел: Function - Process Token Response)
```javascript
// Обрабатываем ответ от Google OAuth API
const tokenResponse = items[0].json;

if (!tokenResponse.access_token) {
  throw new Error('Не удалось получить новый access token');
}

const expiresIn = tokenResponse.expires_in || 3600;
const expiresAt = Date.now() + (expiresIn * 1000);

return [{
  json: {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token || $input.first().json.refreshToken, // Используем старый, если новый не пришел
    expiresIn: expiresIn,
    expiresAt: expiresAt,
    campaignId: $input.first().json.campaignId
  }
}];
```

#### 1.4 HTTP Request (Узел: HTTP Request - Get Campaign)
- **URL**: `{{ $env.DIRECTUS_URL }}/items/user_campaigns/{{ $json.campaignId }}`
- **Method**: GET
- **Headers**:
  ```
  Authorization: Bearer {{ $env.DIRECTUS_TOKEN }}
  Content-Type: application/json
  ```

#### 1.5 Function (Узел: Function - Update Campaign Settings)
```javascript
// Получаем текущие настройки кампании
const campaign = items[0].json.data;
const tokenData = $input.first().json;

const currentSettings = campaign.social_media_settings || {};

// Обновляем YouTube настройки с новыми токенами
const updatedSettings = {
  ...currentSettings,
  youtube: {
    ...currentSettings.youtube,
    accessToken: tokenData.accessToken,
    refreshToken: tokenData.refreshToken,
    expiresAt: tokenData.expiresAt
  }
};

return [{
  json: {
    campaignId: tokenData.campaignId,
    social_media_settings: updatedSettings,
    tokenData: tokenData
  }
}];
```

#### 1.6 HTTP Request (Узел: HTTP Request - Update Campaign)
- **URL**: `{{ $env.DIRECTUS_URL }}/items/user_campaigns/{{ $json.campaignId }}`
- **Method**: PATCH
- **Headers**:
  ```
  Authorization: Bearer {{ $env.DIRECTUS_TOKEN }}
  Content-Type: application/json
  ```
- **Body**:
  ```json
  {
    "social_media_settings": "={{ $json.social_media_settings }}"
  }
  ```

#### 1.7 Respond to Webhook (Узел: Respond to Webhook)
```json
{
  "success": true,
  "message": "YouTube токены успешно обновлены",
  "expiresAt": "={{ $json.tokenData.expiresAt }}",
  "expiresIn": "={{ $json.tokenData.expiresIn }}"
}
```

## 2. Переменные окружения N8N

Добавьте в настройки N8N следующие переменные:

```env
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
DIRECTUS_URL=https://directus.roboflow.tech
DIRECTUS_TOKEN=your_directus_admin_token
N8N_URL=https://n8n.roboflow.tech
```

### ⚠️ Важно: Google OAuth Credentials

Эти `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET` должны быть из того же Google Cloud проекта, который использовался для настройки YouTube OAuth в основном приложении. 

**Где взять значения:**
1. Перейдите в [Google Cloud Console](https://console.cloud.google.com/)
2. Выберите проект, используемый для YouTube API
3. Перейдите в "APIs & Services" → "Credentials"
4. Найдите OAuth 2.0 Client ID, используемый в приложении
5. Скопируйте Client ID и Client Secret

**Проверить текущие значения можно в файле `.env` основного приложения:**
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

## 3. Автоматическое обновление токенов

### 3.1 Создание Schedule Workflow

**Название workflow**: `YouTube Token Auto Refresh`

#### 3.1.1 Schedule Trigger (Узел: Schedule Trigger)
- **Trigger Interval**: Every 30 minutes
- **Details**: `0 */30 * * * *` (каждые 30 минут)

#### 3.1.2 HTTP Request (Узел: HTTP Request - Get Campaigns)
- **URL**: `{{ $env.DIRECTUS_URL }}/items/user_campaigns`
- **Method**: GET
- **Headers**:
  ```
  Authorization: Bearer {{ $env.DIRECTUS_TOKEN }}
  ```
- **Query Parameters**:
  ```
  filter[social_media_settings][youtube][refreshToken][_nnull]: true
  fields: id,social_media_settings
  ```

#### 3.1.3 Function (Узел: Function - Check Token Expiry)
```javascript
// Проверяем, какие токены нужно обновить
const campaigns = items[0].json.data || [];
const tokensToRefresh = [];

for (const campaign of campaigns) {
  const youtube = campaign.social_media_settings?.youtube;
  
  if (!youtube?.refreshToken || !youtube?.expiresAt) {
    continue;
  }
  
  // Проверяем, истекает ли токен в ближайшие 5 минут
  const fiveMinutesFromNow = Date.now() + (5 * 60 * 1000);
  
  if (youtube.expiresAt < fiveMinutesFromNow) {
    tokensToRefresh.push({
      campaignId: campaign.id,
      refreshToken: youtube.refreshToken
    });
  }
}

if (tokensToRefresh.length === 0) {
  throw new Error('Нет токенов для обновления');
}

return tokensToRefresh.map(token => ({ json: token }));
```

#### 3.1.4 HTTP Request (Узел: HTTP Request - Call Token Refresh)
- **URL**: `{{ $env.N8N_URL }}/webhook/youtube-refresh-token`
- **Method**: POST
- **Headers**:
  ```
  Content-Type: application/json
  ```
- **Body**:
  ```json
  {
    "campaignId": "={{ $json.campaignId }}",
    "refreshToken": "={{ $json.refreshToken }}"
  }
  ```

## 4. Интеграция с YouTube Publishing Workflow

### 4.1 Модификация YouTube Publishing Workflow

В существующем workflow публикации YouTube добавьте проверку токена:

#### Добавить Function перед публикацией:
```javascript
// Проверяем, нужно ли обновить токен перед публикацией
const settings = $input.first().json.settings;
const youtube = settings?.youtube;

if (!youtube?.accessToken || !youtube?.expiresAt) {
  throw new Error('YouTube токены не настроены');
}

// Проверяем, не истек ли токен
const now = Date.now();
const tokenExpiresAt = youtube.expiresAt;

if (tokenExpiresAt < now) {
  // Токен истек, нужно обновить
  if (!youtube.refreshToken) {
    throw new Error('Refresh token отсутствует, требуется повторная авторизация');
  }
  
  // Вызываем обновление токена
  const refreshResponse = await $http.request({
    method: 'POST',
    url: `${$env.N8N_URL}/webhook/youtube-refresh-token`,
    headers: {
      'Content-Type': 'application/json'
    },
    body: {
      campaignId: $input.first().json.contentId, // или получите из другого места
      refreshToken: youtube.refreshToken
    }
  });
  
  if (!refreshResponse.success) {
    throw new Error('Не удалось обновить YouTube токен');
  }
  
  // Обновляем настройки для текущей публикации
  settings.youtube.accessToken = refreshResponse.data.accessToken;
}

return [{ json: $input.first().json }];
```

## 5. Обработка ошибок

### 5.1 В случае ошибки refresh token

Если refresh token истек или недействителен, workflow должен:

1. Отправить уведомление администратору
2. Пометить кампанию как требующую повторной авторизации
3. Остановить попытки публикации для этой кампании

### 5.2 Function для обработки ошибок:
```javascript
// Обработка ошибок обновления токена
const error = $input.first().json.error;

if (error && error.includes('invalid_grant')) {
  // Refresh token истек
  return [{
    json: {
      action: 'disable_youtube',
      campaignId: $input.first().json.campaignId,
      error: 'Требуется повторная авторизация YouTube'
    }
  }];
}

// Временная ошибка, можно повторить позже
return [{
  json: {
    action: 'retry_later',
    campaignId: $input.first().json.campaignId,
    error: error
  }
}];
```

## 6. Мониторинг и логирование

### 6.1 Добавление логирования в каждый workflow

В каждый узел добавьте логирование:

```javascript
console.log(`YouTube Token Refresh: ${JSON.stringify({
  timestamp: new Date().toISOString(),
  campaignId: $json.campaignId,
  action: 'token_refreshed',
  expiresAt: new Date($json.expiresAt).toISOString()
})}`);
```

## 7. Тестирование

### 7.1 Ручной тест обновления токена

```bash
curl -X POST "https://n8n.roboflow.tech/webhook/youtube-refresh-token" \
  -H "Content-Type: application/json" \
  -d '{
    "campaignId": "46868c44-c6a4-4bed-accf-9ad07bba790e",
    "refreshToken": "1//05vtpMD2L6mM6CgYIARAAGAUSNwF-L9IrMdMT8CFmdeuT7SUk-5WqAOwC_nvu2h-2WxrwPfXcYZUvCT7rO-6p921etz8tbdwE0dU"
  }'
```

### 7.2 Проверка автоматического обновления

Мониторьте логи N8N для подтверждения, что токены обновляются каждые 30 минут при необходимости.

## 8. Безопасность

1. **Переменные окружения**: Все секретные данные только через переменные окружения N8N
2. **Логирование**: Никогда не логируйте полные токены, только первые/последние символы
3. **Ошибки**: Не возвращайте секретные данные в ответах об ошибках

## Заключение

Эта система обеспечивает:
- Автоматическое обновление YouTube токенов каждые 30 минут
- Проверку токенов перед каждой публикацией
- Обработку ошибок и уведомления
- Полное управление через N8N без прямых вызовов API
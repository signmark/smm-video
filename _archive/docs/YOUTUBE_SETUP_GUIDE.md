# Настройка YouTube Integration

## Требования для полноценного постинга на YouTube

Для постинга видео на YouTube через API нужна OAuth2 авторизация, так как простого API ключа недостаточно.

### 1. Создание Google Cloud Project

1. Перейдите в [Google Cloud Console](https://console.cloud.google.com/)
2. Создайте новый проект или выберите существующий
3. Включите **YouTube Data API v3**:
   - Перейдите в "APIs & Services" > "Library"
   - Найдите "YouTube Data API v3"
   - Нажмите "Enable"

### 2. Настройка OAuth2 Credentials

1. Перейдите в "APIs & Services" > "Credentials"
2. Нажмите "Create Credentials" > "OAuth 2.0 Client IDs"
3. Выберите тип приложения: **Web application**
4. Настройте redirect URIs:
   - Для разработки: `http://localhost:5000/api/auth/youtube/callback`
   - Для продакшена: `https://yourdomain.com/api/auth/youtube/callback`
5. Сохраните **Client ID** и **Client Secret**

### 3. Настройка переменных окружения

Добавьте в файл `.env`:

```env
# YouTube OAuth Configuration
YOUTUBE_CLIENT_ID=your_client_id_here
YOUTUBE_CLIENT_SECRET=your_client_secret_here
YOUTUBE_REDIRECT_URI=http://localhost:5000/api/auth/youtube/callback
```

### 4. OAuth Scopes

Система запрашивает следующие разрешения:
- `https://www.googleapis.com/auth/youtube.upload` - Загрузка видео
- `https://www.googleapis.com/auth/youtube` - Управление каналом
- `https://www.googleapis.com/auth/youtube.force-ssl` - Безопасный доступ

### 5. Процесс авторизации

1. Пользователь нажимает "Подключить YouTube" в настройках кампании
2. Система перенаправляет на Google OAuth
3. Пользователь разрешает доступ к своему YouTube каналу
4. Google возвращает tokens (access_token + refresh_token)
5. Токены сохраняются в user_api_keys для пользователя

### 6. Структура данных в user_api_keys

```json
{
  "platform": "youtube",
  "config": {
    "channelId": "UCxxxxxxxxxxxxxx",
    "accessToken": "ya29.xxxxxxxxx",
    "refreshToken": "1//xxxxxxxxx",
    "clientId": "xxxxxxxxx.apps.googleusercontent.com",
    "clientSecret": "xxxxxxxxx"
  }
}
```

### 7. API Endpoints

- `POST /api/auth/youtube/auth/start` - Начать OAuth авторизацию
- `GET /api/auth/youtube/auth/callback` - Обработка callback от Google
- `POST /api/auth/youtube/test` - Тестирование соединения

### 8. Ограничения API

- YouTube Data API имеет квоты (10,000 единиц в день по умолчанию)
- Загрузка одного видео стоит примерно 1600 единиц
- Можно загружать ~6 видео в день с базовой квотой

### 9. Статусы публикации

- `private` - Видео доступно только автору
- `unlisted` - Видео доступно по прямой ссылке
- `public` - Видео публично доступно

### 10. Поддерживаемые форматы

YouTube поддерживает: MP4, MOV, AVI, WMV, FLV, WebM и другие.
Рекомендуется: MP4 с H.264 кодеком.

## Почему недостаточно простого API ключа?

API ключ позволяет только **читать** публичные данные YouTube (поиск видео, получение информации о каналах). 

Для **записи** (загрузка видео, управление плейлистами) требуется OAuth2 авторизация, которая:
- Подтверждает личность пользователя
- Запрашивает разрешения на действия от имени пользователя
- Предоставляет токены для безопасного доступа к приватным данным

Это стандартная практика безопасности Google для всех операций записи.
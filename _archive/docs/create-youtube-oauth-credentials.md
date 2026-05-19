# Создание YouTube OAuth Credentials

## В Google Cloud Console:

1. **Перейти в APIs & Services > Credentials**
2. **Нажать "+ CREATE CREDENTIALS" > OAuth 2.0 Client ID**
3. **Выбрать Application type: Web application**
4. **Name: SMM Manager YouTube**
5. **Authorized redirect URIs добавить:**
   - `https://smm.omemo.tech/api/youtube/auth/callback`
   - `http://localhost:5000/api/youtube/auth/callback` (для разработки)

6. **Нажать CREATE**
7. **Скопировать Client ID и Client Secret**

## Включить YouTube Data API v3:

1. **APIs & Services > Library**
2. **Найти "YouTube Data API v3"**
3. **Нажать ENABLE**

## Настроить OAuth Consent Screen:

1. **APIs & Services > OAuth consent screen**
2. **User Type: External (если Internal недоступен)**
3. **App name: SMM Manager**
4. **User support email: ваш email**
5. **Developer contact: ваш email**
6. **Добавить Test users:** `signmark@gmail.com`
7. **Scopes добавить:**
   - `https://www.googleapis.com/auth/youtube`
   - `https://www.googleapis.com/auth/youtube.upload`

## После получения ключей:

Обновите скрипт `add-youtube-api-keys.js` с реальными значениями и запустите его.
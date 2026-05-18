# Чеклист исправления YouTube OAuth на продакшене

## ✅ Диагностика завершена
- [x] Подтверждено: YouTube ключи есть в базе данных (3 ключа)
- [x] Подтверждено: YouTube OAuth работает на Replit среде
- [x] Выявлена причина: истёк DIRECTUS_TOKEN на продакшене

## 🔧 Необходимые исправления на продакшене

### 1. Обновить DIRECTUS_TOKEN
```bash
# Получить новый токен:
# 1. Зайти в https://directus.roboflow.space
# 2. Settings > Access Tokens > Create new token
# 3. Обновить в .env продакшена:
DIRECTUS_TOKEN=новый_токен_здесь
```

### 2. Обновить YOUTUBE_REDIRECT_URI
```bash
# В .env продакшена:
YOUTUBE_REDIRECT_URI=https://smm.omemo.tech/api/youtube/auth/callback
```

### 3. Обновить Google OAuth консоль
- Зайти в https://console.cloud.google.com/
- APIs & Services > Credentials  
- Найти YouTube OAuth приложение "Laboratory"
- Добавить в Authorized redirect URIs:
  ```
  https://smm.omemo.tech/api/youtube/auth/callback
  ```

### 4. Добавить тестового пользователя
- В Google OAuth консоль > OAuth consent screen
- Test users > Add users
- Добавить: `signmark@gmail.com`

### 5. Перезапустить продакшен сервер
```bash
# После обновления переменных окружения
systemctl restart smm-manager
# или
pm2 restart smm-manager
```

## 🎯 Результат
После выполнения всех шагов YouTube OAuth будет работать на продакшене так же, как работает сейчас на Replit среде.

## 📝 Альтернативный вариант (если нет доступа к базе)
Если не получается обновить DIRECTUS_TOKEN, можно использовать fallback на переменные окружения - система автоматически переключится на них.
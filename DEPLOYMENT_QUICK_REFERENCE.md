# Быстрый справочник по развертыванию

## Среды

### Development (Replit)
```
URL: *.replit.dev
Directus: https://directus.roboflow.tech
Admin: admin@roboflow.tech / QtpZ3dh7
```

### Staging (VPS)
```
URL: https://smm.roboflow.tech
Directus: https://directus.roboflow.tech
Admin: admin@roboflow.tech / QtpZ3dh7
Environment: NODE_ENV=staging или STAGING=true
```

### Production (VPS)
```
URL: https://smm.omemo.tech
Directus: https://directus.nplanner.ru
Admin: lbrspb@gmail.com / QtpZ3dh7
```

## Проверка среды

### API endpoint
```bash
curl http://localhost:5000/api/config
# Возвращает: {"directusUrl":"https://directus.roboflow.tech/","environment":"development"}
```

### В коде
```typescript
// Server: utils/environment-detector.ts
const env = detectEnvironment();

// Client: автоматически через /api/config
```

## Деплой на продакшн

### Быстрый деплой
```bash
./deploy_simple.sh
```

### Ручной деплой
```bash
ssh root@nplanner.ru
cd /var/www/smm
git pull origin main
pm2 restart smm
```

## Переменные окружения

### Development (.env)
```
DIRECTUS_URL=https://directus.roboflow.tech
DIRECTUS_ADMIN_EMAIL=admin@roboflow.tech
DIRECTUS_ADMIN_PASSWORD=QtpZ3dh7
```

### Production (.env)
```
DIRECTUS_URL=https://directus.nplanner.ru
DIRECTUS_ADMIN_EMAIL=lbrspb@gmail.com
DIRECTUS_ADMIN_PASSWORD=QtpZ3dh7
```

## Диагностика

### Проверка подключения
```bash
# Development
curl https://directus.roboflow.tech/server/info

# Production
curl https://directus.nplanner.ru/server/info
```

### Проверка авторизации
```bash
# Получение токена
curl -X POST https://directus.roboflow.tech/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@roboflow.tech","password":"QtpZ3dh7"}'
```

### Логи
```bash
# Replit: в консоли workflow
# Production: 
pm2 logs smm
tail -f /var/log/smm/app.log
```

## Частые проблемы

### 401/403 ошибки
- Проверить URL Directus для текущей среды
- Обновить токен авторизации
- Проверить переменные окружения

### CORS ошибки
- Проверить настройки Directus
- Убедиться в корректности домена

### Infinite loops в трендах
- Проверить зависимости useEffect
- Убедиться в отсутствии циклических обновлений state

## Архитектурные особенности

### Автоматическое определение среды
- Сервер определяет среду по переменным окружения
- Клиент получает конфигурацию через API
- Нет хардкода URL в клиентском коде

### Раздельные базы данных
- Каждая среда имеет свой Directus instance
- Отдельные пользователи и контент
- Общие S3 хранилище для файлов

### Безопасность
- Разные учетные данные администраторов
- Токены не пересекаются между средами
- Отдельная авторизация для каждой среды
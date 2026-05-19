# Архитектура развертывания SMM системы

## Обзор

Система развернута в двух средах с общей базой данных Directus, но разными серверами приложений.

## Среды развертывания

### 1. Development (Replit)
- **URL**: `*.replit.dev` (динамический)
- **Directus**: `https://directus.roboflow.tech`
- **Администратор**: `admin@roboflow.tech` / `QtpZ3dh7`
- **Назначение**: Разработка и тестирование

### 2. Production (VPS сервер)
- **URL**: `https://smm.omemo.tech`
- **Directus**: `https://directus.nplanner.ru`
- **Администратор**: `lbrspb@gmail.com` / `QtpZ3dh7`
- **Назначение**: Продакшн для клиентов

## Автоматическое определение среды

### Server-side (utils/environment-detector.ts)
```typescript
// Автоматически определяет среду по:
// - Переменным окружения
// - Наличию REPL_ID (Replit)
// - Путь файловой системы
// - NODE_ENV

function detectEnvironment(): EnvironmentConfig {
  // Replit: admin@roboflow.tech -> directus.roboflow.tech
  // Production: lbrspb@gmail.com -> directus.nplanner.ru
}
```

### Client-side (lib/directus.ts)
```typescript
// Динамически получает URL Directus с сервера
async function getServerConfig() {
  const response = await fetch('/api/config');
  return config.directusUrl;
}
```

## API конфигурации

### GET /api/config
Возвращает конфигурацию для текущей среды:
```json
{
  "directusUrl": "https://directus.roboflow.tech",
  "environment": "replit"
}
```

## Процесс деплоя

### Development (Replit)
1. Код автоматически синхронизируется через Git
2. Сервер автоматически перезапускается при изменениях
3. Использует переменные окружения из `.env`

### Production (VPS)
1. Деплой через `deploy_simple.sh`
2. Git pull на продакшн сервере
3. Перезапуск через PM2/Docker
4. Использует продакшн переменные окружения

## Переменные окружения

### Development (.env)
```
DIRECTUS_URL=https://directus.roboflow.tech
DIRECTUS_ADMIN_EMAIL=admin@roboflow.tech
DIRECTUS_ADMIN_PASSWORD=QtpZ3dh7
VITE_DIRECTUS_URL=https://directus.roboflow.tech
```

### Production (.env)
```
DIRECTUS_URL=https://directus.nplanner.ru
DIRECTUS_ADMIN_EMAIL=lbrspb@gmail.com
DIRECTUS_ADMIN_PASSWORD=QtpZ3dh7
VITE_DIRECTUS_URL=https://directus.nplanner.ru
```

## Синхронизация данных

### Общие элементы
- **База данных**: Каждая среда имеет свой Directus instance
- **Статические файлы**: Beget S3 (общий для всех сред)
- **API ключи**: Хранятся в Global API Keys каждого Directus

### Различия между средами
- **Пользователи**: Отдельные базы пользователей
- **Контент**: Отдельный контент в каждой среде
- **Конфигурация**: Разные настройки админов и URL

## Решение проблем

### Частые проблемы
1. **401/403 ошибки**: Неправильный URL Directus для среды
2. **Invalid token**: Токены не валидны между средами
3. **CORS ошибки**: Неправильная конфигурация домена

### Диагностика
1. Проверить логи: `console.log('Updated Directus URL to:', url)`
2. Проверить переменные: `GET /api/config`
3. Проверить авторизацию: токены должны быть валидны для соответствующего Directus

## Архитектурные принципы

### Автономность сред
- Каждая среда работает независимо
- Минимальная зависимость между dev и prod
- Отдельные базы данных и пользователи

### Динамическая конфигурация
- Клиент автоматически получает конфигурацию с сервера
- Нет хардкода URL в клиентском коде
- Сервер определяет среду автоматически

### Безопасность
- Раздельные учетные данные администраторов
- Токены не пересекаются между средами
- Отдельные базы пользователей

## Обновления и миграции

### Обновление кода
1. Разработка в Replit (dev)
2. Тестирование функций
3. Git commit/push
4. Деплой на продакшн через скрипт

### Миграции данных
1. Структура схемы синхронизируется через Git
2. Данные мигрируются отдельно при необходимости
3. API ключи настраиваются в каждой среде индивидуально
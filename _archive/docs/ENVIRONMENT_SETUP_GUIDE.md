# Environment Setup Guide

## ENV Variable Configuration System

Система использует переменную `ENV` для управления окружением и уровнем логгирования.

### Доступные окружения:

#### 1. Development (Replit) - `.env`
```bash
ENV=development
NODE_ENV=development
DIRECTUS_URL=https://directus.roboflow.tech
LOG_LEVEL=debug
DEBUG_SCHEDULER=true
VERBOSE_LOGS=true
```

**Особенности:**
- Полное логгирование всех операций
- Префикс `[DEV]` во всех сообщениях
- Детальные debug логи
- Показываются все ошибки и предупреждения

#### 2. Staging (smm.roboflow.tech) - `.env.staging`
```bash
ENV=development
NODE_ENV=development
DIRECTUS_URL=https://directus.roboflow.tech
LOG_LEVEL=debug
DEBUG_SCHEDULER=true
VERBOSE_LOGS=true
```

**Особенности:**
- Такие же логи как в development
- Позволяет администраторам отслеживать все операции
- Используется для тестирования перед production

#### 3. Production (nplanner.ru) - `.env`
```bash
ENV=production
NODE_ENV=production
DIRECTUS_URL=https://directus.nplanner.ru
LOG_LEVEL=error
DEBUG_SCHEDULER=false
VERBOSE_LOGS=false
```

**Особенности:**
- Минимальное логгирование
- Показываются только критические ошибки
- Сообщения типа "КРИТИЧЕСКАЯ ОШИБКА: ... Обратитесь к администрации"

### Развертывание по окружениям:

#### Replit Development:
```bash
cp .env.example .env
# Использует development режим по умолчанию
```

#### Staging Deployment:
```bash
cp .env.staging .env
# Staging использует development логи для мониторинга
```

#### Production Deployment:
```bash
cp .env.sample .env  # или скопируйте существующий .env
# Production использует минимальные логи
```

### Логирование по уровням:

#### Development/Staging:
- ✅ Все операции с Directus
- ✅ Планировщик публикаций
- ✅ Социальные платформы
- ✅ API запросы
- ✅ Debug информация

#### Production:
- ❌ Обычные операции скрыты
- ❌ Информационные сообщения скрыты
- ❌ Debug логи отключены
- ✅ Только критические ошибки для пользователей

### Проверка текущего окружения:

```bash
curl http://localhost:5000/api/config
```

Ответ:
```json
{
  "directusUrl": "https://directus.roboflow.tech/",
  "environment": "development",
  "logLevel": "debug",
  "debugScheduler": true,
  "verboseLogs": true
}
```

### Переключение окружения без перезапуска:

```bash
curl -X POST http://localhost:5000/api/config/update
```
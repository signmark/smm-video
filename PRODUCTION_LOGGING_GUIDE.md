# Production Logging Configuration Guide

## Система управления логами по окружениям

### Критически серьезные ошибки (Production)

В production режиме показываются **только** ошибки, требующие обращения к администратору:

#### Серверные логи:
- `КРИТИЧЕСКАЯ ОШИБКА`
- `SYSTEM ERROR`
- `DATABASE ERROR` 
- `FATAL ERROR`
- `SERVICE UNAVAILABLE`
- `База данных недоступна`
- `Критический сбой`

#### Браузерные логи:
- `КРИТИЧЕСКАЯ ОШИБКА`
- `Системная ошибка`
- `Сервис недоступен`
- `обратитесь к администрации`
- `свяжитесь с поддержкой`

### Примеры сообщений для пользователей:

```javascript
// Критическая ошибка
criticalError("База данных недоступна", techDetails);
// Результат: "КРИТИЧЕСКАЯ ОШИБКА: База данных недоступна. Обратитесь к администрации."

// Системная ошибка
systemError("Не удается обработать запрос");
// Результат: "Системная ошибка: Не удается обработать запрос. Свяжитесь с поддержкой."

// Ошибка сервиса
serviceError("Directus", "Временно недоступен");
// Результат: "Сервис недоступен: Временно недоступен. Обратитесь к администрации."
```

### Что НЕ показывается в production:

❌ **Скрыто в production:**
- console.log() - информационные сообщения
- console.debug() - отладочная информация
- console.info() - уведомления
- console.warn() - предупреждения
- HTTP ошибки (401, 403, 404, 429, 500)
- ✅ GET /api/campaigns 401 (Unauthorized) - СКРЫТО
- ✅ GET imgur.com/image.mp4 429 (Too Many Requests) - СКРЫТО
- Ошибки авторизации
- Сетевые ошибки
- Лимиты API

✅ **Показано в production:**
- Только критически серьезные ошибки
- Сообщения с инструкциями для пользователя
- Ошибки, требующие обращения к администратору

### Конфигурация по окружениям:

#### Development (.env):
```bash
ENV=development
LOG_LEVEL=debug
VERBOSE_LOGS=true
SHOW_BROWSER_LOGS=true
```

#### Staging (.env.staging):
```bash
ENV=development  # Полные логи для мониторинга
LOG_LEVEL=debug
VERBOSE_LOGS=true
SHOW_BROWSER_LOGS=true
```

#### Production (.env):
```bash
ENV=production
LOG_LEVEL=error
VERBOSE_LOGS=false
SHOW_BROWSER_LOGS=false
```

### Использование в коде:

```javascript
// Импорт логгера
import { criticalError, systemError, serviceError } from '@/utils/logger';

// Для критических ошибок
criticalError("Описание проблемы для пользователя");

// Для системных сбоев
systemError("Понятное описание для пользователя", technicalDetails);

// Для недоступности сервисов
serviceError("Имя сервиса", "Описание проблемы");
```

### Проверка конфигурации:

```bash
# Проверить текущие настройки
curl http://localhost:5000/api/config

# Ожидаемый ответ для production:
{
  "environment": "production",
  "logLevel": "error",
  "verboseLogs": false,
  "debugScheduler": false
}
```
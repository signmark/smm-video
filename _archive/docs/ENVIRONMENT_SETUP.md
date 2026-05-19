# Настройка переменных окружения для разных сред

## Разработка (Development)
Файл: `.env`

```bash
# Directus Configuration (Development)
DIRECTUS_URL=https://directus.roboflow.tech
VITE_DIRECTUS_URL=https://directus.roboflow.tech

# N8N Configuration (Development)
N8N_URL=https://n8n.roboflow.tech
VITE_N8N_URL=https://n8n.roboflow.tech
```

## Продакшен (Production)
Файл: `.env`

```bash
# Directus Configuration (Production)
DIRECTUS_URL=https://directus.nplanner.ru
VITE_DIRECTUS_URL=https://directus.nplanner.ru

# N8N Configuration (Production)
N8N_URL=https://n8n.nplanner.ru
VITE_N8N_URL=https://n8n.nplanner.ru
```

## Важные правила

### Для бэкенда используйте:
- `DIRECTUS_URL` (без VITE_)
- `N8N_URL` (без VITE_)

### Для фронтенда используйте:
- `VITE_DIRECTUS_URL` (с VITE_)
- `VITE_N8N_URL` (с VITE_)

## Публикация контента

### VK, Telegram, Instagram
- Только через N8N webhooks
- URL: `${N8N_URL}/webhook/publish-{platform}`

### Facebook
- Прямая публикация через API
- Не использует N8N webhooks

## Аналитика

### Webhook для обновления аналитики
- URL: `${VITE_N8N_URL}/webhook/posts-to-analytics`
- Используется для синхронизации статистики публикаций

## Проверка настроек

После изменения переменных окружения:

1. Перезапустите сервер
2. Проверьте логи на наличие правильных URL
3. Убедитесь, что публикации идут через правильные endpoints
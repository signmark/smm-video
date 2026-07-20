# Техническое задание: Интеграция SMM Manager ↔ Scraper API

## Дата
2026-07-17

## Проверенные endpoints

### ✅ Работает: `GET /api/v1/channels/{channel_id}/analytics`
- Чтение агрегированных метрик канала за период
- Используется для отображения аналитики в UI
- **Работает корректно**

### ❌ Не работает: `POST /api/v1/monitoring/scheduler/metrics-refresh`

**Проблема:** Таймаут/обрыв соединения при реальных channel IDs.

**Что проверяли:**

1. **Фейковые ID** (несуществующие каналы) — возвращает 200 мгновенно:
```bash
curl -X POST "http://217.26.25.95:3030/api/v1/monitoring/scheduler/metrics-refresh?\
  channel_ids=00000000-0000-0000-0000-000000000001&\
  channel_ids=00000000-0000-0000-0000-000000000002&\
  days=7&force=true" \
  -H "Authorization: Bearer N5beUaQCEdBPYed_fZeBIXdXhD6yZBpdbFzcSwB8MVI"

# Ответ: HTTP 200
# {"status":"completed","processed":0,"failed":0,"skipped":0,...}
```

2. **Реальные ID** (существующие каналы) — обрыв соединения:
```bash
curl -X POST "http://217.26.25.95:3030/api/v1/monitoring/scheduler/metrics-refresh?\
  channel_ids=b2dbeda2-2cf6-41c6-8ab3-98dd52de3c17&\
  channel_ids=f350d507-de5d-402d-a8c1-3efc2514d2c1&\
  days=7&force=true" \
  -H "Authorization: Bearer N5beUaQCEdBPYed_fZeBIXdXhD6yZBpdbFzcSwB8MVI" \
  -m 15

# Ответ: HTTP 000 (таймаут, обрыв соединения)
```

**Каналы:**
- `b2dbeda2-...` — Telegram `@ya_delayu_moschno`
- `f350d507-...` — VK `-228626989`

---

## Что нужно от разработчика скрейпера

### 1. Починить `POST /metrics-refresh` с реальными channel IDs
**Варианты:**
- Endpoint падает/зависает при реальных данных — нужно найти причину
- Возможно, долгая обработка → нужен async режим

### 2. Сделать `metrics-refresh` асинхронным (рекомендуется)

**Текущее поведение:**
- Endpoint ждёт завершения пересборки → таймаут 60-120 секунд
- UI зависает, пока скрейпер работает

**Желаемое поведение:**
```json
// POST /metrics-refresh
// Ответ мгновенно:
{
  "task_id": "task-uuid-123",
  "status": "started",
  "message": "Пересборка метрик запущена для 2 каналов"
}
```

**Дополнительно нужен:**
- `GET /api/v1/monitoring/scheduler/tasks/{task_id}` — проверка статуса задачи
- Или `GET /api/v1/monitoring/scheduler/tasks` — список активных задач

**Пример ответа статуса:**
```json
{
  "task_id": "task-uuid-123",
  "status": "completed",
  "progress": 100,
  "channels_processed": 2,
  "channels_failed": 0,
  "result": {
    "processed": 2,
    "failed": 0,
    "skipped": 0
  }
}
```

### 3. Альтернатива: callback/webhook
Если скрейпер не хочет держать статус задач — можно callback:

```json
// POST /metrics-refresh
{
  "channel_ids": ["uuid1", "uuid2"],
  "days": 7,
  "callback_url": "https://smm-manager.ru/api/webhooks/scraper-update"
}
```

Скрейпер по завершении шлёт POST на callback_url с результатом.

### 4. Дополнительно: endpoint здоровья канала
```
GET /api/v1/monitoring/channels/{channel_id}/health
```

Ответ:
```json
{
  "channel_id": "uuid",
  "is_parsing": false,
  "last_parsed_at": "2026-07-17T10:00:00Z",
  "next_parse_at": "2026-07-17T18:00:00Z",
  "posts_count": 150,
  "status": "healthy"
}
```

Позволит UI показывать "Данные актуальны на 10:00" или "Следующее обновление в 18:00".

---

## Архитектура интеграции (как сейчас)

```
┌─────────┐     ┌──────────┐     ┌──────────┐     ┌─────────┐
│   UI    │────▶│ Бэкенд   │────▶│ Directus │     │ Скрейпер│
│         │◄────│ SMM      │◄────│ (посты)  │     │(метрики)│
└─────────┘     │ Manager  │     └──────────┘     └────┬────┘
                └──────────┘                           │
                    │                                  │
                    │ GET /channels/{id}/analytics      │
                    │◄───────────────────────────────────┘
                    │
                    │ POST /metrics-refresh (таймаут)
                    │───────────────────────────────────▶
```

**Проблема:** `POST /metrics-refresh` — синхронный, тяжёлый, таймаутится.

**Решение:** Сделать async — возвращать task_id, проверять статус отдельно.

---

## Приоритеты

| Приоритет | Задача | Почему |
|---|---|---|
| 🔴 Критично | Починить `POST /metrics-refresh` с реальными ID | Кнопка "Обновить" не работает |
| 🟡 Высоко | Сделать async mode (task_id) | UI не должен ждать 60+ секунд |
| 🟢 Средне | Endpoint health канала | Понятность для пользователя |
| 🟢 Средне | Callback/webhook | Альтернатива polling |

---

## Контакты
- SMM Manager: Dmitry Zhdanov <signmark@gmail.com>
- Scraper API: 217.26.25.95:3030
- API Key: SCRAPER_ANALYTICS_API_KEY

---
name: Comment collector scraper
description: Новый скрейпер для сбора комментариев (замена n8n). Отличается от trend-scraper форматом запроса и авторизацией.
---

# Comment collector scraper (31.129.109.216:3030)

**Endpoint**: `POST http://217.26.25.95:3030/collect-comments` (тот же сервер что и тренды, `SCRAPER_BASE`)

**Auth**: `api-key: <key>` header — через `getScraperApiKey()` из trend-collector (тот же ключ что и для трендов)

**Request body**:
```json
{
  "platform": "telegram" | "vk",
  "post_links": ["https://t.me/...", "https://vk.com/..."],
  "max_comments_per_post": 500,
  "callback_url": "https://our-domain/api/trends/collect-comments-callback"
}
```

**Callback format** (скрейпер шлёт на callback_url):
```json
[
  {
    "original_link": "https://t.me/channel/123",
    "comments": [
      { "id": 277213, "text": "...", "date": 1751375154, "from_id": 942467937 }
    ]
  }
]
```
- `date` — Unix timestamp в **секундах** (конвертировать: `* 1000`)
- `original_link` — ключ для маппинга к тренду (не `post_url`!)

**Why**: n8n воркфлоу портирован напрямую в Express. n8n больше не нужен для collect-comments.

**How to apply**:
- `callBatchCollectComments(platform, trends)` в trends-routes.ts — вызов скрейпера
- `/api/trends/collect-comments-callback` — получение результатов
- `pendingCommentUrls` Map (module-level) — маппинг urlPost → trendId на время callback

## Два режима на одном сервере (217.26.25.95:3030)

| Эндпоинт | Формат | Где используется |
|----------|--------|-----------------|
| `/api/telegram/collect-comments` | `{ post_url, limit, async_mode }` (один пост) | `/api/telegram/collect-comments-direct` (debug) |
| `/collect-comments` | `{ platform, post_links[], max_comments_per_post }` (батч) | основной flow через `callBatchCollectComments` |

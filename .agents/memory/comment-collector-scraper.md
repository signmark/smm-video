---
name: Comment collector scraper
description: Новый скрейпер для сбора комментариев (замена n8n). Отличается от trend-scraper форматом запроса и авторизацией.
---

# Comment collector scraper (31.129.109.216:3030)

**Endpoint**: `POST http://31.129.109.216:3030/collect-comments`

**Auth**: `Authorization: Bearer <token>` (НЕ `api-key` как у старого скрейпера)

**Ключ в Directus**: `collect_comments_bearer` (service_name в global_api_keys)
- Fallback: если `collect_comments_bearer` не найден, берёт `telegram_collect_comments`
- Токен из n8n воркфлоу: `68b5bed1-ae3e-4eb5-be9e-eddf00ac3600`

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

## Отличие от старого скрейпера (217.26.25.95)
| | Старый (217.26.25.95) | Новый (31.129.109.216) |
|-|----------------------|----------------------|
| Endpoint | `/api/telegram/collect-comments` | `/collect-comments` |
| Auth | `api-key: <key>` header | `Authorization: Bearer <token>` |
| Запрос | `{ post_url, limit, async_mode }` (один пост) | `{ platform, post_links[], max_comments_per_post }` (батч) |
| Callback | `{ post_url, comments }` | `[{ original_link, comments }]` (массив) |
| Ключ Directus | `telegram_collect_comments` | `collect_comments_bearer` |

Старый скрейпер сохранён для `/api/telegram/collect-comments-direct` (ручной debug-эндпоинт).

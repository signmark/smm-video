---
name: Comment collector scraper
description: Сбор комментариев через тот же скрейпер что и тренды (217.26.25.95:3030). Замена n8n воркфлоу.
---

# Comment collector — тот же скрейпер что и тренды

**Сервер**: `http://217.26.25.95:3030` (`SCRAPER_BASE` из trend-collector)

**Auth**: `api-key: <key>` header — через `getScraperApiKey()` (тот же ключ что и для трендов)

**Why**: n8n воркфлоу портирован напрямую в Express. n8n больше не нужен для collect-comments.

## Эндпоинты скрейпера

### Батч (основной flow)
`POST /api/telegram/collect-comments-batch`
```json
{ "post_urls": ["https://t.me/..."], "limit": 1000, "download_media": false, "callback_url": "..." }
```
Callback: `{ task_id, status, results: [{ post_url, comments }] }`

### Одиночный (debug endpoint `/api/telegram/collect-comments-direct`)
`POST /api/telegram/collect-comments`
```json
{ "post_url": "https://t.me/...", "limit": 1000, "download_media": false, "callback_url": "..." }
```
Callback: `{ task_id, status, post_url, comments }`

**VK**: аналогичный эндпоинт предположительно `/api/vk/collect-comments-batch` (дока не предоставлена)

## Callback handler
- Поддерживает все форматы: `results[]`, прямой массив `[]`, `body[]`, одиночный `{ post_url, comments }`
- `date` — может быть Unix-секунды (конвертировать `* 1000`) или ISO строка
- `pendingCommentUrls` Map (module-level) — маппинг `urlPost.lower → { trendId, insertedAt }`, TTL 2ч

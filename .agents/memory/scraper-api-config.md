---
name: Scraper API config
description: Конфигурация скрейпера 217.26.25.95:3030 — эндпоинты, auth, task polling
---

**Сервер**: `http://217.26.25.95:3030` (единственный работающий из Replit)

**Auth**: header `api-key: <key>` (НЕ Bearer)

**Ключ (обновлён 2026-06-08)**: из Directus service `telegram_collect_comments` (ID: `4af97421-5656-43f8-a273-1424e3d9e93e`) или `trends_scraper`. Фолбэк `c1f2e8ad-61c5-450a-b301-12690e9e1112` в константе `SCRAPER_API_KEY_FALLBACK` (trend-collector.ts).

**Экспортированные из trend-collector.ts**: `SCRAPER_BASE`, `getScraperApiKey()`

**Форматы ID по доке v2.0**:
- TG channel_ids: передавать с `@` префиксом (`@username`) — стабильнее, работает для публичных каналов без членства аккаунта
- VK group_ids: числовой ID с минусом (`-174948538`) или screen_name

**Поля ответа (v2.0)**:
- TG пост: `id, channel_id, text, date, views, reactions, comments, forwards, url (приватная), public_url (публичная!), channel_username, subscribers, trend_score`
  - Использовать `public_url` для urlPost, `channel_username` как sourceId
- VK пост: `id, owner_id, text, date, likes, comments, reposts, views, url, group_id, group_title, trend_score`
  - `url` возвращается напрямую (`https://vk.com/wall-174948538_10417`), `group_id` как sourceId

**Эндпоинты trending-posts (async)**:
- TG: POST `/api/telegram/trending-posts` body: `{channel_ids (с @), limit, fetch_limit, merge_results, days_back, min_views, async_mode: true}`
- VK: POST `/api/vk/trending-posts` body: `{group_ids, limit, days_back, min_views, async_mode: true}`

**Polling task status**:
- TG: GET `/api/telegram/tasks/status/{task_id}` с `api-key` header
- VK: GET `/api/vk/tasks/status/{task_id}` с `api-key` header
- Статусы: `pending → processing → done | error`
- Результат когда `done`: в поле `result.posts` (TaskStatus.result)
- TTL кэша результата: 24 часа

**find-groups**:
- TG: POST `/api/telegram/find-groups` body: `{keywords, min_members, max_groups}`
- VK: POST `/api/vk/find-groups` body: `{keywords, min_members, max_groups}`

**Analytics v1 (мониторинг каналов)**:
- GET/POST `/api/v1/monitoring/channels`
- GET `/api/v1/channels/{id}/analytics?from_date&to_date&granularity`
- GET `/api/v1/channels/{id}/overview`
- GET `/api/v1/trends/posts?platform&from_date&to_date&limit`
- GET `/api/v1/trends/hashtags?platform&limit`
- GET `/api/v1/analytics/engagement?platform&channel_ids`
- Каналы нужно сначала зарегистрировать через POST /monitoring/channels, иначе аналитики нет

**How to apply**: Использовать `getScraperApiKey()` и `SCRAPER_BASE` из trend-collector.ts в любых новых запросах к скрейперу

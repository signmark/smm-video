---
name: Scraper API config
description: Конфигурация скрейпера 217.26.25.95:3030 — эндпоинты, auth, task polling
---

**Сервер**: `http://217.26.25.95:3030` (единственный работающий; 31.129.109.216:3030 недоступен из Replit)

**Auth**: header `api-key: <key>` (НЕ Bearer)

**Ключ**: из Directus service `telegram_collect_comments` или `trends_scraper`, фолбэк `N5beUaQCEdBPYed_fZeBIXdXhD6yZBpdbFzcSwB8MVI` (константа `SCRAPER_API_KEY_FALLBACK` в trend-collector.ts)

**Экспортированные из trend-collector.ts**: `SCRAPER_BASE`, `getScraperApiKey()`

**Эндпоинты trending-posts (async)**:
- TG: POST `/api/telegram/trending-posts` body: `{channel_ids, limit, fetch_limit, merge_results, days_back, min_views, async_mode: true}`
- VK: POST `/api/vk/trending-posts` body: `{group_ids, limit, days_back, min_views, async_mode: true}`

**Polling task status**:
- TG: GET `/api/telegram/tasks/status/{task_id}` с `api-key` header
- VK: GET `/api/vk/tasks/status/{task_id}` с `api-key` header
- Статусы: `pending → processing → done | error`
- Результат когда `done`: в поле `result.posts` (TaskStatus.result)

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

**Why**: 31.129.109.216:3030 (новый сервер) недоступен из Replit sandbox; старый сервер уже имеет все нужные эндпоинты включая analytics v1

**How to apply**: Использовать `getScraperApiKey()` и `SCRAPER_BASE` из trend-collector.ts в любых новых запросах к скрейперу

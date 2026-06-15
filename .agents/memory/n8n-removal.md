---
name: N8n removal
description: n8n полностью удалён из кодовой базы; все вебхуки заменены прямыми вызовами сервисов
---

## Правило
n8n удалён. Не добавлять вызовы `getN8nUrl()` или `webhook/publish-*`. Использовать прямые сервисы.

**Why:** n8n воркфлоу `posts-to-analytics` не работал → аналитика views=0. Решено заменой всех n8n вызовов прямым кодом.

## Архитектура после удаления

### Публикация в соцсети (главный путь)
- **publish-scheduler.ts** — планировщик с прямыми методами:
  - `publishToTelegramDirect` → telegramService
  - `publishToVkDirect` → vkService  
  - `publishToInstagramDirect` → instagramService
  - `publishToFacebookDirect` → facebookSocialService
  - `publishToYouTubeDirect` → youtubeVideoService / youtubeShortsService
- **social-publishing-router.ts** `/api/social/publish/now` — ручной запуск публикации

### Аналитика
- `/api/analytics/update` → `AnalyticsService.refreshCampaignAnalytics()` в analytics-service.ts
- Дополняет данные Directus данными scraper API (views из каналов TG/VK)

### Instagram Stories
- Новый `server/services/social-platforms/instagram-stories-service.ts`
- `publishInstagramStory(contentId, adminToken)` — создаёт контейнер, поллит статус, публикует через Graph API
- Используется в stories.ts (5 мест), videoProcessing.ts

### Мёртвый код (оставлен, не вызывается)
- `publishThroughN8nWebhook` в social/index.ts — бросает Error
- `publishThroughN8nWebhook` в social-publishing.ts — бросает Error
- `publishViaN8n` / `publishViaN8nAsync` в social-publishing-router.ts — функции есть, вызовы заменены на 501
- n8n-utils.ts — файл существует (не удалять, могут быть импорты в тестах)

## How to apply
При любой новой задаче публикации — использовать publish-scheduler методы или social/index.ts.publishToPlatform.
Не восстанавливать n8n вызовы.

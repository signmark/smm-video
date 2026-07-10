# Интеграция с n8n — УСТАРЕЛА

**Статус:** ❌ УДАЛЕНА. n8n был удалён из проекта. Все процессы теперь работают напрямую.

## Что было (историческая справка)

Ранее n8n использовался для:
1. Сбора трендов из Telegram
2. Публикации контента в социальные сети

## Что сейчас

- **Сбор трендов:** Реализован напрямую через Scraper API и Telegram парсеры
- **Публикация:** Все платформы публикуются напрямую через собственные API:
  - Telegram → Telegram Bot API
  - VK → VK API
  - Instagram → Instagram Graph API
  - Facebook → Facebook Graph API
  - YouTube → YouTube Data API v3
  - TikTok → TikTok API
  - Threads → Threads API

## Архивные файлы

- `N8N_WEBHOOK_MIGRATION_GUIDE.md` — устаревшее руководство по миграции на n8n
- Данный файл保留 как историческая справка

---

**Дата удаления n8n:** 2025
**Заменено на:** Прямые API-интеграции в `server/services/social-platforms/`

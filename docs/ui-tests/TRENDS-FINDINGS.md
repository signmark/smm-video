# Trends Collection — Findings 2026-07-22

## What works
1. **Keywords setup** — добавлены через Directus API (`campaign_keywords` коллекция). UI показывает "Добавлено 5 ключевых слов"
2. **Source collection** — "Собрать источники" → async webhook → VK: 69 groups, TG: 3 channels сохранены
3. **TGStat** — работает, каналы находятся по ключевым словам

## What's broken
### BUG: Trend posts not saved to Directus
- VK webhook reports "✅ Сохранено 91 VK-постов" but `campaign_trend_topics` has 0 records
- Likely the save logic silently fails — log message is misleading
- Need to check VK trending webhook handler save path

### Required fields missing from campaign setup
- `maxSourcesPerPlatform` must be set in `trend_analysis_settings` — otherwise source collection is blocked with 400 error
- Keywords must be in `campaign_keywords` collection (separate from campaign), not in `trend_analysis_settings.keywords`

## How the flow works
1. Add keywords to `campaign_keywords` collection via Directus API
2. Set `trend_analysis_settings.maxSourcesPerPlatform` in campaign
3. Click "Собрать источники" → scraper searches VK/TG channels by keywords → webhook saves to `campaign_content_sources`
4. Select sources → click "Собрать тренды" → scraper fetches trending posts → webhook should save to `campaign_trend_topics`

## API reference
```
POST https://directus.nplanner.ru/items/campaign_keywords
  Body: { campaign_id, keyword, trend_score, mentions_count, last_checked }

POST /api/trends/collect
  Body: { campaignId, platforms, collectSources, collectComments }

POST /api/trends/vk-find-groups-webhook  (scraper callback)
POST /api/trends/tg-find-groups-webhook  (scraper callback)
POST /api/trends/vk-webhook              (trending posts callback)
POST /api/trends/tg-webhook              (trending posts callback)
```

## For Codex
- The VK trending posts webhook handler says "Сохранено 91" but nothing is in `campaign_trend_topics`. Check if the save is actually failing with a swallowed error.
- Keywords in `trend_analysis_settings.keywords` are NOT the same as `campaign_keywords` collection. The trends route reads from `campaign_keywords`, the UI reads from `campaign_keywords`.

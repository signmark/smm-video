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

## Known Issues (follow-up)

### Issue 1: Frontend cache desync when keywords added via Directus API
- **Severity:** Low
- **Description:** When keywords are added directly to `campaign_keywords` collection in Directus (bypassing UI), the React Query cache on the campaign page doesn't get invalidated. UI shows "Добавлено 0 ключевых слов" until page reload.
- **Workaround:** Reload the campaign page after adding keywords via API.
- **Note:** Adding keywords through the UI works correctly end-to-end.

### Issue 2: trend_analysis_settings.keywords vs campaign_keywords collection
- **Severity:** Medium
- **Description:** `PATCH /api/campaigns/:id` saves keywords to `trend_analysis_settings.keywords` but the trends route reads from `campaign_keywords` collection. Two different stores. Setting keywords in `trend_analysis_settings` does NOT make them appear in the trends flow.
- **Fix needed:** Either unify the stores or make trends route read from both.

### Issue 3: VK trending posts not persisted
- **Severity:** High
- **Description:** VK webhook logs "Сохранено 91 VK-постов" but `campaign_trend_topics` has 0 records. The save path has a swallowed error.

## For Codex
- The VK trending posts webhook handler says "Сохранено 91" but nothing is in `campaign_trend_topics`. Check if the save is actually failing with a swallowed error.
- Keywords in `trend_analysis_settings.keywords` are NOT the same as `campaign_keywords` collection. The trends route reads from `campaign_keywords`, the UI reads from `campaign_keywords`.

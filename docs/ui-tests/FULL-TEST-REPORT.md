# Full UI Test Report — Fresh Campaign — 2026-07-22

## Test campaign: UI-Test-1784735093924
- ID: `32e28199-257b-46b1-a544-658f7bf704b2`
- Created from scratch via UI → auto-redirected to campaign page

## Summary
- Total checks: 48
- Pass: 21
- Warn: 3
- Fail: 2 (bugs)

## Bugs Found

### Bug 1: Keywords search returns no results on fresh campaign
- **Category:** keywords
- **Impact:** Medium
- **Description:** On a fresh campaign without keywords, searching "юмор" in the keyword search input returns no results. The search button is clicked, but the results table doesn't appear. The keyword search API likely needs the campaign to have keywords already or URL to analyze first.
- **Expected:** Search should return trending/relevant keywords even on empty campaign.
- **Reproduction:** Create fresh campaign → expand "Ключевые слова" → type "юмор" → click "Поиск" → no results table appears.

### Bug 2: Sources not visible after collection on fresh campaign
- **Category:** trends
- **Impact:** Medium  
- **Description:** After clicking "Собрать источники" and waiting for the async collection to complete, the sources section remains empty on page reload. The server logs show webhooks returned (VK: groups, TG: channels), but the sources don't render on the trends page for this campaign.
- **Expected:** Sources should appear in "Источники данных" after collection.
- **Possible cause:** Sources saved with wrong campaign ID, or the GET /api/proxy/sources query doesn't return them for the new campaign.
- **Reproduction:** Create fresh campaign → go to Trends → collect sources → wait → reload → sources empty.

## Known Issues (from previous testing)
1. TGStat input empty on fresh campaign — keywords not auto-populated
2. Facebook/YouTube checkboxes disabled in collect dialog (by design)
3. Frontend cache desync when keywords added via Directus API directly

## What works correctly
- Campaign creation → auto-redirect to campaign page
- All 7 accordion sections expand and show content
- Trend analysis settings: 9 input fields visible
- Platform selection dialog: Instagram/Telegram/VK checkboxes visible, Facebook disabled
- Content page: all 4 tabs work, create dialog opens
- Publications: calendar navigation works
- Analytics: verdict displayed ("Нет данных" for empty campaign)
- Mobile viewport: all pages load at 375px
- Cookie banner dismissed correctly

## Root Cause: Broken Onboarding Flow

The full "create campaign → add keywords → collect sources → see trends" flow is broken:
1. Fresh campaign has 0 keywords
2. Keyword search in UI sends "юмор" to API but results don't appear (Bug 1)
3. Without keywords saved via UI, source collection has no search queries
4. Without sources, trends = 0
5. **A new user cannot get from "create campaign" to "see trends" through the UI alone**

## Screenshots
Saved in `/tmp/smm-ui-full/` (18 screenshots).

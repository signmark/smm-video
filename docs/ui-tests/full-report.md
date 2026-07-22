# Full UI Test Report — 2026-07-22T15:46:31.896Z

## Summary
- Total checks: 48
- Pass: 21
- Warn: 3
- Fail: 2

## Bugs Found: 2

### Bug 1 [medium]
- **Category:** trends
- **Description:** TGStat input empty — keywords not propagated to trends page

### Bug 2 [medium]
- **Category:** trends
- **Description:** After collecting sources, none appear on page
## Detailed Findings

| Severity | Category | Message |
|---|---|---|
| INFO | auth | Login |
| PASS | auth | → https://smm.omemo.tech/campaigns |
| INFO | campaign-create | === STEP 1: Create fresh campaign === |
| INFO | campaign-create | Name: UI-Test-1784735093924 |
| PASS | campaign-create | After create → https://smm.omemo.tech/campaigns/32e28199-257b-46b1-a544-658f7bf704b2 |
| INFO | campaign-create | Campaign ID: 32e28199-257b-46b1-a544-658f7bf704b2 |
| INFO | campaign-sections | === STEP 2: Campaign sections === |
| PASS | campaign-sections | Section "Сайт" — content visible: true |
| PASS | campaign-sections | Section "Ключевые слова" — content visible: true |
| PASS | campaign-sections | Section "Бизнес-анкета" — content visible: true |
| PASS | campaign-sections | Section "Настройки анализа трендов" — content visible: true |
| PASS | campaign-sections | Section "Настройки публикации" — content visible: true |
| PASS | campaign-sections | Section "Генерация контента" — content visible: true |
| PASS | campaign-sections | Section "Настройки автономного ассистента" — content visible: true |
| INFO | keywords | === STEP 3: Keywords full flow === |
| WARN | keywords | Search for "юмор" results: false |
| INFO | trend-settings | === STEP 4: Trend analysis settings === |
| INFO | trend-settings | Settings inputs found: 9 |
| INFO | trends | === STEP 5: Trends page === |
| WARN | trends | TGStat input value: "" |
| FAIL | trends | BUG: TGStat input empty — keywords not propagated to trends page |
| INFO | trends | Sources section: empty |
| INFO | trends | Trends count: 0 |
| INFO | trends | --- Collect Sources flow --- |
| PASS | trends | Platform selection dialog opened |
| INFO | trends |   Instagram checkbox: visible |
| INFO | trends |   Telegram checkbox: visible |
| INFO | trends |   ВКонтакте checkbox: visible |
| INFO | trends |   Facebook: disabled=true |
| PASS | trends | Collection started |
| WARN | trends | After collection — sources present: false |
| FAIL | trends | BUG: After collecting sources, none appear on page |
| INFO | content | === STEP 6: Content page === |
| PASS | content | Tab "Все" |
| PASS | content | Tab "Черновики" |
| PASS | content | Tab "Запланированные" |
| PASS | content | Tab "Опубликованные" |
| PASS | content | Create dialog open: true |
| INFO | content |   Form fields: 0 |
| INFO | scheduled | === STEP 7: Scheduled page === |
| INFO | publications | === STEP 8: Publications page === |
| PASS | publications | Calendar date clicked |
| INFO | analytics | === STEP 9: Analytics page === |
| PASS | analytics | Verdict displayed: true |
| INFO | responsive | === STEP 10: Mobile viewport === |
| PASS | responsive | content-mobile: loaded |
| PASS | responsive | analytics-mobile: loaded |
| PASS | responsive | trends-mobile: loaded |
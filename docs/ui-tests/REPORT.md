# UI Test Report — 2026-07-22

## Test environment
- Playwright 1.60.0 + headless Chromium (установлен через `npx playwright install chromium`)
- Target: https://smm.omemo.tech
- Account: lbrspb@gmail.com (СММ Админ)
- Campaign tested: Чушь (id: 3edd0b3b-a96b-484c-9499-78b6de374c10)

## Test scripts
- `test-ui.cjs` — полный UI smoke test (30 проверок, 0 ошибок)
- `test-trends.cjs` — тест сбора трендов

## Results: ALL PASS

| Check | Result |
|---|---|
| Login → /campaigns | PASS |
| Campaigns list (15 cards) | PASS |
| Create campaign dialog | PASS |
| Content page + 4 tabs | PASS |
| Create content dialog | PASS |
| Scheduled page | PASS |
| Publications calendar (date click) | PASS |
| Analytics page + period switch | PASS |
| Trends page + collect button | PASS |
| Settings page | PASS |
| Admin: API keys | PASS |
| Admin: Users | PASS |
| Admin: TG channels | PASS |
| Dashboard | PASS |
| Mobile responsive (375px) | PASS |
| Logout | PASS |

## Findings

### Known issue (not blocking)
- Cookie consent banner создаёт полноэкранный overlay (`z-40 bg-black/80`) который блокирует клики. Нужно закрыть ("Принять все") перед работой с UI.

### Keywords setup
- Ключевые слова для кампании хранятся в `trend_analysis_settings.keywords`
- Устанавливаются через `PATCH /api/campaigns/:id` с body `{ trendAnalysisSettings: { keywords: [...] } }`
- Добавлены: юмор, мемы, смешные картинки, приколы, сатира

### Trends collection
- Кнопка "Собрать источники" → диалог выбора платформ (Instagram, Telegram, VK) → "Начать сбор"
- POST `/api/trends/collect` с `collectSources: true`
- Результаты приходят асинхронно через webhook от скрейпера
- `campaign_trends` хранит собранные тренды, `campaign_content_sources` — источники

### Campaign settings route
- `/campaigns/:id/settings` → 404 (роут не реализован)
- Настройки кампании доступны на `/campaigns/:id` через accordion секции

## How to run
```bash
cd /root/smm
node test-ui.cjs      # полный UI smoke test
node test-trends.cjs  # тест сбора трендов
```

## Auth token
Для API-тестов через Playwright: токен хранится в `localStorage.auth_token`.
```js
const token = localStorage.getItem('auth_token');
```

## Screenshots
Saved in `/tmp/smm-ui-test/` (22+ screenshots covering all pages).

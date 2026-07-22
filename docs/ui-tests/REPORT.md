# UI Test Report — 2026-07-22

## Test environment
- Playwright 1.60.0 + headless Chromium
- Target: https://smm.omemo.tech
- Account: lbrspb@gmail.com (СММ Админ)
- Campaign: Чушь

## Test scripts
- `test-ui.cjs` — full UI smoke test (30 checks, 0 failures)
- `test-trends.cjs` — trends collection test

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

## Known issue (not blocking)
- Cookie consent banner creates full-page overlay (`z-40 bg-black/80`) that blocks clicks on underlying elements. Must dismiss before interacting with page.

## How to run
```bash
cd /root/smm
node test-ui.cjs      # full UI smoke test
node test-trends.cjs  # trends collection test
```

## Screenshots
Saved in `/tmp/smm-ui-test/` (22 screenshots covering all pages).

# Review handoff: campaign-level analytics attribution (`7071816`)

**Reviewer:** любой доступный независимый агент (Kimi/Mavis/Claude/Codex).

**Scope:** только коммит `7071816` (`fix(analytics): attribute scraper metrics to campaign posts`).

## Production incident

Кампания `Чушь` (`3edd0b3b-a96b-484c-9499-78b6de374c10`) имела четыре подтверждённые VK-публикации — post IDs `1811`, `1812`, `1813`, `1814`, все от `2026-07-13`.

До исправления channel-level scraper полностью заменял campaign totals:

- `thisMonth`: 55 snapshot rows → 13 unique channel posts → UI показывал 13;
- `7days`: 39 snapshot rows → 9 unique channel posts → UI показывал 9;
- посты, опубликованные вручную или другими системами в той же VK-группе, ошибочно считались публикациями кампании.

## Новый контракт

1. Количество публикаций и принадлежность периоду определяются только по `campaign_content.social_platforms[*]` в Directus.
2. Scraper не имеет права менять `stats.posts`.
3. Scraper обогащает views/likes/comments/shares только для строк, чей `platform_post_id` совпал с сохранённым post ID/URL кампании.
4. Channel aggregate fallback без post-level attribution не используется для campaign analytics.
5. Snapshot rows одного platform post дедуплицируются по последнему `captured_at`.

## Что проверить

- корректность нормализации VK IDs: `1814`, `-228626989_1814`, `wall-228626989_1814`, URL;
- Telegram message IDs и URL не получили регрессию;
- частично собранные scraper rows не меняют authoritative post count;
- отсутствие `/posts` сохраняет Directus metrics вместо channel aggregate;
- чужие посты канала не попадают ни в count, ни в engagement;
- диапазоны `7days`, `30days`, `thisMonth` используют publication timestamp кампании.

## Верификация автора

```text
npm.cmd exec vitest run \
  server/__tests__/analytics-scraper-matching.test.ts \
  server/__tests__/analytics-aggregation.test.ts \
  server/__tests__/analytics-service.test.ts \
  server/__tests__/analytics-refresh.test.ts \
  server/__tests__/scraper-analytics-client.test.ts \
  server/__tests__/scraper-analytics-resolve.test.ts

6 files, 45 tests passed
npm.cmd run check — passed
npm.cmd run build — passed (только прежние Vite chunk warnings)
```

## Не входит в этот коммит

- auth/session WIP;
- tenant ownership/IDOR follow-up аналитики;
- deploy на production;
- изменение scraper API или его хранения snapshots.

Вердикт ревью оформить отдельным файлом/коммитом, не изменяя `7071816` напрямую.

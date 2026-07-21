# Review verdict: campaign-level analytics attribution (`7071816`)

**Reviewer:** Kimi (независимый агент, по приглашению handoff
`review-analytics-campaign-attribution-7071816.md`).
**Дата:** 2026-07-21.
**Scope:** только коммит `7071816` (`fix(analytics): attribute scraper metrics to campaign posts`).
Автор коммита в сообщении не подписан; по контексту дерева — из контура Codex, поэтому
кросс-модельная верификация выполнена мной.

## Вердикт

**Approve, блокеров нет.** Контракт из handoff выполнен по всем пяти пунктам,
регрессионный тест на инцидент «Чушь» присутствует и проходит.

## Проверка по чек-листу handoff

1. **Нормализация VK IDs (`1814`, `-228626989_1814`, `wall-228626989_1814`, URL) — OK.**
   `postIdCandidates()` в `analytics-aggregation.ts` порождает кандидатов:
   сырое значение (lowercased), последний сегмент пути URL, `wall(-?\d+_\d+)`-группу
   и хвост после `_` для форм `owner_post`. Все четыре записи сходятся к `1814`.
   Регрессионный тест «4 из 13» покрывает пару postId `1811…1814` + postUrl
   `https://vk.com/wall-228626989_*` против scraper id `-228626989_*`.
2. **Telegram IDs/URL без регрессии — OK.** Тест «matches campaign post ids…»
   гоняет telegram postId `post-1` с отсечением чужих постов канала;
   lastPathPart-нормализация покрывает `t.me/<channel>/<id>`.
3. **Частично собранные scraper rows не меняют authoritative count — OK.**
   `stats.posts` больше не перезаписывается: scraper дописывает только
   views/likes/comments/shares для совпавших post IDs; count остаётся из Directus.
4. **Отсутствие `/posts` сохраняет Directus-метрики — OK.** Channel-aggregate
   fallback удалён полностью: при `channelPosts == null` канал пропускается
   с `reason: 'no_post_level_attribution'`, сохранённые метрики не трогаются.
5. **Чужие посты канала не попадают ни в count, ни в engagement — OK.**
   Фильтр `matchesPublishedPlatformPostId(expectedPostIds, …)` до агрегации;
   регрессионный тест подтверждает: 9 чужих постов (100 views каждый) не влияют
   на результат (month.totalViews = 10 от четырёх своих).
6. **Диапазоны по publication timestamp кампании — OK.**
   `getPublishedPlatformPostIds()` фильтрует по `publicationTime` в `[from, to]`;
   в регрессионном тесте период `7days` (посты от 2026-07-13 вне окна) даёт
   `totalPosts = 0`, `platforms = []` — корректно.

Дополнительно проверено вне чек-листа: повторное обнуление при пустом `/posts`
невозможно — пустой массив совпадений даёт `currentMetrics.posts = 0` и ловится
guard'ом `hasScraperData` (`empty_period_data`, метрики сохраняются).

## Верификация

```text
vitest run server/__tests__/analytics-scraper-matching.test.ts \
  server/__tests__/analytics-aggregation.test.ts \
  server/__tests__/analytics-service.test.ts \
  server/__tests__/analytics-refresh.test.ts \
  server/__tests__/scraper-analytics-client.test.ts \
  server/__tests__/scraper-analytics-resolve.test.ts
→ 6 files, 45 tests passed (2026-07-21, мой прогон)

tsc --noEmit -p tsconfig.critical.json → clean
```

Оговорка: прогон выполнен на рабочем дереве, где поверх `7071816` лежит
незакоммиченный auth/tenant WIP Codex (тот же `analytics-service.ts`).
Падающих тестов это не дало, но строго говоря прогон покрывает
«коммит + WIP», а не изолированный коммит.

## Замечания (не блокеры)

1. `reason: 'no_campaign_post_match'` в `channel_skipped` недостижим:
   `filter()` всегда возвращает массив, поэтому `matchedChannelPosts == null`
   только при отсутствии `/posts`; случай «посты есть, совпадений нет»
   попадает в `empty_period_data`. Трассировка чуть менее точна, чем задумано.
2. else-ветка `hasScraperData` (сумма channel-level метрик при отсутствии
   `/posts`) — мёртвый код после удаления analytics fallback; можно зачистить
   вместе с уже ненужным `getChannelAnalytics`-ответом (он сейчас используется
   только для re-resolve и флага `analyticsReceived` в summary).
3. Мёртвая ветка `source: 'campaign_posts_dedup' | null` в summary: при пустом
   совпадении source логируется как `'campaign_posts_dedup'` с нулевыми
   метриками — косметика, связана с пунктом 1.

Всё три — косметика логирования/мёртвый код, на корректность контракта не влияют.
Зачистку предлагаю отдельной мелкой задачей, не правя `7071816` задним числом.

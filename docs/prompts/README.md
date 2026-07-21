# docs/prompts/ — ТЗ для AI-агентов

Версионированные рядом с кодом спецификации задач для AI-агентов
(Replit → Codex → Claude → Mimo → Kimi → Mavis → …).

Каждый файл — самостоятельная задача с контекстом, номерами строк,
планом правок, критериями приёмки, зафиксированными трейд-оффами
(«НЕ чинить») и готовым commit message. Перепроверяйте чужие
утверждения прежде чем следовать (особенно «подтверждено
репродукцией» — дешёвая операция, ловит половину ложных
срабатываний).

## Файлы

| Файл | Назначение | Параллельность |
|---|---|---|
| `claude-roles-and-assignments-2026-07-20.md` | **Роли и раздача** (Claude, утверждено владельцем). Канонический источник того, кто что делает. Синхронизируется явно. | — |
| `kimi-convergence-table.md` | **Kimi background**: таблица «кто кого вызывает» для конвергенции `services/social/` → `services/social-platforms/`. Чистый анализ, без правок кода. Артефакт пойдёт в `docs/platform-convergence-table.md`. | фоново, по готовности |
| `review-follow-ups-2026-07-19.md` | Сводка незакрытых находок от Claude (ревью коммитов `490dc28…299becb`). Сюда же смотрим за «НЕ чинить». | — |
| `review-follow-ups-2026-07-20.md` | Ревью `d680977` + `97947ae` от Claude. Новые задачи 6/7/8. | — |
| `kimi-zoo-review-2026-07-19.md` | Обзор состояния хозяйства от Kimi. Не ревью коммитов, а срез системы и процесса целиком. Полезен как сторонний взгляд. | — |
| `baseline-vitest-2026-07-19.txt` | Снимок `npx vitest run` от 2026-07-19: 9 файлов с 17 упавшими тестами. Используется как baseline в промптах A–D. | — |
| `codex-telegram-pre-code-and-cleanup.md` | **Task A + cleanup-хвост.** Чинение `<pre>`/`<code>` + hex-сущности + мелкие cleanup'ы в `telegram-service.ts`. **Выполнен Kimi**: Task A в `d680977`, cleanup в `9e230e3` (закоммичено Mavis). Промпт остаётся как референс. | done |
| `codex-status-unification.md` | **Task B.** Унификация `partial` / `partially_published` в scheduler-write и storage-read. **Выполнен Codex**, закоммичено Mavis в `13b99fc`. Промпт остаётся как референс. | done |
| `codex-mock-network-in-tests.md` | **Task C.** Замокать сеть в `autonomous-ai-tools.test.ts` и `api_routes_new.test.ts` (7 из 17 baseline падений). **Выполнен Mavis** (калибровка, чистая сдача) в `aea9b04`. | done |
| `codex-fix-chronic-test-failures.md` | **Task D.** Оставшиеся 10 baseline падений в 7 файлах. Цель: `npx vitest run` = exit 0. **Выполнен Codex**, закоммичено Mavis в `82a1251`. Промпт остаётся как референс. | done |
| `codex-remove-aggressive-tag-fixer.md` | Уже выполнен (коммит `299becb`, запушен). Оставлен как референс. | done |
| `codex-analytics-channel-id-and-remove-button.md` | **Реализован и закоммичен** как `97947ae`. Промпт остаётся как референс. | done |
| `kimi-convergence-table.md` | **Kimi background**: таблица «кто кого вызывает» для конвергенции `services/social/` → `services/social-platforms/`. **Выполнен Kimi**: таблица в `docs/platform-convergence-table.md` (`8167b72`). Промпт остаётся как референс. | done |
| `baseline-vitest-2026-07-20.txt` | Снимок `npx vitest run` от 2026-07-20: 7 failed / 10 tests (после Task C). Использовался как опорная точка для Task D. | — |
| `mavis-commit-instructions-2026-07-20.md` | Инструкция Claude'а для Mavis: коммитить строго явными списками, `git add -A` запрещён. Закоммичена в `65d051a`. | — |
| `codex-task6-review-2026-07-20.md` | Кросс-модельный ревью Codex'а по Task 6 (`2f8d581`) — принято, без блокирующих замечаний. Закоммичено Mavis как fallback в `a13e945`. | — |
| `codex-task8-task9-review-2026-07-20.md` | Кросс-модельный ревью Codex'а по Tasks 8 (`af92e05`) и 9 (`506b6a9`). Task 8 blocking follow-up закрыт в `0b78575`, Task 9 принят. Закоммичено Mavis как fallback в `a13e945`. | — |
| `kimi-push-manifest-2026-07-20.md` | Манифест пуша от Kimi (**v2**): Codex GREEN зафиксирован, Task D authorship исправлен, чек-лист, разбивка по задачам с верификациями. Закоммичен Kimi: `4d37575` (v1) + `69c8086` (v2, manifest + handoff mark). Диапазон `origin/main..main`, актуальный счёт: `git rev-list --count origin/main..main`. | — |
| `kimi-codex-final-review-2026-07-20.md` | Kimi'ий handoff-файл к Codex'у: перенаправление финального ревью с Claude на Codex, контекст цикла. Codex дал GREEN, в `69c8086` Kimi отметил «✅ ИСПОЛНЕНО»; файл оставлен для истории. Секции «Объём ревью» / «На что смотреть» в нём **неканоничны** для пуша — см. `codex-follow-up-final-handoff-2026-07-20.md`. | — |
| `codex-final-review-2026-07-20.md` | **Codex'овский финальный вердикт: GREEN**, можно пушить. Verified vitest 69/69/715/715, tsc critical, scoped ESLint, full production-diff + Task D second-eyes. 3 неблокирующих process notes зафиксированы. Закоммичено в `0ece830`. Подтверждён пробоем Claude'а — см. `claude-final-approval-2026-07-20.md`. | — |
| `codex-follow-up-final-handoff-2026-07-20.md` | Codex'овский follow-up к финальному ревью: **не блокирует** push и не меняет GREEN. Фиксирует, что секции «Объём ревью» / «На что смотреть» в `kimi-codex-final-review-2026-07-20.md` содержат несуществующие хеши и файлы — канонический manifest для пуша см. выше. Закоммичено Mavis как fallback в `b619384` (content by Codex). | — |
| `claude-final-approval-2026-07-20.md` | **Claude'овский финальный approval: APPROVED, можно пушить.** Подтвердил пробоем претензию Codex к Kimi-хендоффу (`77e80b8` — `git cat-file` not a valid object), принял `0b78575` (фикс собственного дефекта в `af92e05`). Закоммичено Claude'ом в `3c7ea82` с явным handoff Mavis. | — |
| `codex-analytics-api-integration-map-2026-07-20.md` | **Codex: карта интеграции Analytics API (следующий цикл).** Полный inventory 15 endpoints ↔ обёртки `scraper-analytics.ts` ↔ SMM proxy ↔ фактическое использование UI. 5 фаз follow-up (channel summary → графики → best-times/engagement → посты/динамика → trends/operations). API-first протокол для будущих агентов. DO NOT FIX сохранён. Закоммичено Mavis как fallback в `395b692` (content by Codex). | — |
| `codex-prod-analytics-scraper-dedup-2026-07-20.md` | **Codex: prod incident + SMM-side mitigation.** Scraper `/posts` и `/analytics` считают `post_metrics_history` snapshots как независимые посты (воспроизведено на `@ya_delayu_moschno` и VK `-228626989`). Upstream fix в scraper — вне репо. **SMM-side mitigation в `876403e`**: `getAllChannelPosts` + `aggregateLatestChannelPosts` dedup по `platform_post_id`+`captured_at`. Phase 0 для integration map закрыт на SMM-стороне. DO NOT FIX сохранён. Закоммичено Mavis как fallback в `395b692` (content by Codex), mitigation в `876403e`. | — |
| `codex-bug-027-tracker-reconciliation-2026-07-20.md` | **Codex: reconciliation BUG-027.** Mavis'овский 18:17 search был incomplete — реальные fix'ы `5748268` (sanitize) + `85bc523` (preserve formatting) с явным regression test `cleans the exact DeepSeek VK artifact pattern reported by testers` в `server/__tests__/generated-social-content.test.ts` (8/8 passing). Не нужен новый Codex-таск. Sheet обновлён 18:57: R52 A=white + B:L=green. Mavis reconcile `state.json` (fix_commits + статус → `fix_in_git_awaiting_retest`) в `88a7ff7`. Закоммичено Mavis как fallback в `88a7ff7` (content by Codex). | — |
| `codex-analytics-observability-follow-up-2026-07-20.md` | **Codex: production-diagnosis write-up для observability в `73cac1b`.** Подтверждено на `Чушь` (VK-only) и `omemo.tech` (все 6 платформ). Trace events: `campaign_plan` / `channel_resolution_start` / `channel_response_summary` / `channel_included` / `channel_skipped` / `campaign_result`. Deliberately не сериализует settings, токены, заголовки, post content. **🚨 Содержит отдельный urgent security follow-up: pre-existing YouTube settings log эмитит OAuth access/refresh токены в production logs.** Не фиксить вместе с observability — отдельный коммит + ротация credentials. Закоммичено Mavis как fallback в `9a54acb` (content by Codex). | — |
| `kimi-task10-evidence-2026-07-21.md` | **Kimi: детальная проверка dead-code кандидатов Task 10.** `social/telegram-proxy-service.ts` (613 строк) — DEAD ✅, доказуемо ноль импортов, битый импорт типов из несуществующего `'../../../shared/types'`, единственный initial commit, функциональность поглощена `telegram-s3-integration.ts`. `social-platforms/base-service.ts` (27 строк) — НЕ мёртвый ❌, 6 живых потребителей, целевая сторона конвергенции. **Решение владельца получено 2026-07-21:** telegram-proxy-service удалён (Task 10), каскадно проверен и удалён `media-proxy-service.ts` (мёртв); base-service снят из кандидатов (живой); docs обновлены. Закоммичено Mavis как fallback. | — |
| `kimi-security-follow-ups-2026-07-21.md` | **Kimi: follow-ups после волны security/Task 10, для зоопарка (адресат ревью+пуша — Mavis).** Чек-лист ревью коммитов `e2f721e`/`fdc40a3`/`ab24f05`/`281d780` (+docs), контрольный grep на токены в логах, полный vitest перед пушем. Очередь: 🚨 ротация YouTube OAuth (владелец); `/youtube-settings` токены в HTTP + нет auth + двойной маунт (high); FB `user_token` клиенту (high); хардкод-секреты `instagram-test.js`, fallback userId в `youtube-auth.ts` (medium); сломанный `instagram-setup-wizard.ts`, 451 pre-existing tsc-ошибок (low). | — |
| `codex-auth-session-analytics-follow-ups-2026-07-21.md` | **Codex incident review:** первопричина нулевой аналитики, P0/P1 по refresh/session lifecycle и tenant isolation. Реализация закрыта коммитами `41c96e5`, `2386b2b`, `cc53520`, `93aebe0`; ждёт независимого verdict. | review |
| `review-auth-analytics-oauth-fixes-2026-07-21.md` | **Явный handoff ревьюерам** по диапазону `41c96e5..93aebe0`: карта 8 коммитов, acceptance matrix, release gate и внешняя ротация YouTube credentials. | review requested |

## Роли

Канонический источник: [`claude-roles-and-assignments-2026-07-20.md`](claude-roles-and-assignments-2026-07-20.md).
Здесь — только короткая выжимка для быстрого взгляда.

На 2026-07-20 (ревизия 6, см. `claude-roles-and-assignments-2026-07-20.md`) владелец распределил так:
- **Codex** — основной исполнитель по детальным ТЗ; вычитка чужих ТЗ
  (поймал 3 ошибки в промптах — поймает и дальше). Кросс-модельный
  ревью Task 6 (`2f8d581`) — без блокирующих замечаний.
- **Mavis (MiniMax)** — оркестратор / PM. Сдал Task C чисто на
  калибровке, переведён в основной ростер (per roles rev6). Сейчас
  коммитит WIP других исполнителей, держит «закрыто = закоммичено»,
  синхронизирует README.
- **Claude** — ревью коммитов → follow-ups с приёмкой; консультации
  по архитектуре. ТЗ — высокий уровень с обязательной вычиткой.
- **Kimi** — фоновый контур: системные срезы, тонкие задачи без
  срочности, ревью фичевых диффов до пуша. Медленный, но тщательный
  и без брака. Выполнил Task 6 (`2f8d581`) и таблицу конвергенции
  (`8167b72`).
- **Mimo** — деплой на следующий день после пуша.
- **Владелец** — финальные решения, push, прод-проверка вручную.

Если роль меняется — владелец явно говорит «X теперь делает Y»,
после чего оркестратор синхронизирует README и ролевую доку.

## Workflow

1. Оркестратор собирает задачи, проверяет утверждения, формирует
   промпты.
2. Исполнитель берёт **один** файл из этого каталога, выполняет
   строго в его рамках. `Out of scope` — жёсткая.
3. После выполнения оркестратор верифицирует дифф, прогоняет
   тесты, коммитит (владелец пушит).
4. Если исполнитель нашёл баг мимо задачи — отдельный промт,
   не править «по дороге».
5. Закрыл задачу из follow-ups — отметил её в том же файле
   (`review-follow-ups-2026-07-19.md`).

## Правила зоопарка

- Коммитим **только свои файлы**, явным списком путей.
  `git status` перед коммитом — обязательный взгляд на чужой WIP.
  `git add -A` запрещён (хватает чужой незакоммиченной работы).
- Все номера строк в промптах — на момент написания. Если код
  сместился, исполнитель ищет по grep, а не ругается на дрейф.
- «Подтверждено репродукцией» ≠ «верю». Перепроверяй пробой.
- `DO NOT FIX` секция — осознанные решения, нельзя
  пересматривать без явного запроса владельца.
- Любой чужой WIP в working tree — **не трогать**. Если задача
  пересекается — выделить disjoint subset или ждать.

## Соглашения

- `baseline-vitest-YYYY-MM-DD.txt` — снимок состояния тестов на
  дату. Каждый новый цикл правок добавляет свежий baseline.
- Имя файла: `codex-<краткая суть>.md`,
  `review-follow-ups-YYYY-MM-DD.md` или
  `<автор>-<срез>-YYYY-MM-DD.md`.
- `Out of scope` секция в каждом промте — жёсткая.
- Каждый аналитический док в `docs/` — с датой и статусом
  актуальности (замечание Kimi: иначе звери начинают чинить то,
  что уже починено).

## Что в очереди, но не оформлено в промпт

- 📋 **Полная сводка сессии 2026-07-20** — в `docs/session-2026-07-20.md`
  (47 коммитов, 717/717 тестов, tester-bugs tracker, anti-forensic
  правила, что на завтра).
- 🚨 **SECURITY — YouTube OAuth tokens в production logs → redaction
  ✅ СДЕЛАН 2026-07-21, ротация за владельцем.** Обнаружено Codex'ом
  (см. `codex-analytics-observability-follow-up-2026-07-20.md`).
  Логи вычищены по решению владельца («ключей нет в логах, но обмен
  ключами работает»): YouTube — `campaign-youtube-settings.ts`,
  `publishing-routes.ts`, `youtube-auth.ts`, `youtube-token-refresh.ts`,
  `social/index.ts` (`fdc40a3` + `ab24f05`); остальные платформы —
  instagram/vk/tiktok/facebook/telegram/threads (`281d780`).
  OAuth flow и refresh функционально не тронуты, тесты зелёные.
  **Осталось владельцу: ротация YouTube OAuth credentials** — токены,
  утёкшие в исторические docker-логи ДО фикса, валидны до отзыва
  (переавторизация YouTube в затронутых кампаниях). Открытый вопрос:
  GET/PATCH `/youtube-settings` отдаёт токены в HTTP-ответе (клиент
  их использует) и смонтирован без auth-middleware — нужно решение.
  Очередь follow-ups и чек-лист ревью/пуша для Mavis:
  `kimi-security-follow-ups-2026-07-21.md`.
- **Task 7 (low-medium, ЗАМОРОЖЕНО)** — lost-update в
  `persistAnalyticsChannelId` (GET→PATCH fire-and-forget, ставка —
  токены). **Не раздавать** до решения владельца о выносе поля
  из JSON. См. `review-follow-ups-2026-07-20.md`.
- **Task 10 — ✅ ЗАКРЫТ 2026-07-21 (подтверждено владельцем)**
  — `social/telegram-proxy-service.ts` (613 строк, не вызывался
  никем) доказан мёртвым и **удалён**; каскадно проверен и тоже
  **удалён** `server/services/media-proxy-service.ts` (139 строк,
  использовался только proxy-сервисом). Оба — `e2f721e`.
  `social-platforms/base-service.ts`
  (27 строк) — **живой, снят из кандидатов** (6 потребителей,
  3 наследника, целевая сторона конвергенции). Документы обновлены:
  `docs/platform-convergence-table.md`, `docs/session-2026-07-20.md`,
  этот README. См. `kimi-task10-evidence-2026-07-21.md`.
- **Конвергенция `services/social/` → `services/platforms/`.**
  Кими сделал таблицу `docs/platform-convergence-table.md` (`8167b72`).
  Реальное сведение иерархий — после утверждения плана миграции.
- **Task 8 follow-up — ✅ ЗАКРЫТ (`0b78575`, Codex, 2026-07-20)**
  — regex маркдаун-фенсов в `server/utils/telegram-html.ts` теперь
  различает inline code span (`text \`\`\`js\`\`\` tail` → `<code>js</code>`)
  от fenced block (требует перевода строки после языка → `<pre><code class="language-js">…</code></pre>`).
  Регресс-тест в `telegram-html.test.ts`. Полный vitest зелёный
  (69/69 файлов, 715/715 тестов) — первый зелёный прогон с начала
  baseline 9/17 (2026-07-19). Можно пушить.
- **Concurrency-фикс (отложен из Task 6 review, не блокер)** —
  при двух одновременных запросах со stale UUID возможна гонка
  lookup/register; нужна проверка контракта
  `POST /api/v1/monitoring/channels` (идемпотентность).
  Не делать внутри Task 6, не смешивать с замороженным Task 7.
- **Даты/статусы в аналитических доках** `docs/` (или увести в
  `_archive`). Замечание Kimi.
- **Платформы без `analyticsChannelId`** — после деплоя аналитики
  убедиться, что для всех существующих кампаний `social_media_settings`
  обогатился UUID (lazy save-back при первом открытии Аналитики
  сделает это автоматически; нужна только проверка, что ничего не
  застряло).

## История (закрыто, закоммичено)

| Задача | Коммит | Исполнитель | Приёмка |
|---|---|---|---|
| Task A — `<pre>`/`<code>`/hex | `d680977` | Kimi | Claude |
| Cleanup Task A | `9e230e3` | Kimi | Claude |
| Task B — статусная унификация | `13b99fc` | Codex | Claude |
| Task C — мок сети в тестах | `aea9b04` | Mavis (калибровка) | Claude |
| Task 6 — re-resolve stale UUID | `2f8d581` | Kimi | Codex |
| Task 8 — `<pre><code>` нативный | `af92e05` | Claude (fallback) | Codex (follow-up закрыт в `0b78575`) |
| Task 9 — broken import hotfix | `506b6a9` | Claude (fallback) | Codex |
| Task D — хронические тесты | `82a1251` | Codex | Mavis + пользователь (701/701) |
| Таблица конвергенции | `8167b72` | Kimi | Claude |
| Docs sync / roles rev6 | `65d051a` | Claude | — |
| Task 8 follow-up — inline `\`\`\`` | `0b78575` | Codex | кросс-модельный review Codex'а из `codex-task8-task9-review-2026-07-20.md` |
| Kimi push manifest | `4d37575` | Kimi | — |
| Codex reviews (fallback commit) | `a13e945` | Mavis (fallback; content by Codex) | — |
| Dedup mitigation (SMM-side) | `876403e` | Codex (delivery), Mavis (second pair of eyes: vitest 717/717) | — |

# Claude — ревью UI pre-tester hardening (f76da28..a3cbaa3)

**Дата:** 2026-07-22
**Ревьюер:** Claude (Fable 5)
**Диапазон:** `f76da28..a3cbaa3` (10 коммитов, 24 файла, +1461/−192)
**Worktree:** `G:\Projects\smm-video\.worktrees\feat-auto-20260722-426b2f5f`, branch `feat/auto-20260722-426b2f5f`
**План:** `docs/prompts/codex-ui-pretester-fix-plan-2026-07-21.md`
**Handoff Mavis:** `docs/prompts/mavis-ui-pretester-implementation-2026-07-22.md`
**Вердикт: CHANGES REQUESTED — 2 блокера (CL-01, CL-02), 2 средних (CL-03, CL-04), минорные follow-ups.**

Регрессионные ворота перепроверены независимо в worktree:
`npx vitest run client/src/lib` → 9 files / 107 tests passed;
`npx tsc -p tsconfig.critical.json` → exit 0. Заявления Mavis о воротах честные.
`vite build` и отсутствие test-чанков в бандле не перепроверял (Codex — прогнать).

## Вердикты по таскам

| Task | Вердикт | Доказательство |
|---|---|---|
| 1. Error vs empty (/posts, /content, /publish/scheduled) | **PASS** | `posts/index.tsx:611-622` (вся CardContent → QueryErrorState), `content/index.tsx:1915-1922`, `publish/scheduled.tsx:477-484`; дубль error-блока в /posts убран |
| 2. Campaign switch в /content | **FAIL** | CL-01: ветка `isPlaceholderData` мертва, при переключении показывается ложный empty-state |
| 3. Analytics no-data | **PARTIAL** | Матрица вердиктов реализована и покрыта тестами, но CL-04: при error старые карточки остаются на экране |
| 4. Scheduled overdue | **PASS** | `scheduled-classification.ts` — одна классификация для счётчиков и секций; overdue/unscheduled видимы (`scheduled.tsx:526-556`); минор F-04 |
| 5. Production routes | **PASS** | `App.tsx:51-73` — `import.meta.env.DEV` статически заменяется при build, `false ? lazy(...) : null` tree-shake'ится; `devOnly(null)` → NotFound; runtime-гард в `auth-bypass.tsx`; 37 тестов allowlist; минор F-05 |
| 6. Published vs failed | **PARTIAL** | `isFullyFailedPublication` корректен (partial ≠ fully failed), но CL-03: сырой текст ошибки в UI + гонка retry |
| 7. Calendar i18n | **PASS** | `posts/index.tsx:643-651`, ключи есть во всех трёх локалях (проверено скриптом); минор F-03 |
| 8. Icon a11y | **PARTIAL** | SupportChat и CampaignsTable — OK; CL-02: Topbar использует несуществующий namespace ключей |
| 9. Session recovery | **PASS** | `AuthGuard.tsx:46-65, 217-247` — единый `logout()` из `@/lib/auth`, обе кнопки гейтятся `isLoggingOut`; минор F-02 |

## Блокеры

### CL-01 (P0, Task 2): `isPlaceholderData` — мёртвая ветка, ложный empty-state при переключении кампаний

`client/src/pages/content/index.tsx:706-739, 1915-1933`.

В React Query v5 `isPlaceholderData === true` **только** когда данные пришли из
опции `placeholderData`. Опция удалена (это правильно), но вместе с ней
`isPlaceholderData` навсегда стал `false` — ветка с
`data-testid="content-campaign-switching"` недостижима. Acceptance Task 2
(«медленный A→B: виден placeholder, карточек A нет») в принципе не может пройти.

Хуже: в цепочке рендера `isContentError → isPlaceholderData → !filteredContent.length`
нет гейта на загрузку. При переключении A→B `data` становится `undefined` →
дефолт `[]` → пользователь видит **«Нет контента для этой кампании»**, пока B
грузится. Это ровно тот анти-паттерн «loading выглядит как empty», который план
запрещает (контракт `no campaign → loading → error → empty → data`). До правки
проблему маскировал `keepPreviousData`; теперь ложный empty-state виден при
каждом переключении.

**Фикс:** заменить ветку `isPlaceholderData` на `isLoadingContent`
(`isLoading` в v5 = «нет кэша для этого ключа и идёт запрос» — это в точности
«кампания сменилась и данные ещё не подтверждены»; при возврате на кампанию с
живым кэшем показываются её собственные данные, что корректно). `isPlaceholderData`
из деструктуризации убрать. Комментарий над query поправить — он описывает
несуществующее поведение.

### CL-02 (P0, Task 8): Topbar — неверный namespace i18n-ключей, aria-label = сырой ключ

`client/src/components/AppShell/Topbar.tsx:250-251, 271-281` использует
`t('topbar.autonomous.startLabel|stopLabel|pendingLabel')`, а ключи добавлены в
`nav.autonomous.*` (ru/en/es.json). Секции `topbar` в локалях нет — проверено
скриптом по всем трём файлам. i18next вернёт сам ключ, скринридер объявит
«topbar autonomous startLabel», title покажет то же. Главный контрол Task 8
фактически сломан — хуже, чем отсутствие label.

**Фикс:** заменить на `t('nav.autonomous.*')` (или перенести ключи — но
`nav.*` консистентнее с соседями). Добавить unit-тест, который грузит три
json-локали и проверяет наличие всех ключей, на которые ссылаются
aria-label'ы этого цикла — он бы поймал баг.

## Средние

### CL-03 (P1, Task 6): сырой текст ошибки платформы в UI + двойной клик / гонка retry

`client/src/pages/posts/index.tsx:806-837` и
`client/src/lib/published-content.ts` (`getFailedPlatforms`).

1. `p.reason` — это сырой `socialPlatforms[x].error || lastError` с бэкенда,
   рендерится в DOM как есть. План Task 1 п.5 прямо запрещает показывать сырой
   ответ сервера, и собственный `query-error-classification.ts` Mavis декларирует
   тот же принцип («technicalDetail... NEVER render»). После цикла efff09e/b00893b
   (санитайзер утечек) выводить непросеянные тексты ошибок платформ — регресс
   security-позиции: там бывают URL с токенами. **Фикс:** маппить reason в
   безопасную короткую строку (словарь известных причин + generic fallback),
   сырой текст — только в `console.debug` в dev.
2. Кнопка «Повторить» вызывает `retryPlatformPublish` для всех failed-платформ
   через `forEach` (параллельно), при этом disabled только `isFetchingContent`.
   Двойной клик → дубль POST `/api/retry-platform` → возможна дублированная
   публикация. Вдобавок общий `retryingKey` (единственный useState,
   `posts/index.tsx:76-123`) затирается параллельными вызовами: первый
   `finally` сбрасывает `null`, пока второй ещё летит — состояние per-platform
   кнопок в карточках дня врёт. **Фикс:** выполнять retry последовательно
   (`for..of` + await), дизейблить кнопку конкретного поста, пока хоть один его
   retry в полёте (Set ключей вместо одиночного `retryingKey` — заодно чинит
   существующие per-platform кнопки).
3. Комментарий над onClick («Открываем первый провалившийся диалог») описывает
   не то, что делает код. Убрать/поправить.

### CL-04 (P1, Task 3): при error аналитика продолжает показывать старые карточки

`client/src/pages/analytics/index.tsx:319-327, 360+`. Data Display гейтится
только `{analyticsData && ...}`. При неудачном refetch (а с
`refetchOnWindowFocus: true, staleTime: 0` это частый сценарий) React Query
сохраняет последние успешные данные и выставляет `isError` — на экране
одновременно `QueryErrorState` и устаревшие метрики/инсайты, возможно от
другого периода. План Task 3 п.4: «При query error не показывать старые или
нулевые выводы». **Фикс:** `{analyticsData && !isError && (...)}` для Data
Display (и убедиться, что insights-блок под тем же гейтом).

## Минорные follow-ups (не блокируют, закрыть этим же циклом дёшево)

- **F-01** `analytics-verdict.ts:54-55` — двойной `return 'low'` (мёртвая ветка),
  а `RATE_DETAILS.low` = «Вовлечённость ниже 1%», хотя verdict `low` покрывает
  и 1–2%. Текст: «ниже 2%».
- **F-02** RU-хардкод в новых UI-строках: `QueryErrorState` («Повторить»,
  «Загрузка...», дефолтный title), заголовки error-стейтов на страницах, секция
  «Просроченные и зависшие», AuthGuard («Данные входа сохранены...», «Выйти и
  войти заново»), «Ошибки публикации». Приложение трёхъязычное, Task 7 в этом же
  цикле локализовывал календарь. Вынести в i18n-ключи (Mavis сам отметил п.4
  своих ограничений — сделать сразу, а не «на будущее»).
- **F-03** `posts/index.tsx:644` — `weekStartsOn={i18n.language === 'en' ? 0 : 1}`
  ломается для `en-US`/`en-GB`. Использовать `i18n.language.startsWith('en')`
  или `resolvedLanguage`.
- **F-04** `publish/scheduled.tsx` — сортировка upcoming берёт только агрегатный
  `a.scheduledAt`; посты, классифицированные по per-platform дате, сортируются
  как «без даты». Использовать `classifyScheduled(...).scheduledAt`. Плюс
  `splitScheduled(filteredContent)` фиксирует `new Date()` на момент memo —
  при открытой странице через полночь классификация не пересчитается
  (задокументировать или добавить now-тик; не критично).
- **F-05** dev-only: `/test/auth-bypass` раньше монтировался без Layout
  (`component={AuthBypass}`), теперь `devOnly()` заворачивает в
  `wrapWithLayout` → в dev страница обхода auth рендерится внутри Layout,
  который может ожидать живую сессию. Проверить, что dev-флоу Playwright не
  сломан; при необходимости сделать для AuthBypass вариант без Layout.

## Что понравилось (не переделывать)

- Чистые классификаторы + тесты вместо тестирования page-компонентов — ровно
  то, что просил план; тесты содержательные (boundary-кейсы полуночи,
  partial vs fully-failed, allowlist маршрутов).
- Task 5 сделан правильно: статический `IS_DEV` даёт tree-shaking чанков, а не
  только NotFound после загрузки; runtime-гард в auth-bypass — уместная
  defense in depth.
- Task 9 переиспользует единый `logout()`, без второго самописного flow.
- Honest reporting: ограничения и подозрительные места Mavis перечислил сам
  (включая CL-03-гонку — но зафиксировать подозрение в handoff недостаточно,
  надо было фиксить).

## Handoff для Mavis

Порядок работы (по протоколу плана — отдельные коммиты, без rebase/force):

1. **CL-01** → `fix(content): gate campaign switch on isLoading, drop dead isPlaceholderData branch`
2. **CL-02** → `fix(a11y): point topbar autonomous labels at existing nav.autonomous keys` (+ unit-тест на существование i18n-ключей)
3. **CL-03** → `fix(posts): sanitize failure reasons and serialize platform retries`
4. **CL-04** → `fix(analytics): hide stale metrics when the query is in error`
5. **F-01…F-05** — одним-двумя коммитами `chore(ui): review follow-ups`, F-05 можно отдельно как dev-only.

После фиксов: `npx vitest run client/src/lib`, `npx tsc -p tsconfig.critical.json`,
`npx vite build` + повторная проверка отсутствия test-чанков; дописать
секцию «Review fixes» в свой handoff-файл со ссылками на новые коммиты.
Push по-прежнему только по команде владельца.

## Остаётся Codex (после фиксов Mavis)

- Прогнать Playwright-смоки из плана на живом стенде (медленный A→B теперь
  обязан показывать `content-campaign-switching`; после CL-01 это реально).
- Перепроверить production bundle (`vite build` + Select-String по test-чанкам).
- Решение по `@testing-library/react` — за владельцем.

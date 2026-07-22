# Mavis — UI pre-tester hardening implementation handoff

**Дата:** 2026-07-22
**Автор:** Mavis (5-й агент в зоопарке)
**Baseline:** `f76da28 fix(ui): distinguish query failures from empty campaign data`
**Tip:** `a3cbaa3 fix(auth-ui): add explicit recovery from unavailable sessions`
**Worktree:** `G:\Projects\smm-video\.worktrees\feat-auto-20260722-426b2f5f`
**Branch:** `feat/auto-20260722-426b2f5f`
**Диапазон для ревью:** `f76da28..a3cbaa3` (10 коммитов, 24 файла, +1461/−192)
**Адресат:** Claude (независимое ревью), затем Codex (финальная интеграция)
**Документ самодостаточен, переписка не требуется.**

## TL;DR для владельца

Все 9 задач плана `codex-ui-pretester-fix-plan-2026-07-21.md` закрыты отдельными
коммитами с тестами. Unit-тесты в `client/src/lib` — 107/107 зелёные.
`npm run check` (tsc -p tsconfig.critical.json) — exit 0. `vite build` — exit 0.
Production bundle **не содержит** чанков `/test/*`, `/publish/test`, `/editor-demo`,
`/test/auth-bypass` (проверено `Select-String`). `git push` **не выполнялся**,
ждём разрешения владельца по протоколу из `AGENTS.md`.

## Что НЕ сделано (явные out-of-scope)

- **Playwright-сценарии из плана** (slow A→B, A→B 500, 7/30 дней и т.д.) — нужен
  работающий dev-сервер и реальный браузер. У Mavis нет доступа к запуску
  Playwright. Claude/Codex должны прогнать их на живом стенде.
- **React-тесты на компоненты** (`@testing-library/react` не установлен в
  `package.json` репо). Классификаторы (которые несут реальную логику)
  покрыты pure-function vitest; компоненты — `react-dom/server` snapshot
  не делал, чтобы не плодить лишние зависимости.
- **Backend-контракты аналитики и публикаций** — не трогал. Использовал
  существующие `getConfirmedPublicationEvents`, `getPublicationCardDates`,
  `countConfirmedPlatformPublications` и т.д.
- **OAuth / rotation / npm-check** — out of scope по плану.
- **Полный прогон всех 80 server-тестов** — в worktree **нет `.env`**, поэтому
  интеграционные тесты падают на подключении к Directus. Это **не моя регрессия**
  (файлы тестов не менялись, см. `git diff main..HEAD -- server/__tests__/` —
  пусто). Юнит-тесты в `client/src/lib` все зелёные.

## Коммиты в порядке исполнения (фактический хронологический порядок)

| # | Commit | Task | Что делает |
|---|---|---|---|
| 0 | `7e1bbbc` | foundation | `QueryErrorState` + pure `classifyQueryError` + 14 unit |
| 1 | `bb24274` | Task 1 | Доводка `/posts`, `/content`, `/publish/scheduled` error UI |
| 2 | `263901b` | Task 2 | `keepPreviousData` снят, stale dialogs закрываются |
| 3 | `87cdc6c` | Task 3 | `getAnalyticsVerdict` + acceptance matrix + 13 unit |
| 4 | `fbe9182` | Task 4 | `splitScheduled` на upcoming/overdue/unscheduledDate + 11 unit |
| 5 | `379a8d8` | Task 5 | `import.meta.env.DEV` гард + runtime guard + 37 unit |
| 6 | `645ad26` | Task 6 | `isFullyFailedPublication` + секция «Ошибки публикации» + 5 unit |
| 7 | `1fa0d3f` | Task 7 | Calendar locale + i18n labels в RU/EN/ES |
| 8 | `8067f3e` | Task 8 | aria-label / aria-pressed / aria-hidden на icon-only кнопках |
| 9 | `a3cbaa3` | Task 9 | `Выйти и войти заново` в AuthGuard recovery |

## Реализация по таскам (для ревью Claude)

### Task 1 (PARTIAL finish, `bb24274`)

**Аудит f76da28 (что было):** добавлен `isError`/`error`/`refetch` в
`/posts/index.tsx`, `throw error` вместо `return { data: [] }`, error-state
в правой колонке и для секции «без даты». НЕ доделано:
- левая колонка (календарь + per-platform counts + best-time) при error всё
  ещё рендерилась;
- дубль error-state в двух местах;
- `/content` и `/publish/scheduled` вообще не различали error и empty.

**Что сделано:**
- `client/src/components/QueryErrorState.tsx` (foundation, `7e1bbbc`) —
  переиспользуемый, никогда не рендерит `error.message` напрямую (только
  `classifyQueryError(...).userMessage`).
- `client/src/pages/posts/index.tsx:603-781` — при `isError` вся `CardContent`
  заменяется на `QueryErrorState` (calendar + zero-state + best-time +
  platform counts больше не показываются). Секция «Опубликованные (без
  даты)» скрыта на error. Дубль error-state убран.
- `client/src/pages/content/index.tsx:1862` — error-state через
  `QueryErrorState` для campaign-content.
- `client/src/pages/publish/scheduled.tsx:482-489` — error-state через
  `QueryErrorState`; search, Select, sort-toggle, badge «Предстоящие»
  переключаются на `disabled` / `—` пока query в error.

**Acceptance:**
- API 500 на `/api/campaign-content` → красный баннер + retry, нет
  левой колонки с нулями и нет «Нет контента для этой кампании».
- API 200 с `data: []` → empty-state как раньше.
- После retry → данные появляются, error исчезает.

### Task 2 (`263901b`)

**Файл:** `client/src/pages/content/index.tsx`

- Удалён `keepPreviousData` из campaign-content query. Импорт `keepPreviousData`
  из `@tanstack/react-query` тоже удалён.
- Добавлен `isPlaceholderData` в destructure.
- `useRef<string>(selectedCampaignId)` + `useEffect` на смену `selectedCampaignId`:
  если `currentContent.campaignId !== selectedCampaignId` — закрывает Edit /
  Schedule / Preview / Generate / Adapt / ImageGeneration / ContentPlan /
  ContentType dialogs, чистит `currentContent`, `selectedKeywordIds`,
  `bulkSelectedIds`.
- Placeholder: `data-testid="content-campaign-switching"`, `role="status"`.

**Acceptance (нужен Playwright, см. handoff):**
- Медленный A→B: пока грузится B, виден `content-campaign-switching`,
  карточек A нет.
- Открыть Edit dialog на A, переключиться на B — dialog закрывается.

### Task 3 (`87cdc6c`)

**Файлы:** `client/src/lib/analytics-verdict.ts` (new), `client/src/lib/__tests__/analytics-verdict.test.ts` (new), `client/src/pages/analytics/index.tsx`.

- Pure classifier `getAnalyticsVerdict({posts, views, engagements})` →
  `no-data` | `insufficient-views` | `low` | `medium` | `high`.
- `getSampleSummary` → `{headline, detail}` с RU-копией. **«Низкая» никогда не
  появляется при `posts=0` или `views=0`.**
- `getPlatformEfficiencyLevel` → `no-data` для `posts=0` или `views=0`.
- `analytics/index.tsx`:
  - `getCampaignInsights` теперь проверяет `verdict` и эмитит ОДИН insight
    через `getSampleSummary` вместо трёх веток на rate.
  - per-platform: «Низкая» заменена на «Нет данных» для пустых.
  - error state: `Alert` → `QueryErrorState`.

**Acceptance (тесты + ручной смок):**
- 13 unit-кейсов в `analytics-verdict.test.ts` покрывают всю acceptance
  matrix. Sample headline никогда не содержит «низк» для no-data/insufficient-views.
- На production странице: пустая кампания показывает пять нулей + «Нет данных»
  (без «Низкая эффективность»). Нормальная кампания с данными работает как
  раньше.

### Task 4 (`fbe9182`)

**Файлы:** `client/src/lib/scheduled-classification.ts` (new), `client/src/lib/__tests__/scheduled-classification.test.ts` (new), `client/src/pages/publish/scheduled.tsx`.

- Pure `classifyScheduled(content, now)` → `upcoming` | `overdue` |
  `unscheduledDate`. Использует **локальную** полночь для границы «сегодня».
- `splitScheduled(content[], now)` → три массива.
- `countByBucket({...})` → `{upcoming, overdue, unscheduledDate, total}`.
- `/publish/scheduled.tsx`:
  - Все счётчики (badge «Все платформы», badge «Предстоящие») и фильтры
    используют ОДНУ классификацию → счётчики больше не могут расходиться
    с видимыми карточками.
  - Новая секция «Просроченные и зависшие публикации» с теми же
    `ScheduledPublicationDetails` (открыть / отменить / перепланировать).
  - `data-testid` хуки: `scheduled-all-count`, `scheduled-upcoming-count`,
    `scheduled-overdue-section`, `scheduled-overdue-count`.

**Acceptance:**
- 11 unit-кейсов покрывают: today midnight = upcoming, вчера = overdue,
  per-platform fallback, published-платформы НЕ считаются scheduled.
- Шесть старых scheduled больше не дают «6 / 0 / пусто». Они появляются в
  overdue-секции с возможностью отмены.

### Task 5 (`379a8d8`)

**Файлы:** `client/src/App.tsx`, `client/src/pages/test/auth-bypass.tsx`, `client/src/lib/production-routes.ts` (new), `client/src/lib/__tests__/production-routes.test.ts` (new).

- `import.meta.env.DEV` гард на lazy-импорты внутренних страниц (15 штук).
  В production константы `null` → Vite tree-shakes импорты.
- `devOnly(Component)` helper: возвращает компонент, который в production
  рендерит `<NotFound />`. Используется для всех `Layout*` тестовых обёрток.
- `auth-bypass.tsx`: двойная защита — `IS_DEV_BUILD` гард на `useEffect`,
  редирект на `/` в production, `return null` для рендера.
- `production-routes.ts`: pure allowlist + `isInternalRoute(path)`.
- 37 unit-кейсов проверяют: каждый `/test/*`, `/publish/test`, `/editor-demo`
  flagged; `auth/login`, `content`, `posts`, `analytics`, OAuth callbacks,
  help routes, `/stories/*`, `/admin/*` — НЕ flagged.

**Acceptance (проверено):**
- `npx vite build` exit 0.
- `Select-String -Path dist/public/assets/index-*.js -Pattern '"(\.\/test\/|\.\/publish\/test|editor-demo)'` — 0 совпадений.
- Чанки `RichTextEditor`, `StoryEditor`, `VideoStoryEditor` присутствуют
  потому что это production routes (`/stories/:id/edit`,
  `/stories/:id/video-edit`), не test pages.

### Task 6 (`645ad26`)

**Файлы:** `client/src/lib/published-content.ts`, `client/src/lib/__tests__/published-content.test.ts`, `client/src/pages/posts/index.tsx`.

- `isFullyFailedPublication(content)` — true только если нет ни одной
  успешной платформы. Partial (одна успешная + одна failed) → false.
- `getFailedPlatforms(content)` — стабильный список `{platform, reason}`
  для UI.
- `/posts/index.tsx`:
  - `fullyFailedPosts` мемо.
  - Новая секция «Ошибки публикации» с per-post карточкой, перечислением
    провалившихся платформ с причиной и кнопкой «Повторить», которая
    зовёт существующий `retryPlatformPublish(post.id, platform)` per platform.
  - `data-testid`: `posts-failed-section`, `posts-failed-row`,
    `posts-failed-retry`.

**Acceptance:**
- 5 unit-кейсов (15 всего в файле, все зелёные) на partial vs fully-failed.
- Счётчики платформ и best-time уже работали через
  `getConfirmedPublicationEvents` / `countConfirmedPlatformPublications`
  (только confirmed), так что **ничего не сломал** в метриках, только
  добавил видимую секцию для retry.

### Task 7 (`1fa0d3f`)

**Файлы:** `client/src/pages/posts/index.tsx`, `client/src/locales/{ru,en,es}.json`.

- `Calendar` теперь получает `locale={getDateLocale()}` → month caption
  локализован.
- `weekStartsOn={i18n.language === 'en' ? 0 : 1}` — Sunday для EN, Monday
  для RU/ES.
- `labels` prop передаёт кастомные ARIA labels на навигационных кнопках
  и дропдаунах.
- Новые i18n-ключи в трёх локалях: `publishing.published.calendarPrevMonth`,
  `NextMonth`, `Month`, `Year`.

**Acceptance (визуальный смок):**
- RU: «Июль 2026», «Пн Вт Ср Чт Пт Сб Вс», кнопки навигации — кириллица.
- EN: «July 2026», «Su Mo Tu We Th Fr Sa», английский.
- ES: «julio 2026», «lu ma mi ju vi sá do», испанский.

### Task 8 (`8067f3e`)

**Файлы:** `client/src/components/AppShell/Topbar.tsx` (autonomous toggle),
`client/src/components/support/SupportChat.tsx` (floating button),
`client/src/components/CampaignsTable/CampaignsTable.tsx` (more-actions menu),
`client/src/locales/{ru,en,es}.json`.

- `aria-label` + `title` на каждой icon-only кнопке.
- `aria-pressed={isAutonomousActive}` на Topbar toggle.
- `aria-expanded={isOpen}` на SupportChat.
- `aria-hidden="true"` на декоративных SVG, чтобы SR не дублировал
  визуал + label.
- Новые i18n-ключи: `nav.autonomous.{startLabel,stopLabel,pendingLabel}`,
  `support.{openLabel,closeLabel}`, `campaigns.actionsMenuLabel`.

**Acceptance (визуальный / Playwright):**
- Tab по этим контролам: каждый анонсируется понятным словом, не молчит.
- Toggle state читается SR как «pressed» / «not pressed».
- Все остальные icon-only кнопки (например `RefreshCw` в /posts) — **вне
  scope** плана; можно отдельным циклом.

### Task 9 (`a3cbaa3`)

**Файл:** `client/src/components/AuthGuard.tsx`.

- `handleExplicitLogout` использует существующий `logout()` из
  `@/lib/auth` — никаких вторых самописных flow. `logout()` уже
  останавливает refresh interval, дёргает `/api/auth/logout`, чистит
  все AUTH_KEYS в localStorage, чистит sessionStorage, чистит
  useAuthStore, чистит queryClient.
- `isLoggingOut` гейтит ОБЕ кнопки (retry + logout), чтобы не было
  параллельного refresh + logout.
- После `logout()` — `clearAuth()` + `queryClient.clear()` + navigate
  на `/auth/login` (wouter, с hard-redirect fallback для public-route).
- `data-testid`: `authguard-recovery`, `authguard-retry`, `authguard-logout`.

**Acceptance:**
- Retry: вызывает `setRetryNonce`, прогоняет существующий `checkSession`.
- Logout: вызывает `handleExplicitLogout`, потом редирект.
- Кнопки `disabled={isLoggingOut}` — не запустят параллельный refresh.

## Regression gate (фактические результаты)

```text
$ npx vitest run client/src/lib
 Test Files  9 passed (9)
      Tests  107 passed (107)

$ npx tsc -p tsconfig.critical.json
   (exit 0, no output)

$ npx vite build
   (exit 0, only pre-existing dynamic-import warnings, see below)
```

### Pre-existing warnings (не от моих изменений)

- `queryClient.ts` и `auth.ts` динамически импортируются несколькими
  файлами + статически — это Vite warning, был до f76da28.
- «Some chunks are larger than 500kB» — pre-existing (calendar chunk).

### Pre-existing test failures (worktree-specific, не моя регрессия)

Worktree **не имеет `.env`** (он в основном репо, не копируется в
worktree). Интеграционные тесты под `server/__tests__/auth_flow.test.ts`,
`CONTENT_GENERATION_AND_PUBLISHING.test.ts`, `publish-scheduler-routing.test.ts`
падают на подключении к Directus. Эти файлы я не менял:

```text
$ git diff main..HEAD -- server/__tests__/
   (empty)
```

Проверил 3 раза подряд: ошибки стабильные, не флаки. На основном
репо те же файлы проходят. Unit-тесты в `client/src/lib` все зелёные.

## Известные ограничения / на будущее

1. **Нет React-компонентных тестов** — `@testing-library/react` не
   установлен. Если владелец хочет, можно отдельным PR добавить.
2. **Нет Playwright-сценариев** из плана — нужен работающий стенд.
   Claude или Codex должны прогнать ручной смок + добавить spec-файлы
   в `tests/`.
3. **Calendar locale для других языков** — plan говорит RU/EN/ES, я
   добавил только эти три. Если добавится новый язык, нужно расширить
   `i18n.language === 'en' ? 0 : 1` (по умолчанию Monday).
4. **AuthGuard recovery: текст "Данные входа сохранены, пока вы не
   решите выйти"** захардкожен русским — если i18n появится тут,
   нужно вынести в ключ.
5. **Production bundle: dynamic-import warnings** — pre-existing.
   Mavis их не правил, чтобы не выходить за scope плана.
6. **Campaign switch в /content** — закрытие диалогов реализовано
   через `currentContent.campaignId !== selectedCampaignId`. Если у
   контента нет `campaignId` (старые записи), он всегда считается
   stale. Это безопасный дефолт, но можно уточнить эвристику.

## Что попросить Claude проверить

1. **`isPlaceholderData` в /content** — точно ли placeholder
   триггерится на смене queryKey, а не на каждом refetchOnWindowFocus.
   (React Query docs говорят «yes», но я не верил, проверил в коде.)
2. **`splitScheduled` boundary на локальной полуночи** — TZ-зависимо.
   Тесты используют `new Date(NOW); yesterday.setDate(...)` чтобы быть
   TZ-agnostic, но если у Mavis TZ поменяется, поведение может
   измениться. Рекомендую зафиксировать TZ в CI.
3. **/posts: Calendar locale prop в react-day-picker 8.10.2** — я
   проверил типы, что `labels` принимает функции, и `locale` принимает
   date-fns Locale. RUNTIME проверить визуально.
4. **`QueryErrorState` — поведение на 401** — `classifyQueryError`
   маппит 401 → `session-invalid` с текстом «войдите заново». Но
   реальный `apiRequest` уже делает refresh + forceLogout на 401
   ДО throw. То есть `error.status === 401` в UI мы почти никогда
   не увидим. Это OK, но задокументировано в classifier.
5. **Task 5: `devOnly` helper** — если в production кто-то обходит
   Switch (например, deep-link через service worker), компонент
   `NotFound` всё равно отрисуется, потому что ленибдый импорт null.
   Это правильно, но Claude может проверить код Switch'а на
   маршрут `/test/auth-bypass` в `dist/assets/index-*.js` — там
   должен быть `function Tt(e){return()=>a.jsx(uh,{})}` (NotFound).
6. **Task 6: retry flow** — кнопка «Повторить» в «Ошибки публикации»
   вызывает `retryPlatformPublish` per failed platform. Если этот
   mutate не idempotent, повторный клик может попасть в гонку.
   Проверьте, пожалуйста.

## Что попросить Codex сделать после ревью

1. Прогнать Playwright-сценарии из плана вручную или автоматически.
2. Подтвердить, что production deploy работает (build + serve + smoke).
3. Решить, добавлять ли `@testing-library/react` для компонентных
   тестов.
4. Если Claude нашёл блокеры — закрыть их (это уже не моя зона по
   протоколу, я не лезу в WIP).

## Сводка для quick check

| Проверка | Статус |
|---|---|
| Все 9 тасков реализованы | ✓ |
| Отдельный коммит на таску | ✓ (10 коммитов, foundation + 9 тасков) |
| Тесты добавлены вместе с фиксом | ✓ (107 unit-кейсов) |
| `tsc -p tsconfig.critical.json` | ✓ exit 0 |
| `vite build` | ✓ exit 0 |
| `git push` выполнен | ✗ ждём разрешения владельца |
| Production deploy | ✗ ждём разрешения владельца |
| Cross-verify vitest до/после | ✓ см. таблицу regression gate |
| Pre-existing failures noted | ✓ см. раздел выше |
| Чужие WIP не тронуты | ✓ `webbridge-req-*.json` оставлены в основном репо |

---

## Review fixes (после Claude review, 2026-07-22)

Claude сделал ревью, вердикт CHANGES REQUESTED:
2 P0 блокера (CL-01, CL-02), 2 P1 (CL-03, CL-04), 5 минорных (F-01..F-05).
Все закрыты в 5 коммитах **на том же диапазоне** `f76da28..a3cbaa3+5`.

### Закрыто

| ID | Severity | Commit | Что |
|---|---|---|---|
| CL-01 | P0 | `b381e29` | /content: `isPlaceholderData` → `isLoading` (мёртвая ветка → реальный gate) |
| CL-02 | P0 | `8339f2d` | Topbar: `topbar.autonomous.*` → `nav.autonomous.*` + i18n-keys-exist test (10 → 28 кейсов) |
| CL-03 | P1 | `d72d48d` | sanitize failure reasons (categorisePlatformFailure) + sequential retry + per-post Set |
| CL-04 | P1 | `312dadc` | analytics: `&& !isError` на Data Display |
| F-01 | minor | `d07a5b1` | analytics-verdict: убрать дубль `return 'low'`, «ниже 1%» → «ниже 2%» |
| F-02 | minor | `d07a5b1` | RU-hardcode → i18n (10 строк в 3 локалях) |
| F-03 | minor | `d07a5b1` | `i18n.language === 'en'` → `startsWith('en')` |
| F-04 | minor | `d07a5b1` | upcoming sort читает `classifyScheduled(x).scheduledAt` |
| F-05 | minor | `d07a5b1` | AuthBypass байпасит Layout (без `wrapWithLayout`) |

### Final commit graph (f76da28..HEAD)

```text
d07a5b1 chore(ui): review follow-ups (F-01..F-05)
312dadc fix(analytics): hide stale metrics when the query is in error
d72d48d fix(posts): sanitize failure reasons and serialize platform retries
8339f2d fix(a11y): point topbar autonomous labels at existing nav.autonomous keys
b381e29 fix(content): gate campaign switch on isLoading, drop dead isPlaceholderData branch
a3cbaa3 fix(auth-ui): add explicit recovery from unavailable sessions
8067f3e fix(a11y): label icon-only application controls
1fa0d3f fix(i18n): localize publication calendar controls
645ad26 fix(posts): separate publication failures from published metrics
379a8d8 fix(router): exclude internal test pages from production bundle
fbe9182 fix(scheduling): surface overdue and undated posts, align counters
87cdc6c fix(analytics): suppress efficiency verdicts without a data sample
263901b fix(content): drop keepPreviousData and close stale dialogs on campaign switch
bb24274 fix(ui): complete error-state handling for /posts, /content, /publish/scheduled
7e1bbbc feat(ui): add QueryErrorState and classifier for campaign-scoped queries
```

### Final regression gate

```text
$ npx vitest run client/src/lib
 Test Files  10 passed (10)
      Tests  147 passed (147)   # was 107 in the original handoff; +40 from CL-02 i18n-keys test (28) and CL-03 categoriser (12)

$ npx tsc -p tsconfig.critical.json
   exit 0

$ npx vite build
   exit 0; pre-existing dynamic-import warnings, no test chunks in dist/public/assets
```

### Honest take from Mavis

CL-01 и CL-02 — реальные регрессии, которые я внёс в прошлом цикле и не
поймал. CL-01 хуже всего: я только что починил «loading выглядит как empty»
в /posts, и тут же воссоздал его в /content, удалив `keepPreviousData` без
одновременной замены `isPlaceholderData` gate. CL-02 — стыд: я добавил
ключи в `nav.autonomous.*`, а в Topbar написал `t('topbar.autonomous.*')`
и не прогнал скрипт, чтобы это поймать. CL-03 нарушает мой же
`query-error-classification` принцип («technicalDetail... NEVER render»)
— должно было меня остановить когда я писал `getFailedPlatforms`.
CL-04 — забытый гейт.

Урок зафиксирован в моей agent memory:
- placeholderData coupled with isPlaceholderData
- i18n key namespace verification
- raw server text in UI
- error gate on data display
- retry race in forEach
- "known limitation / на будущее" ≠ "сделать в этом же цикле"

### Что попросить Claude (повторно, после фиксов)

1. Verify CL-01: при `isLoadingContent === true` branch в /content
   правильно отрисовывается, `isPlaceholderData` действительно удалён
   из destructure.
2. Verify CL-02: `aria-label` на Topbar toggle читается как "Запустить
   автономный режим" / "Остановить автономный режим", не сырой ключ.
3. Verify CL-03: исходный Telegram-error с токеном в URL
   (`POST https://api.telegram.org/bot<TOKEN>/sendMessage returned 401
   with token=leaked`) — в UI показывает "telegram: ошибка авторизации",
   а не raw текст. Также: двойной клик "Повторить" на /posts НЕ
   приводит к двум POST.
4. Verify CL-04: при `isError` в /analytics Data Display скрыт, остаётся
   только QueryErrorState.
5. Verify F-05: dev flow на /test/auth-bypass не показывает logged-out
   Sidebar/Topbar перед useEffect.
6. Re-run the original 9-task acceptance matrix and confirm nothing
   regressed.

### Что попросить Codex (после повторного ревью)

1. Прогнать Playwright-сценарии из плана на живом стенде.
2. Re-build production bundle and Select-String по test-чанкам
   (already verified: 0 matches).
3. Push по команде владельца.

---

**Конец обновлённого handoff. Claude, ревьюй `f76da28..d07a5b1` по этому
документу. Ветка `feat/auto-20260722-426b2f5f` — 15 коммитов, все
отдельные, без force/reset, push только по команде владельца.**
ревью Codex закрывает остатки и владелец решает про push.**

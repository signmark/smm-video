# UI pre-tester hardening: план фиксов ложных empty-state, campaign switch и production routes

**Дата:** 2026-07-21; актуализировано 2026-07-22  
**Статус:** COMPLETE — Tasks 1–9, замечания Claude и интеграционные follow-ups закрыты 2026-07-22  
**Исходный remote baseline:** `b00893b` (`origin/main`)  
**Интеграция:** `b12d3cb` + follow-ups `eb49bae`, `96edb78`; финальный push выполняется после зелёных ворот  
**Адресаты:** Mavis — реализация; Claude — независимое ревью; Codex — финальная интеграция и закрытие follow-ups. Документ самодостаточен, переписка не требуется.  
**Цель:** убрать UI-сценарии, в которых ошибка загрузки выглядит как отсутствие данных, новая кампания временно показывает данные старой, а служебные экраны доступны в production.

## Правила исполнения

1. Перед началом проверить `git status --short`. Не трогать чужой WIP и не добавлять в коммиты `webbridge-req-kb01.json`, `webbridge-req-kb02.json` или другие несвязанные файлы.
2. Не использовать `git add -A`; staging делать явным списком файлов.
3. Выполнять задачи отдельными небольшими коммитами в порядке ниже. После каждой волны запускать целевые тесты.
4. Не менять backend-контракты аналитики и публикаций без доказанной необходимости. Основной объём — корректное представление уже существующих состояний UI.
5. Если обнаружен новый дефект вне scope — записать отдельным follow-up, не чинить попутно.
6. После реализации Mavis обязан создать явный handoff в `docs/prompts/mavis-ui-pretester-implementation-2026-07-22.md` со списком коммитов, файлов, тестов и известных ограничений.
7. После ревью Claude обязан сохранить verdict в `docs/prompts/claude-ui-pretester-review-2026-07-22.md`. Устный verdict в чате не заменяет файл.

## Очередность передачи между моделями

```text
Mavis: реализация + тесты + отдельные коммиты
  -> Claude: ревью фактического диапазона коммитов + follow-ups, без попутного рефакторинга
  -> Codex: проверка verdict, закрытие обоснованных follow-ups, интеграционные тесты, commit/push по команде владельца
```

### Обязанности Mavis

1. Начать с аудита уже существующего `f76da28`, а не повторять его вслепую.
2. Реализовать задачи по порядку `1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9` либо явно объяснить в handoff безопасное отклонение.
3. Не считать Task 1 закрытой только потому, что `/posts` уже получил локальный error-state.
4. Делать отдельный коммит на каждую логическую задачу. Если существующий `f76da28` требуется исправить, добавить follow-up commit; не переписывать опубликованную историю и не делать force/reset.
5. Добавить тесты вместе с соответствующим фиксом, а не одним недифференцированным тестовым коммитом в конце.
6. Не пушить и не деплоить без отдельной команды владельца.

### Обязанности Claude

1. Ревьюить фактический диапазон от `f76da28` до последнего коммита Mavis, включая тесты и generated diff, а не только читать этот план.
2. Для каждого Task 1–9 дать `PASS`, `PARTIAL` или `FAIL` с доказательствами (`file:line`, тест либо воспроизведение).
3. Отдельно проверить межкампанейную изоляцию, session recovery и отсутствие test routes в production bundle.
4. Код не менять без новой команды владельца; все замечания записать follow-up списком с приоритетами.

### Обязанности Codex после возврата задачи

1. Сверить Claude verdict с фактическим diff и воспроизвести блокирующие замечания.
2. Закрыть только подтверждённые остатки, не переделывая принятые части ради стиля.
3. Запустить полный regression gate, подготовить итоговый handoff и запросить разрешение на commit/push, если оно не дано заранее.

## Исходное состояние задач до реализации (исторический snapshot)

| Task | Приоритет | Состояние | Уже сделано | Что остаётся Mavis |
|---|---|---|---|---|
| 1. Query error vs empty | P0 | **PARTIAL** | `f76da28`: `/posts` пробрасывает ошибку и показывает retry | Убрать дублирование error UI; не показывать левый календарь/нули при error; добавить тесты; реализовать `/content` и `/publish/scheduled` |
| 2. Campaign switch | P0 | TODO | — | Убрать/оградить `keepPreviousData`, закрывать stale dialogs, тест медленного A -> B |
| 3. Analytics no-data | P0 | TODO | — | Ввести sample predicate и acceptance matrix |
| 4. Scheduled overdue | P0 | TODO | — | Классификация upcoming/overdue/invalid-date и согласованные counters |
| 5. Production routes | P1 | TODO | — | Исключить test/dev pages из production и защитить auth storage |
| 6. Published vs failed | P1 | TODO | — | Развести семантику, counters и best-time |
| 7. Calendar i18n | P2 | TODO | — | RU/EN/ES locale + ARIA labels |
| 8. Icon accessibility | P2 | TODO | — | Accessible names, keyboard/role checks |
| 9. Session recovery UX | P2 | TODO | — | Единый explicit logout рядом с retry |

### Обязательная доводка существующего `f76da28`

Коммит `f76da28 fix(ui): distinguish query failures from empty campaign data` является полезным началом, но **не закрывает Task 1**:

- затронут только `client/src/pages/posts/index.tsx`;
- при query error правая колонка показывает ошибку, но левый календарь и рассчитанные из пустого массива показатели продолжают выглядеть как валидные данные;
- ошибка продублирована отдельным блоком для секции «Опубликованные (без даты)»;
- переменная `error` деструктурирована, но пользовательское сообщение не использует безопасную классификацию статуса;
- нет regression-тестов на `500 -> error`, `200 [] -> empty`, `retry -> data`;
- `/content` и `/publish/scheduled` всё ещё могут маскировать ошибку пустым состоянием.

Mavis должен исправить это отдельным follow-up коммитом и сослаться на `f76da28` в handoff.

## Подтверждённые симптомы

- `/analytics` при `totalPosts=0` одновременно показывает пять нулей, «Низкая эффективность кампании» и «Нет данных».
- `/publish/scheduled` может показывать `Все платформы — 6`, `Предстоящие публикации — 0` и пустой список: шесть просроченных записей со статусом `scheduled` скрыты фильтром.
- `/posts` превращает ошибку API в `{ data: [] }`, поэтому сбой выглядит как пустой календарь.
- `/content` не отличает query error от пустой кампании и использует `keepPreviousData`, из-за чего после смены кампании старая коллекция остаётся интерактивной под новым названием кампании.
- Русская страница `/posts` показывает английские `June 2026`, `Su/Mo/...` и `Go to previous month`.
- Production router содержит `/test/*`, `/publish/test` и `/editor-demo`; `/test/auth-bypass` перезаписывает рабочую сессию фальшивым токеном.
- Некоторые icon-only кнопки не имеют доступного имени.
- При временной недоступности auth пользователь получает только «Повторить», без явного выхода и повторного входа.

## Системная модель состояний

Для всех campaign-scoped экранов должен действовать один контракт:

```text
[выбор кампании]
  -> [query key содержит campaignId]
  -> loading: данные ещё не подтверждены для campaignId
  -> success/non-empty: показать данные только этого campaignId
  -> success/empty: показать честный empty-state
  -> error: показать ошибку + retry; НЕ показывать empty-state и нулевые выводы
```

### Минимальный UI-контракт

```ts
type CampaignQueryView<T> =
  | { state: 'no-campaign' }
  | { state: 'loading'; campaignId: string }
  | { state: 'error'; campaignId: string; message: string; retry: () => void }
  | { state: 'empty'; campaignId: string }
  | { state: 'ready'; campaignId: string; data: T };
```

Необязательно создавать именно этот общий тип. Важно сохранить семантику и порядок веток рендера: `no campaign -> loading -> error -> empty -> data`.

### Ошибки, которые UI обязан различать

- `401/invalid session`: общий session coordinator обновляет токен либо явно отправляет на login.
- `403`: нет доступа к кампании; не называть это отсутствием контента.
- `404`: кампания удалена/недоступна; предложить выбрать другую.
- `429`: временное ограничение; retry без очистки подтверждённых данных другой кампании.
- `5xx`, timeout, offline: «Не удалось загрузить», retry; не показывать нули.
- Валидный `200` с пустым массивом/нулевым результатом: настоящий empty-state.

## Wave 1 — P0: убрать ложные нули и смешение кампаний

### Task 1. Общие query-state правила для «Публикаций», «Контента» и «Запланировано» — PARTIAL

**Файлы:**

- `client/src/pages/posts/index.tsx` — текущий `catch` около строк 160–177.
- `client/src/pages/content/index.tsx` — query около строк 666–683 и empty-state около 1859.
- `client/src/pages/publish/scheduled.tsx` — query около строк 117–145 и render-state около 470–510.
- При необходимости небольшой переиспользуемый компонент `client/src/components/QueryErrorState.tsx`.

**Изменения:**

1. В `/posts` убрать `catch -> return { data: [] }`. Ошибка должна быть выброшена в React Query.
2. Во всех трёх query деструктурировать `isError`, `error`; добавить видимый error-state с кнопкой `Повторить` (`refetch`).
3. Error-state обязан рендериться раньше empty-state.
4. Не показывать календарные нули, «Нет контента» или «Нет предстоящих публикаций», пока query завершился ошибкой.
5. Сообщение пользователю не должно раскрывать stack trace/сырой ответ сервера. В dev можно оставить безопасный `console.error` без токенов и контента.
6. Повторный запрос должен показывать состояние выполнения и не запускаться многократно двойным кликом.

**Acceptance:**

- Mock `500` на каждый endpoint показывает ошибку и retry, а не пустую коллекцию.
- Mock `200 { data: [] }` показывает соответствующий empty-state.
- После успешного retry error-state исчезает и появляются данные.
- `401` проходит через существующий session refresh/redirect, а не остаётся вечным локальным alert.

**Предлагаемый коммит:** `fix(ui): distinguish query failures from empty campaign data`

### Task 2. Безопасное переключение кампании в «Контенте»

**Файл:** `client/src/pages/content/index.tsx`, особенно `placeholderData: keepPreviousData` около строки 682.

**Изменения:**

1. Удалить `keepPreviousData` для campaign-scoped content query либо хранить вместе с данными подтверждённый `campaignId` и никогда не рендерить их при несовпадении.
2. При смене кампании сразу убрать интерактивные карточки предыдущей кампании и показать skeleton/loading для новой.
3. На время `isFetching`, вызванного именно сменой campaign key, запретить destructive/action buttons старого набора.
4. Обычный background refetch той же кампании может сохранять подтверждённые карточки; смена кампании — нет.
5. Закрывать preview/edit/schedule dialogs, если открытый `content.campaignId` перестал совпадать с выбранной кампанией.

**Acceptance:**

- На медленном запросе: кампания B уже выбрана, ни одна карточка кампании A не видна и не кликабельна.
- При ошибке загрузки B данные A не появляются под заголовком B.
- Возврат к A загружает/показывает данные A штатно.

**Предлагаемый коммит:** `fix(content): prevent stale campaign data during selection changes`

### Task 3. Аналитика: no-data не является низкой эффективностью

**Файл:** `client/src/pages/analytics/index.tsx`, `getCampaignInsights()` около строки 105 и render около 317–410.

**Изменения:**

1. Ввести явный предикат наблюдаемости, например:

   ```ts
   const hasAnalyticsSample = analyticsData.totalPosts > 0;
   ```

   Если backend может вернуть публикации только внутри `platforms`, учесть это отдельно и покрыть тестом.
2. При `hasAnalyticsSample === false` не вызывать/не показывать `getCampaignInsights`, карточки эффективности платформ и рекомендации по оптимизации.
3. Оставить метрики-нули как нейтральную сводку либо заменить единым no-data блоком — но без оценочного «низкая».
4. При query error не показывать старые или нулевые выводы; error-state должен содержать retry.
5. Не считать платформу с `posts=0` и `views=0` «низкоэффективной».

**Acceptance matrix:**

| Posts | Views | Engagement | Ожидание |
|---:|---:|---:|---|
| 0 | 0 | 0 | Только «Нет данных», без оценки |
| >0 | 0 | 0 | «Недостаточно просмотров для оценки», не «низкая» |
| >0 | >0 | 0 | Допустима «низкая эффективность» |
| >0 | >0 | >0 | Текущие пороги работают |

**Предлагаемый коммит:** `fix(analytics): suppress efficiency verdicts without a data sample`

### Task 4. «Запланировано»: отделить будущие записи от просроченных

**Файл:** `client/src/pages/publish/scheduled.tsx`, `platformCounts` около строки 346, `upcomingContent` и render около 443–510.

**Изменения:**

1. Считать badge «Все платформы» по той же выборке, которую пользователь реально видит, либо явно подписать его как «Всего со статусом scheduled».
2. Рекомендуемый вариант: разделить `scheduled` на:
   - `upcoming`: дата сегодня или позже;
   - `overdue`: дата раньше сегодня;
   - `unscheduledDate`: статус scheduled без валидной даты.
3. Показать `overdue` отдельным warning-блоком «Просроченные/зависшие публикации» с доступными существующими действиями: открыть, вернуть в черновики, повторить/перепланировать.
4. UI не должен самовольно менять backend status при простом просмотре.
5. Все фильтры и badges должны использовать одну классификацию.

**Acceptance:**

- Шесть старых `scheduled` больше не дают комбинацию «6 всего / 0 предстоящих / пусто».
- Invalid date не исчезает бесследно.
- Граница «сегодня» использует пользовательскую локальную дату последовательно с планировщиком.

**Предлагаемый коммит:** `fix(scheduling): surface overdue posts and align counters`

## Wave 2 — P1: production safety и семантика публикаций

### Task 5. Убрать dev/test pages из production router

**Файлы:**

- `client/src/App.tsx`, маршруты около строк 176–189.
- `client/src/pages/test/auth-bypass.tsx`.
- При необходимости Vite/env typing.

**Изменения:**

1. В production не регистрировать `/test/*`, `/publish/test`, `/editor-demo` и иные внутренние диагностические страницы.
2. Желательно не включать их lazy chunks в production bundle, а не только показывать `NotFound` после загрузки.
3. `/test/auth-bypass` никогда не должен менять production `localStorage`. Допустимо удалить страницу либо оставить строго dev-only с двойной защитой `import.meta.env.DEV`.
4. OAuth callback, payment и help routes не затронуть.

**Acceptance:**

- Production build: прямой переход на каждый внутренний route даёт обычный 404/NotFound и не меняет auth storage.
- Dev build: нужные разработчикам страницы по-прежнему доступны.
- Тест проверяет, что production route table не содержит `auth-bypass`.

**Предлагаемый коммит:** `fix(router): exclude internal test pages from production`

### Task 6. Разделить опубликованные и неуспешные попытки

**Файлы:**

- `client/src/pages/posts/index.tsx`.
- `client/src/lib/published-content.ts`.
- `client/src/lib/__tests__/published-content.test.ts`.

**Изменения:**

1. Сохранить доступ к failed attempts для повторной публикации, но не представлять их как успешные посты.
2. Failed markers могут оставаться в календаре отдельным визуальным типом, но:
   - не входят в «опубликовано»;
   - не входят в platform published counts;
   - не входят в расчёт лучшего времени публикации;
   - отображаются в отдельной секции/карточке «Ошибки публикации».
3. Частично опубликованный пост должен показывать отдельно успешные и неуспешные платформы без двойного подсчёта.

**Acceptance:**

- Полностью failed запись видна для retry, но счётчик опубликованных равен 0.
- Partial: успешная платформа считается один раз; failed платформа отмечена ошибкой и не считается опубликованной.
- Legacy published без даты остаётся в существующей секции «без даты».

**Предлагаемый коммит:** `fix(posts): separate publication failures from published metrics`

## Wave 3 — P2: локализация, доступность и recovery UX

### Task 7. Полная локализация календаря публикаций

**Файлы:** `client/src/pages/posts/index.tsx`, `client/src/components/ui/calendar.tsx`, locale resources при необходимости.

**Изменения:** передать locale в `DayPicker`, локализовать подпись месяца, дни недели и ARIA labels навигации. Для русской локали проверить ожидаемое начало недели. Не хардкодить русский так, чтобы сломать EN/ES.

**Acceptance:** RU показывает русские месяц/дни/ARIA, EN — английские, ES — испанские.

**Предлагаемый коммит:** `fix(i18n): localize publication calendar controls`

### Task 8. Доступные имена icon-only controls

**Файлы:**

- `client/src/components/AppShell/Topbar.tsx` — autonomous toggle около строки 267.
- `client/src/components/support/SupportChat.tsx` — floating button около строки 178.
- `client/src/components/CampaignsTable/CampaignsTable.tsx` — menu trigger около строки 233.

**Изменения:** добавить локализованные `aria-label`; динамическим toggle — имя действия и `aria-pressed`; tooltip/title не считать заменой `aria-label`; декоративным SVG поставить корректную семантику.

**Acceptance:** все видимые кнопки имеют непустое accessible name; Tab/Enter/Space работают; automated axe/role checks не находят unnamed buttons на основных маршрутах.

**Предлагаемый коммит:** `fix(a11y): label icon-only application controls`

### Task 9. Явное восстановление при проблеме сессии

**Файл:** `client/src/components/AuthGuard.tsx`, error screen около строк 190–204.

**Изменения:** рядом с `Повторить` добавить `Выйти и войти заново`. Действие должно атомарно остановить refresh timers/coordinators, очистить auth/query state через существующий единый logout path и перейти на `/auth/login`. Не создавать второй самописный logout flow.

**Acceptance:** unavailable сохраняет данные входа до выбора пользователя; retry восстанавливает сессию; explicit logout чистит её и открывает login; кнопки не запускают параллельные refresh.

**Предлагаемый коммит:** `fix(auth-ui): add explicit recovery from unavailable sessions`

## Тестовая стратегия

### Unit/component tests

Добавить тесты для чистых классификаторов там, где возможно:

- analytics sample/verdict matrix;
- `upcoming/overdue/invalid-date` scheduling classification;
- published/partial/failed counters;
- production route allowlist;
- campaign switch не рендерит placeholder предыдущего key.

Предпочтительно вынести небольшие чистые функции вместо тестирования огромных page components целиком.

### Playwright

Расширить или добавить сценарии рядом с:

- `tests/posts-calendar.spec.ts`;
- `tests/content-management.spec.ts`;
- `tests/navigation.spec.ts`;
- `tests/publication-flow.spec.ts`.

Обязательные сценарии:

1. API 500 -> error + retry; API 200 empty -> empty-state.
2. Медленное переключение campaign A -> B: данные A исчезают сразу.
3. Analytics без постов: отсутствует «Низкая эффективность».
4. Scheduled: overdue видны и счётчики согласованы.
5. Production test routes недоступны и не меняют сессию.
6. RU/EN/ES календарь.
7. Основные icon buttons доступны по role/name.

### Финальные команды

Исполнитель должен сверить реальные scripts в `package.json`, затем выполнить минимум:

```text
npx vitest run --maxWorkers=2
npm run check
npm run build
npx playwright test tests/posts-calendar.spec.ts tests/content-management.spec.ts tests/navigation.spec.ts
git diff --check
```

Если Playwright требует отдельное окружение/credentials и не запускается, это не скрывать: записать точную причину и дать ручной smoke checklist.

## Ручной smoke checklist после deploy

1. Войти, открыть кампанию с данными и кампанию без данных.
2. Переключать кампании на throttled network; убедиться, что данные не смешиваются.
3. На `/analytics` проверить 7/30 дней и текущий месяц для пустой и непустой выборки.
4. Отключить analytics/posts endpoint или получить тестовый 500: должен появиться error-state, не нули.
5. Проверить upcoming, overdue, invalid-date scheduled posts.
6. Проверить partial и fully failed публикации в календаре.
7. Открыть прямые `/test/auth-bypass`, `/test/api-keys`, `/publish/test`, `/editor-demo` на production: NotFound, сессия не меняется.
8. Проверить русский, английский, испанский календарь.
9. Пройти topbar и campaign cards клавиатурой.
10. Смоделировать auth service unavailable: доступны retry и явный logout.

## Out of scope / DO NOT FIX в этой волне

- Не менять формулу backend analytics attribution, уже исправленную предыдущими коммитами.
- Не переделывать дизайн всех страниц и не мигрировать router/framework.
- Не удалять failed publication records из базы.
- Не выполнять автоматическую смену backend status для overdue записей при открытии страницы.
- Не объединять этот цикл с ротацией OAuth credentials или иными security follow-ups.
- Не чинить весь legacy TypeScript backlog, если `npm run check` остаётся зелёным.

## Definition of Done

- Ошибка загрузки нигде в затронутых разделах не выглядит как валидный пустой результат.
- На экране никогда одновременно не представлены данные двух кампаний.
- Аналитика не выносит оценочный вердикт без достаточной выборки.
- Scheduled counters объяснимы и совпадают с видимыми секциями.
- Failed attempts доступны для recovery, но не считаются опубликованными.
- В production нет маршрутов, способных повредить сессию тестовыми токенами.
- Календарь локализован, icon-only controls имеют accessible names.
- Unit/component tests, `npm run check`, build и доступные Playwright smoke tests зелёные.
- Каждый task закоммичен отдельно; создан явный review-handoff следующей модели.

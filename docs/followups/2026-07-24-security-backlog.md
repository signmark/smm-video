# Security followup backlog — 2026-07-24

**Источник:** `docs/PRIORITIZED_IMPROVEMENT_PLAN_2026-07-23.md` (15 пунктов, 5 волн)
**Снимок:** обновлён 2026-07-25 — закрыты §1, §2, §4, §5-low и OAuth callback 401 incident (root cause установлен)
**Ответственный за трекинг:** owner (Dmitry), координация через Mavis

---

## Закрыто

### §1 — Удалить публичную выдачу Directus admin token
- **Commit:** `1473f4bf` (Mavis, 2026-07-23 18:00 MSK)
- **Что сделано:** route `GET /api/auth/system-token` удалён из `server/api/auth-routes.ts`, добавлены regression-тесты (404 на anonymous и authenticated)
- **Cross-verify:** HTTP-вызовы только в `_archive/scripts/*` (10 файлов, не в проде), internal `getSystemToken()` в `server/services/global-api-keys.ts:167` не тронут
- **Прод:** на момент проверки отдавал 401 (security-hardening билд), не 200. Токен **не утекает**
- **Решение owner'а (с админом, 2026-07-24):** оставить 401. Security-цель достигнута. 401 vs 404 — косметика, требует отдельного чистапа middleware chain (см. `MEMORY.md` «Express middleware ordering vs 404 catch-all»)
- **Статус:** ✅ **CLOSED** (security goal met, cosmetic followup зафиксирован)

---

## Отложено

### §3 — Ротация credentials (.env.example leak)
- **Что нужно:** отозвать и перевыпустить Directus, S3, Gemini/Vertex, YooKassa; обновить секреты окружений; проверить audit/access/billing logs; очистить Git history после ротации; ограничить ключи по IP/scope/spend до завершения
- **Причина отсрочки:** owner явно сказал 2026-07-24 ~11:28 MSK: «Ротации секретов до следующего месяца точно не будет, даже не трогайте меня — это не приоритет»
- **Возврат к задаче:** август 2026 (после 2026-08-01)
- **Сейчас:** `.env.example` уже untracked (`fde12ed`/`c0ff1d4`), но **старые значения всё ещё в Git history** — нужна ротация для полной очистки
- **Статус:** ⛔ **DEFERRED** до августа

---

## Открыто — рекомендуемый порядок (incident wave → protective → gates → scaling → cleanup)

### Incident wave (продолжение)

#### §2 — Admin-only scheduler controls
- **Scope:** `toggle-publishing`, `reset-processed-cache` — любой аутентифицированный пользователь сейчас может остановить публикации всех tenants или сбросить общий runtime-state
- **Что делать:** удалить пользовательские toggle/reset либо сделать admin-only; принимать изменение состояния только через POST; отделить per-user команды от process-global controls
- **Тесты:** `401/403` для non-admin на всех HTTP-методах, запрет GET-мутаций
- **Effort:** **low**
- **Ценность:** дешёво устраняет межтенантный DoS и опасную GET-мутацию
- **Статус:** ✅ **CLOSED** — commit `e102578d`, `requireSmmAdmin` + POST-only, тесты `server/__tests__/scheduler-admin-gate.test.ts` (см. `docs/prompts/claude-security-2-4-5-2026-07-24.md`)

#### §4 — Upload endpoint hardening
- **Scope:** `app.post('/api/s3/upload-image', ...)` в `server/index.ts:344`
- **Что делать (low):** Multer `memoryStorage()` без лимитов → задать явный размер; MIME allowlist + magic bytes check; S3 key и расширение генерить на сервере; не возвращать клиенту внутренний `error.message`
- **Что делать (medium, опционально):** для крупных файлов — streaming upload или temp spool; снизить глобальный JSON/urlencoded limit до реально необходимого
- **Тесты:** oversized и non-image запросы стабильно получают `413/415`; heap не зависит линейно от размера крупных загрузок
- **Effort:** **low** (базовые защитные лимиты) / **medium** (streaming)
- **Статус:** ✅ **CLOSED (low)** — commit `34a8ebf4`, `server/api/upload-image-route.ts`: лимит 10 MB, MIME allowlist + magic bytes, S3 key на сервере, generic-ошибки. Streaming (medium) остаётся открытым

#### §5 — WebSocket isolation
- **Scope:** `/ws` — неаутентифицированный клиент получает публикационные события всех пользователей
- **Что делать (low):** временно отключить `/ws` в production
- **Что делать (medium):** валидировать Directus session при upgrade, проверять `Origin`, привязать socket к user/tenant ID, отправлять события только владельцу; лимиты размера и частоты сообщений
- **Effort:** **low** (temp close) / **medium** (full)
- **Статус:** ✅ **CLOSED (low)** — commit `34a8ebf4`, `server/utils/ws-gate.ts`: `/ws` в production отклоняет upgrade, override `WS_PUBLIC_EVENTS_ENABLED=true`. 🟡 **§5-medium open** — session-validated user-scoped WS

### Protective layer (6–8)

#### §6 — Fail-closed subscription mutations
- **Что делать:** при недоступности Directus блокировать AI/media/publication mutations; оставить публичные routes и webhooks только в явном allowlist; не пропускать mutating request без identity
- **Сейчас:** fail-open в `requireActiveSubscription` (`server/middleware/require-active-subscription.ts:21-25`) — осознанный компромисс, но допускает использование платных функций при сбое Directus
- **Effort:** medium
- **Статус:** 🟡 open

#### §7 — P0/P1 security regression suite в CI
- **Что делать:** автоматизировать проверки из §1-§6 (отсутствие system-token, admin-only scheduler, tenant-isolated WS, upload 413/415, fail-closed subscription); secret scanning для изменений и истории
- **Зачем:** без тестов исправления регрессируют при следующем рефакторинге
- **Effort:** medium
- **Статус:** ✅ **CLOSED 2026-07-29** — commit `7c9c311b0`, `.github/workflows/ci.yml`: Node 20, кеш npm, на push и pull_request, пять шагов (`npm ci`, `vitest`, `check`, `check:client`, `build`). Клиентский тайпчек попал в гейт после того, как его довели до нуля в том же коммите. Secret scanning в этот заход не добавлялся — остаётся открытым хвостом §7.

#### §8 — Refresh token в HttpOnly cookie + CSP
- **Что делать:** refresh token → `HttpOnly; Secure; SameSite` cookie; access token — в памяти; централизованный client auth adapter (без прямого чтения `localStorage`); CSRF-защита; CSP с точечными `connect-src`/`frame-ancestors`
- **Сейчас:** refresh token в `localStorage` (XSS → долговременная сессия), CSP отключена
- **Effort:** high
- **Статус:** 🟡 open

### Engineering gates (9–11)

#### §9 — Полный TypeScript check как deploy gate
- **Сейчас:** 399 ошибок в 80 файлах; зелёный esbuild bundle не гарантирует исполнимость
- **Что делать:** исправить runtime-significant ошибки первыми; frontend/backend tsconfig разделить; довести `tsc --noEmit` до нуля; в CI обязательным merge/deploy gate
- **Effort:** high (1-я пачка runtime — medium)
- **Статус:** 🟡 open

#### §10 — Liveness/readiness split + redacted logging
- **Что делать:** `/live` — процесс; `/ready` — Directus + обязательное хранилище/queue; request ID + structured logger с redaction; убрать PII/токены/user-IDs и `console.*`; пустые `catch` → контролируемые state transitions
- **Сейчас:** `/health` ложно сообщает о готовности; логи шумные и раскрывают данные
- **Effort:** medium
- **Статус:** 🟡 open

#### §11 — Docker reproducible build
- **Что делать:** `npm install` → `npm ci` (lockfile-driven); корректная классификация dependencies (убрать повторную установку двух пакетов поверх production tree); BuildKit cache; dependency audit; SBOM
- **Effort:** low
- **Статус:** 🟡 open

### Scaling (12–14)

#### §12 — Durable claim + idempotency для публикации
- **Что делать:** атомарный DB claim для scheduled content или очередь с lease; job state вне памяти; idempotency key `(content_id, platform, scheduled_version)`; retry/backoff/dead-letter; тест на два worker'а без дублей
- **Сейчас:** in-memory locks/cache не работают между replicas
- **Effort:** high
- **Статус:** 🟡 open

#### §13 — Process role split: web / worker / bot
- **Что делать:** scheduler/AI/media jobs → worker; Telegram bot → отдельный process; web — HTTP/SPA/WS; отдельные readiness, shutdown, ресурсы, scaling
- **Effort:** high
- **Зависимость:** §12
- **Статус:** 🟡 open

#### §14 — Unified identity/auth/Directus access
- **Что делать:** единый adapter для validation/session/Directus; user/tenant identity только из валидированной сессии; запретить `x-user-id` как source of identity; централизовать role/ownership/entitlement policy
- **Сейчас:** несколько auth-слоёв, разрозненные routers
- **Effort:** high
- **Статус:** 🟡 open

### Code management (15)

#### §15 — Декомпозиция модулей + bundle size
- **Что делать:** делить `server/index.ts`, `publish-scheduler.ts`, `autonomous-ai.ts`, social publishing; крупные React pages → feature boundaries; lazy-load тяжёлые routes/editor; устранить mixed static/dynamic imports; bundle budgets
- **Сейчас:** chunks 762 KB и 675 KB
- **Effort:** high
- **Статус:** 🟡 open

---

## Сводка

| Статус | Кол-во | Пункты |
|---|---|---|
| ✅ Закрыто | 6 | §1, §2, §4, §5-low, §7 (CI, 2026-07-29), OAuth callback 401 incident |
| ⛔ Deferred | 1 | §3 (до августа) |
| 🟡 Открыто | 9 | §5-medium, §6, §8-§15 |
| 🔵 Принятый долг | 1 | остаточные P1 инцидента: ранний parser на весь `/api`, callbacks в обход baseline middleware, VK webhook без подписи/tenant binding, нет тестов на wiring |

## Инцидент: OAuth callback блокировка (2026-07-24)

### Описание
24.07 владелец подтвердил 401 на YouTube OAuth callback. Для публичных callback'ов YouTube, VK, Instagram, Threads и TikTok, а также `/api/vk/token-webhook/:campaignId`, применён общий ранний bypass. После деплоя callback handlers снова достижимы, но точный blast radius и источник 401 по prod-артефакту не сохранены доказательствами.

### Корневая причина
**УСТАНОВЛЕНА 2026-07-25.** Гипотеза owner'а («инцидент вызвал security-фикс, из-за которого API-ключи перестали попадать в UI и стали доступны только на бэке»), подтверждена по коду и истории.

Источник — `b97744ff` «fix(security): keep social credentials server-side» (2026-07-21 14:06 MSK, owner). Коммит уводил соц-ключи из UI на сервер и попутно добавил в социальные роутеры `router.use(authenticateUser)`.

Механизм 401:

1. `server/routes/facebook-groups-discovery.ts:7` — `router.use(authenticateUser)` (добавлено `b97744ff`).
2. `server/index.ts:402` — этот роутер смонтирован как `app.use('/api', facebookGroupsRouter)`, то есть на **весь** префикс `/api`.
3. `server/index.ts:409` — YouTube auth router монтируется **после** него.
4. Express выполняет `router.use(...)` примонтированного роутера для любого запроса с совпадающим префиксом — **до сопоставления маршрутов** и независимо от того, есть ли внутри роутера подходящий путь. Поэтому `GET /api/youtube/auth/callback` заходил в facebook-роутер и не выходил из него.
5. У редиректа от Google нет ни заголовка `Authorization`, ни cookie-сессии → `server/middleware/user-auth.ts:75` возвращает `401` и обрывает цепочку. Обработчик callback'а не вызывался.

Сходится всё, что не объяснял `requireActiveSubscription`: именно 401 (а не 403), именно на GET, именно с 21.07, и «ключи только на бэке» как причина.

**Исключённые версии:** `a3ba91133` (`requireActiveSubscription`) — GET/HEAD/OPTIONS и мутации без пользовательского токена всегда вызывают `next()`, а истёкшая подписка даёт 403; GET-401 не объясняет. `1473f4bf` (удаление `/api/auth/system-token`) — runtime-вызовов из callback handlers не имел. Обе версии закрыты.

**Урок (класс дефекта):** `router.use(middleware)` внутри роутера, примонтированного на широкий префикс (`/api`), работает как глобальный gate для всего префикса, а не только для маршрутов этого роутера. Аутентификацию вешать на конкретные маршруты либо монтировать роутер на узкий префикс (`/api/facebook`) — как уже сделано для `facebookPagesRouter` в `server/index.ts:386`.

### Timeline
1. **25.06.2026** — `requireActiveSubscription` добавлен глобально (Replit Agent)
2. **23.07.2026 18:00** — `1473f4bf` удалил `/api/auth/system-token` (security §1)
3. **24.07.2026 утро** — владелец сообщил о 401 на YouTube callback
4. **24.07.2026 11:43 MSK** — Mavis, `838e8769`: попытка bypass-флага для `requireActiveSubscription`; в prod не устранила 401
5. **24.07.2026 12:16 MSK** — Mavis, `771d66d9` (merge `122fe5f5`): GET callback handlers смонтированы до middleware
6. **24.07.2026 12:28 MSK** — Mavis, `02b47f53` (merge `c0994899`): добавлены POST/OPTIONS VK token-webhook
7. **24.07.2026 12:49 MSK** — Mimo обнаружил crash loop из-за `req.body === undefined`; Mavis зафиксировал parser fix в `156ec84b` (merge `e7c31890`), владелец независимо добавил эквивалентный `6c5c9920`
8. **24.07.2026 15:28 MSK** — Hermes, `f40fc6ec`: добавил публичный VK status endpoint

### Текущая mitigation
`server/index.ts` монтирует выбранные handlers через `app.{get,post,options}` до остальных middleware. Это восстанавливает достижимость callback'ов независимо от неизвестного глобального auth-gate.

Read-only prod smoke 24.07 после pull `bcff975d`: YouTube без params → 400, Instagram → 400, Threads probe → 200, TikTok → 302, VK → 302; ни один из пяти GET callback'ов не вернул 401. Это подтверждает mitigation, но не root cause и не полный OAuth flow с валидным `state`.

### Блокеры закрытия

1. ~~**P0 — root cause/provenance не установлены.**~~ **СНЯТ 2026-07-25:** root cause установлен (`b97744ff` + `router.use` на `/api`, см. раздел «Корневая причина»). Виновник назначен не по корреляции, а по механизму, воспроизводимому по коду.
2. **P1 — ранний JSON parser затрагивает весь API.** Два одинаковых `app.use('/api', express.json({ limit: '1mb' }))` в `server/index.ts` выполняются до штатного parser с лимитом 50 MB. Любой JSON `/api/*` больше 1 MB теперь получит 413, хотя callback parser нужен только VK webhook.
3. **P1 — callbacks обходят весь baseline-контур.** Ранние handlers завершают ответ до helmet, CORS, rate limiting, cache-control и HTTP logging, а не только до предполагаемого auth-gate.
4. **P1 security — VK webhook/status доверяют одному `campaignId`.** Публичный POST использует admin token для записи social settings, а публичный GET — для чтения статуса, без подписи/одноразового state и без tenant ownership gate.
5. **P1 — нет регрессионных тестов на wiring.** 83/83 test files и 883/883 tests проходят на `bcff975d`, но поиск по тестам не находит покрытия `PUBLIC_OAUTH_CALLBACKS`/`oauth-bypass`; зелёный suite не доказывает этот fix.

### Эскалация по каноническому циклу

**ОТМЕНЕНА 2026-07-25 решением owner'а:** «инцидент считаю исчерпанным после фиксов Фабом», «ФБ сейчас работает через токен ИГ, этого пока хватает», «я бы сейчас вообще не лез в стабилизированную Fable 5 ветку». Пункты для Hermes/Mavis/Mimo ниже **не выполнять** без нового поручения — они сохранены как описание того, что осталось не сделано, а не как активные задачи.

1. ~~Hermes:~~ заменить emergency bypass на явный public-callback router после baseline middleware и до конкретного auth-gate; ограничить 1 MB parser только POST VK webhook; убрать дубль parser; добавить интеграционные негативные тесты; отдельно закрыть подпись/state и tenant binding VK webhook/status.
2. ~~Mavis:~~ независимое ревью по `review-verdict-template.md`.
3. ~~Mimo:~~ prod provenance по artifact/log diff — **более не требуется**, root cause установлен по коду.
4. **Owner (Dmitry) — gate:** решение принято, см. выше.

### Остаточный риск (принят, не устраняется сейчас)

Фиксы лечат симптом: публичные callback'и смонтированы раньше всех middleware (`server/index.ts:117-143`). Сама ловушка жива — **любой новый публичный роут, зарегистрированный после `server/index.ts:402`, снова получит 401**, не имея ни строки собственного кода аутентификации.

- **Как чинится:** сузить `app.use('/api', facebookGroupsRouter)` до `/api/facebook` (одна строка + регрессионный тест).
- **Почему не чинится сейчас:** решение owner'а 2026-07-25 не трогать стабилизированную ветку; Facebook работает через IG-токен, потребности нет.
- **Когда возвращаться:** при следующем добавлении публичного роута под `/api`, либо вместе с §14 (unified auth), либо при первом же повторе 401 на callback'е.
- **Кому напомнить:** любому исполнителю, который будет монтировать публичный endpoint под `/api` — читать раздел «Урок» выше до написания кода.

### Статус
✅ **CLOSED 2026-07-25** (решение owner'а). Live-доступность восстановлена фиксами Fable 5, root cause установлен и задокументирован, остаточный риск принят осознанно и описан выше. P1-блокеры (ранний parser на весь `/api`, callbacks в обход baseline middleware, VK webhook без подписи/tenant binding, отсутствие тестов на wiring) закрытием инцидента **не устранены** — переносятся в общий беклог как долг, приоритет назначает owner.

---

## Рекомендуемый next-up

~~**§2 → §4 → §5-low**~~ — выполнено 2026-07-24 (`e102578d`, `34a8ebf4`).
~~**§7 — CI**~~ — выполнено 2026-07-29 (`7c9c311b0`).

**Актуальный next-up: §6 fail-closed subscription → §11 Docker `npm ci` → §10 health/logging** (порядок из `docs/context/state.json`).

Отдельно: релиз-раунд 2026-07-29 закрыл ещё и то, чего в этом списке не было — cross-tenant обход в trends, аутентификацию публичных колбэков трендов, денежный инвариант броней промокода, токены соцсетей в query и доверие заголовку `Host`. Разбор — `docs/followups/2026-07-29-release-closure-handoff.md`.

## Связи

- `docs/PRIORITIZED_IMPROVEMENT_PLAN_2026-07-23.md` — источник пунктов
- `docs/captains-log/2026-07-23.md` — Agent OS + начало цикла
- `docs/captains-log/2026-07-24.md` — security §1 closure + этот беклог
- `docs/followups/2026-07-24-oauth-callback-401-incident.md` — подробная первичная хронология Mavis; гипотезы о prod build и blast radius не считать установленными фактами, при расхождении приоритет у перепроверенного раздела выше
- `1473f4bf` — коммит закрытия §1
- `771d66d9` / `122fe5f5` — Mavis + owner merge: OAuth GET callback emergency bypass
- `02b47f53` / `c0994899` — Mavis + owner merge: VK token-webhook POST/OPTIONS bypass
- `156ec84b` / `e7c31890` / `6c5c9920` — parser fix после обнаруженного Mimo crash loop (в main попали два эквивалентных mount)
- `f40fc6ec` — Hermes: VK token-webhook status bypass
- `b97744ff` — **root cause инцидента**: `fix(security): keep social credentials server-side`, добавил `router.use(authenticateUser)` в facebook-роутер, смонтированный на весь `/api`
- `e102578d` — §2 admin-only scheduler
- `34a8ebf4` — §4 upload hardening + §5-low WS close
- `a3ba91133` — Replit Agent: введение `requireActiveSubscription`; проверен и исключён как объяснение GET-401
- `MEMORY.md` (Mavis agent) — урок про middleware ordering vs 404 catch-all
- `c0ff1d4` (бывший `fde12ed`) — untrack `.env.example`

## Когда обновлять этот файл

- При закрытии любого пункта (✅ + hash коммита)
- При сдвиге приоритета или появлении нового урока
- При возврате к §3 (август 2026)

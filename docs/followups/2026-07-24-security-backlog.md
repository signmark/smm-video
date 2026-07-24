# Security followup backlog — 2026-07-24

**Источник:** `docs/PRIORITIZED_IMPROVEMENT_PLAN_2026-07-23.md` (15 пунктов, 5 волн)
**Снимок:** на 2026-07-24, после закрытия incident §1
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
- **Статус:** 🟡 open, рекомендую следующим

#### §4 — Upload endpoint hardening
- **Scope:** `app.post('/api/s3/upload-image', ...)` в `server/index.ts:344`
- **Что делать (low):** Multer `memoryStorage()` без лимитов → задать явный размер; MIME allowlist + magic bytes check; S3 key и расширение генерить на сервере; не возвращать клиенту внутренний `error.message`
- **Что делать (medium, опционально):** для крупных файлов — streaming upload или temp spool; снизить глобальный JSON/urlencoded limit до реально необходимого
- **Тесты:** oversized и non-image запросы стабильно получают `413/415`; heap не зависит линейно от размера крупных загрузок
- **Effort:** **low** (базовые защитные лимиты) / **medium** (streaming)
- **Статус:** 🟡 open

#### §5 — WebSocket isolation
- **Scope:** `/ws` — неаутентифицированный клиент получает публикационные события всех пользователей
- **Что делать (low):** временно отключить `/ws` в production
- **Что делать (medium):** валидировать Directus session при upgrade, проверять `Origin`, привязать socket к user/tenant ID, отправлять события только владельцу; лимиты размера и частоты сообщений
- **Effort:** **low** (temp close) / **medium** (full)
- **Статус:** 🟡 open

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
- **Статус:** 🟡 open (блокирует все следующие шаги)

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
| ✅ Закрыто | 1 | §1 |
| ⛔ Deferred | 1 | §3 (до августа) |
| 🟡 Открыто | 13 | §2, §4-§15 |

## Рекомендуемый next-up

**§2 — Admin-only scheduler** (low effort, закрывает межтенантный DoS, паттерн как у §1). После §2 — §4 (тоже low, защита upload'а), потом §5 (WS isolation, low для temp close).

## Связи

- `docs/PRIORITIZED_IMPROVEMENT_PLAN_2026-07-23.md` — источник пунктов
- `docs/captains-log/2026-07-23.md` — Agent OS + начало цикла
- `docs/captains-log/2026-07-24.md` — security §1 closure + этот беклог
- `1473f4bf` — коммит закрытия §1
- `MEMORY.md` (Mavis agent) — урок про middleware ordering vs 404 catch-all
- `c0ff1d4` (бывший `fde12ed`) — untrack `.env.example`

## Когда обновлять этот файл

- При закрытии любого пункта (✅ + hash коммита)
- При сдвиге приоритета или появлении нового урока
- При возврате к §3 (август 2026)

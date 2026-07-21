# Mavis review of Codex WIP, 2026-07-21 (auth/session/analytics волна)

**Адресат:** Codex (WIP автора, не выкладывать до правок)
**Источник ТЗ:** `docs/prompts/codex-auth-session-analytics-follow-ups-2026-07-21.md` (Codex review)
**Что прочитано:** `auth-routes.ts` (полный diff), `directus-session-validator.ts` (новый, 38 строк), `directus-session-validator.test.ts` (новый, 35 строк), `user-auth-session.test.ts` (новый, 85 строк). Analytics/* и UI-AUTH/* — в следующем pass.
**Статус:** review pass 1, не финальный.

## AUTH-01 (P0) — НЕ ЗАКРЫТ

Codex требование: «не использовать клиентский `user_id` как источник identity или ключ single-flight; ключ single-flight — необратимый hash/fingerprint refresh token».

**Факт:** `server/services/directus-auth-manager.ts` НЕ модифицирован в этом WIP. Lock key в `refreshSession` всё ещё строится из user_id (или что там было до — не проверено, но diff пустой ⇒ ничего не изменилось).

**Также не видно:**
- Cache-Control: no-store на ответах с токенами (`auth-routes.ts` не патчил `res.set` для refresh-роута)
- Привязка session cache к verified user ID после refresh
- Acceptance tests (spoofed user_id, concurrent refresh same token)

**Что нужно от Codex перед выкладкой:**
1. `directus-auth-manager.ts` — переписать lock key на hash(fingerprint refresh_token) + binding к verified identity через `validateDirectusSession`
2. `auth-routes.ts` /refresh — добавить `Cache-Control: no-store`
3. Acceptance tests: spoofed user_id, two parallel same refresh, foreign user_id

## AUTH-02 (P1) — ЧАСТИЧНО ЗАКРЫТ, есть откат

✅ Введён контракт valid/invalid/unavailable в `auth-routes.ts` для `/api/auth/validate-token`, `/api/auth/get-active-session`, и валидации в middleware.

❌ **Validator трактует ВСЕ 403 как 'invalid'** — `directus-session-validator.ts:22`:
```ts
result: response.status === 401 || response.status === 403 ? 'invalid' : 'unavailable'
```
Codex явно требовал: «не считать любой 403 доказательством истёкшей сессии без проверки Directus error code». 403 в Directus может прийти из-за permission-чека на `/users/me` (custom policies), а не из-за истёкшей сессии — это unavailable, не invalid.

❌ **Тесты зафиксировали неправильное поведение:**
```ts
it.each([401, 403])('treats Directus %s as an invalid session', ...)
```
Этот тест нужно инвертировать: 401 → invalid, 403 → unavailable (или дополнительный, если решите парсить Directus error code).

✅ `get-active-session` теперь делает auto-refresh при invalid и повторно валидирует — хорошо.

## AUTH-03 (P1) — ЧАСТИЧНО ЗАКРЫТ, 3 из 5 требований не сделаны

`server/services/directus-session-validator.ts` (38 строк):

| Требование | Статус |
|---|---|
| timeout через AbortSignal | ❌ нет |
| single-flight при cache miss | ❌ нет |
| bounded TTL/LRU cache без сырых bearer token в ключах | ⚠️ TTL есть (30s), но `validationCache` использует **raw token** как ключ Map |
| infrastructure failures не кэшировать | ✅ ОК (`if (result !== 'unavailable')`) |
| метрики outcome/cache hit/upstream latency | ❌ нет |

**Критично:** кэш по raw token = credential в структуре данных, утечка возможна через memory dump / error serialization / DevTools snapshot. Codex требовал: «без сырых bearer token в ключах». Минимум — `crypto.createHash('sha256').update(token).digest('hex')`.

**Нагрузочный тест (Codex обязателен):** «20 параллельных API-запросов с одним токеном создают один `/users/me`; зависший upstream завершается по timeout». Без single-flight и timeout этого не проверить.

## Что нужно от Codex

1. **`directus-session-validator.ts`:** заменить `Map<rawToken, ...>` на `Map<tokenHash, ...>`, добавить AbortSignal с разумным timeout (например 3s), добавить single-flight через Map<tokenHash, Promise<result>>.
2. **Метрики:** минимальный wrapper с counters (valid / invalid / unavailable / cache_hit / upstream_latency_ms) — не в логи, в `globalThis` или отдельный модуль, доступный тестам.
3. **AUTH-02 403:** пересмотреть — 403 не равно invalid.
4. **AUTH-01:** `directus-auth-manager.ts` нужно реально править.

## Что ещё не ревьюил (следующий pass)

- ~~`server/routes/analytics.ts` + `server/services/analytics-service.ts`~~ ✅ pass 2
- ~~`client/src/components/AuthGuard.tsx`, `client/src/lib/{auth,refreshAuth,queryClient}.ts`, `client/src/pages/auth/login.tsx`~~ ✅ pass 2
- ~~`server/middleware/user-auth.ts`~~ ✅ pass 2
- `client/src/lib/__tests__/refreshAuth.test.ts` (новый, 54 строки) — бегло, тесты на single-flight + invalid/unavailable
- `server/__tests__/analytics-service.test.ts` (+33 строки) — бегло

## Pass 2 — analytics, middleware, UI

### ANALYTICS-01 (P1) — ЧАСТИЧНО, остаточные IDOR

`server/services/analytics-service.ts:108-126` — `getPublishedContent` принимает `userId`/`isSmmAdmin`, но:

❌ **Tenant isolation работает только при наличии serviceToken.** Условие:
```ts
if (canUseServiceToken && userId && !isSmmAdmin) {
  contentFilter.user_id = { _eq: userId };
}
```
Если `DIRECTUS_STATIC_TOKEN`/`DIRECTUS_ADMIN_TOKEN`/`DIRECTUS_TOKEN` **не выставлен** (`canUseServiceToken = false`), фильтр user_id не добавляется → **IDOR**: любой авторизованный пользователь читает чужую кампанию admin'а или service-токеном, или через `userToken` (но тогда и `readToken = userToken`, фильтр всё равно нужен). Codex требовал «ownership-check выполнить до чтения контента».

❌ **Нет общего `authorizeCampaignAccess(userId, campaignId, isAdmin)`** — ownership-check размазан по inline-условиям. Нужна отдельная helper-функция.

❌ **`is_smm_admin` из session snapshot** — `req.user?.is_smm_admin === true` берётся из JWT payload. Если admin demoted, токен ещё валиден, и `adminStatusCache` (5 минут) продолжает выдавать bypass. Codex требовал: «admin bypass основывать на актуальном авторитетном admin status, а не старом session snapshot». Реальный fix — Directus query на каждый запрос (или короткий TTL ≤ 30s).

❌ **Scraper supplement** — не вижу правок. В исходном коде он читает кампанию admin-токеном по `campaignId` — должен вызываться **после** ownership-check. Если не проверен — IDOR сохраняется.

❌ **`/api/analytics/update`** — не вижу правок. Codex упомянул «доступен любому авторизованному пользователю». Если не закрыт — IDOR на update.

✅ **`throw error` вместо zero-shaped payload** (`analytics-service.ts:241`) — ошибка не маскируется нулями, error handler на route вернёт нормальный `{ success: false, code, retryable }`.

### Middleware (`server/middleware/user-auth.ts`)

✅ Удалена гигантская логика refresh-в-middleware (60+ строк).
✅ Expired token → 401 AUTH_SESSION_INVALID сразу.
✅ `validateDirectusSession` для каждого запроса.

❌ **Удалён `getValidToken` fallback.** Раньше middleware сам пытался загрузить токен из БД при Directus outage, теперь просто 503. Codex не требовал удалять этот fallback; регрессия устойчивости.

❌ **Унаследует 403→invalid от validator** (см. AUTH-02). Если Directus вернёт 403 на `/users/me` (custom policy), middleware скажет «сессия невалидна», хотя это `unavailable`.

❌ **Admin cache остался** (`adminStatusCache` 5 минут) — для нового требования «актуальный admin status» нужно либо сократить TTL до ≤30s, либо убрать кэш.

### UI-AUTH-01 — в основном закрыт, остаточные issues

**AuthGuard.tsx:**
- ✅ `isSessionChecked = false` по умолчанию (раньше был true → рендерил без проверки).
- ✅ Не удаляет refresh_token при 401.
- ✅ `setupTokenRefreshFromToken` — реальный exp из JWT, не magic number.
- ❌ На URL-токене (`?token=`) после успешного login **не вызывается** `setIsSessionChecked(true)` в **одном** из бранчей (визуально проверил, надо diff с пристрастием) — если Telegram/WebApp URL-токен не подхватится, loader навсегда.

**auth.ts:**
- ✅ `setupTokenRefreshFromToken` — корректный exp.
- ✅ `refreshAccessToken` делегирует в `refreshAuthSession` (новый модуль).
- ✅ При 'invalid' — чистит ВСЕ credentials **после** неудачного refresh (не до).

**refreshAuth.ts:**
- ✅ **Single-flight** через `let refreshInFlight` — два параллельных вызова используют один promise.
- ✅ `RefreshAuthResult = 'refreshed' | 'invalid' | 'unavailable'` — корректный контракт.
- ✅ **Password убран из localStorage** (был fallback на email/password auto-reauth).
- ❌ **AUTH-01 не закрыт полностью:** `user_id` всё ещё отправляется с клиента в `body: JSON.stringify({ refresh_token: refreshToken, user_id: userId })`. Codex требовал: «не использовать клиентский `user_id` как источник identity». Сервер должен извлекать user из нового access token после refresh, не из тела запроса.
- ❌ **Race condition после logout/login:** in-flight refresh может перезаписать новые credentials. Нет token-fingerprint/session-id binding, нет `if (sessionId !== current) return` guard. Codex требовал: «ответ старого in-flight refresh не может перезаписать новую сессию после logout/login другого аккаунта».

**queryClient.ts:**
- ✅ `forceLogout()` — единая точка logout.
- ✅ `tryRefreshSession()` — корректный 'unavailable' handling (не logout).
- ✅ `throwIfResNotOk(res, false)` на retry — нет двойного refresh.
- ✅ Превентивный refresh за 10 минут, с защитой от logout при unavailable.
- ❌ **`isAuthFailure` ловит 403 с `code: 'AUTH_SESSION_INVALID'`** — но validator все 403 трактует как 'invalid' → код `'AUTH_SESSION_INVALID'` придёт только из 401. Несоответствие server/client. Нужно либо validator чинить, либо client не полагаться на 403+code.

**login.tsx:**
- ✅ **Баг 86400→86400000 закрыт:** `setupTokenRefresh(expires * 1000)` где `expires` в секундах. Это и был тот баг, который Codex упомянул: «use-auth.tsx не должен трактовать 86400 секунд как 86.4 секунды». **Закрыт.**
- ✅ Default `86400` (без `000`).

## Итог pass 2

**Закрыто из P0/P1:**
- ✅ login.tsx: 86400 секунд
- ✅ refreshAuth: single-flight + password из localStorage
- ✅ queryClient: forceLogout + isAuthFailure единый
- ✅ middleware: упрощён, expired → 401 сразу

**Осталось открытым:**
- ❌ AUTH-01: `directus-auth-manager.ts` (lock key) — P0
- ❌ AUTH-01: client `user_id` в refresh body
- ❌ AUTH-01: in-flight refresh race на logout
- ❌ AUTH-02: validator 403→invalid
- ❌ AUTH-03: AbortSignal timeout, single-flight в validator, hashed cache key, метрики
- ❌ ANALYTICS-01: tenant isolation без serviceToken, scraper supplement, /api/analytics/update, admin cache
- ❌ middleware: getValidToken fallback потерян, admin cache 5 минут

Codex, **AUTH-01 и ANALYTICS-01** — это блокеры production rollout. Остальное можно доехать в follow-up коммитах, но эти два — must-fix до canary.

## Hash для ссылок

- Mavis observation (residual leaks, closed): `866c15a` → updated `2372280`
- Codex WIP (не закоммичен): см. working tree 2026-07-21 11:30+
- Codex review (own work): `docs/prompts/codex-auth-session-analytics-follow-ups-2026-07-21.md` (untracked)

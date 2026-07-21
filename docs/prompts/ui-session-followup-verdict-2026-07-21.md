# UI/session follow-up verdict — 2026-07-21

**Диапазон:** `41c96e5..a2a7d00`  
**Фокус:** AuthGuard/public routes, refresh lifecycle, stale 401/account switch, Web Locks, Directus axios interceptor, YouTube/Instagram UI после sanitization.  
**Вердикт:** **BLOCKED / RED** — перед push/deploy нужны исправления ниже.

## Блокеры

### 1. P0 — старый запрос аккаунта A может быть повторён с credential аккаунта B

`apiRequest` считает любое изменение access token признаком успешного refresh и безусловно повторяет исходный запрос (`client/src/lib/queryClient.ts:148`). Directus interceptor делает то же самое (`client/src/lib/directus.ts:78-86`). Изменение токена, однако, может означать logout/login другого пользователя, а не refresh той же сессии.

В результате поздний `401` на `POST`/`PATCH`/`DELETE`, начатый аккаунтом A, после входа в аккаунт B повторяется уже с токеном B. Это может выполнить действие, инициированное в старом UI, над данными нового tenant. `getQueryFn` дополнительно вообще не сохраняет token/user snapshot исходного запроса и при `401` запускает refresh текущей сессии.

**Требуемый фикс:** на старте каждого запроса фиксировать session generation и verified user ID. Retry разрешать только если generation не менялся и новый access token принадлежит тому же user ID. При logout/login увеличивать generation; запрос старой generation завершать как cancelled/superseded без replay. Применить одинаковый контракт к `apiRequest`, `getQueryFn` и `directusApi` interceptor.

**Обязательный тест:** задержать mutation аккаунта A, выполнить login аккаунта B, вернуть mutation `401`; проверить, что второго HTTP-вызова нет и credential B не использован.

### 2. P0 — Web Locks ломает валидную сессию во второй вкладке после ротации refresh token

После ожидания `navigator.locks` вторая вкладка видит заменённый в общей `localStorage` refresh token и возвращает `superseded` (`client/src/lib/refreshAuth.ts:14`, `client/src/lib/refreshAuth.ts:38`). При этом её Zustand store не синхронизируется с новым access token. `tryRefreshSession` трактует `superseded` как готовность к retry (`client/src/lib/queryClient.ts:19`), но `makeRequest` берёт старый token из Zustand (`client/src/lib/queryClient.ts:92`). Повтор снова получает `401`, после чего `throwIfResNotOk(..., false)` вызывает `forceLogout()` и очищает общую `localStorage`, уничтожая успешно обновлённую сессию обеих вкладок.

**Требуемый фикс:** ветка `superseded` должна атомарно синхронизировать store из актуальных `auth_token`/JWT user ID либо возвращать отдельный cross-tab результат, который caller синхронизирует до retry. Добавить обработчик `storage`/session generation, чтобы вкладки видели logout/login/refresh друг друга.

**Обязательный тест:** две независимые store/tab contexts, один общий localStorage и Web Lock; первый tab ротирует token, второй ждёт lock. Второй tab должен повторить запрос новым token, не вызывать logout и не удалить новую пару credential.

### 3. P1 — истёкшая/отозванная сессия всё ещё не получает явного UI lifecycle

`AuthGuard` корректно различает invalid/unavailable при своей проверке, но плановый timeout и резервный interval вызывают `refreshAccessToken().catch(console.error)` (`client/src/lib/auth.ts:25`, `client/src/lib/auth.ts:55`). При invalid `refreshAccessToken` очищает credential/store, однако текущий protected route остаётся отрисован: `AuthGuard` не подписан на token/session generation и не запускается повторно при том же location. При unavailable пользователь также видит только console error, а не retry UI.

Параллельно `AuthProvider` запрашивает `/api/auth/me` до завершения `AuthGuard` и использует `on401: "returnNull"` (`client/src/hooks/use-auth.tsx:81`). При expired access + valid refresh запрос может закэшировать `user = null`; успешный refresh из `AuthGuard` не инвалидирует `/api/auth/me`. Страницы, зависящие от `useAuth().user`, получают ложное состояние logout/отсутствующий user до следующего refetch.

Также `checkIsAdmin` по-прежнему удаляет **refresh token** за 30 секунд до expiry (`client/src/lib/store.ts:140-144`), обходя новый recoverable refresh flow.

**Требуемый фикс:** единый session coordinator/event (`refreshed`, `invalid`, `unavailable`, `account-changed`). AuthGuard должен реагировать на него независимо от location; invalid — очистка Query cache + явный redirect/login reason, unavailable — сохранять credential и показывать retry. После refreshed — синхронизировать store и invalidate/refetch `/api/auth/me`. `checkIsAdmin` должен вызывать coordinator, а не удалять refresh token.

**Обязательные тесты:** (a) timer refresh → 401 приводит к login UI; (b) timer refresh → 503 сохраняет credential и показывает recoverable state; (c) cold load с expired access + valid refresh заканчивается ненулевым `/api/auth/me` user.

### 4. P0 — YouTube callback доверяет изменяемому campaignId и сообщает `saved=true` после провала сохранения

На start ownership проверяется, но callback берёт `campaignId` из клиентского base64 state (`server/routes/youtube-auth.ts:113`) и заменяет его значением из server-side `stateData` только если он отсутствует (`server/routes/youtube-auth.ts:130-132`). Пользователь может начать OAuth для своей кампании, оставить валидный `stateKey`, подменить base64 `campaignId` и заставить callback с admin token записать YouTube credential в чужую кампанию.

Кроме того, ошибка Directus save проглатывается (`server/routes/youtube-auth.ts:196-198`), после чего callback всё равно редиректит с `saved=true` (`server/routes/youtube-auth.ts:204`). UI ставит success flag, пытается загрузить пустые sanitized settings и затем зависает/показывает неинформативный результат вместо ошибки.

**Требуемый фикс:** campaignId брать исключительно из server-side `stateData`; client copy игнорировать или проверять на точное равенство. Перед admin PATCH повторно подтвердить ownership по сохранённым `userId + campaignId`. `saved=true` выставлять только после успешного PATCH; отсутствие Directus config/save failure должно идти в error callback. Желательно хранить OAuth state в общем TTL store, иначе callback после рестарта/другого instance всегда потеряется.

**Обязательные тесты:** tampered campaignId не меняет целевую кампанию; Directus PATCH failure возвращает OAuth error и не создаёт `youtubeOAuthSuccess.saved=true`.

## Что проверено и работает по коду

- Public-route matcher не обрабатывает reset-password `?token=` как access JWT; URL-token success branch завершает loader через `finish()`.
- Cold load больше не удаляет refresh token только из-за expired access token.
- Backend refresh разделяет invalid/rate-limit/unavailable; credential не очищаются на 429/503/timeout.
- Late refresh response не перезаписывает уже записанный другой refresh token в одной вкладке.
- YouTube settings endpoint отдаёт metadata/boolean flags без OAuth token; основной callback сохраняет token server-side.
- Instagram callback больше не отдаёт `longLivedToken`/`pageAccessToken`, а SocialMediaSettings после сообщения перезагружает сохранённые server-side settings.

## Проверка

Выполнено:

```text
npm.cmd test -- --run \
  client/src/lib/__tests__/refreshAuth.test.ts \
  server/__tests__/directus-refresh-service.test.ts \
  server/__tests__/directus-session-validator.test.ts \
  server/__tests__/user-auth-session.test.ts \
  server/__tests__/oauth-response-sanitizer.test.ts \
  server/__tests__/youtube-settings-log-redaction.test.ts \
  server/__tests__/analytics-service.test.ts
```

Результат: **7 test files / 35 tests passed**. Эти тесты не покрывают четыре блокирующих сценария выше.

## Release gate

Не push/deploy. После исправлений нужен повторный review именно по четырём обязательным regression-сценариям; GREEN возможен только при отсутствии cross-account replay, корректной межвкладочной синхронизации, явном invalid/unavailable UI и fail-closed YouTube callback.

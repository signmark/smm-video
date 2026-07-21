# Follow-ups: Directus session lifecycle и аналитика (Codex review, 2026-07-21)

**Контекст:** аналитика кампании показывала нули при фактически существующих публикациях. Повторный вход создавал новую Directus-сессию и временно устранял симптом.

**Статус:** review complete; текущий незакоммиченный патч **не выкладывать**, пока не закрыты P0/P1 ниже.

## Подтверждённая цепочка дефекта

1. Backend доверял декодированному JWT и `exp`, но не проверял, принимает ли сессию Directus.
2. Directus уже отвечал `403`, а аналитический сервис преобразовывал ошибку в успешный zero-shaped payload.
3. На клиенте несколько независимых механизмов refresh использовали разные правила и единицы времени.
4. Logout/login создавал новую согласованную пару access/refresh token, поэтому симптом исчезал.

## P0 — закрыть до любой выкладки

### AUTH-01: исключить выдачу чужих токенов и session-cache poisoning в `/api/auth/refresh`

Файл: `server/api/auth-routes.ts`, блок `/api/auth/refresh`.

Проблема:

- lock key строится из переданного клиентом `user_id`;
- запрос с тем же публичным `user_id` может получить результат уже выполняющегося чужого refresh, включая access/refresh token;
- новая сессия сохраняется в серверный cache под произвольным клиентским `user_id`.

Требования:

- не использовать клиентский `user_id` как источник identity или ключ single-flight;
- ключ single-flight — необратимый hash/fingerprint refresh token;
- после успешного Directus refresh получить пользователя из нового access token через авторитетный Directus endpoint;
- сохранять session cache только под подтверждённым Directus user ID;
- добавить `Cache-Control: no-store` на ответы с токенами.

Acceptance tests:

- одинаковый `user_id`, разные refresh token — результаты никогда не смешиваются;
- собственный refresh token + чужой `user_id` не изменяет чужой session cache;
- два одновременных запроса с одним refresh token вызывают один upstream refresh.

## P1 — блокеры production rollout

### AUTH-02: единый backend-контракт `valid / invalid / unavailable`

Сейчас любая ошибка Directus refresh, включая timeout/429/5xx, превращается в `401 TOKEN_EXPIRED`; клиент закономерно удаляет рабочие credentials.

Требования:

- подтверждённо невалидный refresh credential → `401 AUTH_SESSION_INVALID`;
- Directus timeout/network/5xx → `503 AUTH_VALIDATION_UNAVAILABLE`;
- upstream 429 → `429`, с retry metadata при наличии;
- `get-active-session` должен использовать тот же контракт;
- не считать любой `403` доказательством истёкшей сессии без проверки Directus error code.

### AUTH-03: сделать session validator безопасным для нагрузки

Файл: `server/services/directus-session-validator.ts`.

Требования:

- timeout через `AbortSignal`;
- single-flight на один token fingerprint при cache miss;
- bounded TTL/LRU cache без сырых bearer token в ключах;
- infrastructure failures не кэшировать;
- метрики outcome/cache hit/upstream latency без токенов в логах.

Нагрузочный тест: 20 параллельных API-запросов с одним токеном создают один `/users/me`; зависший upstream завершается по timeout.

### ANALYTICS-01: полная tenant isolation до service/admin reads

Файлы: `server/routes/analytics.ts`, `server/services/analytics-service.ts`.

Проблема: `campaign_content` фильтруется по `user_id`, но scraper supplement читает кампанию admin-токеном по произвольному `campaignId`. `/api/analytics/update` также доступен любому авторизованному пользователю.

Требования:

- общий `authorizeCampaignAccess(userId, campaignId, isAdmin)`;
- ownership-check выполнить до чтения контента, scraper supplement и запуска refresh/update;
- чужая кампания → `403` или non-enumerating `404`, scraper не вызывается;
- admin bypass основывать на актуальном авторитетном admin status, а не старом session snapshot;
- error response аналитики не должен содержать нулевые метрики: только `success:false`, стабильный `code`, message и `retryable`.

### UI-AUTH-01: устранить подтверждённые frontend-регрессии

Файлы: `client/src/components/AuthGuard.tsx`, `client/src/App.tsx`, `client/src/hooks/use-auth.tsx`, `client/src/lib/auth.ts`, `client/src/lib/refreshAuth.ts`, `client/src/lib/queryClient.ts`.

Обязательные исправления:

- валидный Telegram/WebApp `?token=` должен вызвать `setIsSessionChecked(true)`; сейчас ветка зависает на loader;
- `use-auth.tsx` не должен трактовать `86400` секунд как `86.4` секунды;
- удалить/перенаправить старый `clearExpiredToken`, который уничтожает валидный refresh token до попытки восстановления;
- refresh после reload не должен зависеть от уже удалённого `user_id`;
- один coordinator для timer, interval, proactive refresh и response retry;
- поздний `401` от запроса со старым access token должен повториться с уже обновлённым токеном, а не запускать второй refresh;
- ответ старого in-flight refresh не может перезаписать новую сессию после logout/login другого аккаунта;
- invalid refresh должен немедленно и явно завершать UI-сессию; unavailable должен показывать retryable session-check state без logout;
- logout/account switch атомарно очищает user-scoped React Query cache;
- единый список public routes для AuthGuard, redirect helper и App expiry logic.

## P2 — сразу после блокеров

- Перенести period filter аналитики в Directus query вместо загрузки всей истории.
- Использовать единый набор service-token env names во всех ветках аналитики.
- Удалить недостижимую recovery-логику `get-active-session` либо определить endpoint одну ответственность.
- Переставлять refresh schedule после любого успешного refresh.
- Добавить межвкладочную координацию (`Web Locks`/`BroadcastChannel`) или серверную идемпотентность для rotating refresh tokens.
- Использовать один base64url JWT decoder со schema validation вместо разрозненных `atob`.

## Обязательная матрица тестов

1. Backend auth routes: refresh 401, timeout, 429, 500/503; spoofed user ID; concurrent refresh; malformed upstream response.
2. AuthGuard: valid/invalid URL token; valid refresh; invalid refresh; unavailable с retry UI.
3. Query client: несколько 401; late stale 401; второй 401 после retry; 503 без logout; account switch во время refresh.
4. Analytics security: owner/admin/foreign campaign; scraper не вызывается для foreign; error payload без метрик.
5. Session validation load: single-flight, timeout, bounded cache, отсутствие token material в логах.

## Рекомендуемый порядок отдельных коммитов

1. `fix(auth): bind refresh to verified Directus identity` — AUTH-01 + security tests.
2. `fix(auth): preserve invalid vs unavailable semantics` — AUTH-02 + route contract tests.
3. `fix(analytics): authorize campaign before privileged reads` — ANALYTICS-01 + IDOR tests.
4. `fix(auth-ui): centralize refresh and explicit session states` — UI-AUTH-01 + component/query tests.
5. `perf(auth): add timeout single-flight and bounded validation cache` — AUTH-03 + load tests.
6. `test(auth): add end-to-end session lifecycle matrix` — web + Telegram/WebApp + multi-tab cases.

## Canary checklist

- обычный web login;
- Telegram URL login без вечного loader;
- истёкший access + валидный refresh;
- истёкший refresh → явный login;
- Directus 503 → credentials сохранены, виден retryable state;
- owner/foreign/admin analytics access;
- мониторинг частоты `/users/me`, refresh outcomes и forced logout без token material.

## Отдельный внешний отчёт

`docs/prompts/kimi-security-follow-ups-2026-07-21.md` относится к другой security-волне (OAuth token exposure/log redaction). Его P0/P1 не смешивать с этим набором коммитов, но учитывать при общем release gate.

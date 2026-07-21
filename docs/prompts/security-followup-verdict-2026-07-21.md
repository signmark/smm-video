# Security follow-up verdict: `41c96e5^..a2a7d00`

**Дата:** 2026-07-21  
**Reviewer:** Codex, независимое security-review  
**Вердикт:** **BLOCKED — не push/deploy**  
**Риск:** Critical (public OAuth surface, admin/service-token writes, multi-tenant secrets)

Проверен inclusive-диапазон от самого `41c96e5` до `a2a7d00`, а также фактические route/middleware цепочки, через которые изменённый код доступен. Product code не менялся.

## Release blockers

### C-01 — YouTube OAuth state позволяет подменить кампанию

`POST /api/youtube/auth/start` правильно проверяет доступ к исходной кампании и сохраняет `campaignId` в server-side `oauthStates` (`server/routes/youtube-auth.ts:30-60`). Однако callback декодирует второй `campaignId` из клиентского Base64 state (`:105-113`) и заменяет его значением из server-side state только когда клиентское поле отсутствует (`:121-132`). Затем именно это изменяемое значение используется для admin-token GET/PATCH кампании (`:166-193`).

Доказуемый сценарий:

1. Обычный пользователь запускает OAuth для своей кампании и получает валидный state.
2. В Base64 JSON сохраняет валидный `key`, но меняет `campaignId` на ID чужой кампании.
3. Callback находит server-side state по `key`, но оставляет подменённый `campaignId`.
4. Полученные YouTube tokens записываются в чужую кампанию через admin token.

Это authenticated cross-tenant write/credential replacement (CWE-639/CWE-862). Callback обязан брать campaign ID только из `stateData.campaignId`; клиентская копия не должна участвовать в авторизации или выборе объекта. Нужен regression test на tampered state.

### C-02 — общий campaign endpoint обходит ownership и отдаёт OAuth secrets любого tenant

`GET /api/campaigns/:id` читает кампанию admin-токеном (`server/routes/campaigns.ts:198-204`). При несовпадении владельца код только пишет `CAMPAIGN_GET_BYPASS` и продолжает выполнение (`:210-214`), после чего возвращает raw `social_media_settings` (`:216-230`). В этом JSON сейчас хранятся как минимум YouTube `accessToken`/`refreshToken` и Instagram `appSecret`/`longLivedToken`/`accessToken`.

Следствие: любой аутентифицированный пользователь, знающий/угадавший UUID кампании, может получить чужие OAuth credentials. Поэтому утверждение «OAuth tokens остаются server-side» после `0b13067`/`f8c7872` пока фактически неверно, даже несмотря на sanitized dedicated endpoints.

Исправление: fail closed с неразличимым 404 через общий `authorizeCampaignAccess`, затем выдавать sanitized DTO без secret fields. Также `GET /api/campaigns` возвращает raw settings для всех собственных кампаний (`server/routes/campaigns.ts:156-171`) — его DTO тоже должен быть sanitized. Нужны owner/foreign/admin tests и recursive assertion, что в JSON нет token/secret/password material.

### C-03 — Instagram OAuth flow публичный, пишет admin-токеном и умеет эксфильтровать токены

`POST /api/instagram/auth/start` не имеет auth/ownership middleware (`server/routes/instagram-oauth.ts:12-20`). Глобальный subscription gate не является auth: GET всегда пропускаются, а mutating request без пользовательского token явно `next()` (`server/middleware/require-active-subscription.ts`). Start принимает произвольные `campaignId`, `appSecret` и `webhookUrl`, сохраняет их в session (`server/routes/instagram-oauth.ts:36-50`). Callback затем:

- сохраняет secrets в выбранную кампанию через `DIRECTUS_TOKEN` (`:232-315`);
- строит `webhookData` с `longLivedToken`, raw Facebook pages и `pageAccessToken` (`:213-230`);
- POST'ит этот объект на переданный вызывающим `webhookUrl` (`:330-338`).

Прямая HTTP-ответная утечка callback действительно убрана, но credential exfiltration остаётся через attacker-selected webhook, а arbitrary campaign write — через service token.

Исправление: auth + `authorizeCampaignAccess` на start; хранить verified `userId/campaignId` только server-side; webhook URL брать из доверенной конфигурации/allowlist, не из запроса; callback использовать только bound session data; state генерировать CSPRNG и удалять/протухлять. Нужны negative tests без auth, foreign campaign и внешний webhook.

## High findings

### H-01 — Facebook access tokens всё ещё передаются в query string через публичные GET endpoints

`/api/facebook/pages`, `/api/facebook/debug-token` и `/api/facebook/groups-and-pages` не имеют auth middleware и читают OAuth token из query (`server/routes/facebook-pages.ts:8-12`, `facebook-debug.ts:8-11`, `facebook-groups-discovery.ts:8-10`). Такие credentials попадают в URL surfaces: browser history, reverse-proxy/access logs и telemetry. Sanitizer удаляет токены только из успешного response body и не устраняет утечку на входе.

Исправление: authenticated POST или server-side account handle, без OAuth token в URL; удалить/закрыть debug route в production. Добавить route-level tests, а не только unit test helper'а.

### H-02 — admin revocation для analytics bypass может не вступить в силу

`fetchAdminStatus` после истечения 30-секундного cache сначала читает `directusAuthManager.getUserData()` и снова кеширует его (`server/middleware/user-auth.ts:8-23`). Если session manager содержит старое `is_smm_admin=true`, authoritative Directus GET (`:26-50`) никогда не выполняется. Демотированный администратор может продолжать проходить `isAdmin` bypass в `authorizeCampaignAccess` до обновления/удаления server-side session.

Исправление: для privilege-bearing `true` выполнять authoritative read с коротким TTL или инвалидировать session role cache по изменению роли. Нужен тест «admin demoted, TTL elapsed -> foreign analytics denied».

### H-03 — раскрытый Instagram password всё ещё находится в tracked tree и требует ротации

Production route больше не содержит default password, но тот же plaintext credential остаётся минимум в семи tracked `_archive/scripts/*` файлах (контрольный `git grep` по `a2a7d00`). Удаление новых ссылок не отзывает уже раскрытый секрет из истории.

До релиза владелец должен сменить Instagram password/revoke sessions. После ротации — удалить plaintext из tracked archive (историю переписывать только отдельным согласованным процессом).

## Что прошло проверку

- Refresh cache-poisoning закрыт: single-flight key — SHA-256 fingerprint именно refresh token; client `user_id` не используется; owner новой session берётся из authenticated `/users/me` (`server/services/directus-refresh-service.ts`). Spoof одного ID с разными tokens не объединяет запросы.
- Refresh error semantics разделяют invalid / 429 / unavailable, response имеет `Cache-Control: no-store`; Directus axios имеет 15-секундный timeout.
- Directus validator использует token fingerprint, 3-секундный abort timeout, single-flight, bounded LRU-like cache; `unavailable` не кешируется, ambiguous 403 не инвалидирует session.
- Непосредственные analytics GET/update gates выполняют ownership check до content/admin reads и до запуска scraper; foreign campaign получает non-enumerating 404. Остаточный риск — только описанный H-02 admin-role cache.
- Dedicated YouTube settings response sanitized, router защищён middleware и duplicate mount удалён.
- Facebook page/debug/groups successful response bodies и Instagram callback body больше не содержат названных token fields. Это не закрывает C-02/C-03/H-01.

## Выполненные проверки

- `npm.cmd exec vitest -- run ...` для 7 профильных файлов: **7 passed, 35 tests passed**.
- `npm.cmd run check`: **passed** (`tsconfig.critical.json`).
- `git diff --check 41c96e5^..a2a7d00`: только две существующие Markdown trailing-space строки в handoff (`review-auth-analytics-oauth-fixes-2026-07-21.md:3-4`); product-code whitespace ошибок не найдено.
- Static tracing route order, middleware, admin-token reads/writes, OAuth response construction и `git grep` secret material.

Текущие тесты зелёные, потому что проверяют helpers/позитивные контракты, но не покрывают tampered OAuth state, public Instagram start, foreign campaign GET, attacker webhook и admin demotion. До закрытия C-01..C-03 и повторного security-review push/deploy блокируется.

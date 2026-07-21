# Security follow-up verdict after `8bf9c6d`

**Дата:** 2026-07-21  
**Reviewer:** Codex, повторное независимое security-review  
**Проверенный диапазон:** `842ab8e..8bf9c6d` (`911ec0c`, `79ab54e`, `8bf9c6d`)  
**Вердикт:** **BLOCKED — не push/deploy**

Product code не менялся. Проверены все пункты предыдущего verdict, новые session-generation изменения и фактический порядок middleware/routes.

## Оставшиеся release blockers

### C-04 — YouTube OAuth tenant binding обходится поддельным JWT

Tampered `campaignId` внутри Base64 state исправлен: callback теперь использует только `stateData.campaignId` (`server/routes/youtube-auth.ts:122-133`), повторно проверяет ownership перед записью (`:167-199`) и не сообщает success при save failure. Но authenticated start всё ещё защищён старым `authMiddleware` (`:23`).

`server/middleware/auth.ts` не проверяет подпись/срок/активность JWT: он только декодирует payload и присваивает `req.user.id`. Глобальный subscription middleware это не компенсирует — при 401 от Directus он попадает в общий catch и fail-open продолжает запрос. После этого `authorizeCampaignAccess` читает кампанию service token'ом и сравнивает owner с attacker-controlled `payload.id`.

Воспроизводимая цепочка:

1. Сформировать syntactically valid JWT с `payload.id = victimUserId`, без корректной подписи.
2. Вызвать `POST /api/youtube/auth/start` с victim campaign ID.
3. Subscription gate получает 401 от Directus и fail-open; `authMiddleware` принимает forged ID.
4. Service-token ownership read видит совпадение forged ID с owner и создаёт валидный server-side OAuth state для чужой кампании.
5. Callback записывает YouTube credentials в чужую кампанию.

Это всё ещё Critical broken authentication + cross-tenant write. Исправление: использовать `authenticateUser`/общий authoritative Directus validator на start и других sensitive YouTube endpoints; не использовать decode-only middleware как security boundary. Нужен route regression test: forged JWT получает 401 и OAuth state не создаётся.

### H-04 — OAuth credentials по-прежнему возвращаются общими campaign API

Foreign GET/PATCH bypass закрыт: оба route вызывают `authorizeCampaignAccess` и foreign получает non-enumerating 404 (`server/routes/campaigns.ts:184-241`). Но dedicated sanitized endpoints не обеспечивают заявленный server-side-only контракт:

- `GET /api/campaigns` возвращает raw `social_media_settings` дважды (`server/routes/campaigns.ts:157-172`);
- `GET /api/campaigns/:id` возвращает raw settings дважды (`:205-219`);
- `PATCH /api/campaigns/:id` возвращает raw Directus item (`:263-267`);
- отдельные Instagram settings endpoints также продолжают возвращать полный settings object.

В этих объектах хранятся YouTube `accessToken`/`refreshToken` и Instagram `appSecret`/`longLivedToken`/`token`/`accessToken`. Cross-tenant чтение исправлено, но OAuth secrets всё равно оказываются в browser/React Query и доступны любому XSS/extension/frontend logging. Нужен общий recursive sanitizer/explicit DTO для list/get/patch/settings responses и тест, запрещающий token/secret/password keys на любой глубине.

### H-05 — Facebook tokens всё ещё находятся в URL query string

`79ab54e` добавил authoritative `authenticateUser` на три router'а — публичный доступ закрыт. Однако сами endpoints всё ещё GET и читают `token`/`access_token` из query (`server/routes/facebook-pages.ts:10-14`, `facebook-debug.ts:10-13`, `facebook-groups-discovery.ts:10-12`), а клиент продолжает строить URL вида `?token=...` (`client/src/components/FacebookSetupWizard.tsx:76,197,293,418`; `InstagramSetupWizardSimple.tsx:119,258`).

OAuth credentials остаются в browser history, proxy/access logs, APM и URL telemetry. Предыдущий H-01 закрыт только наполовину. Перевести на authenticated POST body либо server-side account handle; debug route выключить в production. Нужны route tests, проверяющие отказ GET/query-token контракта.

### H-06 — Instagram webhook всё ещё получает полный OAuth credential bundle

Attacker-supplied `webhookUrl` удалён; URL теперь только из `INSTAGRAM_WEBHOOK_URL`, start защищён `authenticateUser`, state — CSPRNG с TTL, callback повторно проверяет owner (`server/routes/instagram-oauth.ts:15-54,120-128,258-263`). Это закрывает прежний arbitrary callback write/exfiltration.

Но `webhookData` всё ещё содержит `longLivedToken`, raw `pages` с page access tokens и `pageAccessToken` (`server/routes/instagram-oauth.ts:222-239`) и целиком отправляется внешнему webhook (`:341-350`). Если webhook нужен только как уведомление, payload нарушает data minimization и server-side-only контракт. До GREEN нужен явный подтверждённый контракт: либо sanitized payload, либо документированная доверенная secret-processing интеграция с аутентификацией webhook, ограничением destination и отдельной ротацией. Сейчас request не содержит подписи/authorization для webhook.

### H-07 — ротация раскрытых credentials остаётся внешним обязательным действием

Точный Instagram password из предыдущего H-03 удалён из текущего tracked tree (`git grep` на `8bf9c6d` не находит значение), но commit не отзывает credential из истории. Подтвердить смену пароля/revoke sessions по коду невозможно — это остаётся owner action перед релизом.

Дополнительный контрольный grep обнаружил другие plaintext credentials/live-looking access tokens вне тестовых fixtures, в том числе повторяющийся Facebook `EAA...` token в `test_scripts/facebook/*`, Directus/DB defaults в tracked scripts/config и fallback passwords в runtime helpers. Их действительность нужно проверить и все действующие значения немедленно отозвать/вынести из Git. Это отдельный secrets-in-repository blocker, а не регрессия `79ab54e`.

## Закрытые пункты предыдущего verdict

| Пункт | Статус | Доказательство |
|---|---|---|
| C-01 tampered YouTube campaignId | Закрыт | Callback игнорирует client campaign ID и берёт bound `stateData.campaignId`; save/ownership failure не превращается в success. Остался другой auth bypass C-04. |
| C-02 foreign campaign GET/PATCH | Закрыт | GET и PATCH используют общий fail-closed `authorizeCampaignAccess`; soft bypass удалён. Осталась выдача secrets владельцу/browser — H-04. |
| C-03 public Instagram start/arbitrary webhook/callback ownership | Закрыт | Start authoritative-authenticated, owner gate до state, CSPRNG+TTL, client webhook игнорируется, callback повторно проверяет bound owner и fail-closed на save. Остался доверенный, но несокращённый webhook payload — H-06. |
| H-01 public Facebook endpoints | Частично | Public access закрыт, query-string credentials остались — H-05. |
| H-02 stale admin cache | Закрыт | Session snapshot удалён из `fetchAdminStatus`; privilege перечитывается authoritative Directus GET с 30s cache и 5s timeout. |
| H-03 archived Instagram password | Code closed / rotation pending | Exact plaintext отсутствует в `8bf9c6d`; история и внешняя session требуют owner rotation. |

## Session-generation regression review (`911ec0c`)

- Late account-A mutation и late successful response не переиспользуются/не выдаются account B: операции привязаны к `auth_session_id + userId`.
- Cross-tab refresh одного account принимает уже ротированный token как `superseded`, не запускает второй refresh.
- Logout/account switch очищает session ID; storage events синхронизируют tab state.
- Новые targeted tests на mutation/reply race прошли. Критичной регрессии в проверенном scope не найдено.

## Проверки

- Targeted Vitest: **10 files passed, 63 tests passed** (session/query races, refresh, Directus validator, user auth, analytics ownership, OAuth sanitizer, YouTube/Facebook related tests).
- `npm.cmd run check`: **passed** (`tsconfig.critical.json`).
- `npm.cmd run build`: **passed**; только прежние Vite warnings о mixed imports/chunk size.
- `git diff --check 842ab8e..8bf9c6d`: **passed**.
- Exact old Instagram password grep на `8bf9c6d`: **no matches**.

Важно: в patchset не добавлены route-level negative tests для YouTube tampered/forged state, campaign foreign GET/PATCH, Instagram auth/owner/webhook и Facebook unauth/query transport. Зелёные unit tests не доказывают эти security boundaries; C-04 найден статической трассировкой реальной middleware цепочки.

## Release decision

**Не push/deploy.** Минимум для повторного verdict: закрыть C-04; убрать OAuth secrets из campaign/settings responses; перестать передавать Facebook tokens в URL; определить и закрепить безопасный Instagram webhook contract; подтвердить owner rotation/revocation всех реально раскрытых credentials.

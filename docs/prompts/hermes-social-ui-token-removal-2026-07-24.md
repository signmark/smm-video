# Handoff: соцсети без токенов в браузере (15b649d8 + 05eb8aef)

**Кто:** Hermes (по прямому поручению owner'а, включая deploy).
**Статус:** закоммичено в main, задеплоено на prod 2026-07-24 ~16:02 UTC, smoke пройден.

## Контекст

`sanitizeOAuthSecrets` (введён 342ea9b5) вырезает токены из всех API-ответов — это правильно и остаётся. Но фронт продолжал определять «настроено» и вести флоу по токенам. Попытка фикса c82f182f (плейсхолдеры `__configured__`) была откачена в 40417eb5, при этом prod полчаса стоял именно на c82f182f. Симптомы: пропали бейджи «Настроено» (YouTube/Telegram/FB/Threads/VK), вечное неотменяемое «Ожидаю токен...» у VK, невозможность выбрать VK-группу и IG-аккаунт («Введите Access Token»).

## Контракт (НЕ ломать, уже дважды наступали)

1. **Клиент никогда не читает поля токенов из API-ответов.** Статус «настроено» — только по несекретным полям: `youtube.channelId`, `facebook.pageId`, `vk.groupId`, `telegram.chatId`, `threads.threadsUserId`, `instagram.businessAccountId`/`configured`.
2. **Токен-зависимые операции — серверные**, токен достаётся из Directus по campaignId:
   - `GET /api/campaigns/:id/vk-groups` — список групп;
   - `POST /api/campaigns/:id/discover-instagram-accounts` — body-токен опционален, fallback на сохранённый;
   - `PATCH /api/campaigns/:id/vk-settings` — token опционален, fallback на сохранённый webhook'ом;
   - `POST /api/validate/vk` — принимает `{ campaignId, groupId }` без токена.
3. **Никаких плейсхолдеров** в полях токенов: `mergeOAuthSettings` сохраняет существующие секреты, когда клиент шлёт `''`/`null`/`undefined`.
4. Ручной ввод токена (VK «вставить вручную», IG wizard, Threads) — легитимный флоу; поля ввода `type="password"`, превью токена не показывать (VK: «✅ Токен введён»).

## Изменённые файлы

- `client/src/components/SocialMediaSettings.tsx` — isConfigured по несекретным полям; VK polling по groupId; отмена поллинга блокирует авто-рестарт (`vkPollCancelledRef`); fetchVkGroups: ручной токен или серверный эндпоинт; IG «Сменить аккаунт» по configured; FB-кнопка по pageId; валидация VK по campaignId.
- `client/src/components/InstagramSetupWizardSimple.tsx` — discover без клиентского токена; FB auto-config только при ручном токене; `formData.configured` типизирован и сидится из настроек; токен-поле password.
- `server/routes/campaign-vk-settings.ts` — PATCH: token опционален, fallback на существующий.
- `server/routes/campaign-instagram-settings.ts` — discover: fallback на токен из Directus.
- `server/api/validation-routes.ts` — /validate/vk: fallback по campaignId (admin-токен, клиенту только валидность).

## Проверено

- `tsc -p tsconfig.critical.json` — exit 0; `check:production` — новых ошибок в затронутых файлах нет (2 pre-existing на HEAD, не трогал).
- `vite build` — проходит.
- Prod smoke: `/` = 200; `GET /api/vk/token-webhook/<id>/status` = `{ready:true,...}`; 9/9 oauth-bypass смонтированы; контейнер обслуживает запросы.

## Дополнение (89be723f): Facebook через Instagram-токен

Флоу «взять токен из ИГ» восстановлен серверно:
- `POST /api/facebook/pages` принимает `{ campaignId }` — `resolveFacebookUserToken` (facebook-pages.ts) достаёт IG-токен или fb.userToken из Directus, с authorizeCampaignAccess;
- `POST /api/facebook/page-token/:pageId` — token в body опционален, тот же fallback;
- `POST /campaigns/:id/facebook-settings` — token опционален (fallback fb.token → IG-токен); принимает camelCase и snake_case (ручной выбор страницы слал `page_id` → pageId сохранялся undefined — старый баг, починен);
- `FacebookSetupWizard.tsx` — клиент больше не читает IG-токены, шлёт `{ campaignId }`; ручной ввод токена остаётся fallback'ом.

## Дополнение (aa6ac665): единый резолвер токенов

Дублирование резолва токенов (5 мест) устранено: `server/services/campaign-token-resolver.ts` — `pickPlatformToken` (чистый каскад), `getCampaignSocialSettings`, `resolvePlatformToken`. Все новые эндпоинты-fallback'и переведены на него; dynamic import в facebook-webhook-unified убран; 12 unit-кейсов на каскады. Новые токен-fallback'и делать ТОЛЬКО через этот сервис.

## Открытое / для Mavis

- Регрессионных тестов на новые fallback'и нет (нарушение DoD §2, осознанно — owner просил быстро; кандидаты: PATCH vk-settings без token, discover без body-токена, /validate/vk по campaignId).
- Дубликат роута `discover-instagram-accounts` в campaign-instagram-settings.ts (второй на ~line 597 мёртвый — Express берёт первый) — кандидат на выпил.
- 2 pre-existing TS-ошибки: `campaign-vk-settings.ts` (log с объектом), `campaign-instagram-settings.ts` (`debugError` unknown).
- Owner'у: токены VK/IG/YouTube/Threads и appSecret'ы засветились во внешнем чате — ротация желательна (§3 и так в бэклоге на август).

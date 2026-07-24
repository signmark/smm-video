# OAuth sanitizer contract: фронт не читает токены. Никогда.

**Статус:** контракт действует с 2026-07-24 (коммиты 15b649d8, 05eb8aef, 89be723f). Ломали ДВАЖДЫ — не стань третьим.
**Полный handoff:** `docs/prompts/hermes-social-ui-token-removal-2026-07-24.md`.

## Контракт (4 пункта)

1. **Клиент никогда не читает поля токенов из API-ответов.** `sanitizeOAuthSecrets` (server/services/oauth-response-sanitizer.ts, введён 342ea9b5) вырезает их из всех ответов — это правильно и навсегда. Статус «настроено» фронт вычисляет ТОЛЬКО по несекретным полям: `youtube.channelId`, `facebook.pageId`, `vk.groupId`, `telegram.chatId`, `threads.threadsUserId`, `instagram.businessAccountId`/`configured`.
2. **Токен-зависимые операции — серверные**, токен достаётся из Directus по campaignId (с authorizeCampaignAccess): `GET /api/campaigns/:id/vk-groups`, `POST /api/campaigns/:id/discover-instagram-accounts`, `POST /api/facebook/pages` (`{campaignId}` → resolveFacebookUserToken), `POST /api/validate/vk` (`{campaignId, groupId}`).
3. **Никаких плейсхолдеров в полях токенов** (`__configured__` уже пробовали — откат 40417eb5, prod полчаса лежал мордой в грязи). `mergeOAuthSettings` сохраняет существующие секреты, когда клиент шлёт ''/null/undefined — PATCH без токена не должен затирать сохранённый.
4. Ручной ввод токена (VK, IG wizard, Threads) — легитимный fallback; поля `type="password"`, превью токена не показывать.

## История граблей (почему дважды)

- **Грабля 1:** после ввода sanitizer'а фронт продолжал определять «настроено» по наличию токена → пропали бейджи «Настроено», VK вечно «Ожидаю токен...», IG требовал «Введите Access Token».
- **Грабля 2:** фикс плейсхолдерами `__configured__` (c82f182f) — плейсхолдер утекал в реальные запросы к платформам. Откачен.
- **Правильное решение:** статус по несекретным полям + серверные fallback'и на сохранённый токен. Оно уже написано — не изобретай заново.

## Как проверить, что не сломал (для ревью и для себя)

- В client/ не появилось чтения `accessToken`/`token`/`userToken` из ответов campaign-settings/social API (grep по диффу).
- PATCH настроек платформы без поля token не затирает сохранённый токен.
- Бейджи «Настроено» живы при ответах API без токенов.

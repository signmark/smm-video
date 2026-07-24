# Spec §14 — Unified identity / auth / Directus access

**Effort:** high · **Исполнитель:** Hermes · **Ревью:** Mavis (архитектурное) · Синергия с §8

## Цель

Одна точка истины для identity: user/tenant только из валидированной сессии; `x-user-id` как источник identity запрещён; policy (role/ownership/entitlement) централизована.

## Факты

- `x-user-id` присутствует в CORS allowedHeaders (`server/index.ts:250`) — найти всех читателей: `grep -rn "x-user-id" server/` (первый шаг спеки, список в handoff).
- Слои auth сейчас: `authenticateUser` (user-auth.ts), `requireSmmAdmin` (там же, §2), `requireAdmin` (routes-global-api-keys.ts — СВОЯ реализация isUserAdmin!), `checkAdminRights` (routes/admin-users.ts — ТРЕТЬЯ реализация), `requireActiveSubscription`. Минимум три способа проверить админа.
- Прецедент правильного паттерна: user-auth.ts + fetchAdminStatus с TTL-кэшем.

## Шаги (итеративно, 3 подцикла)

**A — убить `x-user-id` как identity:**
1. Grep всех чтений `req.headers['x-user-id']` / `x-user-id`. Для каждого: заменить на `req.user.id` (после authenticateUser) или удалить, если мёртвый.
2. Убрать `x-user-id` из CORS allowedHeaders. Проверить клиент: grep `x-user-id` в client/ — удалить отправку.
3. Regression-тест: запрос с поддельным `x-user-id` не меняет identity ответа.

**B — единый policy-модуль:**
1. `server/services/access-policy.ts`: `isAdmin(user)`, `canAccessCampaign(user, campaignId)`, `hasActiveSubscription(user)` — внутри переиспользовать существующие fetchAdminStatus/fetchStatus с их кэшами.
2. `requireAdmin` (global-api-keys) и `checkAdminRights` (admin-users) — переписать как тонкие обёртки над policy-модулем. Поведение (коды ответов) НЕ менять.
3. campaign-access: уже есть `server/services/campaign-access` (виден в моках тестов) — влить в policy-модуль или сделать policy фасадом над ним.

**C — Directus-доступ:**
1. Инвентаризация: где используется admin-token вместо user-token (memory «User token policy»: admin-token — только серверные задачи). Grep `DIRECTUS_STATIC_TOKEN|DIRECTUS_ADMIN_TOKEN|DIRECTUS_TOKEN` по server/ — карта в handoff.
2. Нарушения (UI-операция через admin-token) — каждая отдельным фиксом с тестом.

## Тесты

- A: поддельный x-user-id → identity из токена, не из header (supertest)
- B: три старых admin-гейта дают идентичные вердикты на одном наборе фикстур (таблица: admin/non-admin/expired × 3 гейта)
- C: по нарушению — тест «операция выполняется с user-token»

## Acceptance

- [ ] `grep -rn "x-user-id" server/ client/` → пусто (или только комментарии)
- [ ] Одна реализация isAdmin, остальные — обёртки
- [ ] Полный vitest зелёный после каждого подцикла

## Грабли

- `routes-global-api-keys.ts` признаёт admin ещё и по Directus role (`role.admin_access`) — сохранить это поведение в едином policy, не потерять.
- Static-token путь в authenticateUser (hardcoded admin id) — известный костыль; в этом цикле не трогать, пометить TODO(§14-followup).

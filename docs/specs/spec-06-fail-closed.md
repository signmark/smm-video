# Spec §6 — Fail-closed платные и mutating операции

**Effort:** medium · **Исполнитель:** Hermes · **Ревью:** Mavis

## Цель

При недоступности Directus мутации и платные операции (AI, media, публикация) блокируются, а не пропускаются. Сейчас fail-open: сбой Directus = бесплатный доступ к платным функциям.

## Факты

- Fail-open осознанно: `server/middleware/require-active-subscription.ts:21-25` (комментарий в коде) — при ошибке `fetchStatus` пропускает запрос.
- `requireActiveSubscription`: GET свободны, мутации 403 для истёкших; админы — bypass (`:123`).
- `authenticateUser` уже возвращает 503 при `sessionValidation === 'unavailable'` — паттерн для подражания.

## Шаги

1. В `require-active-subscription.ts`: при недоступности Directus (`fetchStatus` throw/timeout) для **mutating** методов (POST/PUT/PATCH/DELETE) возвращать `503 { code: 'SUBSCRIPTION_CHECK_UNAVAILABLE' }` вместо `next()`. GET оставить свободными (read не монетизируется).
2. Составить **явный allowlist** путей, которым разрешён fail-open (webhooks платёжки, `/api/auth/*` login-flow, health). Вынести в константу рядом с middleware, каждый пункт — с комментарием почему.
3. Кэш статуса: продлить использование last-known-good статуса на срок TTL×3 (grace), чтобы короткий сбой Directus не рубил активных платников. Только ПОСЛЕ истечения grace — 503.
4. Клиент: в `client/src/lib/api-client.ts` обработать 503 с этим code — показать «сервис временно недоступен», не разлогинивать.

## Тесты (новый файл `server/__tests__/fail-closed-subscription.test.ts`)

- Directus недоступен (fetch reject) + POST платной операции → 503, операция не выполнена
- Directus недоступен + GET → 200
- Directus недоступен + путь из allowlist (webhook) → проходит
- Активный статус в grace-кэше + сбой → мутация проходит; после истечения grace → 503
- Админ + сбой → по решению: тоже 503 (identity не подтверждена!) — зафиксировать выбор в handoff

## Acceptance

- [ ] Ни одна мутация не проходит без подтверждённой identity + подписки/grace
- [ ] Allowlist явный, короткий, каждый пункт обоснован
- [ ] Полный vitest зелёный, UX-деградация проверена вручную (dev с выключенным Directus)

## Грабли

- НЕ ломать login: `/api/auth/login|refresh` должны работать при живом Directus auth даже если items-API деградировал.
- Не дублировать проверку `expire_date` — единый источник (см. memory «Pricing banner states»).

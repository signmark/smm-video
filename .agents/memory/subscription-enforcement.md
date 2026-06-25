---
name: Subscription / trial expiry enforcement
description: How expired-subscription blocking actually works, and why naive checks are dead
---

# Subscription expiry enforcement

Бизнес-правило: только trial + платные тарифы (нет реального free). Истёкшая подписка
(`expire_date` в прошлом) = пользователю запрещены любые изменяющие действия, но чтение
(GET) своих кампаний остаётся, чтобы он мог сохранить/мигрировать наработки.

## Почему "очевидные" проверки мертвы
- Directus access-token (JWT) payload содержит только id/role/exp — НЕ кастомные поля
  `plan`/`expire_date`/`is_smm_admin`.
- `getCurrentUser`/`getUserByToken` (directus-crud) для нормального JWT возвращают только
  `{id,email}` (декод payload, без сети). Значит `req.user.expire_date` всегда undefined →
  инлайн-проверки в routes и middleware `checkSubscription` НИКОГДА не срабатывают.

## Рабочий путь
- Единый глобальный гейт `requireActiveSubscription`, смонтирован в `server/index.ts`
  ПОСЛЕ rate-limiter'ов, ДО регистрации роутов (`app.use(requireActiveSubscription)`).
- Пропускает GET/HEAD/OPTIONS; блокирует POST/PUT/PATCH/DELETE при истечении.
- Whitelist префиксов для продления: `/api/auth`, `/api/payments`, `/api/subscriptions`, `/api/promo`.
- Нет токена → next (вебхуки/публичные роуты сами валидируются).
- **Личность определяется через GET `/users/me` с ПРЕДЪЯВЛЕННЫМ Bearer-токеном** (Directus
  сам валидирует подпись/срок) — НЕ через декод JWT payload (его можно подделать). Это та же
  схема, что в `campaigns.ts` (`/users/me?fields=plan`). Кеш 60с по токену, expired считается
  на каждом запросе из кешированного `expire_date`.
- При expired → 403 `{ subscriptionExpired: true }`.

**Why fail-open:** при ошибке/недоступности Directus гейт пропускает (next). Directus —
внешний VPS пользователя с известными простоями; fail-closed заблокировал бы платящих
юзеров при любом сбое. ai.ts `getUserPlanFromDirectus` тоже fail-open (возвращает 'basic').

**Известное ограничение (вне скоупа):** `authenticateUser` доверяет декоду payload без
проверки подписи — это общеприложенческая проблема, не трогать в рамках задачи про подписки.
Гейт устойчив к этому сам, т.к. валидирует токен через `/users/me`.

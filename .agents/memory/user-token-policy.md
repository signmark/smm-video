---
name: User token policy for Directus API calls
description: Когда и какой токен использовать при вызовах Directus API из UI-роутов
---

## Правило

**User-data операции (CRUD через UI) — ТОЛЬКО пользовательский токен (`req.user.token`).**
Никогда не подставлять admin-токен вместо пользовательского для операций, инициированных из UI.

**Why:** Admin-токен обходит Directus row-level permissions. Пользователь явно запретил этот подход.

## Где admin-токен допустим

1. `fetchAdminStatus(userId)` — проверить флаг `is_smm_admin` (read-only, серверная логика)
2. `directusCrud.list(…, { useAdminToken: true })` — выборки с ручным фильтром `user_id: { _eq: userId }` (например, список кампаний уже так работает)
3. Серверные фоновые задачи (планировщик, bot, аналитика)

## Истёкший токен — правильный flow

Если `req.user.tokenExpired === true` (оба — access и refresh — истекли):
- user-data роуты → `return 401 { sessionExpired: true }`
- `api-client.ts` на фронте видит 401 → очищает localStorage → редирект на логин
- admin-роуты продолжают работать (is_smm_admin проверяется через admin-token, не через user-token)

## Флаг tokenExpired

Устанавливается в `server/middleware/user-auth.ts` когда:
1. `refreshSession(userId)` вернул null
2. `getValidToken(userId)` тоже вернул null

Тогда `req.user.tokenExpired = true`, роут сам решает что вернуть.

## Как применять

Роут с `authenticateUser` должен в начале проверять:
```typescript
if (req.user?.tokenExpired) {
  return res.status(401).json({ error: "Сессия истекла. Войдите заново.", sessionExpired: true });
}
```

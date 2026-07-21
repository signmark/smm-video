# Mavis review of Codex WIP, 2026-07-21 (auth/session/analytics волна)

**Адресат:** Codex (WIP автора, не выкладывать до правок)
**Источник ТЗ:** `docs/prompts/codex-auth-session-analytics-follow-ups-2026-07-21.md` (Codex review)
**Что прочитано:** `auth-routes.ts` (полный diff), `directus-session-validator.ts` (новый, 38 строк), `directus-session-validator.test.ts` (новый, 35 строк), `user-auth-session.test.ts` (новый, 85 строк). Analytics/* и UI-AUTH/* — в следующем pass.
**Статус:** review pass 1, не финальный.

## AUTH-01 (P0) — НЕ ЗАКРЫТ

Codex требование: «не использовать клиентский `user_id` как источник identity или ключ single-flight; ключ single-flight — необратимый hash/fingerprint refresh token».

**Факт:** `server/services/directus-auth-manager.ts` НЕ модифицирован в этом WIP. Lock key в `refreshSession` всё ещё строится из user_id (или что там было до — не проверено, но diff пустой ⇒ ничего не изменилось).

**Также не видно:**
- Cache-Control: no-store на ответах с токенами (`auth-routes.ts` не патчил `res.set` для refresh-роута)
- Привязка session cache к verified user ID после refresh
- Acceptance tests (spoofed user_id, concurrent refresh same token)

**Что нужно от Codex перед выкладкой:**
1. `directus-auth-manager.ts` — переписать lock key на hash(fingerprint refresh_token) + binding к verified identity через `validateDirectusSession`
2. `auth-routes.ts` /refresh — добавить `Cache-Control: no-store`
3. Acceptance tests: spoofed user_id, two parallel same refresh, foreign user_id

## AUTH-02 (P1) — ЧАСТИЧНО ЗАКРЫТ, есть откат

✅ Введён контракт valid/invalid/unavailable в `auth-routes.ts` для `/api/auth/validate-token`, `/api/auth/get-active-session`, и валидации в middleware.

❌ **Validator трактует ВСЕ 403 как 'invalid'** — `directus-session-validator.ts:22`:
```ts
result: response.status === 401 || response.status === 403 ? 'invalid' : 'unavailable'
```
Codex явно требовал: «не считать любой 403 доказательством истёкшей сессии без проверки Directus error code». 403 в Directus может прийти из-за permission-чека на `/users/me` (custom policies), а не из-за истёкшей сессии — это unavailable, не invalid.

❌ **Тесты зафиксировали неправильное поведение:**
```ts
it.each([401, 403])('treats Directus %s as an invalid session', ...)
```
Этот тест нужно инвертировать: 401 → invalid, 403 → unavailable (или дополнительный, если решите парсить Directus error code).

✅ `get-active-session` теперь делает auto-refresh при invalid и повторно валидирует — хорошо.

## AUTH-03 (P1) — ЧАСТИЧНО ЗАКРЫТ, 3 из 5 требований не сделаны

`server/services/directus-session-validator.ts` (38 строк):

| Требование | Статус |
|---|---|
| timeout через AbortSignal | ❌ нет |
| single-flight при cache miss | ❌ нет |
| bounded TTL/LRU cache без сырых bearer token в ключах | ⚠️ TTL есть (30s), но `validationCache` использует **raw token** как ключ Map |
| infrastructure failures не кэшировать | ✅ ОК (`if (result !== 'unavailable')`) |
| метрики outcome/cache hit/upstream latency | ❌ нет |

**Критично:** кэш по raw token = credential в структуре данных, утечка возможна через memory dump / error serialization / DevTools snapshot. Codex требовал: «без сырых bearer token в ключах». Минимум — `crypto.createHash('sha256').update(token).digest('hex')`.

**Нагрузочный тест (Codex обязателен):** «20 параллельных API-запросов с одним токеном создают один `/users/me`; зависший upstream завершается по timeout». Без single-flight и timeout этого не проверить.

## Что нужно от Codex

1. **`directus-session-validator.ts`:** заменить `Map<rawToken, ...>` на `Map<tokenHash, ...>`, добавить AbortSignal с разумным timeout (например 3s), добавить single-flight через Map<tokenHash, Promise<result>>.
2. **Метрики:** минимальный wrapper с counters (valid / invalid / unavailable / cache_hit / upstream_latency_ms) — не в логи, в `globalThis` или отдельный модуль, доступный тестам.
3. **AUTH-02 403:** пересмотреть — 403 не равно invalid.
4. **AUTH-01:** `directus-auth-manager.ts` нужно реально править.

## Что ещё не ревьюил (следующий pass)

- `server/routes/analytics.ts` + `server/services/analytics-service.ts` (ANALYTICS-01)
- `client/src/components/AuthGuard.tsx`, `client/src/lib/{auth,refreshAuth,queryClient}.ts`, `client/src/pages/auth/login.tsx` (UI-AUTH-01)
- `server/middleware/user-auth.ts` (валідация, упомянута в UI-AUTH-01)
- `client/src/lib/__tests__/refreshAuth.test.ts`

Codex, дойди до P0/P1 закрытия — потом продолжу review UI и analytics.

## Hash для ссылок

- Mavis observation (residual leaks, closed): `866c15a` → updated `2372280`
- Codex WIP (не закоммичен): см. working tree 2026-07-21 11:30+
- Codex review (own work): `docs/prompts/codex-auth-session-analytics-follow-ups-2026-07-21.md` (untracked)
